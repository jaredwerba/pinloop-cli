/**
 * Tests for the intake store compaction (fix 3: unbounded store growth).
 * Run: node --test tests/intake-prune.test.mjs
 * Uses PINLOOP_INTAKE_DIR pointing at a mkdtemp dir and imports from dist/.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CLI = join(root, 'dist', 'cli', 'pinloop.js');

const scratch = mkdtempSync(join(tmpdir(), 'intake-prune-test-'));
process.env['PINLOOP_INTAKE_DIR'] = join(scratch, 'intake');
const dir = process.env['PINLOOP_INTAKE_DIR'];

const prune = await import(join(root, 'dist', 'intake', 'prune.js'));

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-09-22T12:00:00Z');

const row = (over = {}) => ({
  source: 'greenhouse',
  board: 'stripe',
  id: 'gh-1',
  title: 'Account Executive',
  company: 'Stripe',
  locations: ['Seattle, WA'],
  countries: ['United States'],
  url: 'https://boards.greenhouse.io/stripe/jobs/1',
  description_text: 'a long job description that takes up most of the bytes in this row',
  posted_at: '2026-09-20T00:00:00Z',
  employment: 'FULL_TIME',
  workplace: 'ONSITE',
  seen_at: now.toISOString(),
  ...over,
});

function dayStampFor(date) {
  return date.toISOString().slice(0, 10);
}

function writeDay(date, rows) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${dayStampFor(date)}.jsonl`), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
}

function readDay(date) {
  const file = join(dir, `${dayStampFor(date)}.jsonl`);
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
}

after(() => rmSync(scratch, { recursive: true, force: true }));

test('compactIntake removes day files older than keepDays', () => {
  writeDay(new Date(now.getTime() - 10 * DAY), [row({ id: 'old1', url: 'https://x/old1' })]);
  writeDay(now, [row({ id: 'new1', url: 'https://x/new1' })]);
  const stats = prune.compactIntake(dir, 7, now);
  assert.equal(stats.filesRemoved, 1);
  assert.equal(stats.rowsCompacted, 0);
  assert.ok(stats.bytesBefore > 0);
  assert.ok(stats.bytesAfter <= stats.bytesBefore);
  assert.ok(!existsSync(join(dir, `${dayStampFor(new Date(now.getTime() - 10 * DAY))}.jsonl`)));
  assert.ok(existsSync(join(dir, `${dayStampFor(now)}.jsonl`)));
});

test('compactIntake strips description_text from rows older than 48h', () => {
  const oldDate = new Date(now.getTime() - 3 * DAY);
  writeDay(oldDate, [
    row({ id: 'a', url: 'https://x/a', seen_at: new Date(now.getTime() - 3 * DAY).toISOString() }),
    row({ id: 'b', url: 'https://x/b', seen_at: now.toISOString(), description_text: 'fresh desc' }),
  ]);
  const stats = prune.compactIntake(dir, 7, now);
  assert.equal(stats.rowsCompacted, 1);
  assert.ok(stats.bytesAfter < stats.bytesBefore);
  const rows = readDay(oldDate);
  assert.equal(rows.find((r) => r.id === 'a').description_text, '');
  assert.equal(rows.find((r) => r.id === 'b').description_text, 'fresh desc');
});

test('keepUrls retains the description of shortlisted rows even when old', () => {
  const oldDate = new Date(now.getTime() - 3 * DAY);
  writeDay(oldDate, [
    row({ id: 'keep', url: 'https://x/keep', seen_at: new Date(now.getTime() - 3 * DAY).toISOString() }),
    row({ id: 'drop', url: 'https://x/drop', seen_at: new Date(now.getTime() - 3 * DAY).toISOString() }),
  ]);
  const stats = prune.compactIntake(dir, 7, now, new Set(['https://x/keep']));
  assert.equal(stats.rowsCompacted, 1);
  const rows = readDay(oldDate);
  assert.equal(rows.find((r) => r.id === 'keep').description_text, 'a long job description that takes up most of the bytes in this row');
  assert.equal(rows.find((r) => r.id === 'drop').description_text, '');
});

test('compactIntake rewrites atomically: no .tmp files left behind', () => {
  const oldDate = new Date(now.getTime() - 3 * DAY);
  writeDay(oldDate, [row({ id: 'a', url: 'https://x/a', seen_at: new Date(now.getTime() - 3 * DAY).toISOString() })]);
  prune.compactIntake(dir, 7, now);
  const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp'));
  assert.deepEqual(leftovers, []);
  // the rewritten file is still valid JSONL
  assert.equal(readDay(oldDate).length, 1);
});

test('compactIntake handles an empty or missing directory', () => {
  rmSync(dir, { recursive: true, force: true });
  const stats = prune.compactIntake(dir, 7, now);
  assert.deepEqual(stats, { filesRemoved: 0, rowsCompacted: 0, bytesBefore: 0, bytesAfter: 0 });
});

// ---- the CLI command, end to end -------------------------------------------

function runCli(args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: root, env: { ...process.env, PINLOOP_INTAKE_DIR: dir } });
}

test('intake compact --json prints stats', () => {
  const oldDate = new Date(now.getTime() - 10 * DAY);
  writeDay(oldDate, [row({ id: 'old', url: 'https://x/old', seen_at: oldDate.toISOString() })]);
  writeDay(now, [row({ id: 'new', url: 'https://x/new' })]);
  const parsed = JSON.parse(runCli(['intake', 'compact', '--keep-days', '7', '--json']));
  assert.equal(parsed.filesRemoved, 1);
  assert.equal(parsed.keepDays, 7);
  const plain = runCli(['intake', 'compact', '--keep-days', '7']);
  assert.match(plain, /removed 0 day file/);
});