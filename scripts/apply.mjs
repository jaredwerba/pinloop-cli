#!/usr/bin/env node
/**
 * Apply queue CLI for a bot that walks into the form.
 *
 *   node scripts/apply.mjs build --from /home/jkw/OmarchyJobs/daily/quality-us.json
 *   node scripts/apply.mjs status
 *   node scripts/apply.mjs next
 *   node scripts/apply.mjs claim <key> --bot grokbot-1
 *   node scripts/apply.mjs answer --question "Are you authorized to work in the US?" --answer "Yes" --kind fixed
 *   node scripts/apply.mjs verify <key>
 *   node scripts/apply.mjs receipt <key> --bot grokbot-1 --confirmation "GH-88213"
 *   node scripts/apply.mjs release <key> --bot grokbot-1
 *   node scripts/apply.mjs mcp
 *
 * Every command prints JSON, so a bot reads results rather than screen-scraping.
 */
import { createInterface } from 'node:readline';

import {
  APPLY_DIR,
  APPLY_TOOLS,
  buildQueue,
  callApplyTool,
  claim,
  detectAts,
  nextUp,
  queueState,
  readAnswers,
  recordAnswer,
  release,
  resolveAnswers,
  verifyResume,
  writeReceipt,
  packetDir,
} from './apply-lib.mjs';

const argv = process.argv.slice(2);
const command = argv[0] ?? 'status';

function flag(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = argv[i + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function positional(index) {
  const args = argv.slice(1).filter((one) => !one.startsWith('--'));
  return args[index] ?? null;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exit(2);
}

/** Commands run inside this so a refusal comes back as JSON, not a stack trace. */
async function run() {
  switch (command) {
  case 'build': {
    const from = flag('from');
    if (!from) fail('build needs --from <daily run json>');
    const result = buildQueue(from);
    print({ ...result, queue: `${APPLY_DIR}/queue.json`, note: `${result.added} new, ${result.kept} already queued` });
    break;
  }

  case 'status':
  case 'queue': {
    const state = queueState();
    const only = flag('status');
    const rows = only ? state.rows.filter((row) => row.status === only) : state.rows;
    print({
      built_at: state.built_at,
      total: state.total,
      counts: {
        queued: state.rows.filter((r) => r.status === 'queued').length,
        leased: state.rows.filter((r) => r.status === 'leased').length,
        submitted: state.rows.filter((r) => r.status === 'submitted').length,
      },
      by_ats: state.rows.reduce((acc, row) => ({ ...acc, [row.ats]: (acc[row.ats] ?? 0) + 1 }), {}),
      needing_login: state.rows.filter((row) => row.needs_login && row.status === 'queued').length,
      rows: rows.slice(0, Number(flag('limit', '25'))),
    });
    break;
  }

  case 'next': {
    const next = nextUp();
    if (!next) {
      print({ next: null, note: 'queue drained' });
      break;
    }
    print({ next, hint: `claim it with: node scripts/apply.mjs claim ${next.key} --bot <name>` });
    break;
  }

  case 'claim': {
    const key = positional(0);
    if (!key) fail('claim needs a key');
    const packet = claim(key, flag('bot', 'agent'), Number(flag('ttl', '30')));
    print(packet);
    break;
  }

  case 'release': {
    const key = positional(0);
    if (!key) fail('release needs a key');
    print(release(key, flag('bot', 'agent')));
    break;
  }

  case 'answer': {
    const question = flag('question');
    const answer = flag('answer');
    if (!question || !answer) fail('answer needs --question and --answer');
    print(recordAnswer(question, answer, flag('kind', 'fixed')));
    break;
  }

  case 'answers': {
    const store = readAnswers();
    const entries = Object.values(store.entries ?? {});
    print({ count: entries.length, entries });
    break;
  }

  case 'questions': {
    const key = positional(0);
    if (!key) fail('questions needs a key');
    const state = queueState();
    const job = state.rows.find((row) => row.key === key);
    if (!job) fail(`no queued job with key ${key}`);
    print({ key, ats: job.ats, needs_login: job.needs_login, answers: resolveAnswers(job) });
    break;
  }

  case 'verify': {
    const target = flag('file') ?? positional(0);
    if (!target) fail('verify needs a key or --file <resume.md>');
    let path = target;
    if (!target.includes('/')) {
      const state = queueState();
      const job = state.rows.find((row) => row.key === target);
      if (!job) fail(`no queued job with key ${target}`);
      path = `${packetDir(target)}/resume.md`;
    }
    const result = verifyResume(path);
    print(result);
    process.exit(result.ok ? 0 : 3);
    break;
  }

  case 'receipt': {
    const key = positional(0);
    if (!key) fail('receipt needs a key');
    print(
      writeReceipt(key, {
        bot: flag('bot', 'agent'),
        confirmation: flag('confirmation', ''),
        note: flag('note'),
        status: flag('status', 'submitted'),
      }),
    );
    break;
  }

  case 'ats': {
    const url = positional(0);
    if (!url) fail('ats needs a url');
    print({ url, ats: detectAts(url) });
    break;
  }

  case 'mcp': {
    const lines = createInterface({ input: process.stdin });
    const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
    for await (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      let request;
      try {
        request = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const id = request.id;
      const method = String(request.method ?? '');
      try {
        if (method === 'initialize') {
          write({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'pinloop-apply', version: '0.1.0' },
            },
          });
        } else if (method.startsWith('notifications/')) {
          // no reply
        } else if (method === 'tools/list') {
          write({ jsonrpc: '2.0', id, result: { tools: APPLY_TOOLS } });
        } else if (method === 'tools/call') {
          const params = request.params ?? {};
          const result = await callApplyTool(String(params.name ?? ''), params.arguments ?? {});
          write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
        } else {
          write({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
        }
      } catch (error) {
        write({ jsonrpc: '2.0', id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
      }
    }
    break;
  }

  default:
    fail(`unknown command '${command}'. Try: build, status, next, claim, release, answer, answers, questions, verify, receipt, ats, mcp`);
  }
}

try {
  await run();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}