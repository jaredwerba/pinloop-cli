/**
 * Quality gate for the daily-100 list (task daily-100-gate).
 *
 * Reads a fixture JSON — no network, no live board calls — and enforces the
 * rules the lead set for what may be treated as the day's list:
 *   - United States only (no foreign locations)
 *   - seller seats only (no intern, sdr, bdr titles)
 *   - every row has a url, and no url appears twice
 *   - at most 8 rows per company
 *   - strong only when the title itself carries the infra words; a target
 *     employer alone is fair, not strong
 *   - declared count must equal the array length
 *
 * Run against a real file:  node --test tests/daily-100.test.mjs
 * (with DAILY100_FILE set, the good/bad fixture checks below are skipped.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const FOREIGN = /(israel|london|paris|tokyo|berlin|dublin|india|germany|canada|singapore)/i;
const BLOCKED_TITLE = /(intern|sdr|bdr)/i;
const STRONG_TITLE =
  /(cloud|gpu|iaas|paas|hyperscal|data\s*center|datacenter|kubernetes|\bai\b|ai[-\s])/i;

/** Validates one daily-100 file; returns a list of violations (empty = good). */
export function validateDaily100(content) {
  const violations = [];
  const jobs = Array.isArray(content?.jobs) ? content.jobs : null;
  if (!jobs) {
    return ['file has no jobs array'];
  }
  if (content.count !== undefined && Number(content.count) !== jobs.length) {
    violations.push(`declared count ${content.count} does not match jobs length ${jobs.length}`);
  }
  const seenUrls = new Map();
  const perCompany = new Map();
  for (const [index, row] of jobs.entries()) {
    const where = `row ${index + 1}`;
    const title = String(row?.title ?? '');
    const company = String(row?.company ?? '');
    const location = String(row?.location ?? '');
    const url = String(row?.url ?? '');

    if (FOREIGN.test(location)) violations.push(`${where}: foreign location '${location}'`);
    if (BLOCKED_TITLE.test(title)) violations.push(`${where}: blocked title '${title}'`);
    if (url === '' || url === 'undefined') violations.push(`${where}: missing url`);

    if (seenUrls.has(url)) {
      violations.push(`${where}: duplicate url ${url} (first seen row ${seenUrls.get(url)})`);
    } else {
      seenUrls.set(url, index + 1);
    }

    perCompany.set(company, (perCompany.get(company) ?? 0) + 1);

    if (String(row?.screen ?? '') === 'strong' && !STRONG_TITLE.test(title)) {
      violations.push(`${where}: strong without infra words in title '${title}' — a target employer alone is fair`);
    }
  }
  for (const [company, n] of perCompany) {
    if (n > 8) violations.push(`company '${company}' has ${n} rows, cap is 8`);
  }
  return violations;
}

/** Shared assertions used by both fixture tests. */
function assertClean(content) {
  const violations = validateDaily100(content);
  assert.deepEqual(violations, [], `daily-100 file failed the gate: ${violations.join('; ')}`);
}

const liveFile = process.env['DAILY100_FILE'];

test('fixture: a good daily-100 file passes every rule', () => {
  const path = join(here, 'fixtures', 'daily-100-good.json');
  assert.ok(existsSync(path), `missing fixture ${path}`);
  assertClean(JSON.parse(readFileSync(path, 'utf8')));
});

test('fixture: the bad file fails on every rule the gate enforces', () => {
  const path = join(here, 'fixtures', 'daily-100-bad.json');
  assert.ok(existsSync(path), `missing fixture ${path}`);
  const content = JSON.parse(readFileSync(path, 'utf8'));
  const text = validateDaily100(content).join('\n');
  assert.match(text, /foreign location/i, 'no foreign-location violation');
  assert.match(text, /blocked title/i, 'no blocked-title violation');
  assert.match(text, /missing url/i, 'no missing-url violation');
  assert.match(text, /duplicate url/i, 'no duplicate-url violation');
  assert.match(text, /cap is 8/i, 'no company-cap violation');
  assert.match(text, /strong without infra words/i, 'no unearned-strong violation');
  assert.match(text, /does not match jobs length/i, 'no count-mismatch violation');
});

test('fixture files hold enough rows to be meaningful', () => {
  const good = JSON.parse(readFileSync(join(here, 'fixtures', 'daily-100-good.json'), 'utf8'));
  const bad = JSON.parse(readFileSync(join(here, 'fixtures', 'daily-100-bad.json'), 'utf8'));
  assert.ok(good.jobs.length >= 100, 'good fixture should hold a full day: 100 rows');
  assert.ok(bad.jobs.length >= 5, 'bad fixture should hold several violations');
});

if (liveFile) {
  test(`live file ${liveFile} passes the gate`, () => {
    assert.ok(existsSync(liveFile), `live file ${liveFile} does not exist`);
    assertClean(JSON.parse(readFileSync(liveFile, 'utf8')));
  });
}
