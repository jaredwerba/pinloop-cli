/**
 * Intake store compaction: the daily JSONL files grow without bound unless
 * something prunes them. `compactIntake` deletes day files older than
 * keepDays, and for the files inside the window strips `description_text`
 * from rows seen more than 48h ago — the descriptions are the bulk of the
 * bytes, and a posting that old has already been screened and (if shortlisted)
 * is still protected via `keepUrls`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IntakeRow } from './sources.ts';

export const DAY_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
/** The half-life of a stored description: past this, only keepUrls keep it. */
export const KEEP_DESCRIPTION_HOURS = 48;

export type CompactStats = {
  filesRemoved: number;
  rowsCompacted: number;
  bytesBefore: number;
  bytesAfter: number;
};

function isOlderThan48h(seenAt: unknown, cutoffMs: number): boolean {
  const t = typeof seenAt === 'string' ? Date.parse(seenAt) : Number.NaN;
  if (Number.isNaN(t)) return true; // a row we cannot date is treated as old
  return t < cutoffMs;
}

/**
 * Rewrites one day file atomically: temp file in the same directory, then
 * rename, so a crash mid-write never leaves a torn store.
 */
function rewriteFile(path: string, lines: string[]): { rowsCompacted: number; bytesBefore: number; bytesAfter: number } {
  const before = readFileSync(path, 'utf8');
  const after = lines.join('\n') + (lines.length > 0 ? '\n' : '');
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, after);
  renameSync(tmp, path);
  return {
    rowsCompacted: 0,
    bytesBefore: Buffer.byteLength(before),
    bytesAfter: Buffer.byteLength(after),
  };
}

export function compactIntake(
  dir: string,
  keepDays: number,
  now: Date = new Date(),
  keepUrls?: Set<string>,
): CompactStats {
  if (!existsSync(dir)) {
    return { filesRemoved: 0, rowsCompacted: 0, bytesBefore: 0, bytesAfter: 0 };
  }
  mkdirSync(dir, { recursive: true });

  const nowMs = now.getTime();
  const cutoffMs = nowMs - KEEP_DESCRIPTION_HOURS * 60 * 60 * 1000;
  const oldestDay = new Date(nowMs);
  oldestDay.setUTCDate(oldestDay.getUTCDate() - keepDays);
  const oldestStamp = oldestDay.toISOString().slice(0, 10);

  let filesRemoved = 0;
  let rowsCompacted = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const entry of readdirSync(dir)) {
    if (!DAY_FILE_PATTERN.test(entry)) continue;
    const day = entry.slice(0, 10);
    const path = join(dir, entry);
    const size = existsSync(path) ? Buffer.byteLength(readFileSync(path, 'utf8')) : 0;

    if (day < oldestStamp) {
      rmSync(path);
      filesRemoved += 1;
      bytesBefore += size;
      continue;
    }

    // Inside the window: strip descriptions from rows older than 48h.
    const kept: string[] = [];
    let compacted = 0;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      let parsed: IntakeRow;
      try {
        parsed = JSON.parse(trimmed) as IntakeRow;
      } catch {
        kept.push(trimmed); // torn line: leave as-is
        continue;
      }
      if (
        typeof parsed.description_text === 'string' &&
        parsed.description_text !== '' &&
        isOlderThan48h(parsed.seen_at, cutoffMs) &&
        !(keepUrls && parsed.url !== '' && keepUrls.has(parsed.url))
      ) {
        parsed.description_text = '';
        compacted += 1;
        kept.push(JSON.stringify(parsed));
      } else {
        kept.push(trimmed);
      }
    }

    bytesBefore += size;
    if (compacted === 0) {
      bytesAfter += size;
      continue;
    }
    const result = rewriteFile(path, kept);
    rowsCompacted += compacted;
    bytesAfter += result.bytesAfter;
  }

  return { filesRemoved, rowsCompacted, bytesBefore, bytesAfter };
}