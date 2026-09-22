/**
 * Count commands for this fork, in the order Pinloop's own method requires:
 * count before any pull, fixed conditions before typed words, and never treat
 * the first count as the size of the market.
 *
 * Flags match the installed command. --in title is the only place OR/AND
 * brackets are read. --country takes the full name. --experience and
 * --category are counted, then left off the pull until a count shows the
 * field is populated: older postings carry neither, and a filter on them
 * drops those rows silently.
 */

export type FitQuery = {
  /** What this count is for. Run them in order. */
  name: string;
  /** Why it is in the plan, and what to do with the number. */
  why: string;
  /** The command to run. It hands no posting over. */
  command: string;
};

function monthsAgo(months: number, now: Date): string {
  const day = new Date(now.getTime());
  day.setMonth(day.getMonth() - months);
  return day.toISOString().slice(0, 10);
}

/** Seller titles, as title words. AND binds the two words of the phrase. */
const SELLER =
  '((Account AND Executive) OR (Account AND Manager))';

/** The product class on the master resume headline. */
const INFRA = '(Cloud OR Infrastructure OR GPU OR AI OR IaaS)';

/**
 * Employers to count one at a time. A comma-joined list is refused in full
 * when one name is ambiguous, so the plan does not batch them.
 */
export const EMPLOYERS_TO_COUNT: readonly string[] = [
  'Vercel',
  'LaunchDarkly',
  'Glean',
  'Writer',
  'Braintrust',
  'Temporal',
  'Fireworks',
  'Stripe',
  'Databricks',
  'Appian',
  'Oracle',
  'CoreWeave',
  'Nebius',
  'Crusoe',
  'Snowflake',
  'NVIDIA',
  'Anthropic',
  'OpenAI',
];

export function fitPlan(now: Date = new Date()): FitQuery[] {
  const since = monthsAgo(6, now);
  const country = '--country "United States"';
  const sellerInfra = `--in title "${SELLER} AND ${INFRA}"`;
  const sellerOnly = `--in title "${SELLER}"`;

  const queries: FitQuery[] = [
    {
      name: 'sales-label',
      why:
        'Size of the Sales label in the US, full time. A label, not the pull. ' +
        'A later count with the label off will be larger, and that gap is postings the label missed.',
      command: `pinloop count --category Sales ${country} --employment FULL_TIME`,
    },
    {
      name: 'title-seller-infra',
      why:
        'The primary pool: account executive or account manager, and cloud, AI, GPU, IaaS, or infrastructure, in the title. No category and no employment label, so unlabeled postings stay in.',
      command: `pinloop count ${sellerInfra} ${country}`,
    },
    {
      name: 'title-seller-infra-recent',
      why:
        'Same title, posted in the last six months. This is the number a pull of that window would collect from. If it is in the thousands, narrow before pulling. If it is under a few dozen, the title is too tight and the next count is the one to widen from.',
      command: `pinloop count ${sellerInfra} ${country} --posted-after ${since}`,
    },
    {
      name: 'title-seller-only',
      why:
        'Seller titles with the product words taken off. This is the wider AE pool (SaaS AE seats included). Use it only if the infra title count is thin.',
      command: `pinloop count ${sellerOnly} ${country} --posted-after ${since}`,
    },
    {
      name: 'experience-10',
      why:
        'How many of the primary title rows are labeled 10+ years. Do not put --experience on the pull until this and the unlabeled count are both known. Older rows have no experience field and a filter drops them.',
      command: `pinloop count ${sellerInfra} ${country} --experience 10+ --posted-after ${since}`,
    },
    {
      name: 'experience-5-10',
      why: 'Same title, labeled 5-10 years. A decade of AE work fits this band when a posting rounds down.',
      command: `pinloop count ${sellerInfra} ${country} --experience 5-10 --posted-after ${since}`,
    },
    {
      name: 'career-sites',
      why:
        'Primary title, employer career sites only. Prefer this feed for the first pull: it is the hiring page, not a reposted board.',
      command: `pinloop count ${sellerInfra} ${country} --from "career sites" --posted-after ${since}`,
    },
  ];

  for (const employer of EMPLOYERS_TO_COUNT) {
    queries.push({
      name: `employer-${employer.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      why:
        `Seller titles at ${employer}. If the name is refused, use the employer names that refusal prints. Do not guess a second spelling.`,
      command:
        `pinloop count ${sellerOnly} ${country} --company "${employer}" --posted-after ${since}`,
    });
  }

  queries.push({
    name: 'first-pull-after-counts',
    why:
      'Not a count. Run this only after the counts above, and only if the career-sites number is small enough to spend a daily pull on. Free accounts are handed 5 postings a day. No category, no employment label, no experience filter. Read every title before showing it.',
    command:
      `pinloop pull ${sellerInfra} ${country} --from "career sites" --posted-after ${since} --limit 5`,
  });

  return queries;
}

export function planText(queries: FitQuery[]): string {
  const lines = [
    'Fit plan for Jared Werba. Counts hand nothing over. Do not pull until the career-sites count is a number you mean to spend.',
    'Quota figures are not in this plan. They stay in the local resume and go to the Pinloop account only when you load the profile.',
    '',
  ];
  queries.forEach((query, index) => {
    lines.push(`${index + 1}. ${query.name}`);
    lines.push(`   ${query.why}`);
    lines.push(`   ${query.command}`);
    lines.push('');
  });
  return lines.join('\n');
}
