/**
 * Pull public career-site listings Pinloop does not receive.
 *
 * Pinloop's pull only covers the feeds its servers already ingest. An employer's
 * own Greenhouse or Ashby board is often missing from that set. These two
 * posting APIs are unauthenticated and per company. No login, no Pinloop quota.
 *
 *   node listings/scan-boards.mjs
 *
 * Writes listings/seller.json (title, employer, location, url) and
 * listings/summary.json (how many jobs each board had).
 * Oracle, AWS, Microsoft, Google, NVIDIA and Glean are not on these two APIs.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Boards confirmed live on 2026-09-22. Slug is the board id, not a guess. */
const BOARDS = [
  ['greenhouse', 'nebius', 'Nebius'],
  ['greenhouse', 'coreweave', 'CoreWeave'],
  ['greenhouse', 'anthropic', 'Anthropic'],
  ['greenhouse', 'stripe', 'Stripe'],
  ['greenhouse', 'databricks', 'Databricks'],
  ['greenhouse', 'vercel', 'Vercel'],
  ['greenhouse', 'togetherai', 'Together AI'],
  ['greenhouse', 'launchdarkly', 'LaunchDarkly'],
  ['greenhouse', 'mercury', 'Mercury'],
  ['greenhouse', 'appian', 'Appian'],
  ['greenhouse', 'scaleai', 'Scale AI'],
  ['ashby', 'crusoe', 'Crusoe'],
  ['ashby', 'openai', 'OpenAI'],
  ['ashby', 'snowflake', 'Snowflake'],
  ['ashby', 'temporal', 'Temporal'],
  ['ashby', 'lambda', 'Lambda Labs'],
  ['ashby', 'fireworks', 'Fireworks'],
  ['ashby', 'writer', 'Writer'],
  ['ashby', 'braintrust', 'Braintrust'],
];

const SELLER =
  /\b(account executive|account manager|strategic account|enterprise account|commercial account|account director|sales director|director of sales|head of sales|regional sales|territory manager|sales manager)\b/i;
const BLOCKED =
  /\b(intern(ship)?|new grad|campus|co-?op|sdr|bdr|sales development|business development representative|recruit(er|ing))\b/i;

const US_COUNTRY = /^(united states|usa|u\.s\.a\.|u\.s\.|us)$/i;

/** Last segment of a location, when it is a country rather than a US state. Two-letter codes that are also US states are left out. */
const COUNTRY_SEGMENT = {
  can: 'Canada',
  canada: 'Canada',
  uk: 'United Kingdom',
  'u.k.': 'United Kingdom',
  gbr: 'United Kingdom',
  'united kingdom': 'United Kingdom',
  england: 'United Kingdom',
  france: 'France',
  germany: 'Germany',
  japan: 'Japan',
  singapore: 'Singapore',
  australia: 'Australia',
  ireland: 'Ireland',
  netherlands: 'Netherlands',
  sweden: 'Sweden',
  'south korea': 'South Korea',
  korea: 'South Korea',
  india: 'India',
  brazil: 'Brazil',
  mexico: 'Mexico',
  spain: 'Spain',
  italy: 'Italy',
  switzerland: 'Switzerland',
  israel: 'Israel',
  poland: 'Poland',
  belgium: 'Belgium',
  denmark: 'Denmark',
  norway: 'Norway',
  finland: 'Finland',
  portugal: 'Portugal',
  austria: 'Austria',
  china: 'China',
  uae: 'United Arab Emirates',
  ie: 'Ireland',
  ch: 'Switzerland',
  fr: 'France',
  jp: 'Japan',
  sg: 'Singapore',
  au: 'Australia',
  nl: 'Netherlands',
  se: 'Sweden',
  kr: 'South Korea',
  nz: 'New Zealand',
  be: 'Belgium',
  at: 'Austria',
  pl: 'Poland',
  es: 'Spain',
  it: 'Italy',
  br: 'Brazil',
  mx: 'Mexico',
  no: 'Norway',
  dk: 'Denmark',
  fi: 'Finland',
  pt: 'Portugal',
  il: 'Israel',
  hk: 'Hong Kong',
  tw: 'Taiwan',
  ae: 'United Arab Emirates',
};

/** Bare city names that are not in the United States. */
const FOREIGN_CITY = {
  london: 'United Kingdom',
  dublin: 'Ireland',
  paris: 'France',
  munich: 'Germany',
  tokyo: 'Japan',
  seoul: 'South Korea',
  sydney: 'Australia',
  amsterdam: 'Netherlands',
  stockholm: 'Sweden',
  singapore: 'Singapore',
  berlin: 'Germany',
  toronto: 'Canada',
  vancouver: 'Canada',
};

function urlFor(ats, slug) {
  if (ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
  return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
}

function countryOrLocation(name) {
  const value = (name ?? '').replace(/\s+/g, ' ').trim();
  if (value === '') return { countries: [], locations: [] };
  if (US_COUNTRY.test(value) || /\b(united states|usa)\b/i.test(value) || /^US-/i.test(value)) {
    return { countries: ['United States'], locations: [value] };
  }
  const compact = value.toLowerCase();
  if (compact.startsWith('fr-')) return { countries: ['France'], locations: [value] };
  if (compact.startsWith('gb-') || compact.startsWith('uk-')) return { countries: ['United Kingdom'], locations: [value] };
  if (compact.startsWith('ca-') || /\btoronto\b/.test(compact)) return { countries: ['Canada'], locations: [value] };
  if (/\b(dublin|london|berlin|paris)\b/.test(compact)) {
    const named = /\bdublin\b/.test(compact) ? 'Ireland' : /\bparis\b/.test(compact) ? 'France' : /\bberlin\b/.test(compact) ? 'Germany' : 'United Kingdom';
    return { countries: [named], locations: [value] };
  }
  const parts = value.split(',').map((part) => part.trim()).filter((part) => part !== '');
  const last = (parts[parts.length - 1] ?? '').toLowerCase();
  const named = COUNTRY_SEGMENT[last] ?? FOREIGN_CITY[last] ?? FOREIGN_CITY[value.toLowerCase()];
  if (named !== undefined) return { countries: [named], locations: [value] };
  return { countries: [], locations: [value] };
}

function fromGreenhouse(board, job) {
  const place = countryOrLocation(job.location?.name);
  return {
    id: `${board[0]}:${board[1]}:${job.id}`,
    title: (job.title ?? '').replace(/\s+/g, ' ').trim(),
    company: job.company_name || board[2],
    ...place,
    url: job.absolute_url ?? '',
    posted_at: job.updated_at ?? job.first_published ?? null,
    ats: board[0],
    board: board[1],
  };
}

function fromAshby(board, job) {
  const place = countryOrLocation(typeof job.location === 'string' ? job.location : '');
  const workplace = job.workplaceType ?? (job.isRemote === true ? 'Remote' : null);
  return {
    id: `${board[0]}:${board[1]}:${job.id}`,
    title: (job.title ?? '').replace(/\s+/g, ' ').trim(),
    company: board[2],
    ...place,
    workplace_type: workplace,
    url: job.jobUrl ?? job.applyUrl ?? '',
    posted_at: job.publishedAt ?? null,
    ats: board[0],
    board: board[1],
  };
}

async function fetchBoard(board) {
  const [ats, slug] = board;
  const response = await fetch(urlFor(ats, slug), {
    headers: { 'user-agent': 'pinloop-fit-scan/0.1', accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${ats} ${slug} HTTP ${response.status}`);
  const body = await response.json();
  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  const rows = jobs.map((job) => (ats === 'greenhouse' ? fromGreenhouse(board, job) : fromAshby(board, job)));
  return { board, jobs: rows };
}

const settled = await Promise.all(
  BOARDS.map(async (board) => {
    try {
      return await fetchBoard(board);
    } catch (error) {
      return { board, error: error instanceof Error ? error.message : String(error), jobs: [] };
    }
  }),
);

const seller = [];
const summary = [];
for (const result of settled) {
  const [ats, slug, company] = result.board;
  const kept = result.jobs.filter((row) => SELLER.test(row.title) && !BLOCKED.test(row.title));
  seller.push(...kept);
  summary.push({
    ats,
    slug,
    company,
    jobs: result.jobs.length,
    seller: kept.length,
    error: result.error ?? null,
  });
}

seller.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
writeFileSync(join(here, 'seller.json'), `${JSON.stringify(seller, null, 2)}\n`);
writeFileSync(
  join(here, 'summary.json'),
  `${JSON.stringify({ scanned_at: new Date().toISOString(), boards: summary, seller: seller.length }, null, 2)}\n`,
);

const failed = summary.filter((row) => row.error);
console.log(`boards ${summary.length}, seller listings ${seller.length}, failed ${failed.length}`);
for (const row of summary) {
  console.log(`${row.seller}\t${row.jobs}\t${row.company}\t${row.ats}`);
}
