/**
 * Employer career-portal loaders for the boards that do not use Greenhouse,
 * Ashby, or Lever. Amazon, Microsoft, NVIDIA, Oracle, Google and Glean publish
 * their own endpoints. Voltage Park runs on kula.ai.
 *
 * Every endpoint here was checked live on 2026-09-22. None needs a login and
 * none spends Pinloop's daily pull. A portal that stops answering throws, and
 * the caller records it as a miss rather than failing the whole run.
 *
 * Each loader returns rows of { title, company, location, url, posted }.
 */

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

/**
 * Node cannot decode zstd, and amazon.jobs answers with content-encoding: zstd
 * and a body cut short when it does. Asking for identity keeps the JSON whole.
 */
const HEADERS = { 'user-agent': UA, 'accept-encoding': 'identity' };

export function isoOrNull(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const parsed = new Date(String(value).replace(/\s+/g, ' ').trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** "Posted 5 Days Ago", "Posted Today", "Posted 30+ Days Ago". */
export function fromRelative(text) {
  if (typeof text !== 'string') return null;
  if (/today/i.test(text)) return new Date().toISOString();
  if (/yesterday/i.test(text)) return new Date(Date.now() - 86400000).toISOString();
  const d = /(\d+)\+?\s*day/i.exec(text);
  if (d) return new Date(Date.now() - Number(d[1]) * 86400000).toISOString();
  const w = /(\d+)\+?\s*(?:week|wk)/i.exec(text);
  if (w) return new Date(Date.now() - Number(w[1]) * 7 * 86400000).toISOString();
  const mo = /(\d+)\+?\s*month/i.exec(text);
  if (mo) return new Date(Date.now() - Number(mo[1]) * 30 * 86400000).toISOString();
  return null;
}

async function getJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: { ...HEADERS, accept: 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, {
    headers: { ...HEADERS, accept: 'text/html' },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

// ------------------------------------------------------------------ Amazon

async function amazon() {
  const url =
    'https://www.amazon.jobs/en/search.json?base_query=' +
    encodeURIComponent('account executive') +
    '&result_limit=100&country%5B%5D=US&sort=recent';
  const body = await getJson(url);
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  return jobs.map((job) => ({
    title: String(job.title || '').replace(/\s+/g, ' ').trim(),
    company: 'Amazon Web Services',
    location: String(job.normalized_location || job.location || '').replace(/\s+/g, ' ').trim(),
    url: job.job_path ? `https://www.amazon.jobs${job.job_path}` : '',
    posted: isoOrNull(job.posted_date),
  }));
}

// --------------------------------------------------------------- Microsoft

async function microsoft() {
  const url =
    'https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=' +
    encodeURIComponent('account executive') +
    '&location=' + encodeURIComponent('United States') + '&start=0&num=200';
  const body = await getJson(url);
  const positions = body?.data?.positions ?? [];
  return positions.map((job) => ({
    title: String(job.name || '').replace(/\s+/g, ' ').trim(),
    company: 'Microsoft',
    location: (job.standardizedLocations ?? []).join(' | '),
    url: job.positionUrl ? `https://jobs.careers.microsoft.com${job.positionUrl}` : '',
    posted: isoOrNull(job.postedTs),
  }));
}

// ----------------------------------------------------------------- NVIDIA

/**
 * Workday answers at most 20 postings for one request and returns HTTP 400 for
 * anything larger, so this pages 20 at a time.
 */
async function nvidia() {
  const url = 'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs';
  const postings = [];
  for (let offset = 0; offset < 200; offset += 20) {
    const body = await getJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: 'account executive' }),
    });
    const page = Array.isArray(body?.jobPostings) ? body.jobPostings : [];
    postings.push(...page);
    if (page.length < 20) break;
  }
  return postings.map((job) => ({
    title: String(job.title || '').replace(/\s+/g, ' ').trim(),
    company: 'NVIDIA',
    location: String(job.locationsText || '').replace(/\s+/g, ' ').trim(),
    url: job.externalPath
      ? `https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite${job.externalPath}`
      : '',
    posted: fromRelative(job.postedOn),
  }));
}

// ------------------------------------------------------------------ Oracle

async function oracle() {
  const finder = 'findReqs;siteNumber=CX_1001,keyword=account executive,limit=200,sortBy=POSTING_DATES_DESC';
  const url =
    'https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions' +
    '?onlyData=true&expand=requisitionList.secondaryLocations' +
    `&finder=${encodeURIComponent(finder)}`;
  const body = await getJson(url);
  const items = body?.items ?? [];
  const rows = items[0]?.requisitionList ?? [];
  return rows.map((job) => ({
    title: String(job.Title || '').replace(/\s+/g, ' ').trim(),
    company: 'Oracle',
    location: String(job.PrimaryLocation || '').replace(/\s+/g, ' ').trim(),
    url: job.Id
      ? `https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/${job.Id}`
      : '',
    posted: isoOrNull(job.PostedDate),
  }));
}

// ------------------------------------------------------------------ Google

async function google() {
  const url =
    'https://www.google.com/about/careers/applications/jobs/results/?q=' +
    encodeURIComponent('account executive') +
    '&location=' + encodeURIComponent('United States') + '&num=100&sort_by=date';
  const html = await getText(url);
  const match = /AF_initDataCallback\(\{key: 'ds:1'.*?data:(\[.*?\]), sideChannel/s.exec(html);
  if (!match) throw new Error('job data block not found in the page');
  const rows = JSON.parse(match[1])[0] ?? [];
  return rows
    .filter((row) => Array.isArray(row) && row.length > 9)
    .map((row) => {
      const places = Array.isArray(row[9]) ? row[9].map((p) => (Array.isArray(p) ? p[0] : '')).filter(Boolean) : [];
      return {
        title: String(row[1] || '').replace(/\s+/g, ' ').trim(),
        company: 'Google Cloud',
        location: places.join(' | '),
        url: row[0] ? `https://www.google.com/about/careers/applications/jobs/results/${row[0]}` : '',
        posted: Array.isArray(row[12]) ? isoOrNull(row[12][0]) : null,
      };
    });
}

// ------------------------------------------------------------------- Glean

async function glean() {
  const body = await getJson('https://boards-api.greenhouse.io/v1/boards/gleanwork/jobs');
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  return jobs.map((job) => ({
    title: String(job.title || '').replace(/\s+/g, ' ').trim(),
    company: 'Glean',
    location: String(job.location?.name || '').replace(/\s+/g, ' ').trim(),
    url: String(job.absolute_url || ''),
    posted: isoOrNull(job.first_published ?? job.updated_at),
  }));
}

// ------------------------------------------------------------ Voltage Park

/**
 * Voltage Park links to jobs.ashbyhq.com/voltagepark.com, but the Ashby posting
 * API answers 404 for every slug they use, and their kula.ai board reads
 * "No jobs found". Kept here so it starts reporting the day either one answers.
 */
async function voltagePark() {
  const response = await fetch('https://api.ashbyhq.com/posting-api/job-board/voltagepark.com', {
    headers: { ...HEADERS, accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`ashby posting api HTTP ${response.status}`);
  const body = await response.json();
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  return jobs.map((job) => ({
    title: String(job.title || '').replace(/\s+/g, ' ').trim(),
    company: 'Voltage Park',
    location: String(job.location || '').replace(/\s+/g, ' ').trim(),
    url: String(job.jobUrl || job.applyUrl || ''),
    posted: isoOrNull(job.publishedAt),
  }));
}

/** Portal name to loader. Order is the order they are reported in. */
export const PORTALS = [
  ['amazon', amazon],
  ['microsoft', microsoft],
  ['nvidia', nvidia],
  ['oracle', oracle],
  ['google', google],
  ['glean', glean],
  ['voltagepark', voltagePark],
];