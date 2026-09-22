# Agent-native apply queue

The pipeline already answers two questions: which jobs (`scripts/daily-100.mjs`)
and what should the resume say (`pinloop intake brief` → career-ops
resume-factory). This layer answers the third one, the half a bot does not have
today: which form am I walking into, what will it ask, what is the answer, has
another bot already taken it, and what proves it went through.

    node scripts/apply.mjs build --from /home/jkw/OmarchyJobs/daily/quality-us.json
    node scripts/apply.mjs next
    node scripts/apply.mjs claim <key> --bot grokbot-1
    node scripts/apply.mjs verify <key>
    node scripts/apply.mjs receipt <key> --bot grokbot-1 --confirmation GH-5415461008

Every command prints JSON. `node scripts/apply.mjs mcp` serves the same thing as
seven MCP tools over stdio, so an agent gets them through its normal tool loop
rather than by parsing a screen.

    apply_queue    the queue with lease holder and receipt per job
    apply_next     the best unclaimed job
    apply_claim    lease a job; returns the prepared packet
    apply_answer   record a screening answer once, by fingerprint
    apply_verify   anti-fabrication check on a generated resume
    apply_receipt  record the submission
    apply_release  hand a job back unfinished

## Four ideas doing the work

**A packet is the unit of work, not a job posting.** `claim` returns everything
the bot needs in one call: `packet_dir`, the resume path to write, the pdf path,
the form field names for that vendor in the order the form presents them, the
answers to use, and the steps. The bot does not explore the page to find out
what the page wants.

**A lease, so bots can drain one queue in parallel.** `claim` takes a TTL lease
and refuses a second claimant:

    $ node scripts/apply.mjs claim ec817b3d65d1 --bot grokbot-2
    {"error":"ec817b3d65d1 is leased by grokbot-1 until 2026-09-22T19:38:43.642Z"}

Leases expire on their own, so a bot that dies does not strand a job. This is
what makes "several grokbots working the list" safe instead of a race.

**Answer by canonical slot, so nothing is answered twice.** Fingerprinting alone
only collapses wordings that share their words, and the vendors do not share
them: Greenhouse's field is literally `work_authorization`, Ashby asks "Are you
legally authorized to work in the United States?". `CANONICAL_RULES` maps both
onto the `work_authorization` slot, so one recording serves every vendor:

    $ node scripts/apply.mjs answer \
        --question "Will you now or in the future require sponsorship…?" \
        --answer "No" --kind fixed
    $ node scripts/apply.mjs questions ec817b3d65d1
      sponsorship   cache   fixed   No
      salary        missing human   null   NEEDS HUMAN

Salary, gender, race, veteran and disability are refused as reusable facts.
They can be stored only as `kind=human`, and a missing answer is returned as
`needs_human` — never filled with a plausible guess. An invented salary
expectation is a misrepresentation on a real application, so the layer will not
carry one.

**Verify before submitting, not after.** The resume carries `[GROKBOT]`
instruction slots, and a generator is allowed to reorder, cut and reframe the
source. It is not allowed to introduce a figure or a name the source does not
contain:

    $ node scripts/apply.mjs verify --file /tmp/bad.md
    {"ok":false,
     "invented_numbers":["$47M"],
     "invented_terms":["Snowflakeack"],
     "problems":["figures not in the source: $47M",
                 "terms not in the source: Snowflakeack"]}

It also fails a resume that still carries an unresolved `[GROKBOT]` slot, which
is the other way generated text escapes into a printed document. Exit code 3 on
failure, so a bot can gate the submit step on it.

## What the bot does, end to end

    claim      get the packet (lease taken)
    brief      pinloop intake brief <url> gives the JD text for the slot
    generate   write resume.md into packet_dir, filling every [GROKBOT] slot
    verify     fails on invented figures, names, or unresolved slots
    pdf        render to pdf_out
    apply      open the url, fill `fields` in order with `answers`
    stop       any answer marked needs_human: ask, never invent
    receipt    write the confirmation; the job leaves the queue for good

Steps the layer marks `needs_login` (Workday, Microsoft, Amazon, Oracle, Google —
15 of the 98) need a human session before the form renders. The packet says so
rather than letting a bot burn a lease discovering it.

## Files

    scripts/apply-lib.mjs   the layer: keys, ATS table, slots, leases, verify
    scripts/apply.mjs       CLI and MCP server
    scripts/apply.test.mjs  15 tests, node --test scripts/apply.test.mjs
    ~/OmarchyJobs/apply/    queue.json, leases.json, answers.json, packets/<key>/

State lives outside the repo and outside the resume. `PINLOOP_APPLY_DIR` and
`PINLOOP_RESUME` move it, which is how the tests run against a scratch directory
instead of a real queue.

## Not built

Nothing opens a browser or submits a form. The layer decides, prepares and
records; the bot does the walking. That boundary is deliberate: it keeps the
irreversible step — pressing submit — where a human can see it.
