# pinloop-cli fork

I forked the upstream repository `pinloop-ai/pinloop-cli` on 22 September 2026.
The upstream command is a terminal job board for a coding agent.
I did not fork it to replace that product.
I forked it because the free plan cannot run the search I need.
I then found defects in the data, fixed the defects, and added a local pipeline.
Three coding agents built the pipeline under one harness.
A fourth agent only scored rows.
The public page is [omarchy-jobs.vercel.app](https://omarchy-jobs.vercel.app).

## 1. Fork

The upstream command reads the Pinloop service.
The free plan gives 5 new postings a day.
The server enforces that number.
The client in this repository does not hold the number.
A change in this repository cannot raise the number.
Pro gives 1,500 new postings a month.
Pro still does not give 100 new postings a day.
The service terms say not to work around the limit.
I did not change the client to ignore a refusal.

I need account executive seats in Boston or Cambridge.
I need seats that are fully remote in the United States.
I do not need seats in other cities.
I do not need regional remote seats.
The fork adds a local collector beside the upstream command.
The local collector reads public company boards.
The local collector does not spend the free daily pull.

## 2. Flaws

I treated the first live pull as a test, not as a result.

1. The first title query matched too many seats.
The words infrastructure and AI matched building-system seats.
Johnson Controls returned as a cloud seat.
The title did not name cloud, GPU, IaaS, or hyperscale.

2. The free pull cannot fill a daily list.
A count of the tight title returned 103 career-site rows in six months.
The free account can take 5 of those rows a day.
The first day on this version returned 10 rows.
The first day then used the allowance.

3. One Greenhouse board can fill a list with the wrong country.
The first public-board run let Stripe fill 100 rows.
Rows included London, Paris, Tokyo, and Israel.
A word list for country names did not catch the code AUS.
Amazon writes Canberra as AUS, not Australia.

4. The reader did not read the Greenhouse location field.
The API returns location as an object with a name field.
The reader treated that object as a string.
2,788 stored Greenhouse rows had no location.
A city filter on those rows did nothing.

5. The reader misread the Greenhouse description field.
The field is HTML text.
The reader treated the field as base64.
Stored descriptions held damaged characters.

6. A remote word is not a remote seat.
NVIDIA writes the location as US, AR, Remote.
A bare remote test missed that form.
Hybrid seats contain the word remote.
City offices contain the word remote.
Remote, Texas is not a national remote seat.

7. Profile text leaked private figures.
The command `pinloop fit docs` copied the resume into a profile file.
The copy held pay, quota, rank, and award names.
The profile file is gitignored.
The figures still must not be generated.

8. The agent guide failed closed.
`pinloop guide` exited 1.
The guide builder requires one text entry for each command.
The new commands had no entries.
A new agent could not discover the fork.

9. An earlier note called the employer career sites unreachable.
Amazon, Microsoft, NVIDIA, Oracle, Google, Glean, and Voltage Park had no board token.
Each site publishes its own endpoint.
A missing token is not a missing feed.

10. Two empty HTTP 200 responses are not proof of a board.
SmartRecruiters and Workable return 200 and an empty list for unknown names.
An empty 200 cannot prove that a company is absent.
Those two feeds are not discovery sources.

## 3. Fixes

I ran each fix below.

The title query now requires cloud, GPU, IaaS, or hyperscale.
Bare infrastructure is out.
Bare AI is out.
The change is in `src/fit/plan.ts`.
The commit is be677a2.

The daily collector does not call the Pinloop pull.
The collector reads public boards.
One board error does not stop the run.
The adapter retries once after 1.5 seconds.
The timeout uses AbortSignal.

The location gate now has one foreign-country test.
The test includes three-letter country codes.
The test does not include two-letter codes.
Two-letter codes collide with state names.
NVIDIA location text US, AR, Remote now counts as remote.
A national remote phrase counts as fully remote.
A state after the word remote does not count.
Hybrid does not count.
The same rule lives in `scripts/daily-100.mjs` and in `src/intake/geo.ts`.

The Greenhouse reader now reads `location.name`.
The reader decodes HTML and strips tags.
Agent 3 restored locations on 2,776 stored rows.

`backgroundFromResume` now removes dollar figures.
The function removes quota lines, rank lines, and award names.
A check of the regenerated file found 0 leaked lines.
The profile directory stays in `.gitignore`.

I added seven guide entries in `src/shared/guide-text.ts`.
`pinloop guide` now exits 0.
A new agent can read the fork commands.

## 4. Multi-agent harness

I was the lead agent.
I wrote the tasks.
I owned the commits.
The other agents did not commit.

The harness split the tree so agents did not edit the same files.

Agent 2 owned `scripts/`.
Agent 2 did not edit `src/` or `tests/`.
Agent 3 owned `src/intake/` and `tests/`.
Agent 4 had no write access to the tree.
Agent 4 only returned scores.

Task files named the output file for each agent.
Agent 2 wrote `WORKLOG.md`.
Agent 3 wrote `AGENT3-WORKLOG.md`.
The agents did not write each other's result files.

Agent 3 used subagents for the review.
Agent 3 used subagents for the features.
Four subagents reviewed broken integrations.
Three subagents built the agent-facing commands.
The lead still owned the merge.

## 5. Multi-agent build

The lead model was Grok Build 4.7.
Grok Build 4.7 forked the repository.
Grok Build 4.7 wrote the fit overlay.
Grok Build 4.7 wrote the first daily collector.
Grok Build 4.7 set the Boston and remote rule.
Grok Build 4.7 connected the page to Neon Postgres.

Agent 2 was a Hermes session.
Agent 2 used DeepSeek V4.1 Flash.
Agent 2 added the Lever board type.
Agent 2 added seven employer portal loaders.
Agent 2 added the apply queue.
Agent 2 fixed the AUS country-code leak.
Agent 2 fixed the NVIDIA remote form.

Agent 3 was a Hermes session.
Agent 3 used GLM 5.3 Flash.
Agent 3 wrote the tests.
Agent 3 wrote the intake store.
Agent 3 fixed the Greenhouse location bug.
Agent 3 fixed the Greenhouse description bug.
Agent 3 added the Boston and remote gate on briefs.
Agent 3 removed the private figures from profile text.

Agent 4 was not a coding agent.
Agent 4 was Jev, a typed decision model.
Jev scored an earlier list of 100 rows.
The cost was 0.001973 dollars.
The result was 32 strong, 63 fair, and 5 no.
The 5 no scores were technical account manager seats or non-US seats.
The title rule had kept those rows.
`pinloop intake score` can attach a Jev file to stored rows by URL.
32 rows matched.
68 URLs did not match.
Those 68 belong to the other collector.
The score gap is still open.

## 6. New integrations

The fork reads three public board APIs.
No API key is required.

Greenhouse uses `boards-api.greenhouse.io`.
Ashby uses the public posting API.
Lever uses `api.lever.co/v0/postings`.
`scripts/boards.json` holds 85 live boards.
The split is 53 Greenhouse, 28 Ashby, and 4 Lever.
A Lever scan added 122 seller rows.
Palantir and Spotify answered, and had no account executive titles.
Those two boards are recorded as live, not as failures.

Seven employer sites had no usable board token.
Each site now has a loader in `scripts/portals.mjs`.

Amazon jobs return zstd and truncate at 1,024 bytes when Node cannot decode the body.
The loader sends `accept-encoding: identity`.
The full JSON then returns.
The Amazon scan returned 81 seller rows of 100.

Microsoft host `gcsservices.careers.microsoft.com` returns 404.
The live host is `apply.careers.microsoft.com`.
The Microsoft scan returned 10 seller rows.

NVIDIA uses Workday.
Workday returns HTTP 400 when the page size is above 20.
The loader pages 20 rows at a time.
The NVIDIA scan returned 50 seller rows of 200.

Oracle uses the ORC REST API on `eeho.fa.us2.oraclecloud.com`.
The Oracle scan returned 42 seller rows of 200.

The Google jobs API path returns 404.
Google renders jobs in the page inside `AF_initDataCallback`.
The loader parses that block.
The Google scan returned 3 seller rows of 20.

Glean is the Greenhouse token gleanwork.
The Glean scan returned 29 seller rows of 125.

Voltage Park is a recorded miss.
The Ashby slug returns 404.
The kula.ai board says no jobs.
The loader stays, so a later day can report jobs.

The six live portals returned 215 seller rows on 22 September 2026.

The page uses Neon Postgres on Vercel.
The project name is omarchy-jobs.
One API route reads the table.
The table key is the job URL.
The first save writes the day.
A later save of the same URL does not change the day.
A later run adds rows.
A later run does not delete earlier days.
The connection string stays in Vercel environment variables.
The connection string is not in git.

## 7. New features

`pinloop fit plan` counts before any pull.
`pinloop fit score` screens a row on this machine.
The screen values are strong, fair, weak, and no.
`pinloop fit docs` writes profile text with private figures removed.
`pinloop fit load` uploads that text only after login.

`pinloop intake boards` fetches, screens, and stores.
`pinloop intake day` reads one day from the store.
`pinloop intake status` compares the day with the target of 100.
`pinloop intake serve` accepts rows over local HTTP.
The store is one JSONL file per day under `fit/intake`.
The store dedupes by URL.
The store directory is gitignored.
One live intake run stored 4,117 postings.
239 of those rows screened strong.

`pinloop intake brief` writes a resume-factory block for one stored URL.
The command refuses a URL that is not in the store.
The command does not invent a description.
The Boston and remote gate runs before a brief is written.
A strong seat in Austin cannot become a brief.
On 22 September 2026 the gate left 4 strong briefs.

`pinloop intake applied` appends one tracker row.
The command refuses a duplicate URL.
`pinloop intake compact` deletes old day files and strips old description text.
`pinloop intake score` merges an external score file by URL.

`scripts/daily-100.mjs` writes the daily file and saves new rows to Neon.
The default gate is Boston, Cambridge, or fully remote in the United States.
The flag `where us` widens the gate to the United States.
The flag still rejects other countries.
A wide run returned 100 seats from 48 employers.
The default run on 22 September 2026 saved 16 seats.
4 seats are in Boston.
12 seats are fully remote.
The page shows one list.
The page does not split the list by city.

`scripts/apply.mjs` builds one packet for one coding agent.
The packet holds the resume path, the form field names, the answers, and the steps.
`claim` takes a lease with a time limit.
A second agent cannot claim the same job.
An expired lease does not block the job.
Salary, gender, race, veteran status, and disability cannot be stored as reusable facts.
Those answers must be kind human.
An unanswered disclosure returns needs_human.
The command does not guess.
`verify` rejects a resume that adds a number or a name.
`verify` rejects an unresolved GROKBOT slot.
The exit code is 3.
A test queue held 98 jobs.
71 jobs had a known application system.
27 jobs did not.
15 jobs need a login before the form renders.
The queue does not submit the form.
The test sent 0 applications.

## 8. Agent optimization

The upstream command already prints instructions for a coding agent.
This fork keeps that pattern and adds a tool surface.

`pinloop mcp` is a Model Context Protocol server on standard input.
The protocol is JSON-RPC.
One JSON message uses one line.
Logs go to standard error.
Standard output stays protocol text.
The server exposes 10 tools.
The tools cover boards, status, day, brief, applied, score, and fit.
No login is required.
No Pinloop call is made.

`scripts/apply.mjs mcp` exposes 7 more tools.
An agent claims, answers, verifies, and releases through tools.
The agent does not parse a screen.
The packet says when a login wall exists.
The agent does not spend a lease to discover that wall.

The guide text names every new command.
A fresh agent can read `pinloop guide` and find the surface.
JSON flags exist on the list commands.
An agent can branch on exit codes.
One failed board does not fail the day.

## 9. Verification

`npm test` reported 54 passed and 0 failed.
The 54 tests cover fit, intake, the daily gate, prune, brief, applied, and score.
`node --test scripts/apply.test.mjs` reported 15 passed.
`node --test scripts/apply.test.mjs` reported 0 failed.
The daily acceptance check passed on the wide United States file.
The file had 100 jobs, 48 companies, 0 foreign rows, and 0 duplicate URLs.
One company had at most 3 rows.
I ran the apply path end to end on one demo job.
I then removed the demo receipt.
The live page API returned 16 jobs for day 2026-09-22.

## 10. Limits

The Boston and remote market is small.
On 22 September 2026 the saved list had 16 seats, not 100.
A wider United States list can return 100 seats.
The wider list includes cities I do not want.
I kept the narrow gate.

Two collectors still exist.
`pinloop intake` and `scripts/daily-100.mjs` read overlapping boards.
A measured overlap was 19 of 100 URLs.
The fit rule in the daily script and the fit rule in `src/fit/rubric.ts` still disagree on technical account manager seats.
One rule should win.
The merge is not done.

The JSONL store uses a promise-chain lock inside one process.
The store does not use a cross-process file lock.
Voltage Park still has no open jobs.
27 apply packets have an unknown form.
The apply layer prepares the form.
The apply layer does not send the form.

## 11. Record

Read [OVERVIEW.md](OVERVIEW.md) for the short project record.
Read [WORKLOG.md](WORKLOG.md) for the agent 2 record.
Read [AGENT3-WORKLOG.md](AGENT3-WORKLOG.md) for the agent 3 record.
Read [APPLY.md](APPLY.md) for the apply queue.
The upstream license covers the command line only.
See [LICENSE](LICENSE).

Upstream repository: https://github.com/pinloop-ai/pinloop-cli
Page: https://omarchy-jobs.vercel.app
Home: https://pinloop.ai
