#!/usr/bin/env node
/**
 * Scan the employer career portals that do not use Greenhouse, Ashby, or Lever.
 *
 * Amazon, Microsoft, NVIDIA, Oracle, Google and Glean publish their own job
 * endpoints; Voltage Park runs on kula.ai. None needs a login and none spends
 * Pinloop's daily pull. Loaders live in scripts/portals.mjs.
 *
 *   node scripts/scan-portals.mjs [--out listings/portals.json]
 *
 * A portal that stops answering is recorded in misses and does not sink the run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PORTALS } from './portals.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = stringFlag('--out', join(here, '..', 'listings', 'portals.json'));

const SELLER =
  /\b(account executive|account manager|strategic account|enterprise account|commercial account|account director|sales director|director of sales|head of sales|regional sales|territory manager|sales manager)\b/i;
const BLOCKED =
  /\b(intern(ship)?|new grad|campus|co-?op|sdr|bdr|sales development|business development representative|recruit(er|ing))\b/i;

function stringFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

/** Seller-title filter, shared with the daily list. */
export function isSellerRow(row) {
  return Boolean(row.url && row.title) && !BLOCKED.test(row.title) && SELLER.test(row.title);
}

const results = [];
const seller = [];
const seen = new Set();

for (const [name, load] of PORTALS) {
  try {
    const rows = await load();
    const kept = rows.filter((row) => {
      if (!isSellerRow(row)) return false;
      if (seen.has(row.url)) return false;
      seen.add(row.url);
      return true;
    });
    seller.push(...kept.map((row) => ({ ...row, portal: name })));
    results.push({ portal: name, jobs: rows.length, seller: kept.length, error: null });
    console.log(`${String(kept.length).padStart(4)} seller / ${String(rows.length).padStart(5)} jobs  ${name}`);
  } catch (error) {
    results.push({ portal: name, jobs: 0, seller: 0, error: String(error?.message ?? error) });
    console.log(`   miss  ${name}: ${error?.message ?? error}`);
  }
}

seller.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
const report = {
  scanned_at: new Date().toISOString(),
  portals: results,
  seller: seller.length,
  misses: results.filter((row) => row.error).map((row) => row.portal),
  jobs: seller,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${seller.length} seller listings from ${results.filter((row) => !row.error).length}/${results.length} portals`);
console.log(`wrote ${OUT}`);
process.exit(seller.length > 0 ? 0 : 2);