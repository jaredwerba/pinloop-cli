# Worklog — expansion of the pinloop fork, 2026-09-22

What was asked, what was built, and what was measured. Every number below came
from a command that was actually run; the commands are listed so any of it can be
re-checked.

This session worked as **agent 2** on the fork, beside the lead (agent 1) and
agent 3. Agent 3 owns `src/intake/`. This work deliberately stayed out of
`src/` and `tests/` and added a `scripts/` surface instead, so the three agents
would not collide.

---

## 1. Lever — a third board API

Asked: "figure out how to scan more job sites and get more listings into this
repo."

The fork already read Greenhouse and Ashby. Lever is a real third public feed:

    https://api.lever.co/v0/postings/<token>?mode=json

SmartRecruiters and Workable were probed and **rejected**: both answer `200` with
an empty list for names that are not really on them, so an empty `200` proves
nothing and neither can be used as a discovery source.

Changes:

    scripts/daily-100.mjs   boardUrl() and rowsFrom() now handle lever rows
    scripts/boards.json     17 live boards added -> 85 total
                            (greenhouse 53, ashby 28, lever 4)

Result: **122 new seller listings** written to `listings/more.json` —
Zscaler 81, Matillion 8, Reddit 8, Lyft 6, Dropbox 4, Sysdig 4, Gusto 4,
Huntress 3, Instacart 2, Starburst 2. Palantir (312 postings) and Spotify (77)
are live boards with no account-executive titles, so they contributed nothing and
are recorded as such rather than as failures.

---

## 2. Career portals — the six employers that had no board API

Asked: "figure out how to get those companies on this list. if you have to pull
from their careers portal do it."

Oracle, AWS, Microsoft, Google, NVIDIA, Glean and Voltage Park were all reported
as unreachable in the previous session. Each turned out to publish its own
endpoint. All seven were probed until a real payload came back:

    portal        endpoint                                          seller / total
    amazon        amazon.jobs/en/search.json                            81 / 100
    microsoft     apply.careers.microsoft.com/api/pcsx/search            10 / 10
    nvidia        nvidia.wd5.myworkdayjobs.com CXS (Workday, paged 20)    50 / 200
    oracle        eeho.fa.us2.oraclecloud.com ORC REST                   42 / 200
    google        careers page, AF_initDataCallback block                3 / 20
    glean         Greenhouse board token "gleanwork"                     29 / 125
    voltagepark   kula.ai + Ashby — no open roles                          0 / 0

**215 seller listings** in `listings/portals.json`.

### What each one cost, and why it is written down

- `amazon.jobs` answers `content-encoding: zstd` and **truncates the body at
  exactly 1024 bytes** when Node cannot decode it. Sending
  `accept-encoding: identity` returns the whole JSON. This looked like a broken
  API for several attempts; it is a compression mismatch.
- **Workday returns HTTP 400 for `limit` above 20.** The cap is undocumented.
  The loader pages 20 at a time.
- Microsoft's `gcsservices.careers.microsoft.com` host is dead (404). The live
  one is `apply.careers.microsoft.com/api/pcsx/search`.
- `careers.google.com/api/v3/search` is 404. Google server-renders its jobs into
  the results page inside an `AF_initDataCallback({key: 'ds:1'` block, so the
  listing is parsed out of the HTML.
- **Voltage Park is a recorded miss.** Their site links to
  `jobs.ashbyhq.com/voltagepark.com`, but the Ashby posting API answers 404 for
  every slug they use, and their kula.ai board reads "No jobs found". The loader
  exists so it starts reporting the day either one answers.

Files:

    scripts/portals.mjs        the seven loaders
    scripts/scan-portals.mjs   scans them, filters to seller titles, writes JSON
    listings/PORTALS.md        the endpoints and the gotchas above
    listings/portals.json      the listings

---

## 3. The daily list, and the gate that was hiding these employers

Wiring the portals in exposed a second problem: even once AWS, Oracle, NVIDIA,
Google and Microsoft were reachable, **none of them reached the daily list.**

`daily-100.mjs` keeps only Boston, Cambridge or fully-remote seats. Those
employers post account executives in Seattle, Austin or "United States" and
almost never as a Boston or remote seat:

    node scripts/daily-100.mjs --target 100                  -> 20-25 seats, 0 from those employers
    node scripts/daily-100.mjs --target 100 --where us       -> 100 seats, 48 employers, all six present

So `--where` was added. `boston-remote` stays the default; `us` widens to
anywhere in the United States with foreign countries still excluded.

### Two real bugs fixed in the location gate

- **Foreign country codes leaked.** `amazon.jobs` writes "Canberra, Australian
  Capital Territory, **AUS**", not "Australia", so the word list missed it and
  foreign rows were counted as US-anywhere. Added a three-letter-code test
  (AUS, BRA, DEU, CAN, GBR, IND, SGP, JPN, …). Two-letter codes are deliberately
  excluded because they collide with US state abbreviations.
- **NVIDIA writes "US, AR, Remote"**, which no `remote` check caught because the
  location is not a bare "Remote". Now recognised as remote.

Both gates now share one `isForeign()` test, so widening the location filter
cannot reintroduce foreign listings.

Also in this area:

    scripts/verify-daily.mjs    acceptance check: 100 jobs, no foreign rows, no
                                intern/SDR/BDR, no duplicate urls, max 8 per
                                company, >=15 companies, no invented "strong"
    scripts/probe-coverage.mjs  per-employer coverage: what each source offers
                                under each gate (this is how the 25-vs-100 gap
                                was found and measured)

`verify-daily.mjs` on the US run: **PASS** — 100 jobs, 48 companies, max 3 per
company, 0 foreign, 0 blocked titles, 0 duplicate urls, 13 strong / 87 fair.

---

## 4. The apply layer — the intended use case

Asked: "can this be optimized for a grokbot to go to this website and generate a
resume and apply? … think of a creative way to make this agent-native."

The chain already existed up to *resume out*: `pinloop intake brief` produces the
career-ops §0 block, and the resume already carries `[GROKBOT]` slots that
`src/fit/documents.ts` strips before sending it upstream. What was missing was
everything *after* the resume — the half where a bot has to walk into a form.

The unit of work is a **packet**, not a job posting. `claim` returns one object
containing the resume path to write, the pdf path, the vendor's form field names
in form order, the answers to use, and the ordered steps.

Four ideas do the work:

**A lease, so bots can drain one queue in parallel.** `claim` takes a TTL lease
and refuses a second claimant:

    $ node scripts/apply.mjs claim ec817b3d65d1 --bot grokbot-2
    {"error":"ec817b3d65d1 is leased by grokbot-1 until 2026-09-22T19:38:43.642Z"}

Leases expire on their own, so a bot that dies does not strand a job.

**Answers by canonical slot.** Fingerprinting alone fails at this: Greenhouse's
field is literally `work_authorization` while Ashby asks "Are you legally
authorized to work in the United States?". `CANONICAL_RULES` maps both onto one
slot so a single recording serves every vendor. Verified: recording the natural
question once resolves the Greenhouse field on a different job.

**Personal disclosures are refused as reusable facts.** Salary, gender, race,
veteran and disability can only be stored as `kind=human`; anything unanswered
comes back `needs_human` and is never guessed:

    $ node scripts/apply.mjs answer --question "What are your salary expectations?" \
        --answer "185000" --kind fixed
    {"error":"… must be recorded as kind=human; it is a personal disclosure, not a reusable fact"}

**Verify before submitting.** The generator may reorder, cut and reframe; it may
not introduce a figure or a name the source does not contain:

    $ node scripts/apply.mjs verify --file /tmp/bad.md
    {"ok":false,"invented_numbers":["$47M"],"invented_terms":["Snowflakeack"]}

It also fails a resume still carrying an unresolved `[GROKBOT]` slot. Exit 3, so
a bot can gate its submit on it.

Files:

    scripts/apply-lib.mjs    the layer: keys, ATS table, slots, leases, verify
    scripts/apply.mjs        CLI (build, status, next, claim, release, answer,
                             answers, questions, verify, receipt, ats, mcp) and
                             an MCP server over stdio
    scripts/apply.test.mjs   15 tests
    APPLY.md                 the design write-up
    ~/OmarchyJobs/apply/     queue.json, leases.json, answers.json, packets/<key>/

The MCP surface is seven tools — `apply_queue`, `apply_next`, `apply_claim`,
`apply_answer`, `apply_verify`, `apply_receipt`, `apply_release` — so a bot gets
these through its normal tool loop rather than by parsing a screen.

Measured state: **98 jobs queued**, ATS detected on 71 of them
(greenhouse 32, ashby 21, amazon/google/lever/microsoft/workday/oracle 3 each,
**27 unknown** = company career pages needing manual mapping). **15 need a login**
before the form renders (Workday, Microsoft, Amazon, Oracle, Google); the packet
says so rather than letting a bot burn a lease finding out.

---

## 5. Verification

    $ npm test                                  54 pass, 0 fail
    $ node --test scripts/apply.test.mjs        15 pass, 0 fail
    $ node scripts/verify-daily.mjs …/quality-us.json   PASS
    $ node scripts/apply.mjs mcp (stdio)        initialize + tools/list + apply_next OK

The 54 include the repo's own `tests/daily-100.test.mjs` and `tests/intake.test.mjs`,
so the `daily-100.mjs` changes did not break the existing suite.

End-to-end exercised, not just unit-tested: a job was built, queued, claimed, the
lease conflict was provoked, answers were resolved from the cache, a fabricated
resume was rejected, a clean one passed, a receipt was written, and the submitted
job then refused re-claim. The demo receipt was removed afterwards so the real
queue is clean (98 queued, 0 submitted).

---

## 6. Files added or changed

    ADDED   scripts/portals.mjs          seven employer portal loaders
    ADDED   scripts/scan-portals.mjs     scan + filter + write listings/portals.json
    ADDED   scripts/probe-coverage.mjs   per-employer coverage under each gate
    ADDED   scripts/verify-daily.mjs     daily run acceptance check
    ADDED   scripts/apply-lib.mjs        apply layer
    ADDED   scripts/apply.mjs            apply CLI + MCP server
    ADDED   scripts/apply.test.mjs       15 tests
    ADDED   APPLY.md                     apply layer design
    ADDED   listings/PORTALS.md          portal endpoints and gotchas
    ADDED   listings/portals.json        215 seller listings
    ADDED   listings/more.json           122 seller listings (Lever boards)

    CHANGED scripts/daily-100.mjs        lever rows, --where gate, foreign country
                                         codes, NVIDIA remote form, portals wired in
    CHANGED scripts/boards.json          68 -> 85 verified boards
    CHANGED listings/README.md           points at PORTALS.md

Nothing was committed, pushed, or uploaded. `src/` and `tests/` were not touched.

---

## 7. Open items

- **The default gate is a decision for the lead.** `boston-remote` is unchanged
  as the default and yields ~20-25 seats; `--where us` yields 100 with all six
  employers present. The scheduled run needs to pick one.
- **Voltage Park** stays a recorded miss until their Ashby or kula.ai board starts
  answering.
- **27 of 98 queued jobs have an unknown application system** — company career
  pages (`detectAts` returns `unknown`). Each needs one entry added to the `ATS`
  table before a bot can be told what that form asks.
- **No browser step exists.** The layer decides, prepares and records; pressing
  submit is left to the agent, and the irreversible step is deliberately not
  automated in this layer.
- The `~/.pinloop/credentials.json` account was never used, read, or logged.

---

## 8. Re-running everything

    cd ~/OmarchyJobs/pinloop-cli

    node scripts/scan-portals.mjs                     # refresh the seven portals
    node scripts/daily-100.mjs --target 100 --where us \
        --out ~/OmarchyJobs/daily/quality-us.json     # the 100-job US list
    node scripts/verify-daily.mjs ~/OmarchyJobs/daily/quality-us.json
    node scripts/apply.mjs build --from ~/OmarchyJobs/daily/quality-us.json
    node scripts/apply.mjs status
    npm test && node --test scripts/apply.test.mjs
