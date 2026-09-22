/**
 * `pinloop mcp` — a Model Context Protocol server over stdio for this fork.
 *
 * Speaks the MCP JSON-RPC shape (initialize, tools/list, tools/call) on stdin
 * and stdout, one JSON message per line, so any MCP client — Claude Desktop,
 * Cursor, another Hermes agent — can drive the pipeline as tools:
 *
 *   intake_boards    fetch + screen + store postings from board APIs
 *   intake_status    today's counts against the daily target
 *   intake_day       read stored postings, optionally filtered by verdict
 *   fit_score        screen arbitrary posting rows through the local rubric
 *   fit_plan         the ordered count plan (no network)
 *
 * Everything is local: no login, no Pinloop server calls, no spend. Logs go to
 * stderr so stdout stays protocol-pure.
 */
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Command } from 'commander';

import { rowsFromJson, screenPosting } from '../fit/rubric.ts';
import { fitPlan } from '../fit/plan.ts';
import { addRows, attachScores, dayStamp, DAILY_TARGET, intakeDir, readDays, type ScoreRow } from './store.ts';
import { fetchBoards, parseBoardSpecs, type IntakeRow } from './sources.ts';
import { DEFAULT_BOARDS, defaultIntakeDir } from './run.ts';
import { briefForUrl, briefId, briefsForFilter } from './brief.ts';
import { markApplied, defaultTrackerPath } from './applied.ts';

type JsonValue = Record<string, unknown>;

/** One tool's contract, sent in tools/list. */
type Tool = {
  name: string;
  description: string;
  inputSchema: JsonValue;
};

const TOOLS: Tool[] = [
  {
    name: 'intake_boards',
    description:
      'Fetch job postings from public board APIs (Greenhouse, Lever, Ashby — no keys), screen each against the local fit rubric, dedupe, and store. Returns counts against the daily target.',
    inputSchema: {
      type: 'object',
      properties: {
        boards: {
          type: 'array',
          items: { type: 'string' },
          description: 'Board specs like "greenhouse:stripe", "lever:nebius", "ashby:openai". Omit for the default list.',
        },
      },
    },
  },
  {
    name: 'intake_status',
    description: "Today's intake counts (added, duplicates, day total, screen breakdown) against the daily target.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'intake_day',
    description: 'Read stored postings from the last N days, optionally filtered to one verdict.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days back (default 1).' },
        screen: { type: 'string', enum: ['strong', 'fair', 'weak', 'no'], description: 'Only rows with this verdict.' },
        limit: { type: 'number', description: 'Cap the returned rows (default 50).' },
      },
    },
  },
  {
    name: 'fit_score',
    description: 'Screen posting rows (title/company/locations/countries/employment/workplace/experience) through the local rubric without storing anything.',
    inputSchema: {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'object' }, description: 'One or more posting rows.' },
      },
      required: ['rows'],
    },
  },
  {
    name: 'intake_brief',
    description:
      'Resume-factory input for one posting url: returns the stored job description rendered as the career-ops resume-factory §0 block (JOB_POSTING/COMPANY/ROLE_TITLE pre-filled). No network; posting must be in the local intake store.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The posting url as stored at intake.' },
        days: { type: 'number', description: 'How many days of intake to search (default 7).' },
      },
      required: ['url'],
    },
  },
  {
    name: 'intake_brief_all',
    description:
      'Batch resume-factory briefs: writes a §0 file for every stored posting matching the screen verdict that carries a full description (>200 chars). Returns the written file paths.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days of intake to read (default 1).' },
        screen: { type: 'string', enum: ['strong', 'fair', 'weak', 'no'], description: 'Only rows with this verdict (default strong).' },
        limit: { type: 'number', description: 'Cap the number of briefs written (default 20).' },
      },
    },
  },
  {
    name: 'intake_serve_push',
    description: 'Push one posting row into the intake store without the HTTP server (same shape as POSTing to intake serve).',
    inputSchema: {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'object' }, description: 'Posting rows (title/company required).' },
      },
      required: ['rows'],
    },
  },
  {
    name: 'intake_applied',
    description:
      'Mark one stored posting as applied: verifies the url is in the local intake store (last 14 days), appends a row to the career-ops application tracker (default PINLOOP_APPLIED_TRACKER or /home/jkw/Projects/career-ops/data/applications.md), and records it in applied.jsonl so it cannot be marked twice without force.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The posting url as stored at intake.' },
        note: { type: 'string', description: 'Optional note recorded with the application.' },
        force: { type: 'boolean', description: 'Record even if this url is already in applied.jsonl (default false).' },
      },
      required: ['url'],
    },
  },
  {
    name: 'intake_score',
    description:
      'Attach external scorer output (e.g. Jev scores) onto already-stored intake rows, matched by url over the last N days. Give a file path or inline rows.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to a score file: a bare array of rows, or an object with a jobs array; each row needs a url.' },
        rows: { type: 'array', items: { type: 'object' }, description: 'Inline score rows instead of a file; each needs a url.' },
        scorer: { type: 'string', description: 'Name recorded in each scores object (default "jev").' },
        days: { type: 'number', description: 'How many days of intake to match against (default 7).' },
      },
    },
  },
  {
    name: 'fit_plan',
    description: 'Print the ordered Pinloop count plan for this fork. Counts only; runs no commands.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/** Reuses run.ts's push-row shape without importing the CLI module. */
function pushToRow(value: Record<string, unknown>): IntakeRow {
  const now = new Date().toISOString();
  const locations = Array.isArray(value['locations']) ? (value['locations'] as unknown[]).map(String) : [];
  return {
    source: 'push',
    board: typeof value['board'] === 'string' ? value['board'] : 'push',
    id:
      typeof value['id'] === 'string' && value['id'] !== ''
        ? String(value['id'])
        : `push-${now}-${Math.random().toString(36).slice(2, 8)}`,
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
}

/** Dispatches one tools/call; every result comes back as MCP text content. */
async function callTool(name: string, args: JsonValue): Promise<unknown> {
  switch (name) {
    case 'intake_boards': {
      const specs = Array.isArray(args['boards']) ? (args['boards'] as unknown[]).map(String) : DEFAULT_BOARDS;
      const { rows, errors } = await fetchBoards(parseBoardSpecs(specs));
      const { counts, addedRows } = addRows(defaultIntakeDir(), rows);
      return { counts, errors, sample: addedRows.slice(0, 10).map((one) => ({ title: one.title, company: one.company, screen: one.screen })) };
    }
    case 'intake_status': {
      const rows = readDays(defaultIntakeDir(), 1);
      const screened = { no: 0, weak: 0, fair: 0, strong: 0 };
      for (const row of rows) {
        const key = row['screen'];
        if (key === 'no' || key === 'weak' || key === 'fair' || key === 'strong') screened[key] += 1;
      }
      return { day: dayStamp(), dayTotal: rows.length, target: DAILY_TARGET, screened };
    }
    case 'intake_day': {
      const days = typeof args['days'] === 'number' ? args['days'] : 1;
      const limit = typeof args['limit'] === 'number' ? args['limit'] : 50;
      const screen = typeof args['screen'] === 'string' ? args['screen'] : undefined;
      let rows = readDays(defaultIntakeDir(), days);
      if (screen) rows = rows.filter((row) => row['screen'] === screen);
      return { count: rows.length, rows: rows.slice(0, limit) };
    }
    case 'intake_score': {
      let scoreRows: ScoreRow[] = [];
      if (Array.isArray(args['rows'])) {
        scoreRows = (args['rows'] as Record<string, unknown>[]).filter(
          (one): one is ScoreRow => typeof one === 'object' && one !== null && typeof one['url'] === 'string',
        );
      } else if (typeof args['file'] === 'string' && args['file'] !== '') {
        const { readFileSync } = await import('node:fs');
        const parsed = JSON.parse(readFileSync(String(args['file']), 'utf8')) as unknown;
        const list: unknown[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { jobs?: unknown })?.jobs)
            ? ((parsed as { jobs: unknown[] }).jobs as unknown[])
            : [];
        scoreRows = list.filter(
          (one): one is ScoreRow => typeof one === 'object' && one !== null && typeof (one as { url?: unknown }).url === 'string',
        );
      }
      const days = typeof args['days'] === 'number' ? args['days'] : 7;
      const scorer = typeof args['scorer'] === 'string' && args['scorer'] !== '' ? args['scorer'] : 'jev';
      const result = attachScores(defaultIntakeDir(), scorer, scoreRows, new Date(), days);
      return { ...result, scorer };
    }
    case 'fit_score': {
      const results = rowsFromJson(args['rows']).map((row, index) => screenPosting(row, index));
      return { results };
    }
    case 'intake_brief': {
      const url = String(args['url'] ?? '');
      const days = typeof args['days'] === 'number' ? args['days'] : 7;
      const brief = briefForUrl(url, days);
      if (!brief.found) {
        throw new Error(`no stored posting with url ${url} in the last ${days} day(s) of intake. Run intake_boards first.`);
      }
      return brief;
    }
    case 'intake_brief_all': {
      const days = typeof args['days'] === 'number' ? args['days'] : 1;
      const screen = typeof args['screen'] === 'string' ? args['screen'] : 'strong';
      const limit = typeof args['limit'] === 'number' ? args['limit'] : 20;
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { join: joinPaths } = await import('node:path');
      const { dayStamp: stamp } = await import('./store.js');
      // Same default directory as the CLI, so both halves write to one place.
      const dir = joinPaths(process.cwd(), 'fit', 'intake', 'briefs', stamp());
      const { briefs } = briefsForFilter(days, screen, defaultIntakeDir(), limit);
      mkdirSync(dir, { recursive: true });
      const files = briefs.map((brief) => {
        const file = joinPaths(dir, `${briefId(brief.url)}.md`);
        writeFileSync(file, `${brief.section0}\n`);
        return { url: brief.url, title: brief.title, company: brief.company, file };
      });
      return { written: files.length, dir, files };
    }
    case 'intake_serve_push': {
      const list = Array.isArray(args['rows']) ? (args['rows'] as Record<string, unknown>[]) : [];
      const { addRows } = await import('./store.js');
      const rows = list.map(pushToRow);
      const { counts } = addRows(defaultIntakeDir(), rows);
      return counts;
    }
    case 'intake_applied': {
      const url = String(args['url'] ?? '');
      const note = typeof args['note'] === 'string' ? args['note'] : '';
      const force = args['force'] === true;
      const logFile = join(defaultIntakeDir(), 'applied.jsonl');
      if (force && existsSync(logFile)) {
        // markApplied refuses duplicates on its own; force means: drop the
        // prior entries for this url before recording the new one.
        const kept = readFileSync(logFile, 'utf8')
          .split('\n')
          .filter((line: string) => {
            const trimmed = line.trim();
            if (trimmed === '') return false;
            try {
              return (JSON.parse(trimmed) as { url?: string }).url !== url;
            } catch {
              return true; // torn line: keep it
            }
          });
        writeFileSync(logFile, kept.length > 0 ? `${kept.join('\n')}\n` : '');
      }
      return markApplied(defaultIntakeDir(), url, note, defaultTrackerPath());
    }
    case 'fit_plan': {
      return { queries: fitPlan().map((query) => ({ name: query.name, command: query.command })) };
    }
    default:
      throw new Error(`no tool named '${name}'`);
  }
}

/** Serves MCP over line-delimited JSON-RPC on stdin/stdout until stdin closes. */
export async function serveMcp(): Promise<void> {
  const lines = createInterface({ input: process.stdin });
  const write = (value: JsonValue): void => {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  };
  for await (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let request: JsonValue;
    try {
      request = JSON.parse(trimmed) as JsonValue;
    } catch {
      continue; // not JSON: ignore, keep the stream alive
    }
    const id = request['id'];
    const method = String(request['method'] ?? '');
    try {
      if (method === 'initialize') {
        write({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'pinloop-fork-intake', version: '0.1.0' },
          },
        });
      } else if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
        // notifications get no reply
      } else if (method === 'tools/list') {
        write({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      } else if (method === 'tools/call') {
        const params = (request['params'] ?? {}) as JsonValue;
        const toolName = String(params['name'] ?? '');
        const toolArgs = (params['arguments'] ?? {}) as JsonValue;
        const result = await callTool(toolName, toolArgs);
        write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
      } else {
        write({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
      }
    } catch (error) {
      write({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}

export function addMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('run the MCP server over stdio (intake and fit as MCP tools)')
    .action(async () => {
      await serveMcp();
    });
}

// re-exported so tests of the store have one import site
export { intakeDir };
