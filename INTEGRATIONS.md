# Integration pipelines (agent 3)

The fork now has a local-first integration layer that processes 100+ postings
a day without touching the free Pinloop account's pull cap.

## Architecture

  sources (open board APIs, no keys)
    Greenhouse / Lever / Ashby   src/intake/sources.ts
        |
        v
  intake pipeline                src/intake/store.ts
    dedupe (url, cross-board) -> local rubric screen -> JSONL per day
    fit/intake/YYYY-MM-DD.jsonl  (gitignored)
        |
        +--> pinloop intake day|status          CLI read-back
        +--> pinloop intake serve               HTTP endpoint (POST rows, GET /status)
        +--> pinloop mcp                        MCP server over stdio (5 tools)
        +--> upstream: only the shortlist goes to pinloop count/pull/judge

## Commands

  pinloop intake boards [specs...]   fetch + screen + store; default board list
                                     verified live 2026-09-22 (11 boards)
  pinloop intake serve --port 7788   local HTTP ingest for webhooks/other agents
  pinloop intake day --days N [--screen strong]
  pinloop intake status              today's counts vs the 100/day target
  pinloop mcp                        MCP stdio server: intake_boards, intake_status,
                                     intake_day, fit_score, fit_plan

## Verified live, 2026-09-22

  intake boards (11 boards): 4,117 postings ingested, 4,112 added after dedupe,
  screened 238 strong / 161 fair / 3,491 weak / 227 no. Target 100/day: met.
  HTTP push: POST row -> stored strong; identical push -> deduped (duplicates: 1).
  MCP: initialize, tools/list (5 tools), tools/call fit_score and intake_status
  answered over stdio.
  Tests: 27 passing (tests/fit.test.mjs, tests/intake.test.mjs).

## Daily run (for the lead to schedule)

  pinloop intake boards            # each morning, or pinloop intake serve kept running
  pinloop intake day --screen strong --days 1 | pinloop fetch --json   # shortlist upstream

# Agent-optimize bridge (agent 3)

This fork is the machine side of the job search. The human side is the
career-ops resume factory (~/Projects/career-ops, modes/resume-factory-spec.md):
"JD in → resume out", which demands the FULL job description text in its §0
input block. The daily lists carry title/company/url only — until now an agent
generating a resume had to fetch every description by hand.

The bridge is `pinloop intake brief`:

  pinloop intake brief <url>                 print the §0 block (JOB_POSTING,
                                             COMPANY, ROLE_TITLE pre-filled,
                                             description from the intake store)
  pinloop intake brief <url> --out brief.md  write it to a file
  pinloop intake brief <url> --days 14       widen the lookback

MCP clients get the same as the `intake_brief` tool; `intake_serve_push` lets
an agent push rows into the store without the HTTP server.

Guarantees
  - No network: the description comes from what intake already stored.
  - Nothing invented: if the url is not in the store, the command refuses and
    says to run intake boards first. A thin description (<200 chars) warns.
  - The brief carries only the posting's words. Candidate facts stay in the
    factory's own gitignored files, exactly as its integrity rules require.

Agent workflow, end to end
  1. pinloop intake boards                     (collect + screen + store)
  2. pinloop intake day --screen strong --json (shortlist)
  3. pinloop intake brief <url> --out /tmp/s0.md
  4. hand /tmp/s0.md to a grokbot session running the resume factory

Fix shipped with this: the Greenhouse adapter was misreading the content
field as base64 (it is HTML-escaped text), so descriptions stored before
2026-09-22 18:24 are mojibake. New rows are clean text; `intake brief`
warns on any thin/corrupt description instead of feeding it to the factory.
Re-run `pinloop intake boards` to refresh, then delete the corrupt day file
if a clean re-brief is needed for an old url.

