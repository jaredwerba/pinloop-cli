/**
 * Local screen for the jobs this fork is tuned for.
 *
 * This is not Pinloop's judge. It only reads fields a posting already carries
 * (title, employer, country, employment, experience) and applies the fit rules
 * below. Dollar figures, phone, and the resume itself stay out of this file:
 * they live in the local resume and are uploaded to the account, not committed.
 *
 * Primary seat: quota-carrying Account Executive for AI infrastructure and
 * AI-native platforms, United States, Boston / East / remote-US. Source of the
 * shape: ~/resumes/resume.md headline and the tailored AE files already in
 * ~/resumes/. Forward-deployed and pre-sales files in that folder are not the
 * target of this screen.
 */

export type Screen = 'no' | 'weak' | 'fair' | 'strong';

export type PostingFacts = {
  id?: string;
  title?: string | null;
  company?: string | null;
  locations?: string[] | null;
  countries?: string[] | null;
  country?: string | null;
  employment?: string | null;
  workplace_type?: string | null;
  workplace?: string | null;
  experience?: string | null;
};

export type ScreenResult = {
  id: string;
  screen: Screen;
  title: string;
  company: string;
  reason: string;
};

/** Titles that are a different job, not a misspelled AE seat. */
const BLOCKED_TITLE =
  /\b(intern(ship)?|new grad|new graduate|early career|campus|co-?op|sdr|bdr|sales development|business development representative|recruit(er|ing))\b/i;

/** Seller titles this person already holds and already applies under. */
const SELLER_TITLE =
  /\b(account executive|account manager|strategic account|enterprise account|commercial account)\b/i;

/** Product class. Bare "infrastructure" and bare "AI" are not enough: the first pull was building-systems AE seats. */
const INFRA_TITLE =
  /\b(cloud|gpu|iaas|paas|hyperscal|data center|kubernetes)\b/i;

/**
 * Employers already targeted in ~/resumes/, plus the infrastructure sellers
 * the same motion maps onto. Matched as case-insensitive substrings.
 * "Lambda" alone is omitted on purpose: it also names a coding school.
 */
export const TARGET_EMPLOYERS: readonly string[] = [
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
  'Mercury',
  'Oracle',
  'Amazon Web Services',
  'AWS',
  'Microsoft',
  'Azure',
  'Google Cloud',
  'CoreWeave',
  'Nebius',
  'Crusoe',
  'Lambda Labs',
  'NVIDIA',
  'Snowflake',
  'Voltage Park',
  'Together AI',
  'Anthropic',
  'OpenAI',
  'Scale AI',
];

const US = /^(united states|usa|u\.s\.a\.|u\.s\.|us)$/i;

/**
 * Last segment of a location Pinloop stores as a city string, not as a country.
 * "Boston, MA" and "Vienna, Vienna, Austria" are locations. They are not the
 * countries field. Substituting one for the other rejects Boston.
 */
const US_STATE_ABBREV = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

/** A location that names one of these, and is not a US place, is abroad. */
const FOREIGN_COUNTRY =
  /\b(austria|germany|france|spain|portugal|netherlands|belgium|sweden|norway|denmark|finland|ireland|united kingdom|england|scotland|wales|canada|mexico|india|australia|brazil|singapore|japan|china|poland|romania|serbia|switzerland|israel)\b/i;

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function listed(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((one) => text(one)).filter((one) => one !== '');
}

/** Country field only. Locations are cities and must not fill this in. */
function countriesOf(row: PostingFacts): string[] {
  const named = listed(row.countries);
  const extra = text(row.country);
  return extra === '' ? named : [...named, extra];
}

function lastSegment(location: string): string {
  const parts = location.split(',').map((part) => part.trim()).filter((part) => part !== '');
  return parts[parts.length - 1] ?? '';
}

function locationIsUnitedStates(location: string): boolean {
  if (isUnitedStates(location)) return true;
  if (/\b(boston|cambridge|massachusetts|new england)\b/i.test(location)) return true;
  const last = lastSegment(location);
  return last.length === 2 && US_STATE_ABBREV.has(last.toUpperCase());
}

function foreignLocation(locations: string[]): string | undefined {
  return locations.find((location) => !locationIsUnitedStates(location) && FOREIGN_COUNTRY.test(location));
}

function isUnitedStates(value: string): boolean {
  if (US.test(value)) return true;
  return /\b(united states|usa|u\.s\.)\b/i.test(value);
}

function employerHit(company: string): string | undefined {
  const haystack = company.toLowerCase();
  return TARGET_EMPLOYERS.find((name) => haystack.includes(name.toLowerCase()));
}

/**
 * Screen one posting. Absent country, employment, and experience are not
 * treated as failures: Pinloop leaves those fields blank on older rows, and a
 * blank is not evidence the job is abroad or junior.
 */
export function screenPosting(row: PostingFacts, index: number): ScreenResult {
  const title = text(row.title);
  const company = text(row.company);
  const id = text(row.id) || `row-${index + 1}`;
  const employment = text(row.employment).toUpperCase();
  const experience = text(row.experience);
  const countries = countriesOf(row);
  const locations = listed(row.locations);
  const knownCountry = countries.length > 0;
  const inUs = countries.some(isUnitedStates);
  const abroad = knownCountry ? undefined : foreignLocation(locations);
  const seller = SELLER_TITLE.test(title);
  const infra = INFRA_TITLE.test(title);
  const employer = employerHit(company);

  const base = { id, title: title || '(no title)', company: company || '(no employer)' };

  if (BLOCKED_TITLE.test(title) || employment === 'INTERN') {
    return {
      ...base,
      screen: 'no',
      reason: 'title or employment is intern, SDR/BDR, campus, or recruiting, not an AE seat',
    };
  }
  if (knownCountry && !inUs) {
    return {
      ...base,
      screen: 'no',
      reason: `country is ${countries.join(', ')}, not United States`,
    };
  }
  if (abroad !== undefined) {
    return {
      ...base,
      screen: 'no',
      reason: `location is ${abroad}, which names a country other than the United States, and the posting stores no United States country`,
    };
  }
  if (experience === '0-2') {
    return {
      ...base,
      screen: 'no',
      reason: 'experience band is 0-2; this search is a decade of quota-carrying AE work',
    };
  }
  if (seller && (infra || employer !== undefined)) {
    return {
      ...base,
      screen: 'strong',
      reason:
        employer !== undefined
          ? `seller title at ${employer}`
          : 'seller title with cloud, AI, or infrastructure in the title',
    };
  }
  if (seller || (infra && employer !== undefined)) {
    return {
      ...base,
      screen: 'fair',
      reason: seller
        ? 'seller title, but neither the title nor the employer is in the AI-infrastructure set'
        : `infrastructure title at ${employer}, not an account-executive title`,
    };
  }
  if (employer !== undefined) {
    return {
      ...base,
      screen: 'weak',
      reason: `${employer} is a target employer, but the title is not an account-executive seat`,
    };
  }
  return {
    ...base,
    screen: 'weak',
    reason: 'no account-executive title and no target employer',
  };
}

/** Reads a Pinloop --json object, a bare array, or one posting. */
export function rowsFromJson(value: unknown): PostingFacts[] {
  if (Array.isArray(value)) return value as PostingFacts[];
  if (value !== null && typeof value === 'object') {
    const held = value as { rows?: unknown; results?: unknown };
    if (Array.isArray(held.rows)) return held.rows as PostingFacts[];
    if (Array.isArray(held.results)) return held.results as PostingFacts[];
    if ('title' in held || 'id' in held) return [value as PostingFacts];
  }
  return [];
}
