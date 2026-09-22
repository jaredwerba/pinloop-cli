/**
 * `pinloop intake applied` — the bridge from the intake store to the
 * career-ops application tracker (`data/applications.md`).
 *
 * One call does three things:
 *   1. verifies the url was actually stored by intake (last 14 days),
 *   2. appends one row to the tracker matching its existing table format,
 *   3. logs the application to applied.jsonl so the same url can never be
 *      marked applied twice (unless --force).
 *
 * The tracker file is only ever appended to — the header and all existing
 * rows are read, never rewritten, so this is safe to run against the real
 * tracker.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readDays } from './store.ts';

/** The tracker's legacy 9-column header (AGENTS.md Step 4), used when the file doesn't exist yet. */
const FALLBACK_HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const FALLBACK_RULE = '|---|------|---------|------|-------|--------|-----|--------|-------|';

/** Header text (lowercased) → canonical field. Same aliases tracker-parse.mjs knows. */
const HEADER_ALIASES: Record<string, string> = {
  '#': 'num', num: 'num', no: 'num',
  date: 'date',
  company: 'company', employer: 'company',
  role: 'role', title: 'role', position: 'role',
  score: 'score',
  status: 'status',
  pdf: 'pdf', 'cv pdf': 'pdf', 'cv': 'pdf',
  report: 'report',
  notes: 'notes', note: 'notes',
};

/** Local today stamp (YYYY-MM-DD) in the tracker's timezone. */
export function localDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

/** Neutralize characters that would corrupt the markdown table. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

type HeaderMap = { cells: string[]; map: Record<string, number> };

/** Parses the first table row of the tracker as its header. Null when no header line exists. */
function detectHeader(text: string): HeaderMap | null {
  for (const line of text.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim().toLowerCase());
    const map: Record<string, number> = {};
    cells.forEach((c, i) => {
      const field = HEADER_ALIASES[c];
      if (field != null && map[field] === undefined) map[field] = i;
    });
    if (map['company'] !== undefined && map['role'] !== undefined) return { cells, map };
    return null; // first pipe line that isn't a recognizable header: don't guess further
  }
  return null;
}

/** Builds one tracker row in the detected (or fallback) column order. */
function trackerRow(header: HeaderMap, fields: { date: string; company: string; role: string; url: string; note: string }): string {
  const notes = fields.note !== '' ? `${fields.note} (${fields.url})` : fields.url;
  const values: Record<string, string> = {
    num: '', date: cell(fields.date), company: cell(fields.company), role: cell(fields.role),
    score: '', status: 'Applied', pdf: '', report: '', notes: cell(notes),
  };
  const row = header.cells.map((_, i) => '');
  for (const [field, index] of Object.entries(header.map)) {
    row[index] = values[field] ?? '';
  }
  return `| ${row.slice(1, header.cells.length - 1).join(' | ')} |`;
}

export function markApplied(
  dir: string,
  url: string,
  note: string,
  trackerPath: string,
  now: Date = new Date(),
  force = false,
): { day: string; title: string; company: string; tracker: string } {
  if (url === '') throw new Error('a url is required');

  // 1. the posting must be in the intake store (last 14 days)
  const stored = readDays(dir, 14).find((row) => row['url'] === url);
  if (!stored) {
    throw new Error(
      `no stored posting with url ${url} in the last 14 day(s) of intake. ` +
        'Run pinloop intake boards first — nothing is invented in its place.',
    );
  }
  const title = String(stored['title'] ?? '');
  const company = String(stored['company'] ?? '');

  // 3 (read side). dedupe against the applied log
  const logFile = join(dir, 'applied.jsonl');
  if (existsSync(logFile) && !force) {
    for (const line of readFileSync(logFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const entry = JSON.parse(trimmed) as { url?: string };
        if (entry.url === url) {
          throw new Error(
            `${url} is already marked applied (see ${logFile}). ` +
              'Pass --force to record it again.',
          );
        }
      } catch (error) {
        if (error instanceof SyntaxError) continue; // torn line: skip
        throw error;
      }
    }
  }

  // 2. append one row to the tracker, matching its existing table format
  const day = localDay(now);
  let header: HeaderMap;
  if (existsSync(trackerPath)) {
    const parsed = detectHeader(readFileSync(trackerPath, 'utf8'));
    if (!parsed) {
      throw new Error(
        `${trackerPath} exists but its table header is not recognizable. ` +
          'Fix the header (it must at least have Company and Role columns) before marking applied.',
      );
    }
    header = parsed;
  } else {
    mkdirSync(join(trackerPath, '..'), { recursive: true });
    appendFileSync(trackerPath, `# Applications Tracker\n\n${FALLBACK_HEADER}\n${FALLBACK_RULE}\n`);
    header = detectHeader(readFileSync(trackerPath, 'utf8')) as HeaderMap;
  }

  // number the row: one past the last numbered data row
  let next = 1;
  for (const line of readFileSync(trackerPath, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const first = (line.split('|')[1] ?? '').trim();
    const parsedNum = Number(first);
    if (first !== '' && Number.isInteger(parsedNum) && parsedNum >= next) next = parsedNum + 1;
  }
  const rowLine = trackerRow(header, { date: day, company, role: title, url, note });
  const numbered = rowLine.replace(/^\|  /, `| ${next} `);
  appendFileSync(trackerPath, `${numbered}\n`);

  // 3 (write side). append to the dedupe log
  appendFileSync(logFile, `${JSON.stringify({ url, day, title, company, note })}\n`);

  return { day, title, company, tracker: trackerPath };
}

/** Default tracker path, overridable via PINLOOP_APPLIED_TRACKER. */
export function defaultTrackerPath(): string {
  const env = process.env['PINLOOP_APPLIED_TRACKER'];
  if (env && env !== '') return env;
  return '/home/jkw/Projects/career-ops/data/applications.md';
}
