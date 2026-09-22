Local career-site scan. Pinloop's servers choose which hiring pages they ingest. This fork cannot add a source to Pinloop. It can read three public board APIs plus the employers' own career portals. No login, no daily pull.

See `PORTALS.md` for the employer portals (Amazon, Microsoft, NVIDIA, Oracle, Google, Glean, Voltage Park).

  Greenhouse  https://boards-api.greenhouse.io/v1/boards/<token>/jobs
  Ashby       https://api.ashbyhq.com/posting-api/job-board/<token>
  Lever       https://api.lever.co/v0/postings/<token>?mode=json

scripts/boards.json is the live token list (85 boards, including Lever). A token that 404s does not belong there. SmartRecruiters and Workable answer 200 with an empty list for names that are not really on those systems, so an empty 200 is not a hit.

Run

  node scripts/daily-100.mjs --target 100 --out /home/jkw/OmarchyJobs/daily/quality.json
  node listings/scan-boards.mjs

Files

  listings/seller.json   first Greenhouse/Ashby seller pull, 19 boards
  listings/more.json     122 seller listings from the 17 boards added 2026-09-22
                         (Lever: Palantir, Sysdig, Matillion, Spotify.
                          Greenhouse: Duolingo, Instacart, Lyft, Robinhood, SoFi,
                          Gusto, Reddit, Dropbox, Zscaler, Netlify, Huntress,
                          PlanetScale, Starburst)
  listings/summary.json  jobs per board from the first scan

Zscaler alone added 81 seller titles. Palantir (312 jobs) and Spotify (77) are live and had no account-executive titles.

Still not on these three APIs: see PORTALS.md. Amazon, Microsoft, NVIDIA, Oracle, Google, Glean and Voltage Park are now read from their own endpoints.

Re-run the scripts to refresh. Do not commit credentials. The JSON is listings, not a resume.
