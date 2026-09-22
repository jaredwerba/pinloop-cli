#!/usr/bin/env node
/**
 * Daily Boston or fully remote AE list from public Greenhouse, Ashby, and Lever boards.
 *
 * Pinloop's server caps new postings. These boards do not. Each token was
 * checked live. A token that 404s is not in scripts/boards.json. Nothing here
 * submits an application or uses the Pinloop login.
 *
 * Strong means the title itself names cloud, GPU, IaaS, PaaS, hyperscale,
 * data center, Kubernetes, or AI. A target employer alone is fair.
 * At most 8 seats per company. Dated rows older than 21 days are dropped.
 *
 * Usage: node scripts/daily-100.mjs [--target 100] [--out path.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORTALS } from './portals.mjs';

const TARGET_COUNT = numberFlag('--target', 100);
const OUT = stringFlag('--out', '');
const PER_COMPANY = 8;
const MAX_AGE_DAYS = 21;
const here = dirname(fileURLToPath(import.meta.url));
const BOARDS = JSON.parse(readFileSync(join(here, 'boards.json'), 'utf8')).boards;

const SELLER =
  /\b(account executive|account manager|strategic account|enterprise account|commercial account)\b/i;
const BLOCKED = /\b(intern(ship)?|new grad|sdr|bdr|sales development|campus|co-?op|technical account manager)\b/i;
const INFRA = /\b(cloud|gpu|iaas|paas|hyperscale|data center|kubernetes|ai)\b/i;
const FORBIDDEN = /israel|london|paris|tokyo|berlin|dublin|india|germany|canada|singapore/i;
const NON_US =
  /\b(israel|london|paris|tokyo|berlin|dublin|dach|emea|apac|india|germany|uk\b|united kingdom|canada|singapore|australia|france|brazil|japan|ireland|netherlands|spain|mexico|poland|sweden|switzerland|austria|belgium|italy|korea|china|taiwan|hong kong)\b/i;
const US_PLACE =
  /\b(united states|\busa\b|u\.s\.|san francisco|\bsf\b|new york|\bnyc\b|boston|cambridge|chicago|seattle|austin|denver|atlanta|los angeles|california|massachusetts|washington|texas|illinois|colorado|georgia|oregon|virginia|florida|arizona|remote)\b/i;
/**
 * Three-letter country codes. amazon.jobs writes "Canberra, Australian Capital
 * Territory, AUS" rather than the word Australia, so the word list above does
 * not catch it. Two-letter codes are left out because they collide with US
 * state abbreviations.
 */
const FOREIGN_CODE =
  /\b(AUS|BRA|MYS|DEU|CAN|GBR|IND|SGP|JPN|CHN|MEX|KOR|TWN|ISR|FRA|NLD|ESP|ITA|POL|SWE|CHE|AUT|BEL|DNK|NOR|FIN|PRT|IRL|NZL|ZAF|ARG|CHL|COL|PER|THA|VNM|IDN|PHL|TUR|EGY|NGA|KEN|SAU|ARE|CZE|HUN|ROU|GRC|UKR|RUS)\b/;

/**
 * Which locations the day's list keeps.
 *
 *   boston-remote  Boston, Cambridge, or a location that is fully remote. The
 *                  default, and the tighter of the two.
 *   us             anywhere in the United States, excluding foreign countries.
 *                  Employers such as Amazon, Oracle and NVIDIA post account
 *                  executives in Athens, Seattle or "United States" and almost
 *                  never as a Boston or remote seat, so nothing from them
 *                  reaches the default list.
 */
const WHERE = stringFlag('--where', 'boston-remote');

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

function boardUrl(board) {
  if (board.ats === 'ashby') return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}`;
  if (board.ats === 'lever') return `https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json`;
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs`;
}

function postedOf(value) {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function tooOld(posted) {
  if (posted === null) return false;
  const age = Date.now() - new Date(posted).getTime();
  return age > MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/** Foreign country, named or coded. Nothing outside the United States gets in. */
function isForeign(place) {
  return FORBIDDEN.test(place) || NON_US.test(place) || FOREIGN_CODE.test(place);
}

function whereOf(location) {
  const place = String(location || '').replace(/\s+/g, ' ').trim();
  if (place === '') return null;
  if (isForeign(place)) return null;
  if (/\b(boston|cambridge)\b/i.test(place)) return 'boston';
  // NVIDIA writes "US, AR, Remote" and "US, CA, Santa Clara".
  if (/^US\b/i.test(place) && /\bremote\b/i.test(place) && !/\bhybrid\b/i.test(place)) return 'remote';
  if (!/\bremote\b/i.test(place) || /\bhybrid\b/i.test(place)) return null;
  const leftover = place
    .replace(/\bremote within united states\b/ig, '')
    .replace(/\bremote\s*[-,]?\s*(united states|u\.s\.|usa|us)\b/ig, '')
    .replace(/\bremote\b/ig, '')
    .replace(/\bunited states of america\b/ig, '')
    .replace(/\bunited states\b/ig, '')
    .replace(/\busa\b/ig, '')
    .replace(/[^a-z]/ig, '');
  return leftover === '' ? 'remote' : null;
}

/** A United States location of any kind, for `--where us`. */
function usWhere(location) {
  const place = String(location || '').replace(/\s+/g, ' ').trim();
  if (place === '') return null;
  if (isForeign(place)) return null;
  if (/\b(boston|cambridge)\b/i.test(place)) return 'boston';
  if (/^US\b/i.test(place) && /\bremote\b/i.test(place) && !/\bhybrid\b/i.test(place)) return 'remote';
  if (/^united states$/i.test(place) || /^US$/i.test(place)) return 'us';
  if (/^US\b/i.test(place) || /,\s*[A-Z]{2}\b/.test(place) || US_PLACE.test(place)) return 'us';
  return null;
}

function otherMarket(title) {
  if (/\b(latam|mena|emea|apac|portuguese|spanish[- ]speaking|thai|bilingual)\b/i.test(title)) return true;
  if (/\bboston\b/i.test(title)) return false;
  return /\b(florida|west|southeast|southwest|tola|texas|california|chicago|seattle|austin|denver)\b/i.test(title);
}

function screen(title) {
  if (BLOCKED.test(title) || !SELLER.test(title)) return 'skip';
  return INFRA.test(title) ? 'strong' : 'fair';
}

function rowsFrom(board, body) {
  if (board.ats === 'lever') {
    const jobs = Array.isArray(body) ? body : [];
    return jobs.map((job) => {
      const categories = job.categories ?? {};
      return {
        title: String(job.text || '').replace(/\s+/g, ' ').trim(),
        company: board.company,
        location: String(categories.location || '').replace(/\s+/g, ' ').trim(),
        url: String(job.hostedUrl || job.applyUrl || ''),
        posted: postedOf(job.createdAt),
      };
    });
  }
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  if (board.ats === 'ashby') {
    return jobs.map((job) => ({
      title: String(job.title || '').replace(/\s+/g, ' ').trim(),
      company: board.company,
      location: String(job.location || '').replace(/\s+/g, ' ').trim(),
      url: String(job.jobUrl || job.applyUrl || ''),
      posted: postedOf(job.publishedAt),
    }));
  }
  return jobs.map((job) => ({
    title: String(job.title || '').replace(/\s+/g, ' ').trim(),
    company: board.company,
    location: String(job.location?.name || '').replace(/\s+/g, ' ').trim(),
    url: String(job.absolute_url || ''),
    posted: postedOf(job.first_published),
  }));
}

async function fetchBoard(board) {
  const response = await fetch(boardUrl(board), {
    headers: { 'user-agent': 'pinloop-daily-100/0.1', accept: 'application/json' },
  });
  if (!response.ok) return { board, missed: true, jobs: [] };
  const body = await response.json();
  return { board, missed: false, jobs: rowsFrom(board, body).filter((job) => job.url) };
}

function pick(jobs, target) {
  const byCompany = new Map();
  for (const job of jobs) {
    const list = byCompany.get(job.company) ?? [];
    list.push(job);
    byCompany.set(job.company, list);
  }
  for (const list of byCompany.values()) {
    list.sort((a, b) => {
      if (a.screen !== b.screen) return a.screen === 'strong' ? -1 : 1;
      return (b.posted || '').localeCompare(a.posted || '');
    });
  }
  const companies = [...byCompany.keys()].sort();
  const chosen = [];
  const counts = new Map();
  let progressed = true;
  while (chosen.length < target && progressed) {
    progressed = false;
    for (const company of companies) {
      if (chosen.length >= target) break;
      const taken = counts.get(company) ?? 0;
      const list = byCompany.get(company);
      if (taken >= PER_COMPANY || taken >= list.length) continue;
      chosen.push(list[taken]);
      counts.set(company, taken + 1);
      progressed = true;
    }
  }
  return chosen;
}

const settled = await Promise.all(BOARDS.map((board) => fetchBoard(board).catch(() => ({ board, missed: true, jobs: [] }))));
const boardsHit = [];
const boardsMissed = [];
const eligible = [];
const seen = new Set();

for (const result of settled) {
  const token = `${result.board.ats}:${result.board.token}`;
  if (result.missed) {
    boardsMissed.push(token);
    continue;
  }
  boardsHit.push(token);
  for (const job of result.jobs) {
    const key = `${job.company}|${job.title}|${job.location}`.toLowerCase();
    if (seen.has(job.url) || seen.has(key)) continue;
    const verdict = screen(job.title);
    if (verdict === 'skip') continue;
    const where = (WHERE === 'us' ? usWhere : whereOf)(job.location);
    if (where === null) continue;
    if (WHERE !== 'us' && otherMarket(job.title)) continue;
    if (tooOld(job.posted)) continue;
    seen.add(job.url);
    seen.add(key);
    eligible.push({ ...job, screen: verdict, where });
  }
}

// Employer portals that publish their own job endpoints. Same treatment as a
// board: a portal that stops answering is recorded, not fatal.
const portalsHit = [];
const portalsMissed = [];
for (const [name, load] of PORTALS) {
  let rows = [];
  try {
    rows = await load();
  } catch {
    portalsMissed.push(name);
    continue;
  }
  portalsHit.push(name);
  for (const job of rows) {
    const key = `${job.company}|${job.title}|${job.location}`.toLowerCase();
    if (seen.has(job.url) || seen.has(key)) continue;
    const verdict = screen(job.title);
    if (verdict === 'skip') continue;
    const where = (WHERE === 'us' ? usWhere : whereOf)(job.location);
    if (where === null) continue;
    if (WHERE !== 'us' && otherMarket(job.title)) continue;
    if (tooOld(job.posted)) continue;
    seen.add(job.url);
    seen.add(key);
    eligible.push({ ...job, screen: verdict, where, source: name });
  }
}

const jobs = pick(eligible, TARGET_COUNT);
const undated = jobs.filter((job) => job.posted === null).length;
const companies = new Set(jobs.map((job) => job.company));
const report = {
  pulledAt: new Date().toISOString(),
  target: TARGET_COUNT,
  count: jobs.length,
  strong: jobs.filter((job) => job.screen === 'strong').length,
  fair: jobs.filter((job) => job.screen === 'fair').length,
  undated,
  companies: companies.size,
  perCompanyMax: PER_COMPANY,
  where: WHERE,
  boardsHit,
  boardsMissed,
  portalsHit,
  portalsMissed,
  jobs,
};

if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(`boards hit ${boardsHit.length}, missed ${boardsMissed.length}, eligible ${eligible.length}, companies ${companies.size}`);
console.log(`portals hit ${portalsHit.length}, missed ${portalsMissed.length}`);
console.log(`${jobs.length} US seller seats (${WHERE}) — ${report.strong} strong, ${report.fair} fair, ${undated} undated`);
for (const job of jobs.slice(0, 12)) {
  console.log(`${job.screen}  ${job.title}  ${job.company}  ${job.location || '(no location)'}`);
}
if (jobs.length > 12) console.log(`... ${jobs.length - 12} more`);
if (OUT) console.log(`wrote ${OUT}`);
if (OUT) {
  const save = spawnSync(process.execPath, [
    join(here, '..', '..', 'daily-site', 'scripts', 'save-day.mjs'),
    OUT,
  ], { stdio: 'inherit' });
  if (save.status !== 0) {
    console.error('the run was written to disk, but it was not saved to the database');
    process.exit(save.status ?? 1);
  }
}
const ok = jobs.length > 0 && jobs.every((job) => ['boston', 'remote', 'us'].includes(job.where));
process.exit(ok ? 0 : 2);
