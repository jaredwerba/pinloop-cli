import { readFileSync } from 'node:fs';
import { PORTALS } from './portals.mjs';

const SELLER =
  /\b(account executive|account manager|strategic account|enterprise account|commercial account)\b/i;
const BLOCKED = /\b(intern(ship)?|new grad|sdr|bdr|sales development|campus|co-?op|technical account manager)\b/i;
const FORBIDDEN = /israel|london|paris|tokyo|berlin|dublin|india|germany|canada|singapore/i;
const NON_US =
  /\b(israel|london|paris|tokyo|berlin|dublin|dach|emea|apac|india|germany|uk\b|united kingdom|canada|singapore|australia|france|brazil|japan|ireland|netherlands|spain|mexico|poland|sweden|switzerland|austria|belgium|italy|korea|china|taiwan|hong kong)\b/i;
const US_PLACE =
  /\b(united states|\busa\b|u\.s\.|san francisco|\bsf\b|new york|\bnyc\b|boston|cambridge|chicago|seattle|austin|denver|atlanta|los angeles|california|massachusetts|washington|texas|illinois|colorado|georgia|oregon|virginia|florida|arizona|remote)\b/i;

function whereOf(location) {
  const place = String(location || '').replace(/\s+/g, ' ').trim();
  if (place === '') return null;
  if (FORBIDDEN.test(place) || NON_US.test(place)) return null;
  if (/\b(boston|cambridge)\b/i.test(place)) return 'boston';
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

function usAnywhere(location) {
  const place = String(location || '').replace(/\s+/g, ' ').trim();
  if (place === '') return false;
  if (FORBIDDEN.test(place) || NON_US.test(place)) return false;
  return /US-|\bUS\b/i.test(place) || US_PLACE.test(place) || /,\s*[A-Z]{2}\b/.test(place);
}

const rows = [];
for (const [name, load] of PORTALS) {
  try {
    const jobs = await load();
    const seller = jobs.filter((j) => j.url && j.title && !BLOCKED.test(j.title) && SELLER.test(j.title));
    const bostonRemote = seller.filter((j) => whereOf(j.location) !== null);
    const usAny = seller.filter((j) => usAnywhere(j.location));
    rows.push({ portal: name, all: jobs.length, seller: seller.length, bostonRemote: bostonRemote.length, usAny: usAny.length });
    if (bostonRemote.length) {
      console.log(`\n${name} — Boston/remote matches:`);
      for (const j of bostonRemote.slice(0, 8)) console.log(`   ${j.title} | ${j.location}`);
    }
  } catch (e) {
    rows.push({ portal: name, error: String(e.message ?? e) });
  }
}

console.log('\nportal                jobs  seller  boston/remote  US-anywhere');
for (const r of rows) {
  if (r.error) {
    console.log(`${r.portal.padEnd(20)} MISS ${r.error}`);
    continue;
  }
  console.log(`${r.portal.padEnd(20)} ${String(r.all).padStart(5)} ${String(r.seller).padStart(7)} ${String(r.bostonRemote).padStart(14)} ${String(r.usAny).padStart(12)}`);
}

console.log('\nUS-anywhere seller seats by employer (what a wider gate would add):');
const wide = [];
for (const [name, load] of PORTALS) {
  try {
    for (const j of await load()) {
      if (j.url && j.title && !BLOCKED.test(j.title) && SELLER.test(j.title) && usAnywhere(j.location)) wide.push(j);
    }
  } catch {}
}
const byCompany = new Map();
for (const j of wide) byCompany.set(j.company, (byCompany.get(j.company) ?? 0) + 1);
console.log([...byCompany.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join('  '));
console.log('total US-anywhere seller seats from portals:', wide.length);