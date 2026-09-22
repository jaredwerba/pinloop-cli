/**
 * Tests for Feature F: attaching external scores (Jev) onto stored intake rows.
 * Run: node --test tests/intake-score.test.mjs
 * Uses PINLOOP_INTAKE_DIR pointing at a mkdtemp dir, seeds a fake intake dir,
 * runs the CLI `intake score --file` subcommand, and checks the store directly.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CLI = join(root, 'dist', 'cli', 'pinloop.js');

const scratch = mkdtempSync(join(tmpdir(), 'intake-score-test-'));
process.env['PINLOOP_INTAKE_DIR'] = join(scratch, 'intake');
const dir = process.env['PINLOOP_INTAKE_DIR'];

const store = await import(join(root, 'dist', 'intake', 'store.js'));

const now = new Date('2026-09-22T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const row = (over = {}) => ({
  source: 'greenhouse',
  board: 'stripe',
  id: 'gh-1',
  title: 'Account Executive',
  company: 'Stripe',
  locations: ['Seattle, WA'],
  countries: ['United States'],
  url: 'https://boards.greenhouse.io/stripe/jobs/1',
  description_text: 'desc',
  posted_at: '2026-09-20T00:00:00Z',
  employment: 'FULL_TIME',
  workplace: 'ONSITE',
  seen_at: now.toISOString(),
  screen: 'fair',
  reason: 'test',
  ...over,
});

function dayStampFor(date) {
  return date.toISOString().slice(0, 10);
}

function writeDay(date, rows) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${dayStampFor(date)}.jsonl`), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
}

function readDayRaw(date) {
  const file = join(dir, `${dayStampFor(date)}.jsonl`);
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

after(() => rmSync(scratch, { recursive: true, force: true }));

test('CLI intake score --file attaches scores and reports matched/unmatched', () => {
  const today = now;
  const yesterday = new Date(now.getTime() - DAY);
  writeDay(today, [
    row({ id: 'a', url: 'https://x/a' }),
    row({ id: 'b', url: 'https://x/b/' }), // trailing slash must still match
  ]);
  writeDay(yesterday, [row({ id: 'c', url: 'https://x/c', seen_at: yesterday.toISOString() })]);

  const scoreFile = join(scratch, 'scores.json');
  writeFileSync(
    scoreFile,
    JSON.stringify({
      jobs: [
        { url: 'https://x/a', fit: 'strong', is_ae: 0.9, is_us: 0.95 },
        { url: 'https://x/b', fit: 'fair', is_ae: 0.7 },
        { url: 'https://x/c/', fit: 'no' },
        { url: 'https://x/nowhere', fit: 'strong' },
      ],
    }),
  );

  const out = JSON.parse(
    execFileSync(process.execPath, [CLI, 'intake', 'score', '--file', scoreFile, '--scorer', 'jev', '--json'], {
      env: process.env,
      encoding: 'utf8',
    }),
  );
  assert.equal(out.matched, 3);
  assert.deepEqual(out.unmatched, ['https://x/nowhere']);
  assert.equal(out.scorer, 'jev');
});

test('rows rewritten in place with a scores object; readDays returns them', () => {
  const rows = readDayRaw(now);
  const a = rows.find((r) => r.id === 'a');
  assert.ok(a.scores, 'row a should carry scores');
  assert.equal(a.scores.scorer, 'jev');
  assert.equal(a.scores.fit, 'strong');
  assert.equal(a.scores.is_ae, 0.9);
  assert.ok(typeof a.scores.scoredAt === 'string' && !Number.isNaN(Date.parse(a.scores.scoredAt)));
  assert.ok(!('url' in a.scores), 'the match url is not duplicated inside scores');
  // untouched row fields survive
  assert.equal(a.title, 'Account Executive');
  assert.equal(a.screen, 'fair');

  // trailing-slash stored url matched the bare score url, and stays as stored
  const b = rows.find((r) => r.id === 'b');
  assert.equal(b.url, 'https://x/b/');
  assert.equal(b.scores.fit, 'fair');

  // day before
  const yesterday = new Date(now.getTime() - DAY);
  const c = readDayRaw(yesterday).find((r) => r.id === 'c');
  assert.equal(c.scores.fit, 'no');

  const read = store.readDays(dir, 7, now);
  const scored = read.filter((r) => r.scores);
  assert.equal(scored.length, 3);
});

test('readDays rows round-trip as clean JSONL (no undefined/null artifacts)', () => {
  for (const line of readFileSync(join(dir, `${dayStampFor(now)}.jsonl`), 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const parsed = JSON.parse(line);
    assert.ok(!('scores' in parsed) || parsed.scores !== null);
  }
});

test('attachScores is idempotent per scorer: re-attach overwrites, others untouched', () => {
  const result = store.attachScores(dir, 'jev', [{ url: 'https://x/a', fit: 'weak' }], now, 7);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.unmatched, []);
  const a = readDayRaw(now).find((r) => r.id === 'a');
  assert.equal(a.scores.fit, 'weak');
  const b = readDayRaw(now).find((r) => r.id === 'b');
  assert.equal(b.scores.fit, 'fair');
});

test('attachScores with a missing dir reports everything unmatched', () => {
  const result = store.attachScores(join(scratch, 'nope'), 'jev', [{ url: 'https://x/a' }], now, 7);
  assert.equal(result.matched, 0);
  assert.deepEqual(result.unmatched, ['https://x/a']);
});
