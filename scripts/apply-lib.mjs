/**
 * Agent-native apply layer.
 *
 * The pipeline already answers "which jobs" and "what resume". This answers the
 * half a bot needs to actually walk into an application form: which form is it,
 * what will it ask, what is the answer, has another bot claimed it, and what
 * proves it was submitted.
 *
 * The unit of work is a packet, and a packet is claimed under a lease so that
 * several bots can drain one queue without applying to the same job twice.
 *
 *   build   daily run JSON -> queue.json + one directory per job
 *   claim   take a lease on a job for N minutes
 *   answer  record a screening answer once, keyed by question fingerprint
 *   receipt record the submission so the job leaves the queue for good
 *   verify  fail a generated resume that claims something the source does not
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// ------------------------------------------------------------------ paths

export const APPLY_DIR = process.env['PINLOOP_APPLY_DIR'] || join(homedir(), 'OmarchyJobs', 'apply');
export const RESUME_SOURCE =
  process.env['PINLOOP_RESUME'] || join(homedir(), 'resumes', 'resume.md');

export const queuePath = () => join(APPLY_DIR, 'queue.json');
export const leasesPath = () => join(APPLY_DIR, 'leases.json');
export const answersPath = () => join(APPLY_DIR, 'answers.json');
export const packetDir = (key) => join(APPLY_DIR, 'packets', key);
export const packetPath = (key) => join(packetDir(key), 'packet.json');
export const receiptPath = (key) => join(packetDir(key), 'receipt.json');

/** Duplicated from src/fit/documents.ts so this layer stands alone. */
export function stripGrokbotBlocks(markdown) {
  return markdown
    .replace(/\[GROKBOT[\s\S]*?\[GROKBOT_OUTPUT\]/g, '')
    .replace(/\[GROKBOT[^\]]*\][^\n]*/g, '');
}

export function defaultResumePath() {
  return RESUME_SOURCE;
}

// ------------------------------------------------------------------ JSON io

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// ------------------------------------------------------------------- keys

/**
 * Stable per-job key. Derived from company, title and the url with the noisy
 * query and tracking parameters dropped, so the same posting read from a board
 * API, a daily run and a portal scan lands on one key and one packet.
 */
export function jobKey(job) {
  const url = String(job.url || '')
    .split('?')[0]
    .replace(/\/+$/, '')
    .toLowerCase();
  const basis = `${String(job.company || '').toLowerCase()}|${String(job.title || '').toLowerCase()}|${url}`;
  return createHash('sha1').update(basis).digest('hex').slice(0, 12);
}

// -------------------------------------------------------------------- ATS

/**
 * Which application system a url belongs to, and what that system asks for.
 *
 * The field map is the payload the bot needs: the site's own input names, in
 * the order the form presents them, so filling is mechanical rather than
 * exploratory. `questions` lists what that vendor asks nearly every time.
 */
export const ATS = {
  greenhouse: {
    match: /greenhouse\.io/i,
    fields: ['first_name', 'last_name', 'email', 'phone', 'resume', 'cover_letter', 'linkedin', 'website'],
    questions: ['work_authorization', 'sponsorship', 'location', 'salary', 'notice_period'],
  },
  lever: {
    match: /jobs\.lever\.co|lever\.co\/v0/i,
    fields: ['name', 'email', 'phone', 'resume', 'org', 'urls[LinkedIn]', 'comments'],
    questions: ['work_authorization', 'sponsorship', 'location'],
  },
  ashby: {
    match: /ashbyhq\.com|jobs\.ashby/i,
    fields: ['firstName', 'lastName', 'email', 'phone', 'resume', 'linkedinUrl'],
    questions: ['work_authorization', 'sponsorship', 'location'],
  },
  workday: {
    match: /myworkdayjobs\.com|workday\.com/i,
    fields: ['firstName', 'lastName', 'email', 'phoneNumber', 'resume', 'address', 'linkedin'],
    questions: ['work_authorization', 'sponsorship', 'previous_employment', 'education', 'salary'],
    notes: 'Workday often forces an account sign-in before the form renders.',
  },
  microsoft: {
    match: /careers\.microsoft\.com/i,
    fields: ['name', 'email', 'phone', 'resume', 'linkedin'],
    questions: ['work_authorization', 'sponsorship', 'salary'],
    notes: 'Sign-in required; the apply action is behind a Microsoft account.',
  },
  amazon: {
    match: /amazon\.jobs/i,
    fields: ['name', 'email', 'phone', 'resume', 'linkedin'],
    questions: ['work_authorization', 'sponsorship', 'salary'],
    notes: 'Sign-in required; amazon.jobs uses its own account.',
  },
  oracle: {
    match: /oraclecloud\.com|oracle\.com\/careers/i,
    fields: ['name', 'email', 'phone', 'resume', 'linkedin'],
    questions: ['work_authorization', 'sponsorship', 'salary'],
    notes: 'Oracle Recruiting Cloud requires an account.',
  },
  google: {
    match: /google\.com\/about\/careers/i,
    fields: ['name', 'email', 'phone', 'resume', 'linkedin'],
    questions: ['work_authorization', 'sponsorship'],
    notes: 'Google account sign-in required.',
  },
};

export function detectAts(url) {
  const text = String(url || '');
  for (const [name, spec] of Object.entries(ATS)) {
    if (spec.match.test(text)) return name;
  }
  return 'unknown';
}

/** True when the form cannot be reached without a human signing in first. */
export function needsLogin(ats) {
  const spec = ATS[ats];
  return Boolean(spec?.notes && /sign-in|account/i.test(spec.notes));
}

// ------------------------------------------------------- answer handling

/**
 * Question fingerprint. The same question is asked in many wordings across
 * vendors ("Are you authorized to work in the US?" / "Do you have the legal
 * right to work in the United States?"). Lowercase, drop punctuation and the
 * filler words, and the two collapse onto one key.
 */
export function fingerprint(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(please|do|does|are|is|you|your|the|a|an|to|in|of|for|at|on|with|have|has|will|would|that|this|it)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical slots.
 *
 * Fingerprinting alone only collapses wordings that share their words, and the
 * vendors do not share them: the field is literally `work_authorization` on one
 * board and "Are you legally authorized to work in the United States?" on the
 * next. A synonym table maps both onto one slot, so an answer recorded once is
 * found by every vendor that asks about it. This is what makes the cache worth
 * having — without it a bot re-answers the same five questions on every site.
 */
export const CANONICAL_RULES = {
  work_authorization: /\b(authoriz\w*|right to work|legally permitted|eligible to work|work permit)/,
  sponsorship: /\bsponsor/,
  location: /\b(location|where are you based|based in|city|relocat|commut)/,
  salary: /\b(salary|compensation|comp expectations|pay expectation|total comp|desired pay|ote)\b/,
  notice_period: /\b(notice period|start date|when can you start|availability to start|earliest start)/,
  previous_employment: /\b(previously (worked|employed)|former employee|worked (at|for) .*(before|previously))/,
  education: /\b(degree|education|university|college|graduat|gpa)\b/,
  linkedin: /\blinkedin\b/,
  website: /\b(website|portfolio|personal site)\b/,
  remote_preference: /\b(remote|hybrid|onsite|on-site|work model|in office)\b/,
  veteran: /\bveteran\b/,
  disability: /\bdisabilit/,
  gender: /\bgender\b/,
  race: /\b(race|ethnicit)/,
  age: /\b(date of birth|birth date|age)\b/,
  referral: /\b(how did you hear|referral|who referred)\b/,
};

/**
 * The slot a question belongs to, or null when it matches nothing known.
 * Underscores and dashes become spaces first, so a vendor's literal field name
 * (`work_authorization`, `notice-period`) reads like the question it stands for.
 */
export function canonicalKey(question) {
  const text = String(question || '').toLowerCase().replace(/[_\-]+/g, ' ');
  for (const [slot, pattern] of Object.entries(CANONICAL_RULES)) {
    if (pattern.test(text)) return slot;
  }
  return null;
}

/**
 * Answer kinds. `fixed` answers are facts that never change and are safe to
 * reuse forever; `derived` answers are computed from the job; `human` answers
 * must never be generated, because inventing them is a misrepresentation on a
 * real application.
 */
export const ANSWER_KINDS = ['fixed', 'derived', 'human'];

/** Which answer keys a bot must never auto-fill. */
export const NEVER_AUTO = [
  'salary',
  'compensation',
  'expected_compensation',
  'desired_salary',
  'gender',
  'race',
  'ethnicity',
  'veteran',
  'disability',
  'date_of_birth',
];

export function isNeverAuto(key) {
  const text = String(key || '').toLowerCase();
  return NEVER_AUTO.some((one) => text.includes(one));
}

// ------------------------------------------------------------------ leases

export function readLeases() {
  return readJson(leasesPath(), {});
}

export function writeLeases(leases) {
  writeJson(leasesPath(), leases);
}

/** A lease that has run out is not a lease. Expired ones are swept on read. */
export function activeLeases(leases, now = Date.now()) {
  const live = {};
  for (const [key, lease] of Object.entries(leases)) {
    if (new Date(lease.expires_at).getTime() > now) live[key] = lease;
  }
  return live;
}

// ------------------------------------------------------------------ queue

/**
 * Build the queue from one daily run file. Existing packets and receipts are
 * left alone, so a rebuild never erases a claim or a submitted application.
 */
export function buildQueue(runFile) {
  const run = readJson(runFile, null);
  if (!run || !Array.isArray(run.jobs)) {
    throw new Error(`${runFile} does not look like a daily run file (no jobs array)`);
  }
  const previous = readJson(queuePath(), { jobs: [] });
  const byKey = new Map((previous.jobs ?? []).map((job) => [job.key, job]));
  const added = [];
  const kept = [];

  for (const job of run.jobs) {
    const key = jobKey(job);
    const existing = byKey.get(key) ?? readJson(packetPath(key), null);
    const ats = existing?.ats && existing.ats !== 'unknown' ? existing.ats : detectAts(job.url);
    const record = {
      key,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.url,
      screen: job.screen ?? null,
      where: job.where ?? null,
      ats,
      needs_login: needsLogin(ats),
      first_seen: existing?.first_seen ?? new Date().toISOString(),
      status: existing?.status ?? 'queued',
    };
    byKey.set(key, record);
    (existing ? kept : added).push(key);
    writeJson(packetPath(key), record);
  }

  const jobs = [...byKey.values()].sort(
    (a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title),
  );
  writeJson(queuePath(), {
    built_at: new Date().toISOString(),
    source: runFile,
    where: run.where ?? null,
    total: jobs.length,
    jobs,
  });
  return { total: jobs.length, added: added.length, kept: kept.length, addedKeys: added };
}

/** Queue rows joined with lease and receipt state. */
export function queueState(now = Date.now()) {
  const queue = readJson(queuePath(), { jobs: [] });
  const leases = activeLeases(readLeases(), now);
  const rows = (queue.jobs ?? []).map((job) => {
    const receipt = readJson(receiptPath(job.key), null);
    const lease = leases[job.key] ?? null;
    const status = receipt ? 'submitted' : lease ? 'leased' : job.status;
    return { ...job, status, lease, receipt };
  });
  return { built_at: queue.built_at, total: rows.length, rows };
}

/**
 * Take a lease. Refuses when another bot holds a live one, which is the whole
 * point: two bots draining the queue must not both apply to one job.
 */
export function claim(key, bot, ttlMinutes = 30, now = Date.now()) {
  const leases = activeLeases(readLeases(), now);
  const queue = readJson(queuePath(), { jobs: [] });
  const job = (queue.jobs ?? []).find((one) => one.key === key);
  if (!job) throw new Error(`no queued job with key ${key}`);
  const receipt = readJson(receiptPath(key), null);
  if (receipt) throw new Error(`${key} was already submitted on ${receipt.submitted_at}`);
  const held = leases[key];
  if (held && held.bot !== bot) {
    throw new Error(`${key} is leased by ${held.bot} until ${held.expires_at}`);
  }
  const lease = {
    bot,
    claimed_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMinutes * 60000).toISOString(),
  };
  leases[key] = lease;
  writeLeases(leases);
  mkdirSync(packetDir(key), { recursive: true });
  const answers = resolveAnswers(job);
  const packet = {
    key,
    job,
    lease,
    packet_dir: packetDir(key),
    resume_source: defaultResumePath(),
    resume_out: join(packetDir(key), 'resume.md'),
    pdf_out: join(packetDir(key), `${job.company.replace(/[^\w]+/g, '-')}-${key}.pdf`),
    cover_out: join(packetDir(key), 'cover.md'),
    fields: ATS[job.ats]?.fields ?? [],
    questions: ATS[job.ats]?.questions ?? [],
    notes: ATS[job.ats]?.notes ?? null,
    answers,
    steps: [
      'generate the resume from the source, filling every [GROKBOT] slot',
      'pinloop intake brief <url> is the JD text if the slot needs the posting',
      'run: node scripts/apply.mjs verify ' + key,
      'render the pdf to pdf_out',
      'open job.url and fill fields with answers, in order',
      'any answer marked needs_human: stop and ask, never invent',
      'run: node scripts/apply.mjs receipt ' + key + ' --confirmation <id-or-note>',
    ],
  };
  writeJson(packetPath(key), { ...job, lease });
  writeJson(join(packetDir(key), 'packet.json'), packet);
  return packet;
}

export function release(key, bot) {
  const leases = readLeases();
  const held = leases[key];
  if (!held) return { released: false, reason: 'nothing to release' };
  if (held.bot !== bot) throw new Error(`${key} is leased by ${held.bot}, not ${bot}`);
  delete leases[key];
  writeLeases(leases);
  return { released: true, key };
}

// ---------------------------------------------------------------- answers

export function readAnswers() {
  return readJson(answersPath(), { entries: {} });
}

/**
 * Resolve the answers this application needs. Reusable answers come from the
 * cache; the vendor's usual questions are looked up by fingerprint; anything
 * still missing is returned as needs_human rather than filled with a guess.
 */
export function resolveAnswers(job) {
  const cache = readAnswers().entries ?? {};
  const wanted = ATS[job.ats]?.questions ?? [];
  const out = [];
  for (const name of wanted) {
    const slot = canonicalKey(name);
    const printed = fingerprint(name);
    const hit =
      (slot && cache[`slot:${slot}`]) ||
      cache[printed] ||
      Object.values(cache).find((entry) => entry.fingerprint === printed || (slot && entry.slot === slot));
    if (hit && hit.answer) {
      out.push({
        question: hit.question,
        slot: hit.slot ?? slot,
        fingerprint: hit.fingerprint ?? printed,
        answer: hit.answer,
        kind: hit.kind,
        source: 'cache',
      });
    } else {
      out.push({
        question: name,
        slot,
        fingerprint: printed,
        answer: null,
        kind: isNeverAuto(name) || slot === 'salary' ? 'human' : 'unknown',
        source: 'missing',
        needs_human: true,
      });
    }
  }
  return out;
}

/**
 * Record an answer once. It is filed under its canonical slot when the question
 * matches one, so a different vendor's wording of the same question finds it.
 */
export function recordAnswer(question, answer, kind = 'fixed') {
  if (!ANSWER_KINDS.includes(kind)) throw new Error(`kind must be one of ${ANSWER_KINDS.join(', ')}`);
  const slot = canonicalKey(question);
  if ((isNeverAuto(question) || slot === 'salary' || slot === 'gender' || slot === 'race' || slot === 'veteran' || slot === 'disability') && kind !== 'human') {
    throw new Error(`"${question}" must be recorded as kind=human; it is a personal disclosure, not a reusable fact`);
  }
  const store = readAnswers();
  store.entries = store.entries ?? {};
  const printed = fingerprint(question);
  const key = slot ? `slot:${slot}` : printed;
  store.entries[key] = {
    question,
    slot,
    fingerprint: printed,
    answer,
    kind,
    recorded_at: new Date().toISOString(),
  };
  writeJson(answersPath(), store);
  return store.entries[key];
}

// ---------------------------------------------------------------- receipts

export function writeReceipt(key, { bot, confirmation, note, status = 'submitted' }) {
  if (!confirmation) throw new Error('a receipt needs --confirmation: the page confirmation, email id, or a note saying where it landed');
  const packet = readJson(packetPath(key), null);
  if (!packet?.job) throw new Error(`no packet for ${key}; build and claim it first`);
  const receipt = {
    key,
    bot,
    status,
    confirmation,
    note: note ?? null,
    url: packet.job.url,
    company: packet.job.company,
    title: packet.job.title,
    submitted_at: new Date().toISOString(),
  };
  writeJson(receiptPath(key), receipt);
  const leases = readLeases();
  delete leases[key];
  writeLeases(leases);
  writeJson(packetPath(key), { ...packet.job, status: 'submitted', receipt });
  return receipt;
}

// ----------------------------------------------------------------- verify

const NUMBER = /\$?\d[\d,.]*\s?(?:%|K|M|MM|B|ARR|k|m|b)?/g;

/** `400.` at the end of a sentence and `400` mid-line are the same figure. */
function normalizeFigure(token) {
  return String(token).replace(/\s/g, '').replace(/[.,;:]+$/, '').toLowerCase();
}

/**
 * Anti-fabrication check on a generated resume.
 *
 * Every figure and every capitalised term in the generated text must appear in
 * the source resume. A generator is allowed to reorder, cut and reframe; it is
 * not allowed to introduce a number, an employer, a school or a certificate
 * that the source does not contain. The [GROKBOT] instruction blocks are
 * stripped from the source first, so the instructions themselves are not
 * mistaken for facts.
 *
 * The term check skips the first word of every line and every heading or
 * bullet, because capitalisation there is grammar, not a claim.
 */
export function verifyResume(generatedPath, sourcePath = defaultResumePath()) {
  const source = stripGrokbotBlocks(readFileSync(sourcePath, 'utf8'));
  const generated = readFileSync(generatedPath, 'utf8');

  const leftOver = generated.match(/\[GROKBOT[^\]]*\]/g) ?? [];

  const sourceFigures = new Set((source.match(NUMBER) ?? []).map(normalizeFigure));
  const inventedNumbers = [];
  for (const raw of generated.match(NUMBER) ?? []) {
    if (!sourceFigures.has(normalizeFigure(raw))) inventedNumbers.push(raw.trim());
  }

  const sourceTerms = new Set(
    (source.match(/\b[A-Z][A-Za-z0-9.&+-]{2,}\b/g) ?? []).map((one) => one.toLowerCase()),
  );
  const inventedTerms = [];
  for (const line of generated.split('\n')) {
    if (/^\s*(#|[-*>]|\|)/.test(line)) continue; // heading, bullet or table row
    const words = line.split(/\s+/).filter(Boolean);
    for (let index = 1; index < words.length; index += 1) {
      // A trailing period is punctuation, not part of the name.
      const word = words[index].replace(/[^A-Za-z0-9.&+-]/g, '').replace(/[.]+$/, '');
      if (!/^[A-Z][A-Za-z0-9.&+-]{2,}$/.test(word)) continue;
      if (!sourceTerms.has(word.toLowerCase())) inventedTerms.push(word);
    }
  }

  const problems = [];
  if (leftOver.length > 0) problems.push(`${leftOver.length} unresolved [GROKBOT] slot(s) left in the printed resume`);
  if (inventedNumbers.length > 0) problems.push(`figures not in the source: ${[...new Set(inventedNumbers)].join(', ')}`);
  if (inventedTerms.length > 0) problems.push(`terms not in the source: ${[...new Set(inventedTerms)].slice(0, 12).join(', ')}`);

  return {
    generated: generatedPath,
    source: sourcePath,
    ok: problems.length === 0,
    unresolved_slots: leftOver.length,
    invented_numbers: [...new Set(inventedNumbers)],
    invented_terms: [...new Set(inventedTerms)],
    problems,
  };
}

/** Next queued job nobody holds, best screen first. */
export function nextUp(now = Date.now()) {
  const state = queueState(now);
  const free = state.rows.filter((row) => row.status === 'queued' || (row.status !== 'submitted' && !row.lease));
  free.sort((a, b) => {
    const rank = { strong: 0, fair: 1, weak: 2 };
    return (rank[a.screen] ?? 3) - (rank[b.screen] ?? 3) || a.company.localeCompare(b.company);
  });
  return free[0] ?? null;
}

// ------------------------------------------------------------------- MCP

export const APPLY_TOOLS = [
  {
    name: 'apply_queue',
    description: 'The application queue: every job with its key, application system, lease holder and submission receipt.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Only rows in this state: queued, leased, submitted.' } } },
  },
  {
    name: 'apply_next',
    description: 'The best unclaimed job, with its key and application system. Null when the queue is drained.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'apply_claim',
    description: 'Lease a job so no other bot takes it. Returns the prepared packet: output paths, the form field names, and the answers to use. Refuses if another bot holds it or if it was already submitted.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        bot: { type: 'string', description: 'Name of the agent taking the lease.' },
        ttl_minutes: { type: 'number', description: 'How long the lease lasts (default 30).' },
      },
      required: ['key', 'bot'],
    },
  },
  {
    name: 'apply_answer',
    description: 'Record a screening answer once, keyed by fingerprint, so no bot has to work it out again. Personal disclosures (salary, gender, race, veteran, disability) are refused unless recorded as kind=human.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        answer: { type: 'string' },
        kind: { type: 'string', enum: ['fixed', 'derived', 'human'] },
      },
      required: ['question', 'answer'],
    },
  },
  {
    name: 'apply_verify',
    description: 'Check a generated resume against the source: unresolved [GROKBOT] slots, and any figure or proper term the source does not contain.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'apply_receipt',
    description: 'Record a submission so the job leaves the queue for good. Needs the confirmation, email id, or a note saying where it landed.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        bot: { type: 'string' },
        confirmation: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['key', 'bot', 'confirmation'],
    },
  },
  {
    name: 'apply_release',
    description: 'Give back a lease without submitting, when the bot cannot finish the application.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, bot: { type: 'string' } }, required: ['key', 'bot'] },
  },
];

export async function callApplyTool(name, args) {
  switch (name) {
    case 'apply_queue': {
      const state = queueState();
      const rows = args.status ? state.rows.filter((row) => row.status === args.status) : state.rows;
      return {
        built_at: state.built_at,
        total: rows.length,
        counts: {
          queued: state.rows.filter((r) => r.status === 'queued').length,
          leased: state.rows.filter((r) => r.status === 'leased').length,
          submitted: state.rows.filter((r) => r.status === 'submitted').length,
        },
        rows: rows.slice(0, 50),
      };
    }
    case 'apply_next':
      return { next: nextUp() };
    case 'apply_claim':
      return claim(String(args.key), String(args.bot ?? 'agent'), Number(args.ttl_minutes ?? 30));
    case 'apply_answer':
      return recordAnswer(String(args.question), String(args.answer), String(args.kind ?? 'fixed'));
    case 'apply_verify':
      return verifyResume(String(args.path));
    case 'apply_receipt':
      return writeReceipt(String(args.key), {
        bot: String(args.bot ?? 'agent'),
        confirmation: String(args.confirmation),
        note: args.note ? String(args.note) : null,
      });
    case 'apply_release':
      return release(String(args.key), String(args.bot ?? 'agent'));
    default:
      throw new Error(`no tool named '${name}'`);
  }
}

/** Re-exported so a test can point the layer at a scratch directory. */
export function listPackets() {
  try {
    return readdirSync(join(APPLY_DIR, 'packets'));
  } catch {
    return [];
  }
}

export { renameSync };