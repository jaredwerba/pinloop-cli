/**
 * Tests for the agent-native apply layer.
 *
 * Run: node --test scripts/apply.test.mjs
 *
 * The layer is pointed at a scratch directory before import, so a test never
 * touches a real queue, a real lease, or a real receipt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'apply-test-'));
process.env['PINLOOP_APPLY_DIR'] = scratch;

const lib = await import('./apply-lib.mjs');

// A miniature resume with the same markers the real one uses.
const sourceResume = join(scratch, 'resume.md');
writeFileSync(
  sourceResume,
  [
    '# Test Person',
    '',
    'Closed a $10M ARR deal. 2x quota. Top 3 of 400.',
    '',
    '[GROKBOT — replace this block with one sentence. Keep the same voice.] This closer',
    'mentions Vercel and must be deleted from the printed resume. [GROKBOT_OUTPUT]',
    '',
    '- Promoted at Oracle to lead OCI sales.',
  ].join('\n'),
);
process.env['PINLOOP_RESUME'] = sourceResume;

const job = {
  key: 'k1',
  title: 'Enterprise Account Executive',
  company: 'Anthropic',
  location: 'Boston, MA',
  url: 'https://job-boards.greenhouse.io/anthropic/jobs/123?utm_source=x',
  screen: 'strong',
};
const runFile = join(scratch, 'run.json');
writeFileSync(runFile, JSON.stringify({ where: 'us', jobs: [job] }));

lib.buildQueue(runFile);
/** buildQueue derives the key from the job, so read it back rather than assume it. */
const KEY = lib.jobKey(job);

test('jobKey ignores tracking query parameters and is stable', () => {
  const a = lib.jobKey(job);
  const b = lib.jobKey({ ...job, url: 'https://job-boards.greenhouse.io/anthropic/jobs/123' });
  assert.equal(a, b);
  assert.equal(a, lib.jobKey(job));
  assert.notEqual(a, lib.jobKey({ ...job, title: 'Different Title' }));
});

test('detectAts recognises each vendor from the url alone', () => {
  assert.equal(lib.detectAts('https://job-boards.greenhouse.io/anthropic/jobs/1'), 'greenhouse');
  assert.equal(lib.detectAts('https://jobs.lever.co/nebius/abc'), 'lever');
  assert.equal(lib.detectAts('https://jobs.ashbyhq.com/openai/xyz'), 'ashby');
  assert.equal(lib.detectAts('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/1'), 'workday');
  assert.equal(lib.detectAts('https://apply.careers.microsoft.com/careers/job/1'), 'microsoft');
  assert.equal(lib.detectAts('https://www.amazon.jobs/en/jobs/1/x'), 'amazon');
  assert.equal(lib.detectAts('https://example.com/careers'), 'unknown');
});

test('a natural question and a vendor field name land on one canonical slot', () => {
  const natural = 'Are you legally authorized to work in the United States?';
  const vendor = 'work_authorization';
  assert.equal(lib.canonicalKey(natural), 'work_authorization');
  assert.equal(lib.canonicalKey(vendor), 'work_authorization');
  assert.equal(lib.canonicalKey('notice_period'), 'notice_period');
  assert.equal(lib.canonicalKey('Will you require sponsorship?'), 'sponsorship');
  assert.equal(lib.canonicalKey('What is your favourite colour?'), null);
});

test('an answer recorded once is found by a differently worded vendor field', () => {
  lib.recordAnswer('Are you legally authorized to work in the United States?', 'Yes', 'fixed');
  const resolved = lib.resolveAnswers({ ats: 'greenhouse' });
  const work = resolved.find((one) => one.slot === 'work_authorization');
  assert.equal(work.source, 'cache');
  assert.equal(work.answer, 'Yes');
  assert.equal(work.kind, 'fixed');
});

test('a personal disclosure is refused as a reusable fact', () => {
  assert.throws(() => lib.recordAnswer('What are your salary expectations?', '185000', 'fixed'), /kind=human/);
  assert.throws(() => lib.recordAnswer('What is your gender?', 'x', 'fixed'), /kind=human/);
  // ...but it is allowed once explicitly marked as a human answer.
  const recorded = lib.recordAnswer('What are your salary expectations?', '185000', 'human');
  assert.equal(recorded.kind, 'human');
});

test('an unanswered question is returned as needs_human, never guessed', () => {
  const resolved = lib.resolveAnswers({ ats: 'lever' });
  const location = resolved.find((one) => one.slot === 'location');
  assert.equal(location.answer, null);
  assert.equal(location.needs_human, true);
});

test('a lease blocks a second bot and expires', () => {
  const packet = lib.claim(KEY, 'grokbot-1', 30);
  assert.equal(packet.lease.bot, 'grokbot-1');
  assert.throws(() => lib.claim(KEY, 'grokbot-2', 30), /leased by grokbot-1/);

  // The same bot may renew its own lease.
  const renewed = lib.claim(KEY, 'grokbot-1', 30);
  assert.equal(renewed.lease.bot, 'grokbot-1');

  // Once the clock passes the expiry, another bot may take it.
  const later = Date.now() + 31 * 60000;
  lib.claim(KEY, 'grokbot-2', 30, later);
  assert.equal(lib.activeLeases(lib.readLeases(), later)[KEY].bot, 'grokbot-2');
});

test('a release hands the job back', () => {
  lib.release(KEY, 'grokbot-2');
  assert.equal(lib.activeLeases(lib.readLeases())[KEY], undefined);
});

test('the queue reports the application system and login requirement', () => {
  const state = lib.queueState();
  const row = state.rows.find((one) => one.key === KEY);
  assert.equal(row.ats, 'greenhouse');
  assert.equal(row.needs_login, false);
  assert.equal(row.status, 'queued');
});

test('a submitted job leaves the queue and can never be claimed again', () => {
  lib.claim(KEY, 'grokbot-1', 30);
  const receipt = lib.writeReceipt(KEY, { bot: 'grokbot-1', confirmation: 'GH-123' });
  assert.equal(receipt.confirmation, 'GH-123');
  const state = lib.queueState();
  assert.equal(state.rows.find((one) => one.key === KEY).status, 'submitted');
  assert.throws(() => lib.claim(KEY, 'grokbot-9', 30), /already submitted/);
});

test('a receipt without a confirmation is refused', () => {
  assert.throws(() => lib.writeReceipt(KEY, { bot: 'b', confirmation: '' }), /needs --confirmation/);
});

test('verify passes a resume that only reframes the source', () => {
  const generated = join(scratch, 'good.md');
  writeFileSync(generated, '# Test Person\n\nClosed a $10M ARR deal and hit 2x quota, Top 3 of 400.\n');
  const result = lib.verifyResume(generated);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
});

test('verify fails a resume that invents a figure or an employer', () => {
  const generated = join(scratch, 'bad.md');
  writeFileSync(generated, '# Test Person\n\nClosed a $47M ARR deal at Snowflakeack.\n');
  const result = lib.verifyResume(generated);
  assert.equal(result.ok, false);
  assert.ok(result.invented_numbers.includes('$47M'));
  assert.ok(result.invented_terms.includes('Snowflakeack'));
});

test('verify fails a resume that still carries an unresolved slot', () => {
  const generated = join(scratch, 'unfinished.md');
  writeFileSync(generated, '# Test Person\n\nClosed a $10M ARR deal.\n\n[GROKBOT — fill me in]\n');
  const result = lib.verifyResume(generated);
  assert.equal(result.ok, false);
  assert.equal(result.unresolved_slots, 1);
});

test('every MCP tool is reachable and returns JSON', async () => {
  const names = lib.APPLY_TOOLS.map((tool) => tool.name);
  assert.ok(names.includes('apply_claim'));
  const queue = await lib.callApplyTool('apply_queue', {});
  assert.equal(typeof queue.total, 'number');
  const ats = await lib.callApplyTool('apply_answer', { question: 'Are you onsite 5 days?', answer: 'Hybrid', kind: 'derived' });
  assert.equal(ats.slot, 'remote_preference');
  await assert.rejects(() => lib.callApplyTool('apply_receipt', { key: KEY, bot: 'b', confirmation: '' }), /needs --confirmation/);
});