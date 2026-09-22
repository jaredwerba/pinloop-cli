# pinloop-cli fork

This is my fork of [pinloop-ai/pinloop-cli](https://github.com/pinloop-ai/pinloop-cli).

Upstream Pinloop is a job-board command line for a coding agent. It is useful. I did not fork it to replace that product. I forked it because the free plan cannot do the search I need.

## Why I forked it

I want account executive jobs in Boston, or jobs that are fully remote in the United States. I do not want jobs in other cities, and I do not want regional remote jobs.

Pinloop's server decides how many new postings a free account can take. That number is 5 a day. On the first day this account ran this version, the server handed 10. The client in this repository does not hold that number, and a change here cannot raise it. Pro is 1,500 new postings a month. That is still not 100 a day, and the terms say not to work around the limit.

I already use career-ops to evaluate jobs. I needed a daily collector that reads public company boards, keeps only Boston and fully remote seats, and does not spend the Pinloop allowance.

## What I changed

- `pinloop fit` scores a posting against an account executive profile before any pull.
- `scripts/daily-100.mjs` reads public Greenhouse, Ashby, and Lever boards, plus career sites for Amazon, Microsoft, NVIDIA, Oracle, Google, and Glean. Voltage Park had no open jobs on 22 September 2026.
- The default location rule keeps Boston and Cambridge, or a fully remote United States seat. Other cities stay out.
- `pinloop intake` stores board results locally, writes a job brief, and can mark a job applied. One board error does not stop the run.
- Tests cover the fit commands, the intake store, and the daily list rules. The last full run reported 54 passing tests.
- `scripts/apply.mjs` prepares one application packet for a coding agent. It does not submit the application.
- The page at [omarchy-jobs.vercel.app](https://omarchy-jobs.vercel.app) shows one list. Neon Postgres keeps each run by date. A later run adds jobs. It does not delete earlier days.

## Why this is better

The upstream command is still the right tool for a Pinloop account. This fork is better for my search.

I can collect jobs every day without using the 5-a-day pull. The page no longer fills with New York, San Francisco, or regional remote seats. A Greenhouse location bug had stored 2,788 rows with no location, so a city filter did nothing. That bug is fixed, and the Boston rule now runs on real locations. Each day's jobs stay on the page.

The honest size of this search is small. On 22 September 2026 the Boston and fully remote list had 16 jobs, not 100. A wider United States search can return 100 jobs, but that list includes cities I do not want. Fewer correct jobs is the improvement.

## How it was built

Grok Build 4.7 led the fork and wrote the tasks. Two Hermes sessions did the other work, on separate files.

Agent 2 used DeepSeek V4.1 Flash. That session added the extra boards, the employer site loaders, and the apply queue.

Agent 3 used GLM 5.3 Flash. That session added the tests, the intake store, and the Boston and remote gate.

The full record is in [OVERVIEW.md](OVERVIEW.md), [WORKLOG.md](WORKLOG.md), and [AGENT3-WORKLOG.md](AGENT3-WORKLOG.md).

## Upstream command

The original command still needs Node 22 or newer and a Pinloop account.

```
npm install -g pinloop
pinloop
```

`pinloop welcome` and `pinloop guide` describe the upstream command. Login uses a browser and has no password. The license in this repository covers the command line only. See [LICENSE](LICENSE).

- Upstream: https://github.com/pinloop-ai/pinloop-cli
- Home: https://pinloop.ai
- Discord: https://pinloop.ai/discord
- Privacy: https://pinloop.ai/privacy
- Terms: https://pinloop.ai/terms
