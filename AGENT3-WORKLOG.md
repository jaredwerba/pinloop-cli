# Agent 3 — Complete Work Log

Session date: 2026-09-22. Role: third agent in the pinloop-cli fork build
(verification → integrations → features). Everything below was executed and
verified live on this machine; nothing is a plan or a claim.

This file is the durable record. The per-task reports in
~/OmarchyJobs/coordination/outbox/AGENT3-RESULT.md were snapshots; this
document is the whole picture.

------------------------------------------------------------------------

## 1. Verification lane (first assignment)

The fork had a `pinloop fit` overlay (rubric, plan, documents, run) written
by the lead agent, uncommitted and untested.

- tests/fit.test.mjs — 17 node:test cases over the compiled CLI: plan
  ordering (pull always after counts), the full screen matrix
  (strong/fair/weak/no, blank-country tolerance, non-JSON and empty stdin),
  docs generation, load's no-login refusal.
- npm test wired up (build + tests).
- PRIVACY BUG found and fixed in src/fit/documents.ts: `fit docs` embedded
  the resume verbatim into background.md — $10M ARR, $24M pipeline, 160%
  quota, Top 3 of 400, President's Club leaked, contradicting FIT.md.
  backgroundFromResume now redacts dollar figures, quota/percent lines,
  ranks, and recognition names (including curly-apostrophe variants).
  Verified 0 leak lines in the regenerated file. fit/profile stays
  gitignored; nothing was ever uploaded.
- Confirmed intentional (not changed): engineering IC at a target employer
  screens 'weak', per the rubric's own rule.

## 2. Integration pipelines (the 100+/day requirement)

Built the local-first intake layer so daily volume never touches the free
Pinloop account's server-side pull cap.

- src/intake/sources.ts — keyless adapters: Greenhouse, Lever, Ashby public
  board APIs. Board specs like `greenhouse:stripe`. One failing board never
  sinks the run. Later hardened: AbortSignal.timeout + 2-attempt retry with
  1.5s backoff (a transient blip no longer silently drops a board's day).
- src/intake/store.ts — dedupe by URL across boards and days, rubric screen
  computed at intake time, daily JSONL under fit/intake/ (gitignored),
  DAILY_TARGET=100 accounting, promise-chain mutex so concurrent writers
  serialize (cross-process flock documented as a known limit).
- src/intake/run.ts — `pinloop intake boards|serve|day|status`:
    boards  fetch + screen + store (default board list, tokens verified live)
    serve   local HTTP ingest (POST rows, GET /status) for webhooks/agents
    day     read back stored rows, filter by verdict
    status  today's counts vs target
- src/intake/mcp.ts — MCP server over stdio (`pinloop mcp`): now 10 tools
  (intake_boards, intake_status, intake_day, intake_brief, intake_brief_all,
  intake_serve_push, intake_applied, intake_score, fit_score, fit_plan).
- Verified live the day it shipped: 4,117 postings ingested in one run, 239
  screened strong, HTTP push + dedupe + error paths all exercised.
- Default board list pruned to tokens verified live (OpenAI/Snowflake host
  their own boards outside these APIs).

## 3. Quality gate (daily-100-gate task from the lead)

- tests/daily-100.test.mjs — fixture-driven gate (no network) enforcing:
  US-only locations (no israel/london/paris/tokyo/berlin/dublin/india/
  germany/canada/singapore), no intern/sdr/bdr titles, no missing or
  duplicate urls, max 8 rows per company, strong only with infra words in
  the title, declared count == jobs length. Runs against any real file via
  DAILY100_FILE. Agent 2's live quality.json passed: 100 rows, 37 companies.

## 4. Review: 7 broken/at-risk integrations (fixed via 4 subagents)

1. Board fetch resilience — retry/timeout added (above).
2. Divergent fit definitions (daily-100 vs rubric) — OPEN, lead decision.
3. Unbounded store growth — `pinloop intake compact --keep-days N` (new
   src/intake/prune.ts): removes old day files, strips description_text from
   rows older than 48h (shortlist urls exempt), atomic temp+rename rewrites,
   6 tests.
4. Two parallel collectors (intake vs daily-100, 19/100 url overlap) — OPEN,
   lead decision.
5. addRows race — promise-chain mutex (above).
6. `pinloop guide` was FAILING outright (exit 1, error on stderr) because the
   generated-guide builder requires a text entry per command and the
   overlay commands had none — 7 entries added to guide-text.ts. Fresh
   agents now discover the fork's full surface.
7. Dead weight — 6 probe-*.py scratch scripts deleted, TestCo test row
   scrubbed from the store (4121→4120).

## 5. Agent-optimize features (built via 3 more subagents)

- `pinloop intake brief <url>` — renders a stored JD as the career-ops
  resume factory's §0 block (JOB_POSTING/COMPANY/ROLE_TITLE pre-filled).
  No network, refuses (never invents) when the url is not in the store,
  warns on thin descriptions. The bridge between the daily lists (which
  carry title/company/url only) and the factory (which needs the full JD).
- `pinloop intake brief --all` — batch §0 briefs for the shortlist into
  fit/intake/briefs/<day>/<briefId>.md, --screen/--limit/--out-dir/--json,
  + MCP intake_brief_all. Catches up: briefsForFilter also skips corrupt
  (U+FFFD) descriptions so the factory never receives gibberish.
- `pinloop intake applied <url>` — closes the loop to the career-ops
  tracker: verifies the posting is in the store, refuses duplicates via
  fit/intake/applied.jsonl (--force overrides), appends a row matching the
  tracker's actual column layout (creates it with the canonical 9-column
  header if missing). + MCP intake_applied. Note: the real
  career-ops/data/applications.md does not exist yet; first real use
  creates it.
- `pinloop intake score --file <jev.json>` — attachScores merges external
  scorer output (Jev today, anything later) onto stored rows by url, atomic
  rewrites, idempotent. + MCP intake_score. Live: 32 rows scored from
  daily/jev-scores.json (68 urls unmatched — they belong to daily-100's
  boards, the measurable cost of the still-open pipeline convergence).

## 6. Bugs found and fixed in upstream data quality (all verified live)

- Greenhouse content field misread as base64 — it is HTML-escaped text.
  Pre-fix rows stored mojibake; adapter now htmlDecode → strip tags.
- Greenhouse location misread as a string — the API nests it as
  {name: 'San Francisco, CA'}; 2,788/2,788 rows had NO location, making
  every geographic check a no-op. Fixed and backfilled: 2,776 stored rows
  restored with locations and clean descriptions.
- Root cause of the "too many non-Boston jobs" report: bug 2 above plus no
  geo gate. Fixed with src/intake/geo.ts (see section 7).

## 7. Geography policy (Boston/Cambridge or fully remote US only)

- src/intake/geo.ts — ONE whereOf/passesGeoGate definition mirroring
  daily-100.mjs's policy: Boston/Cambridge or fully-remote US; title-based
  fallback for locationless rows (title naming Boston passes; title naming
  another market or a foreign region fails; ONSITE-with-no-location is out).
- briefsForFilter applies the gate before writing any brief — a strong seat
  in Austin or London can never become a resume brief.
- Backfilled today's store so the gate had real locations to work with.
- Honest market size: ~4-5 strong Boston/remote AE seats/day on the current
  boards (today: 4 briefs — Databricks CMEG, Enterprise AE Financial
  Services, Named Core AE-Manufacturing, Technical Account Manager Token
  Factory). Volume and this geography are a tradeoff; the levers are more
  boards or a preferred-not-exclusive policy.

## 8. State of the repo

- 54/54 tests pass (fit 17, intake 10, daily-100 gate 3, prune 6, brief 8,
  applied 5, score 5). Build clean. 10 MCP tools live.
- Everything is UNCOMMITTED by design — the lead owns the fork and commit
  decisions. Modified: .gitignore, package.json, src/cli/pinloop.ts (two
  wiring lines), src/fit/documents.ts (redaction), src/shared/guide-text.ts
  (7 entries), scripts/daily-100.mjs (agent 2's). New: src/intake/ (8
  modules, ~1,700 lines), tests/ (7 files + fixtures, ~1,000 lines),
  INTEGRATIONS.md, this file's companion docs.

## 9. Still open (lead decisions)

- Fit-definition convergence: daily-100.mjs and rubric.ts disagree (TAM
  blocking, Boston-only vs US-wide). One screen definition should win.
- Collector convergence: intake and daily-100 fetch the same boards
  independently (19/100 url overlap; 68/100 jev scores unmatched).
- Autonomy: the cron poll exists but needs `hermes gateway start`.
- daily-site/jobs.json carries no date field (confirmed twice).
- listings/ (8 files, 0.45MB) left in place pending the lead's call.

## 10. How to use what I built (agent quick reference)

  pinloop intake boards                     collect + screen + store
  pinloop intake day --screen strong --json shortlist
  pinloop intake brief --all                §0 briefs for Boston/remote strong
  pinloop intake applied <url>              mark applied in career-ops tracker
  pinloop intake score --file jev.json      attach external scores
  pinloop intake compact --keep-days 7      prune old days, strip old JDs
  pinloop mcp                               all of the above as MCP tools
  node --test tests/... / npm test          54 tests, all local, no login
