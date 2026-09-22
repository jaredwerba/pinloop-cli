/**
 * The intake store: one JSONL file per day under fit/intake/YYYY-MM-DD.jsonl
 * (gitignored with the rest of fit/profile-adjacent state), plus a running
 * seen-ids index so a posting is never processed twice no matter which board
 * it surfaced on.
 *
 * Quota accounting lives here too: the fork's target is 100+ postings a day,
 * and `dayQuota` is what the commands check against so a run can be told
 * plainly that it is under or over.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { IntakeRow } from './sources.ts';
import { screenPosting } from '../fit/rubric.ts';

export const DAILY_TARGET = 100;

/** Where intake state lives: alongside the fit profile directory. */
export function intakeDir(baseDir: string): string {
  return join(dirname(baseDir), 'intake');
}

export function dayStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function dayFile(dir: string, day: string): string {
  return join(dir, `${day}.jsonl`);
}

/** Stable identity for dedupe: url when there is one, else source+id. */
export function identityOf(row: IntakeRow): string {
  return row.url !== '' ? row.url : `${row.source}:${row.id}`;
}

export type IntakeCounts = {
  fetched: number;
  added: number;
  duplicates: number;
  dayTotal: number;
  dayTarget: number;
  screened: { no: number; weak: number; fair: number; strong: number };
};

/**
 * Adds rows to the day's file, skipping anything already indexed. The seen
 * index is the whole point of a 100+/day pipeline: boards re-serve the same
 * posting for weeks, and the rubric's verdicts must be computed once.
 *
 * Concurrency: the read-modify-append critical section below is fully
 * synchronous, so Node's single thread already serializes it per-process —
 * no interleaving is possible between two addRows calls in this process (the
 * module-level promise chain is kept as the serialization point in case the
 * section ever goes async). Cross-process writes (two `intake serve`
 * processes, or an HTTP push racing a board run) are NOT locked — flock-style
 * locking is a known limit; such processes may race and re-count duplicates.
 */
// Per-process write mutex: a shared promise chain every writer attaches to.
// The critical section is currently synchronous (already atomic in-process);
// this chain exists so an async critical section would await it.
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(job: () => T): T {
  // The critical section runs synchronously (atomic within this process);
  // its completion is chained onto writeQueue so a future async writer
  // could await the same mutex.
  const result = job();
  writeQueue = writeQueue.then(
    () => result,
    () => result,
  );
  return result;
}

export function addRows(
  dir: string,
  rows: IntakeRow[],
  now: Date = new Date(),
): { counts: IntakeCounts; addedRows: (IntakeRow & { screen: ReturnType<typeof screenPosting>['screen']; reason: string })[] } {
  return enqueueWrite(() => {
    mkdirSync(dir, { recursive: true });
  const day = dayStamp(now);
  const file = dayFile(dir, day);
  const seen = new Set<string>();
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        seen.add(identityOf(JSON.parse(trimmed) as IntakeRow));
      } catch {
        // a torn last line from a killed run: skip it, the next add rewrites nothing
      }
    }
  }

  const addedRows: (IntakeRow & { screen: ReturnType<typeof screenPosting>['screen']; reason: string })[] = [];
  const screened = { no: 0, weak: 0, fair: 0, strong: 0 };
  let duplicates = 0;

  for (const row of rows) {
    const id = identityOf(row);
    if (seen.has(id)) {
      duplicates += 1;
      continue;
    }
    seen.add(id);
    const verdict = screenPosting(
      {
        id: row.id,
        title: row.title,
        company: row.company,
        locations: row.locations,
        countries: row.countries,
        employment: row.employment,
        workplace: row.workplace,
      },
      0,
    );
    screened[verdict.screen] += 1;
    const stored = { ...row, screen: verdict.screen, reason: verdict.reason };
    addedRows.push(stored);
    appendFileSync(file, `${JSON.stringify(stored)}\n`);
  }

  // dayTotal counts every stored row for this stamp, old and new.
  let dayTotal = 0;
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() !== '') dayTotal += 1;
    }
  }

  return {
    counts: { fetched: rows.length, added: addedRows.length, duplicates, dayTotal, dayTarget: DAILY_TARGET, screened },
    addedRows,
    };
  });
}

// -------------------------------------------------------------------- scores

/** A score row from an external scorer (e.g. Jev): url plus that scorer's fields. */
export type ScoreRow = { url: string; fit?: string; [key: string]: unknown };

export type AttachScoresResult = { matched: number; unmatched: string[] };

/** Match key for scores: url with a trailing slash and whitespace normalized away. */
function urlKey(url: unknown): string {
  return typeof url === 'string' ? url.trim().replace(/\/+$/, '') : '';
}

/**
 * Drops undefined values so JSONL stays clean — JSON.stringify would
 * stringify `undefined` inside an array as null and top-level as '' is never
 * wanted; object properties holding undefined are dropped, but nested arrays
 * are not. Scores are flat objects, so a shallow sweep suffices.
 */
function cleanValue(value: unknown): unknown {
  if (value === undefined) return undefined; // callers drop the key
  if (Array.isArray(value)) return value.filter((one) => one !== undefined);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, one] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = cleanValue(one);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return value;
}

/**
 * Attaches external scorer output (Jev today) to already-stored intake rows.
 * Reads the last `days` day files (default 7), matches score rows by url
 * (trailing slash normalized), and rewrites each affected day file atomically
 * — temp file plus rename, the same pattern prune.ts uses. The scores object
 * merged into a row is { scorer, scoredAt, ...scoreRowFields }; a second
 * attach with the same scorer overwrites the first.
 */
export function attachScores(
  dir: string,
  scorer: string,
  scoreRows: ScoreRow[],
  now: Date = new Date(),
  days = 7,
): AttachScoresResult {
  if (!existsSync(dir)) return { matched: 0, unmatched: scoreRows.map((one) => String(one.url ?? '')) };
  const scoredAt = now.toISOString();

  const scoresByUrl = new Map<string, Record<string, unknown>>();
  const unmatched: string[] = [];
  for (const one of scoreRows) {
    const key = urlKey(one.url);
    if (key === '') continue;
    scoresByUrl.set(key, cleanValue({ ...one, url: undefined }) as Record<string, unknown>);
  }

  let matched = 0;
  const remaining = new Set(scoresByUrl.keys());

  for (let back = 0; back < days && remaining.size > 0; back += 1) {
    const date = new Date(now.getTime());
    date.setUTCDate(date.getUTCDate() - back);
    const path = dayFile(dir, dayStamp(date));
    if (!existsSync(path)) continue;
    const kept: string[] = [];
    let rewrote = false;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        kept.push(trimmed); // torn line: leave as-is
        continue;
      }
      const key = urlKey(parsed['url']);
      if (key !== '' && remaining.has(key)) {
        const fields = scoresByUrl.get(key)!;
        parsed['scores'] = { scorer, scoredAt, ...fields };
        matched += 1;
        remaining.delete(key);
        kept.push(JSON.stringify(parsed));
        rewrote = true;
      } else {
        kept.push(trimmed);
      }
    }
    if (rewrote) {
      const tmp = `${path}.tmp-${process.pid}`;
      writeFileSync(tmp, kept.join('\n') + '\n');
      renameSync(tmp, path);
    }
  }

  for (const one of scoreRows) {
    const key = urlKey(one.url);
    if (key !== '' && remaining.has(key)) unmatched.push(String(one.url));
  }
  return { matched, unmatched };
}

/** Reads one day's stored rows, or the last N days of them. */
export function readDays(dir: string, days: number, now: Date = new Date()): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let back = 0; back < days; back += 1) {
    const date = new Date(now.getTime());
    date.setUTCDate(date.getUTCDate() - back);
    const file = dayFile(dir, dayStamp(date));
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        out.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // torn line: skip
      }
    }
  }
  return out;
}
