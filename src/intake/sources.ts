/**
 * Source adapters: pull raw job postings from public boards that expose open
 * APIs and need no account, no key, and no payment.
 *
 * Every adapter returns rows already shaped like the Pinloop posting facts the
 * fit rubric reads (src/fit/rubric.ts), plus `url` and `source`, and carries a
 * `seen_at`. Nothing here talks to the Pinloop server: intake is local-first,
 * so a day of 100+ postings is never bounded by the free account's pull cap.
 *
 * Boards supported, all keyless:
 *   - Greenhouse boards API  (boards.greenhouse.io/v1/boards/<token>/jobs?content=true)
 *   - Lever postings API     (api.lever.co/v0/postings/<token>?mode=json)
 *   - Ashby postings API     (api.ashbyhq.com/posting-api/job-board/<token>)
 */

const UA = 'pinloop-fork-intake/0.1 (local job intake for personal fit screening)';

export type RawPosting = {
  source: 'greenhouse' | 'lever' | 'ashby' | 'push';
  board: string;
  id: string;
  title: string;
  company: string;
  locations: string[];
  url: string;
  description_text: string;
  posted_at: string | null;
  employment: string | null;
  workplace: string | null;
};

/** The row shape the rubric reads, with provenance and the full text kept. */
export type IntakeRow = RawPosting & { seen_at: string; countries: string[]; scores?: ExternalScores };

/**
 * One external scorer's verdict stored on the row after intake (Jev today,
 * other scorers later). `scorer` names who scored, `scoredAt` is when the
 * scores were attached, and the remaining fields are the scorer's own output
 * (e.g. fit, is_ae, is_us) passed through untouched.
 */
export type ExternalScores = {
  scorer: string;
  scoredAt: string;
  fit?: string;
  [key: string]: unknown;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 1_500;

/**
 * fetch with an explicit AbortSignal.timeout and one retry: a single transient
 * failure (5xx, reset, slow response) must not permanently drop a board's postings
 * for the run. The UA string stays unchanged.
 */
async function getJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} from ${url}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await sleep(RETRY_BACKOFF_MS);
    }
  }
  throw lastError;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** Greenhouse content arrives HTML-escaped (&lt;p&gt;). Unescape before stripping tags. */
function htmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function postedIso(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Guesses an employment label from the title, because none of the APIs label it directly. */
function employmentOf(title: string): string | null {
  const t = title.toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return 'INTERN';
  if (/\b(contract|contractor|c2c)\b/.test(t)) return 'CONTRACT';
  return 'FULL_TIME';
}

/** Remote-mention in the job name or location, because the APIs disagree on where that lives. */
function workplaceOf(title: string, locations: string[]): string | null {
  const haystack = `${title} ${locations.join(' ')}`.toLowerCase();
  if (/\bremote\b/.test(haystack)) return 'REMOTE';
  if (/\bhybrid\b/.test(haystack)) return 'HYBRID';
  return locations.length > 0 ? 'ONSITE' : null;
}

function row(source: RawPosting['source'], board: string, company: string, raw: RawPosting): IntakeRow {
  return { ...raw, company: raw.company || company, board, seen_at: new Date().toISOString(), countries: [] };
}

// ---------------------------------------------------------------- Greenhouse

/** One Greenhouse board. Token is the slug in boards.greenhouse.io/<token>. */
export async function greenhouse(token: string): Promise<IntakeRow[]> {
  const json = (await getJson(`https://boards.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`)) as {
    jobs?: Record<string, unknown>[];
  };
  const jobs = Array.isArray(json.jobs) ? json.jobs : [];
  return jobs.map((job) => {
    const title = text(job['title']);
    // Greenhouse nests the location: {name: 'San Francisco, CA'}. Reading it
    // as a string stored no location at all, which made any geographic gate
    // impossible on these rows.
    const locationObject = (job['location'] ?? {}) as Record<string, unknown>;
    const locations = [text(locationObject['name'])].filter((one) => one !== '');
    const raw: RawPosting = {
      source: 'greenhouse',
      board: token,
      id: `gh-${token}-${String(job['id'] ?? '')}`,
      title,
      company: text((job['company'] as Record<string, unknown> | undefined)?.['name']),
      locations,
      url: text(job['absolute_url']),
      description_text: text(htmlDecode(String(job['content'] ?? ''))),
      posted_at: postedIso(job['updated_at'] ?? job['first_published']),
      employment: employmentOf(title),
      workplace: workplaceOf(title, locations),
    };
    return row('greenhouse', token, token, raw);
  });
}

// --------------------------------------------------------------------- Lever

/** One Lever board. Token is the slug in jobs.lever.co/<token>. */
export async function lever(token: string): Promise<IntakeRow[]> {
  const json = (await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`)) as Record<
    string,
    unknown
  >[];
  const list = Array.isArray(json) ? json : [];
  return list.map((job) => {
    const title = text(job['text']);
    const categories = (job['categories'] ?? {}) as Record<string, unknown>;
    const locations = [text(categories['location'])].filter((one) => one !== '');
    const raw: RawPosting = {
      source: 'lever',
      board: token,
      id: `lv-${token}-${String(job['id'] ?? '')}`,
      title,
      company: text(job['company']),
      locations,
      url: text(job['hostedUrl'] ?? job['applyUrl']),
      description_text: [text(job['description']), text(job['descriptionPlain'])].filter((one) => one !== '').join('\n'),
      posted_at: postedIso(job['createdAt']),
      employment: String(categories['commitment'] ?? '').toUpperCase() || employmentOf(title),
      workplace: workplaceOf(title, locations),
    };
    return row('lever', token, token, raw);
  });
}

// --------------------------------------------------------------------- Ashby

/** One Ashby board. Token is the slug in jobs.ashbyhq.com/<token>. */
export async function ashby(token: string): Promise<IntakeRow[]> {
  const json = (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`)) as {
    jobs?: Record<string, unknown>[];
  };
  const jobs = Array.isArray(json.jobs) ? json.jobs : [];
  return jobs.map((job) => {
    const title = text(job['title']);
    const locations = [text(job['location'])].filter((one) => one !== '');
    const raw: RawPosting = {
      source: 'ashby',
      board: token,
      id: `as-${token}-${String(job['id'] ?? '')}`,
      title,
      company: text(job['company'] ?? token),
      locations,
      url: text(job['jobUrl'] ?? job['job_url']),
      description_text: text(job['descriptionHtml'] ?? job['descriptionPlain']),
      posted_at: postedIso(job['publishedAt'] ?? job['updatedAt']),
      employment: employmentOf(title),
      workplace: workplaceOf(title, locations),
    };
    return row('ashby', token, token, raw);
  });
}

export type BoardSpec = { source: 'greenhouse' | 'lever' | 'ashby'; token: string };

/** Parses board specs like "greenhouse:stripe", "lever:netflix", "ashby:openai". */
export function parseBoardSpecs(specs: string[]): BoardSpec[] {
  const out: BoardSpec[] = [];
  for (const spec of specs) {
    const match = /^(greenhouse|lever|ashby):([A-Za-z0-9_-]+)$/.exec(spec.trim());
    if (match) {
      out.push({ source: match[1] as BoardSpec['source'], token: match[2]! });
    } else {
      throw new Error(
        `board spec '${spec}' is not understood. Use source:token, for example greenhouse:stripe, lever:netflix, ashby:openai.`,
      );
    }
  }
  return out;
}

/** Fetches every named board; one failing board reports and does not sink the rest. */
export async function fetchBoards(specs: BoardSpec[]): Promise<{ rows: IntakeRow[]; errors: string[] }> {
  const rows: IntakeRow[] = [];
  const errors: string[] = [];
  for (const spec of specs) {
    try {
      const one = spec.source === 'greenhouse' ? await greenhouse(spec.token) : spec.source === 'lever' ? await lever(spec.token) : await ashby(spec.token);
      rows.push(...one);
    } catch (error) {
      errors.push(`${spec.source}:${spec.token} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { rows, errors };
}
