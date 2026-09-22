/**
 * Tests for the `pinloop fit` overlay. Run: node --test tests/fit.test.mjs
 * These exercise the compiled dist/ output, so build first (npm run build).
 * No network, no login, no writes outside fit/profile (only docs uses that).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CLI = join(root, 'dist', 'cli', 'pinloop.js');

function runCli(args, input, env) {
  return execFileSync(process.execPath, [CLI, ...args], {
    input,
    encoding: 'utf8',
    cwd: root,
    env: env === undefined ? process.env : { ...process.env, ...env },
  });
}

// rubric via the CLI's fit score path
const posting = (over = {}) => ({
  id: 'p1',
  title: 'Account Executive',
  company: 'Nebius',
  countries: ['United States'],
  employment: 'FULL_TIME',
  experience: '10+',
  ...over,
});

test('fit plan prints an ordered count plan and no network', () => {
  const out = runCli(['fit', 'plan']);
  assert.match(out, /1\. sales-label/);
  assert.match(out, /pinloop count --category Sales/);
  assert.match(out, /United States/);
  assert.match(out, /pinloop pull .* --limit 5/);
  // pull must come last: counts before any pull
  const lines = out.split('\n');
  const pullIdx = lines.findIndex((l) => l.includes('pinloop pull'));
  assert.ok(pullIdx > lines.findIndex((l) => l.includes('pinloop count')), 'pull after counts');
});

test('fit plan --json is valid JSON with queries array', () => {
  const parsed = JSON.parse(runCli(['fit', 'plan', '--json']));
  assert.ok(Array.isArray(parsed.queries));
  assert.ok(parsed.queries.length > 10);
  for (const q of parsed.queries) {
    assert.ok(q.name && q.command && q.why);
  }
});

test('fit score screens JSON rows from stdin', () => {
  const out = runCli(['fit', 'score'], JSON.stringify([posting()]));
  assert.match(out, /strong/);
  assert.match(out, /Nebius/);
});

test('fit score --json returns rows', () => {
  const parsed = JSON.parse(runCli(['fit', 'score', '--json'], JSON.stringify([posting()])));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].screen, 'strong');
});

test('fit score rejects non-JSON input with a clear error', () => {
  assert.throws(() => runCli(['fit', 'score'], 'not json'), /not JSON/);
});

test('fit score handles empty stdin', () => {
  assert.match(runCli(['fit', 'score'], ''), /no postings/);
});

const screens = [
  [{ title: 'Account Executive', company: 'CoreWeave', countries: ['United States'] }, 'strong'],
  [{ title: 'Enterprise Account Executive', company: 'Snowflake', countries: ['United States'] }, 'strong'],
  [{ title: 'Sales Development Representative', company: 'Nebius' }, 'no'],
  [{ title: 'Account Executive', company: 'Random SaaS', countries: ['Germany'] }, 'no'],
  [{ title: 'Forward Deployed Engineer', company: 'Nebius' }, 'weak'],
  [{ title: 'Account Executive', company: 'Some Retail Co' }, 'fair'],
  [{ title: 'Software Engineer', company: 'Nebius' }, 'weak'],
];

for (const [row, expected] of screens) {
  test(`screen: ${row.title} @ ${row.company} -> ${expected}`, () => {
    const parsed = JSON.parse(runCli(['fit', 'score', '--json'], JSON.stringify([row])));
    assert.equal(parsed.rows[0].screen, expected);
  });
}

test('blank country is not rejected as foreign', () => {
  const parsed = JSON.parse(runCli(['fit', 'score', '--json'], JSON.stringify([posting({ countries: null, country: null })])));
  assert.notEqual(parsed.rows[0].screen, 'no');
});

test('fit docs writes profile documents locally and redacts phone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fit-docs-'));
  try {
    const out = runCli(['fit', 'docs', '--json'], '');
    const parsed = JSON.parse(out);
    assert.ok(parsed.files.length >= 5);
    for (const f of parsed.files) {
      const text = readFileSync(f, 'utf8');
      assert.ok(!/\(\d{3}\)\s*\d{3}-\d{4}/.test(text), `phone leaked into ${f}`);
      assert.ok(!/\$\d/.test(text), `dollar figure leaked into ${f}`);
    }
    // files must include the named documents
    const names = parsed.files.map((f) => f.split('/').pop());
    for (const need of ['constraints.md', 'background.md', 'preferences.md', 'judge-prompt.md']) {
      assert.ok(names.includes(need), `missing ${need}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a Boston location is not treated as a foreign country', () => {
  const parsed = JSON.parse(runCli(['fit', 'score', '--json'], JSON.stringify([
    { title: 'Account Executive', company: 'CoreWeave', locations: ['Boston, MA'] },
  ])));
  assert.equal(parsed.rows[0].screen, 'strong');
  assert.match(parsed.rows[0].reason, /CoreWeave/);
});

test('a location that names a non-US country is out when no country field is stored', () => {
  const parsed = JSON.parse(runCli(['fit', 'score', '--json'], JSON.stringify([
    { title: 'Account Executive', company: 'Nebius', locations: ['Vienna, Vienna, Austria'] },
  ])));
  assert.equal(parsed.rows[0].screen, 'no');
  assert.match(parsed.rows[0].reason, /Austria/);
});

test('a city with no country in the location is not rejected as foreign', () => {
  const parsed = JSON.parse(runCli(['fit', 'score', '--json'], JSON.stringify([
    { title: 'Account Executive', company: 'Nebius', locations: ['Belgrade'] },
  ])));
  assert.notEqual(parsed.rows[0].screen, 'no');
});

test('fit refuses unknown action', () => {
  assert.throws(() => runCli(['fit', 'nope']), /no action called/);
});

test('fit load refuses without login', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fit-nologin-'));
  try {
    assert.throws(
      () => runCli(['fit', 'load'], '', { PINLOOP_CONFIG_DIR: dir }),
      /needs a login|Nothing was uploaded/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
