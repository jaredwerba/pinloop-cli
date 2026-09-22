/**
 * Tests for `pinloop intake brief --all` (batch §0 briefs). Run:
 * node --test tests/intake-brief.test.mjs
 *
 * Seeds a fake intake dir via PINLOOP_INTAKE_DIR, then runs the built CLI as a
 * child process so the command path is exercised end to end. No network.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CLI = join(root, 'dist', 'cli', 'pinloop.js');

const scratch = mkdtempSync(join(tmpdir(), 'intake-brief-test-'));
const dir = join(scratch, 'intake');
process.env['PINLOOP_INTAKE_DIR'] = dir;

// import after the env var is set
const store = await import(join(root, 'dist', 'intake', 'store.js'));
const brief = await import(join(root, 'dist', 'intake', 'brief.js'));

after(() => rmSync(scratch, { recursive: true, force: true }));

const fullDescription =
  'We are hiring a quota-carrying account executive to own the west region. ' +
  'You will run full-cycle enterprise sales, partner with solutions engineering, ' +
  'and forecast weekly. Base plus variable, four years of closing experience required.';

function makeRow(over) {
  return {
    source: 'greenhouse',
    board: 'stripe',
    id: 'job-1',
    url: 'https://boards.greenhouse.io/stripe/jobs/1',
    title: 'Account Executive',
    company: 'Stripe',
    locations: ['Boston, MA'],
    countries: ['United States'],
    description_text: fullDescription,
    posted_at: '2026-09-20T00:00:00Z',
    employment: 'FULL_TIME',
    workplace: 'ONSITE',
    seen_at: new Date().toISOString(),
    screen: 'strong',
    reason: 'test row',
    ...over,
  };
}

/** Writes three rows straight into today's file: strong w/ desc, strong w/o desc, fair w/ desc. */
function seed(extraRows = []) {
  rmSync(dir, { recursive: true, force: true });
  const rows = [
    makeRow(),
    makeRow({ id: 'job-2', url: 'https://boards.greenhouse.io/stripe/jobs/2', title: 'Sales Development Representative', description_text: '' }),
    makeRow({ id: 'job-3', url: 'https://boards.greenhouse.io/stripe/jobs/3', title: 'Enterprise AE', company: 'Databricks', locations: ['Remote'], workplace: 'REMOTE', posted_at: '2026-09-21T00:00:00Z', screen: 'fair' }),
    ...extraRows,
  ];
  mkdirSync(dir, { recursive: true });
  writeFileSync(store.dayFile(dir, store.dayStamp()), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function runCli(args, cwd) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { cwd, env: process.env, encoding: 'utf8' });
    return { stdout, code: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? String(error), code: error.status ?? 1 };
  }
}

test('briefsForFilter keeps only screen-matched rows with a full description', () => {
  seed();
  const { briefs, considered } = brief.briefsForFilter(1, 'strong', dir);
  assert.equal(considered, 2); // strong rows only; the fair one is not considered
  assert.equal(briefs.length, 1); // one strong row has a full description
  assert.equal(briefs[0].url, 'https://boards.greenhouse.io/stripe/jobs/1');
});

test('intake brief --all --json writes only qualifying rows, files start with JOB_POSTING:', () => {
  seed();
  const outDir = join(scratch, 'briefs-out');
  const { stdout, code } = runCli(['intake', 'brief', '--all', '--json', '--out-dir', outDir], scratch);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.written, 1);
  assert.equal(parsed.skipped, 1); // the strong row with a missing description; the fair row is screen-filtered, not skipped
  assert.equal(parsed.files.length, 1);
  assert.ok(existsSync(parsed.files[0].file));
  const text = readFileSync(parsed.files[0].file, 'utf8');
  assert.ok(text.startsWith('JOB_POSTING:'));
  assert.ok(text.includes('COMPANY:      Stripe'));
  assert.equal(readdirSync(outDir).length, 1);
});

test('intake brief --all --screen fair briefs the fair row instead', () => {
  seed();
  const outDir = join(scratch, 'briefs-fair');
  const { stdout } = runCli(['intake', 'brief', '--all', '--screen', 'fair', '--json', '--out-dir', outDir], scratch);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.written, 1);
  const text = readFileSync(parsed.files[0].file, 'utf8');
  assert.ok(text.includes('COMPANY:      Databricks'));
});

test('intake brief --all --limit caps the briefs written', () => {
  seed([
    makeRow({ id: 'job-4', url: 'https://boards.greenhouse.io/stripe/jobs/4', title: 'Enterprise AE' }),
    makeRow({ id: 'job-5', url: 'https://boards.greenhouse.io/stripe/jobs/5', title: 'Senior AE' }),
  ]);
  // seeded: 4 strong rows total, 3 with full descriptions; limit 1 must cut to 1
  const outDir = join(scratch, 'briefs-limit');
  const { stdout } = runCli(['intake', 'brief', '--all', '--json', '--limit', '1', '--out-dir', outDir], scratch);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.written, 1);
  assert.equal(parsed.files.length, 1);
  assert.equal(readdirSync(outDir).length, 1);
});

test('briefId is stable for the same url', () => {
  assert.equal(brief.briefId('https://x.example/1'), brief.briefId('https://x.example/1'));
});
