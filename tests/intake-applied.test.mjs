/**
 * Tests for the intake applied-tracker bridge (`pinloop intake applied`).
 * Uses a temp tracker file via PINLOOP_APPLIED_TRACKER and a temp intake dir
 * via PINLOOP_INTAKE_DIR, so the real career-ops tracker is never touched.
 * Run: node --test tests/intake-applied.test.mjs
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const scratch = mkdtempSync(join(tmpdir(), 'applied-test-'));
process.env['PINLOOP_INTAKE_DIR'] = join(scratch, 'intake');
process.env['PINLOOP_APPLIED_TRACKER'] = join(scratch, 'tracker', 'applications.md');
const dir = process.env['PINLOOP_INTAKE_DIR'];
const tracker = process.env['PINLOOP_APPLIED_TRACKER'];

// import after the env vars are set
const store = await import(join(root, 'dist', 'intake', 'store.js'));
const { markApplied, localDay } = await import(join(root, 'dist', 'intake', 'applied.js'));

const URL1 = 'https://boards.greenhouse.io/stripe/jobs/42';
const row = (over = {}) => ({
  source: 'greenhouse',
  board: 'stripe',
  id: 'gh-stripe-42',
  title: 'Account Executive',
  company: 'Stripe',
  locations: ['Seattle, WA'],
  countries: ['United States'],
  url: URL1,
  description_text: 'quota carrying account executive',
  posted_at: '2026-09-20T00:00:00Z',
  employment: 'FULL_TIME',
  workplace: 'ONSITE',
  seen_at: new Date().toISOString(),
  ...over,
});

/** Seed one stored row into the intake dir. */
const seed = (over = {}) => {
  store.addRows(dir, [row(over)]);
};

beforeEach(() => {
  rmSync(join(scratch, 'intake'), { recursive: true, force: true });
  rmSync(join(scratch, 'tracker'), { recursive: true, force: true });
});
after(() => rmSync(scratch, { recursive: true, force: true }));

test('happy path appends a well-formed row to a new tracker and the applied log', () => {
  seed();
  const result = markApplied(dir, URL1, 'applied via portal form', tracker);
  assert.equal(result.company, 'Stripe');
  assert.equal(result.title, 'Account Executive');

  const text = readFileSync(tracker, 'utf8');
  assert.ok(text.includes('# Applications Tracker'));
  assert.ok(text.includes('| # | Date | Company | Role | Score | Status | PDF | Report | Notes |'));
  const dataLines = text.split('\n').filter((l) => l.startsWith('| ') && /^\| \d+ /.test(l));
  assert.equal(dataLines.length, 1);
  assert.ok(dataLines[0].includes('| Stripe |'));
  assert.ok(dataLines[0].includes('| Account Executive |'));
  assert.ok(dataLines[0].includes('| Applied |'));
  assert.ok(dataLines[0].includes(URL1));
  assert.ok(dataLines[0].includes(localDay()));
  assert.ok(dataLines[0].includes('applied via portal form'));

  const log = readFileSync(join(dir, 'applied.jsonl'), 'utf8');
  const entries = log.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, URL1);
  assert.equal(entries[0].day, localDay());
  assert.equal(entries[0].title, 'Account Executive');
  assert.equal(entries[0].company, 'Stripe');
  assert.equal(entries[0].note, 'applied via portal form');
});

test('appends to an existing tracker matching its header columns', () => {
  seed();
  mkdirSync(join(scratch, 'tracker'), { recursive: true });
  writeFileSync(
    tracker,
    [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 7 | 2026-01-05 | Anthropic | Research Eng | 88 | Screened | x.pdf | r.md | recruiter call |',
    ].join('\n') + '\n',
  );
  markApplied(dir, URL1, '', tracker);
  const dataLines = readFileSync(tracker, 'utf8')
    .split('\n')
    .filter((l) => /^\| \d+ /.test(l));
  assert.equal(dataLines.length, 2);
  // keeps the previous numbering and does not touch the earlier row
  assert.ok(dataLines[0].startsWith('| 7 | 2026-01-05 | Anthropic'));
  assert.ok(dataLines[1].startsWith('| 8 |'));
  assert.ok(dataLines[1].includes('| Applied |'));
  assert.ok(dataLines[1].trimEnd().endsWith(`${URL1} |`)); // empty note → bare url in Notes
});

test('duplicate is refused unless force', () => {
  seed();
  markApplied(dir, URL1, 'first', tracker);
  assert.throws(
    () => markApplied(dir, URL1, 'second', tracker),
    /already marked applied/,
  );
  // second call must not have added another tracker row
  const rows = readFileSync(tracker, 'utf8').split('\n').filter((l) => /^\| \d+ /.test(l));
  assert.equal(rows.length, 1);

  markApplied(dir, URL1, 'second', tracker, new Date(), true);
  const log = readFileSync(join(dir, 'applied.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
  assert.equal(log.length, 2);
  assert.equal(log[1].note, 'second');
  const rowsAfter = readFileSync(tracker, 'utf8').split('\n').filter((l) => /^\| \d+ /.test(l));
  assert.equal(rowsAfter.length, 2);
});

test('missing url in the intake store is refused', () => {
  seed();
  assert.throws(
    () => markApplied(dir, 'https://boards.greenhouse.io/stripe/jobs/999', '', tracker),
    /no stored posting with url/,
  );
  assert.ok(!existsSync(tracker));
  assert.ok(!existsSync(join(dir, 'applied.jsonl')));
});

test('pipes in notes are escaped and the tracker stays a well-formed table', () => {
  seed();
  markApplied(dir, URL1, 'note | with pipe', tracker);
  const dataLines = readFileSync(tracker, 'utf8').split('\n').filter((l) => /^\| \d+ /.test(l));
  assert.equal(dataLines.length, 1);
  assert.equal(dataLines[0].split(/(?<!\\)\|/).length, 11); // leading/trailing empties + 9 columns
  assert.ok(dataLines[0].includes('note \\| with pipe'));
});