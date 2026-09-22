/**
 * `pinloop intake` — the source-and-store half of this fork's pipeline.
 *
 *   pinloop intake boards --json            fetch named boards, screen, store
 *   pinloop intake serve [--port N]         HTTP endpoint for webhooks/pushers
 *   pinloop intake day [--days N] [--json]  read back what was stored
 *   pinloop intake status                   today's counts against the target
 *
 * The rubric verdict is computed at intake time and stored with the row, so
 * nothing downstream needs to re-screen. Nothing here touches the Pinloop
 * server or needs a login: the point of intake is that the daily volume of
 * 100+ postings flows locally, and only the shortlist goes upstream.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import { compactIntake } from './prune.ts';
import { markApplied, defaultTrackerPath } from './applied.ts';
import { profileDir } from '../fit/run.ts';
import { addRows, attachScores, DAILY_TARGET, dayStamp, intakeDir, readDays, type ScoreRow } from './store.ts';
import { fetchBoards, parseBoardSpecs, type IntakeRow } from './sources.ts';
import { briefForUrl, briefId, briefsForFilter } from './brief.ts';

/** Boards this fork is tuned to watch — every one verified live 2026-09-22. */
export const DEFAULT_BOARDS = [
  'greenhouse:stripe',
  'greenhouse:databricks',
  'greenhouse:nebius',
  'greenhouse:scaleai',
  'greenhouse:anthropic',
  'ashby:openai',
  'ashby:crusoe',
  'ashby:lambda',
  'ashby:braintrust',
  'ashby:launchdarkly',
  'ashby:temporal',
];

function dirOf(): string {
  const env = process.env['PINLOOP_INTAKE_DIR'];
  if (env && env !== '') return env;
  return intakeDir(profileDir());
}

function statusLine(counts: ReturnType<typeof addRows>['counts']): string {
  const { fetched, added, duplicates, dayTotal, dayTarget, screened } = counts;
  const verdict = dayTotal >= dayTarget ? 'target met' : `${dayTarget - dayTotal} more to reach the target of ${dayTarget}`;
  return (
    `fetched ${fetched}, added ${added}, duplicates skipped ${duplicates}. ` +
    `Today holds ${dayTotal} postings (${verdict}). ` +
    `Screen: ${screened.strong} strong, ${screened.fair} fair, ${screened.weak} weak, ${screened.no} no.`
  );
}

/** The boards' rows, screened and stored. Used by both the command and the server. */
async function ingestBoards(specs: string[]) {
  const boardSpecs = parseBoardSpecs(specs);
  const { rows, errors } = await fetchBoards(boardSpecs);
  const { counts, addedRows } = addRows(dirOf(), rows);
  return { counts, addedRows, errors };
}

function writeJson(response: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  response.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  response.end(text);
}

async function readBody(request: IncomingMessage, cap = 5 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > cap) throw new Error('body larger than 5 MiB');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Rows pushed straight to the endpoint, already in intake shape (or a loose
 * subset: title and company are the only required fields). Used by webhook
 * bridges, scrapers, or any other agent on this machine.
 */
function rowFromPushed(value: Record<string, unknown>): IntakeRow {
  const now = new Date().toISOString();
  const locations = Array.isArray(value['locations']) ? (value['locations'] as unknown[]).map(String) : [];
  const row: IntakeRow = {
    source: 'push',
    board: typeof value['board'] === 'string' ? value['board'] : 'push',
    id: typeof value['id'] === 'string' && value['id'] !== '' ? String(value['id']) : `push-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: typeof value['title'] === 'string' ? value['title'] : '',
    company: typeof value['company'] === 'string' ? value['company'] : '',
    locations,
    url: typeof value['url'] === 'string' ? value['url'] : '',
    description_text: typeof value['description_text'] === 'string' ? value['description_text'] : '',
    posted_at: typeof value['posted_at'] === 'string' ? value['posted_at'] : null,
    employment: typeof value['employment'] === 'string' ? value['employment'] : null,
    workplace: typeof value['workplace'] === 'string' ? value['workplace'] : null,
    seen_at: now,
    countries: Array.isArray(value['countries']) ? (value['countries'] as unknown[]).map(String) : [],
  };
  if (row.title === '' && row.company === '') {
    throw new Error('a pushed row needs at least a title or a company');
  }
  return row;
}

export function addIntakeCommand(program: Command): void {
  const intake = program.command('intake').description('feed postings in from open boards and pushed rows, screened and stored locally');

  intake
    .command('boards')
    .description('fetch postings from public board APIs (greenhouse:token, lever:token, ashby:token) and store them screened')
    .argument('[specs...]', 'board specs; with none, this fork\'s default board list is used')
    .option('--json', 'print one JSON object holding the counts and the added rows')
    .action(async (specs: string[], options: Record<string, boolean | undefined>) => {
      const list = specs.length > 0 ? specs : DEFAULT_BOARDS;
      const { counts, addedRows, errors } = await ingestBoards(list);
      if (options['json']) {
        process.stdout.write(`${JSON.stringify({ counts, errors, rows: addedRows }, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${statusLine(counts)}\n`);
      for (const error of errors) process.stderr.write(`${error}\n`);
    });

  intake
    .command('serve')
    .description('run a local HTTP endpoint that stores pushed postings; POST / with a row or a rows array')
    .option('--port <n>', 'port to listen on', '7788')
    .option('--host <host>', 'address to bind', '127.0.0.1')
    .action(async (options: Record<string, string | boolean | undefined>) => {
      const port = Number(options['port'] ?? 7788);
      const host = String(options['host'] ?? '127.0.0.1');
      const server = createServer(async (request, response) => {
        if (request.method === 'GET' && (request.url === '/' || request.url === '/status')) {
          writeJson(response, 200, {
            day: dayStamp(),
            rows: readDays(dirOf(), 1).length,
            target: DAILY_TARGET,
            boards: DEFAULT_BOARDS,
          });
          return;
        }
        if (request.method === 'POST' && (request.url === '/' || request.url === '/rows')) {
          try {
            const parsed = JSON.parse(await readBody(request)) as unknown;
            const list = Array.isArray(parsed)
              ? parsed
              : Array.isArray((parsed as { rows?: unknown })?.rows)
                ? ((parsed as { rows: unknown[] }).rows as Record<string, unknown>[])
                : [parsed as Record<string, unknown>];
            const rows = list.map(rowFromPushed);
            const { counts, addedRows } = addRows(dirOf(), rows);
            writeJson(response, 200, { counts, rows: addedRows.map((one) => ({ id: one.id, screen: one.screen })) });
          } catch (error) {
            writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        writeJson(response, 404, { error: 'not found. GET /status, or POST / with a posting row or a rows array.' });
      });
      server.listen(port, host, () => {
        process.stdout.write(`intake endpoint on http://${host}:${port} — POST rows to /, GET /status\n`);
      });
    });

  intake
    .command('day')
    .description('read back stored postings from today or the last N days')
    .option('--days <n>', 'how many days back', '1')
    .option('--screen <screen>', 'only rows with this verdict: strong, fair, weak, or no')
    .option('--json', 'print one JSON object holding the rows')
    .action(async (options: Record<string, string | boolean | undefined>) => {
      const days = Math.max(1, Number(options['days'] ?? 1) || 1);
      let rows = readDays(dirOf(), days);
      const screen = typeof options['screen'] === 'string' ? options['screen'] : undefined;
      if (screen) rows = rows.filter((row) => row['screen'] === screen);
      if (options['json']) {
        process.stdout.write(`${JSON.stringify({ rows, count: rows.length }, null, 2)}\n`);
        return;
      }
      process.stdout.write(`${rows.length} stored posting${rows.length === 1 ? '' : 's'}\n`);
      for (const row of rows) {
        process.stdout.write(
          `${String(row['screen'] ?? '?')}  ${String(row['title'] ?? '(no title)')}  ${String(row['company'] ?? '(no employer)')}  ${String(row['source'] ?? '')}\n`,
        );
      }
    });

  intake
    .command('brief')
    .description(
      'resume-factory input: one posting url rendered as the factory spec\'s §0 block, or --all for every qualifying stored posting. No network.',
    )
    .argument('[url]', 'the posting url as it was stored at intake')
    .option('--all', 'brief every stored posting matching --screen with a full description, writing one file each')
    .option('--days <n>', 'how many days of intake to search', '7')
    .option('--screen <screen>', 'with --all: only rows with this verdict (default strong)', 'strong')
    .option('--out-dir <path>', 'with --all: directory for the brief files (default fit/intake/briefs/<YYYY-MM-DD>/)')
    .option('--limit <n>', 'with --all: cap the number of briefs written (0 = no cap)', '0')
    .option('--out <path>', 'write the §0 block to this file instead of stdout')
    .option('--json', 'print one JSON object instead of human text')
    .action(async (url: string | undefined, options: Record<string, string | boolean | undefined>) => {
      const days = Math.max(1, Number(options['days'] ?? 7) || 7);

      // Batch mode: --all with no url. One file per qualifying posting, named
      // by the stable briefId so a re-run overwrites in place, never dups.
      if (options['all'] && !url) {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        const outDir =
          typeof options['outDir'] === 'string' && options['outDir'] !== ''
            ? options['outDir']
            : join(process.cwd(), 'fit', 'intake', 'briefs', dayStamp());
        const limit = Math.max(0, Number(options['limit'] ?? 0) || 0);
        const screen = typeof options['screen'] === 'string' ? options['screen'] : 'strong';
        const { briefs, considered } = briefsForFilter(days, screen, dirOf(), limit);
        mkdirSync(outDir, { recursive: true });
        const files = briefs.map((brief) => {
          const file = join(outDir, `${briefId(brief.url)}.md`);
          writeFileSync(file, `${brief.section0}\n`);
          return { url: brief.url, title: brief.title, company: brief.company, file };
        });
        const skipped = considered - briefs.length;
        if (options['json']) {
          process.stdout.write(`${JSON.stringify({ written: files.length, dir: outDir, skipped, files }, null, 2)}\n`);
          return;
        }
        process.stdout.write(`written ${files.length} briefs to ${outDir}, skipped ${skipped} (thin/missing description)\n`);
        return;
      }

      if (!url) throw new Error('give a posting url, or pass --all with no url to brief every qualifying stored posting');
      const brief = briefForUrl(url, days);
      if (!brief.found) {
        throw new Error(
          `no stored posting with url ${url} in the last ${days} day(s) of intake. ` +
            `Run pinloop intake boards first, or raise --days. Nothing was invented in its place.`,
        );
      }
      if (brief.description_chars <= 200) {
        process.stderr.write(
          `warning: the stored description is thin (${brief.description_chars} chars). ` +
            'The factory wants the full JD text; consider re-ingesting the board.\n',
        );
      }
      if (typeof options['out'] === 'string' && options['out'] !== '') {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        const { dirname: dirOf } = await import('node:path');
        mkdirSync(dirOf(options['out']), { recursive: true });
        writeFileSync(options['out'], `${brief.section0}\n`);
        process.stdout.write(`wrote the §0 block to ${options['out']} (${brief.description_chars} chars of JD)\n`);
        return;
      }
      process.stdout.write(`${brief.section0}\n`);
    });

  intake
    .command('applied')
    .description('mark one stored posting as applied: append a row to the career-ops tracker and the applied log')
    .argument('<url>', 'the posting url as it was stored at intake')
    .option('--note <text>', 'a note recorded with the application', '')
    .option('--force', 'mark it applied even if the log already has this url', false)
    .option('--tracker <path>', 'tracker file to append to', defaultTrackerPath())
    .action(async (url: string, options: Record<string, string | boolean | undefined>) => {
      const trackerPath = typeof options['tracker'] === 'string' && options['tracker'] !== '' ? options['tracker'] : defaultTrackerPath();
      const note = typeof options['note'] === 'string' ? options['note'] : '';
      const result = markApplied(dirOf(), url, note, trackerPath);
      process.stdout.write(
        `applied: ${result.title} at ${result.company} on ${result.day} — appended to ${result.tracker}\n`,
      );
    });

  intake
    .command('score')
    .description('attach external scorer output (e.g. a Jev scores file) onto stored intake rows, matched by url')
    .requiredOption('--file <path>', 'score file: a bare array of rows, or an object with a jobs array; each row needs a url')
    .option('--scorer <name>', 'name recorded in each scores object', 'jev')
    .option('--days <n>', 'how many days of intake to match against', '7')
    .option('--json', 'print one JSON object holding matched and unmatched urls')
    .action(async (options: Record<string, string | boolean | undefined>) => {
      const { readFileSync: readFile } = await import('node:fs');
      const path = String(options['file']);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFile(path, 'utf8'));
      } catch (error) {
        throw new Error(`could not read score file ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const list: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { jobs?: unknown })?.jobs)
          ? ((parsed as { jobs: unknown[] }).jobs as unknown[])
          : [];
      const scoreRows = list.filter(
        (one): one is ScoreRow => typeof one === 'object' && one !== null && typeof (one as { url?: unknown }).url === 'string',
      );
      const days = Math.max(1, Number(options['days'] ?? 7) || 7);
      const scorer = typeof options['scorer'] === 'string' && options['scorer'] !== '' ? options['scorer'] : 'jev';
      const result = attachScores(dirOf(), scorer, scoreRows, new Date(), days);
      if (options['json']) {
        process.stdout.write(`${JSON.stringify({ ...result, scorer, file: path }, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        `attached ${scorer} scores to ${result.matched} stored row(s); ${result.unmatched.length} score row(s) matched nothing` +
          `${result.unmatched.length > 0 ? `: ${result.unmatched.join(', ')}` : ''}\n`,
      );
    });

  intake
    .command('compact')
    .description('delete day files older than --keep-days and strip stored descriptions older than 48h (shortlisted urls keep theirs)')
    .option('--keep-days <n>', 'how many days of intake files to keep', '7')
    .option('--json', 'print one JSON object holding the compaction stats')
    .action(async (options: Record<string, string | boolean | undefined>) => {
      const keepDays = Math.max(0, Number(options['keepDays'] ?? 7) || 0);
      const stats = compactIntake(dirOf(), keepDays);
      if (options['json']) {
        process.stdout.write(`${JSON.stringify({ ...stats, keepDays }, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        `removed ${stats.filesRemoved} day file(s), stripped descriptions from ${stats.rowsCompacted} row(s): ` +
          `${stats.bytesBefore} -> ${stats.bytesAfter} bytes\n`,
      );
    });

  intake
    .command('status')
    .description("today's intake counts against the daily target")
    .action(async () => {
      const rows = readDays(dirOf(), 1);
      const screened = { no: 0, weak: 0, fair: 0, strong: 0 };
      for (const row of rows) {
        const value = screened[row['screen'] as keyof typeof screened];
        if (value !== undefined) screened[row['screen'] as keyof typeof screened] += 1;
      }
      const counts = { fetched: rows.length, added: rows.length, duplicates: 0, dayTotal: rows.length, dayTarget: DAILY_TARGET, screened };
      process.stdout.write(`${statusLine(counts)}\n`);
    });
}

/** Directory the MCP server reports, so both halves agree on where state lives. */
export function defaultIntakeDir(): string {
  return dirOf();
}

// keep join and homedir imports honest for the optional env override path
export function fallbackIntakeDir(): string {
  return join(homedir(), '.pinloop', 'intake');
}
