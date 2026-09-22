#!/usr/bin/env node
/**
 * Regenerates the daily-100 test fixtures. Run from the repo root:
 *   node tests/fixtures/make-daily-100-fixtures.mjs
 * The good fixture is a full 100-row day that must pass the gate: 20 US
 * companies x 5 seats, unique urls, and strong rows that all carry infra
 * words in the title. The bad fixture plants exactly one row per rule the
 * gate enforces. Committed output; this script is only for regeneration.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const companies = [
  ['coreweave', 'CoreWeave'], ['nebius', 'Nebius'], ['stripe', 'Stripe'],
  ['databricks', 'Databricks'], ['snowflake', 'Snowflake'], ['vercel', 'Vercel'],
  ['temporal', 'Temporal'], ['launchdarkly', 'LaunchDarkly'], ['glean', 'Glean'],
  ['writer', 'Writer'], ['mercury', 'Mercury'], ['anthropic', 'Anthropic'],
  ['openai', 'OpenAI'], ['nvidia', 'NVIDIA'], ['commvault', 'Commvault'],
  ['crusoe', 'Crusoe'], ['braintrust', 'Braintrust'], ['modal', 'Modal'],
  ['together', 'Together AI'], ['hashicorp', 'HashiCorp'],
];

const places = [
  'Boston, MA', 'New York, NY', 'Seattle, WA', 'Austin, TX', 'Chicago, IL',
  'San Francisco, CA', 'Remote, United States',
];

const strongTitles = [
  'Account Executive, AI Infrastructure',
  'Enterprise Account Executive — GPU Cloud',
  'Account Manager, IaaS Platform',
  'Strategic Account Executive, Kubernetes',
  'Commercial Account Executive, Hyperscale Data Center',
  'Account Executive, AI Startups',
];

const fairTitles = [
  'Account Executive, Mid Market',
  'Enterprise Account Executive',
  'Commercial Account Manager',
  'Strategic Account Executive',
];

const good = {
  pulledAt: '2026-09-22T13:00:00.000Z',
  target: 100,
  count: 100,
  strong: 0,
  fair: 0,
  boardsHit: companies.map(([token]) => token),
  boardsMissedCount: 0,
  jobs: [],
};

let n = 0;
for (const [token, name] of companies) {
  for (let seat = 0; seat < 5; seat += 1) {
    n += 1;
    // strong only with infra words in the title; the rest are fair
    const isStrong = seat < 3;
    const title = isStrong
      ? strongTitles[(n + seat) % strongTitles.length]
      : fairTitles[seat % fairTitles.length];
    good.jobs.push({
      title,
      company: name,
      location: places[(n + seat) % places.length],
      url: `https://boards.greenhouse.io/${token}/jobs/${400000 + n}`,
      posted: '2026-09-15T00:00:00Z',
      screen: isStrong ? 'strong' : 'fair',
    });
  }
}
good.strong = good.jobs.filter((job) => job.screen === 'strong').length;
good.fair = good.jobs.filter((job) => job.screen === 'fair').length;

const bad = {
  pulledAt: '2026-09-22T13:00:00.000Z',
  target: 100,
  count: 15,
  jobs: [
    { title: 'Account Executive', company: 'Nebius', location: 'Tel Aviv, Israel', url: 'https://x/1', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Stripe', location: 'London, UK', url: 'https://x/2', posted: null, screen: 'fair' },
    { title: 'Sales Development Representative', company: 'Vercel', location: 'Boston, MA', url: 'https://x/3', posted: null, screen: 'skip' },
    { title: 'Account Executive, BDR Team Lead', company: 'Glean', location: 'Remote, US', url: 'https://x/4', posted: null, screen: 'skip' },
    { title: 'Account Executive', company: 'Temporal', location: 'Chicago, IL', url: '', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Writer', location: 'Denver, CO', url: 'https://x/1', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Snowflake', location: 'Remote, US', url: 'https://x/6', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Stripe', location: 'Seattle, WA', url: 'https://x/7', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Stripe', location: 'Austin, TX', url: 'https://x/9', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Stripe', location: 'New York, NY', url: 'https://x/10', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Stripe', location: 'San Francisco, CA', url: 'https://x/11', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Stripe', location: 'Chicago, IL', url: 'https://x/12', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Stripe', location: 'Boston, MA', url: 'https://x/13', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Stripe', location: 'Denver, CO', url: 'https://x/14', posted: null, screen: 'fair' },
    { title: 'Account Executive', company: 'Stripe', location: 'Remote, US', url: 'https://x/15', posted: null, screen: 'fair' },
    { title: 'Account Executive, Enterprise', company: 'CoreWeave', location: 'Austin, TX', url: 'https://x/8', posted: null, screen: 'strong' },
  ],
};

writeFileSync(join(here, 'daily-100-good.json'), `${JSON.stringify(good, null, 2)}\n`);
writeFileSync(join(here, 'daily-100-bad.json'), `${JSON.stringify(bad, null, 2)}\n`);
console.log(`good: ${good.jobs.length} rows (${good.strong} strong, ${good.fair} fair, ${companies.length} companies)`);
console.log(`bad: ${bad.jobs.length} rows, one planted violation per rule (plus a count mismatch)`);
