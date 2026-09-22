/**
 * Resume-factory briefs: turn an intake row into the filled §0 input the
 * career-ops resume factory expects (modes/resume-factory-spec.md).
 *
 * The factory is "JD in → resume out" and demands the full job description
 * text. The daily lists carry title/company/url only. This module closes that
 * gap with data already stored at intake time — it never invents a
 * description. If the posting is not in the local intake store, it says so.
 *
 * Integrity rules are copied from the factory spec itself: nothing here adds
 * facts, and phone/quota redaction from src/fit/documents.ts is NOT applied
 * here because the factory reads candidate facts from its own gitignored
 * files — a brief carries only the posting's words, never the candidate's.
 */
import { createHash } from 'node:crypto';

import { readDays, intakeDir } from './store.ts';
import { defaultIntakeDir } from './run.ts';
import { passesGeoGate } from './geo.ts';

export type Brief = {
  url: string;
  found: boolean;
  section0: string;
  company: string;
  title: string;
  location: string;
  posted: string | null;
  description_chars: number;
  days_looked_back: number;
};

function section0(row: Record<string, unknown>, days: number): string {
  const description = String(row['description_text'] ?? '').trim();
  return [
    'JOB_POSTING: |',
    ...description.split('\n').map((line) => `  ${line}`),
    `COMPANY:      ${String(row['company'] ?? '')}`,
    `ROLE_TITLE:   ${String(row['title'] ?? '')}`,
    'POSITIONING:  auto',
    'PAGE_LIMIT:   auto',
    'EXTRAS:       none',
    '',
    `# source url: ${String(row['url'] ?? '')}`,
    `# location: ${String(row['location'] ?? String((row['locations'] as string[] | undefined)?.[0] ?? ''))}`,
    `# posted: ${String(row['posted_at'] ?? 'unknown')}`,
    `# description drawn from the local intake store, last ${days} day(s); if it is thin, run pinloop intake boards and re-brief`,
  ].join('\n');
}

export function briefStats(rows: Record<string, unknown>[]): { rows: number; withDescription: number } {
  const withDescription = rows.filter((row) => String(row['description_text'] ?? '').trim().length > 200).length;
  return { rows: rows.length, withDescription };
}

/** Builds a brief for one url out of the stored intake rows. No network. */
export function briefForUrl(url: string, days = 7, dir = defaultIntakeDir()): Brief {
  const rows = readDays(dir, days);
  const wanted = url.replace(/\/$/, '');
  const row = rows.find((one) => String(one['url'] ?? '').replace(/\/$/, '') === wanted);
  const lookback = readDays(dir, days).length > 0 ? days : days;
  if (!row) {
    return {
      url,
      found: false,
      section0: '',
      company: '',
      title: '',
      location: '',
      posted: null,
      description_chars: 0,
      days_looked_back: lookback,
    };
  }
  const description = String(row['description_text'] ?? '').trim();
  return {
    url,
    found: true,
    section0: section0(row, days),
    company: String(row['company'] ?? ''),
    title: String(row['title'] ?? ''),
    location: String(row['location'] ?? String((row['locations'] as string[] | undefined)?.[0] ?? '')),
    posted: (row['posted_at'] as string | null) ?? null,
    description_chars: description.length,
    days_looked_back: days,
  };
}

/** Briefs every row of a daily file that has a stored description. */
export function briefsForDailyFile(
  dailyPath: string,
  days = 7,
  dir = defaultIntakeDir(),
): { briefs: Brief[]; missing: string[] } {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const content = JSON.parse(readFileSync(dailyPath, 'utf8')) as { jobs?: Record<string, unknown>[] };
  const jobs = Array.isArray(content.jobs) ? content.jobs : [];
  const briefs: Brief[] = [];
  const missing: string[] = [];
  for (const job of jobs) {
    const url = String(job['url'] ?? '');
    if (url === '') continue;
    const brief = briefForUrl(url, days, dir);
    if (brief.found && brief.description_chars > 200) briefs.push(brief);
    else missing.push(url);
  }
  return { briefs, missing };
}

/** Stable id for a brief file name. */
export function briefId(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 12);
}

/** One row's brief, ready to be written as a §0 file. */
export type BriefRow = {
  url: string;
  title: string;
  company: string;
  section0: string;
  description_chars: number;
};

/**
 * Briefs for every stored row matching a screen verdict that carries a full
 * description (the factory's own >200-char bar, same as briefForUrl's
 * thin-description warning). `considered` counts the screen-matched rows so
 * the caller can report how many were skipped for a thin or missing
 * description. `limit` caps the briefs (0 = no cap).
 */
export function briefsForFilter(
  days = 1,
  screen = 'strong',
  dir = defaultIntakeDir(),
  limit = 0,
): { briefs: BriefRow[]; considered: number } {
  // The pre-fix rows (before the Greenhouse htmlDecode fix) stored mojibake
  // rather than JD text. A replacement char in the head means corrupt text:
  // skip it rather than hand the factory gibberish.
  const readable = (value: unknown): string => String(value ?? '').trim();
  const corrupt = (text: string): boolean => text.slice(0, 80).includes('\ufffd');
  const rows = readDays(dir, days).filter((row) => row['screen'] === screen);
  // Boston/remote gate: the resume factory writes for seats he would take,
  // so a strong row in Austin or London never becomes a brief.
  const local = rows.filter((row) => passesGeoGate(row as { title?: unknown; locations?: unknown; workplace?: unknown }));
  const qualifying = local
    .filter((row) => {
      const text = readable(row['description_text']);
      return text.length > 200 && !corrupt(text);
    })
    .map((row) => ({
      url: String(row['url'] ?? ''),
      title: String(row['title'] ?? ''),
      company: String(row['company'] ?? ''),
      section0: section0(row, days),
      description_chars: readable(row['description_text']).length,
    }));
  return { briefs: limit > 0 ? qualifying.slice(0, limit) : qualifying, considered: rows.length };
}

export { intakeDir };
