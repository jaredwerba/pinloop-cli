/**
 * Tests for the intake pipeline and the MCP server. Run: node --test tests/intake.test.mjs
 * Network is mocked nowhere: these exercise the store, the rubric integration,
 * the push endpoint (real HTTP on a random port), and the MCP stdio server.
 * Board fetching over the live network is NOT in these tests.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CLI = join(root, 'dist', 'cli', 'pinloop.js');

const scratch = mkdtempSync(join(tmpdir(), 'intake-test-'));
process.env['PINLOOP_INTAKE_DIR'] = join(scratch, 'intake');
const dir = process.env['PINLOOP_INTAKE_DIR'];

// import after the env var is set
const store = await import(join(root, 'dist', 'intake', 'store.js'));
const sources = await import(join(root, 'dist', 'intake', 'sources.js'));

const row = (over = {}) => ({
  source: 'greenhouse',
  board: 'stripe',
  id: 'gh-stripe-1',
  title: 'Account Executive',
  company: 'Stripe',
  locations: ['Seattle, WA'],
  countries: ['United States'],
  url: 'https://boards.greenhouse.io/stripe/jobs/1',
  description_text: 'quota carrying account executive',
  posted_at: '2026-09-20T00:00:00Z',
  employment: 'FULL_TIME',
  workplace: 'ONSITE',
  seen_at: new Date().toISOString(),
  ...over,
});

beforeEach(() => rmSync(dir, { recursive: true, force: true }));
after(() => rmSync(scratch, { recursive: true, force: true }));

test('addRows stores screened rows and counts them', () => {
  const { counts, addedRows } = store.addRows(dir, [row(), row({ title: 'Sales Development Representative', id: 'gh-stripe-2', url: 'https://boards.greenhouse.io/stripe/jobs/2' })]);
  assert.equal(counts.fetched, 2);
  assert.equal(counts.added, 2);
  assert.equal(counts.duplicates, 0);
  assert.equal(counts.screened.strong, 1);
  assert.equal(counts.screened.no, 1);
  assert.equal(addedRows[0].screen, 'strong');
  assert.ok(existsSync(join(dir, `${store.dayStamp()}.jsonl`)));
});

test('addRows dedupes by url across runs', () => {
  store.addRows(dir, [row()]);
  const second = store.addRows(dir, [row(), row({ url: 'https://other.example/x', id: 'x1', title: 'SDR' })]);
  assert.equal(second.counts.added, 1);
  assert.equal(second.counts.duplicates, 1);
  assert.equal(second.counts.dayTotal, 2);
});

test('identityOf prefers url, falls back to source:id', () => {
  assert.equal(store.identityOf(row()), 'https://boards.greenhouse.io/stripe/jobs/1');
  assert.equal(store.identityOf(row({ url: '', id: 'abc' })), 'greenhouse:abc');
});

test('readDays reads back stored rows', () => {
  store.addRows(dir, [row(), row({ id: 'r2', url: 'https://x/2' })]);
  const rows = store.readDays(dir, 1);
  assert.equal(rows.length, 2);
});

test('parseBoardSpecs accepts source:token and rejects junk', () => {
  const specs = sources.parseBoardSpecs(['greenhouse:stripe', 'lever:nebius']);
  assert.deepEqual(specs, [{ source: 'greenhouse', token: 'stripe' }, { source: 'lever', token: 'nebius' }]);
  assert.throws(() => sources.parseBoardSpecs(['stripe']), /not understood/);
});

// ---- the CLI commands, end to end -----------------------------------------

function runCli(args, input) {
  return execFileSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8', cwd: root, env: { ...process.env, PINLOOP_INTAKE_DIR: dir } });
}

test('intake day --json returns stored rows', () => {
  store.addRows(dir, [row()]);
  const parsed = JSON.parse(runCli(['intake', 'day', '--json']));
  assert.equal(parsed.count, 1);
  assert.equal(parsed.rows[0].company, 'Stripe');
});

test('intake day --screen filters', () => {
  store.addRows(dir, [row(), row({ id: 'r3', url: 'https://x/3', title: 'Recruiter' })]);
  const parsed = JSON.parse(runCli(['intake', 'day', '--json', '--screen', 'no']));
  assert.equal(parsed.count, 1);
});

test('intake status reports against target', () => {
  store.addRows(dir, [row()]);
  const out = runCli(['intake', 'status']);
  assert.match(out, /Today holds 1 postings/);
  assert.match(out, /target of 100/);
});

test('intake serve stores pushed rows over HTTP', async () => {
  const child = spawn(process.execPath, [CLI, 'intake', 'serve', '--port', '0'], {
    cwd: root,
    env: { ...process.env, PINLOOP_INTAKE_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // port 0 would be ideal but the CLI prints the fixed port; use a scratch port
  child.kill('SIGTERM');
  // Instead pick a free port ourselves.
  const net = await import('node:net');
  const server = net.createServer();
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  server.close();

  const child2 = spawn(process.execPath, [CLI, 'intake', 'serve', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, PINLOOP_INTAKE_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    // wait for the listen line
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
      child2.stdout.on('data', (chunk) => {
        if (String(chunk).includes('intake endpoint on')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const push = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Enterprise Account Executive', company: 'CoreWeave', locations: ['Boston, MA'], url: 'https://push.example/1' }),
    });
    const body = await push.json();
    assert.equal(push.status, 200);
    assert.equal(body.counts.added, 1);
    assert.equal(body.counts.screened.strong, 1);

    const status = await (await fetch(`http://127.0.0.1:${port}/status`)).json();
    assert.equal(status.day, store.dayStamp());
    assert.ok(status.rows >= 1);

    const bad = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nothing: true }),
    });
    assert.equal(bad.status, 400);
  } finally {
    child2.kill('SIGTERM');
    child.kill('SIGTERM');
  }
});

test('mcp server speaks JSON-RPC over stdio', async () => {
  const child = spawn(process.execPath, [CLI, 'mcp'], {
    cwd: root,
    env: { ...process.env, PINLOOP_INTAKE_DIR: dir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  child.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() !== '') lines.push(JSON.parse(line));
    }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fit_score', arguments: { rows: [{ title: 'Account Executive', company: 'Nebius', countries: ['United States'] }] } } })}\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, 2500));
  child.kill('SIGTERM');

  const byId = new Map(lines.map((message) => [message.id, message]));
  assert.equal(byId.get(1).result.serverInfo.name, 'pinloop-fork-intake');
  const toolNames = byId.get(2).result.tools.map((tool) => tool.name);
  for (const need of ['intake_boards', 'intake_status', 'intake_day', 'fit_score', 'fit_plan']) {
    assert.ok(toolNames.includes(need), `missing tool ${need}`);
  }
  const scored = JSON.parse(byId.get(3).result.content[0].text);
  assert.equal(scored.results[0].screen, 'strong');
});
