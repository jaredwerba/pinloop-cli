#!/usr/bin/env node
/**
 * Daily AE search against public Greenhouse boards.
 *
 * Pinloop's server caps new postings. These boards do not. Each token is one
 * company's public job board (GET, no key). A miss is skipped. Nothing here
 * submits an application.
 *
 * At most 8 seats are kept per company, so one board cannot fill the day.
 * A location that is not a US place is dropped. Blank location is kept.
 *
 * Usage: node scripts/daily-100.mjs [--target 100] [--out path.json]
 */

const TARGET_COUNT = numberFlag('--target', 100);
const OUT = stringFlag('--out', '');
const PER_BOARD = 8;

const BOARDS = [
  'stripe', 'airtable', 'anthropic', 'openai', 'databricks', 'snowflake',
  'vercel', 'temporal', 'launchdarkly', 'glean', 'writer', 'mercury',
  'coreweave', 'nebius', 'fireworksai', 'fireworks', 'braintrust',
  'cloudflare', 'datadog', 'mongodb', 'elastic', 'confluent', 'hashicorp',
  'gitlab', 'grafana', 'clickhouse', 'cockroachlabs', 'supabase', 'neon',
  'modal', 'together', 'crusoe', 'scaleai', 'cohere', 'mistral',
  'perplexity', 'huggingface', 'wandb', 'replicate', 'anyscale',
  'cerebras', 'sambanova', 'groq', 'equinix', 'digitalocean', 'fastly',
  'commvault', 'nvidia', 'appian', 'brex', 'ramp', 'plaid', 'rippling',
  'gusto', 'notion', 'figma', 'linear', 'discord', 'reddit', 'coinbase',
  'robinhood', 'affirm', 'chime', 'sofi', 'lattice', 'gitlab',
];

const TARGET = new Set([
  'stripe', 'airtable', 'databricks', 'snowflake', 'vercel', 'temporal',
  'coreweave', 'nebius', 'anthropic', 'openai', 'nvidia', 'commvault',
  'launchdarkly', 'glean', 'writer', 'mercury', 'fireworks', 'braintrust',
]);

const SELLER = /\b(account executive|account manager|strategic account|enterprise account|commercial account)\b/i;
const BLOCKED = /\b(intern(ship)?|new grad|sdr|bdr|sales development|campus|co-?op)\b/i;
const CLOUD = /\b(cloud|gpu|iaas|paas|hyperscal|data center|kubernetes)\b/i;
const US_PLACE =
  /\b(united states|\busa\b|u\.s\.|san francisco|\bsf\b|new york|\bnyc\b|boston|cambridge|chicago|seattle|austin|denver|atlanta|los angeles|california|massachusetts|washington|texas|illinois|colorado|georgia|oregon|virginia|florida|arizona|remote)\b/i;
const NON_US =
  /\b(israel|london|paris|tokyo|berlin|dublin|dach|emea|apac|india|germany|uk\b|united kingdom|canada|singapore|australia|france|brazil|japan|ireland|netherlands|spain|mexico|poland|sweden|switzerland)\b/i;

function numberFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function stringFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

function screen(title, location, company) {
  if (BLOCKED.test(title) || !SELLER.test(title)) return 'skip';
  const place = location || '';
  if (NON_US.test(place) && !/\b(united states|\busa\b|US-)/.test(place)) return 'no';
  if (place && !US_PLACE.test(place) && !/\bUS-/.test(place)) return 'no';
  if (CLOUD.test(title) || TARGET.has(company)) return 'strong';
  return 'fair';
}

async function boardJobs(token) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`;
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) return [];
  const body = await response.json();
  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  return jobs
    .map((job) => ({
      title: String(job.title || ''),
      company: token,
      location: String(job.location?.name || ''),
      url: String(job.absolute_url || ''),
      posted: job.first_published || job.updated_at || null,
    }))
    .filter((job) => job.url);
}

const found = [];
const boardsHit = [];
const boardsMissed = [];

for (const token of BOARDS) {
  if (found.length >= TARGET_COUNT) break;
  let jobs = [];
  try {
    jobs = await boardJobs(token);
  } catch {
    boardsMissed.push(token);
    continue;
  }
  if (jobs.length === 0) {
    boardsMissed.push(token);
    continue;
  }
  boardsHit.push(token);
  let kept = 0;
  for (const job of jobs) {
    if (kept >= PER_BOARD || found.length >= TARGET_COUNT) break;
    const verdict = screen(job.title, job.location, token);
    if (verdict === 'skip' || verdict === 'no') continue;
    found.push({ ...job, screen: verdict });
    kept += 1;
  }
}

const ranked = [
  ...found.filter((job) => job.screen === 'strong'),
  ...found.filter((job) => job.screen === 'fair'),
];

const report = {
  pulledAt: new Date().toISOString(),
  target: TARGET_COUNT,
  count: ranked.length,
  strong: ranked.filter((job) => job.screen === 'strong').length,
  fair: ranked.filter((job) => job.screen === 'fair').length,
  boardsHit,
  boardsMissedCount: boardsMissed.length,
  jobs: ranked,
};

if (OUT) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
}

const companies = new Set(ranked.map((job) => job.company));
console.log(`boards hit ${boardsHit.length}, missed ${boardsMissed.length}, companies in list ${companies.size}`);
console.log(`${ranked.length} US seller seats (${report.strong} strong, ${report.fair} fair)`);
for (const job of ranked.slice(0, 12)) {
  console.log(`${job.screen}  ${job.title}  ${job.company}  ${job.location}`);
}
if (ranked.length > 12) console.log(`... ${ranked.length - 12} more`);
if (OUT) console.log(`wrote ${OUT}`);
process.exit(ranked.length >= TARGET_COUNT ? 0 : 2);
