/**
 * `pinloop fit` — the local overlay on this fork.
 *
 * plan and score talk to no server. docs writes profile files on this machine.
 * load uploads those files with `pinloop profile put`, which is the supported
 * way to store them, and refuses to run until a login exists.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Command } from 'commander';

import { CREDENTIALS_FILENAME, CONFIG_DIR_ENV_VAR } from '../cli/paths.ts';
import { fitDocuments, readBackground } from './documents.ts';
import { fitPlan, planText, type FitQuery } from './plan.ts';
import { rowsFromJson, screenPosting, type ScreenResult } from './rubric.ts';

const ACTIONS = ['plan', 'docs', 'load', 'score'] as const;
type Action = (typeof ACTIONS)[number];

function configDir(): string {
  const override = process.env[CONFIG_DIR_ENV_VAR];
  if (override && override !== '') return override;
  return join(homedir(), '.pinloop');
}

function credentialsExist(): boolean {
  return existsSync(join(configDir(), CREDENTIALS_FILENAME));
}

/**
 * Where generated profile files go. The repo copy is gitignored. A global
 * install has no repo, so the files land under the Pinloop config directory.
 */
export function profileDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoFit = join(here, '..', '..', 'fit', 'profile');
  const repoRoot = join(here, '..', '..');
  if (existsSync(join(repoRoot, '.git')) && existsSync(join(repoRoot, 'package.json'))) {
    return repoFit;
  }
  return join(configDir(), 'fit', 'profile');
}

export function writeProfileFiles(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const document of fitDocuments(readBackground())) {
    const path = join(dir, `${document.name}.md`);
    writeFileSync(path, document.text);
    written.push(path);
  }
  return written;
}

export function scoreStdin(raw: string): ScreenResult[] {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      'pinloop fit score reads Pinloop JSON from standard input (pinloop search --json, or a rows array). The input was not JSON.',
    );
  }
  return rowsFromJson(parsed).map((row, index) => screenPosting(row, index));
}

function scoreText(results: ScreenResult[]): string {
  if (results.length === 0) return 'no postings were piped in\n';
  const lines = [`local screen of ${results.length} postings. This is not a Pinloop judge verdict.`, ''];
  for (const result of results) {
    lines.push(`${result.screen}  ${result.title}  ${result.company}`);
    lines.push(`  ${result.reason}`);
  }
  const counts = { no: 0, weak: 0, fair: 0, strong: 0 };
  for (const result of results) counts[result.screen] += 1;
  lines.push('');
  lines.push(
    `${counts.strong} strong, ${counts.fair} fair, ${counts.weak} weak, ${counts.no} no`,
  );
  return `${lines.join('\n')}\n`;
}

function loadProfiles(dir: string, json: boolean): void {
  if (!credentialsExist()) {
    throw new Error(
      'pinloop fit load needs a login. Run pinloop login, then pinloop fit load. Nothing was uploaded.',
    );
  }
  const paths = writeProfileFiles(dir);
  const script = process.argv[1];
  if (!script) throw new Error('could not find this pinloop script to run profile put');
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
    const child = spawnSync(process.execPath, [script, 'profile', 'put', name, '--file', path], {
      stdio: json ? 'pipe' : 'inherit',
      encoding: 'utf8',
    });
    if (child.status !== 0) {
      const detail = json ? child.stderr || child.stdout : '';
      throw new Error(`pinloop profile put ${name} failed.${detail ? ` ${detail.trim()}` : ''}`);
    }
    if (json) process.stderr.write(child.stdout ?? '');
  }
}

function refuseUnknown(action: string): never {
  throw new Error(
    `pinloop fit has no action called "${action}". The actions are: ${ACTIONS.join(', ')}.`,
  );
}

export function addFitCommand(program: Command): void {
  program
    .command('fit')
    .description('count plan, local screen, and profile docs for this fork')
    .argument('[action]', `one of ${ACTIONS.join(', ')}`, 'plan')
    .option('--json', 'print JSON')
    .action(async (action: string, options: { json?: boolean }) => {
      if (!ACTIONS.includes(action as Action)) refuseUnknown(action);
      const chosen = action as Action;
      const dir = profileDir();

      if (chosen === 'plan') {
        const queries: FitQuery[] = fitPlan();
        if (options.json) {
          process.stdout.write(`${JSON.stringify({ queries }, null, 2)}\n`);
          return;
        }
        process.stdout.write(planText(queries));
        return;
      }

      if (chosen === 'docs') {
        const paths = writeProfileFiles(dir);
        if (options.json) {
          process.stdout.write(`${JSON.stringify({ dir, files: paths }, null, 2)}\n`);
          return;
        }
        process.stdout.write(`wrote ${paths.length} profile documents to ${dir}\n`);
        process.stdout.write('These files are local. Do not commit them. Load them with pinloop fit load after pinloop login.\n');
        return;
      }

      if (chosen === 'load') {
        loadProfiles(dir, options.json === true);
        process.stdout.write(`loaded profile documents from ${dir}\n`);
        return;
      }

      const raw = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        process.stdin.on('error', reject);
      });
      const results = scoreStdin(raw);
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ rows: results }, null, 2)}\n`);
        return;
      }
      process.stdout.write(scoreText(results));
    });
}
