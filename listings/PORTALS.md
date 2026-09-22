# Career portals beyond the three board APIs

Pinloop's servers choose which hiring pages they ingest, and this fork cannot add
a source to Pinloop. It can read the employers' own public job endpoints. None
of these needs a login and none spends the daily pull.

## Portals wired, all checked live 2026-09-22

  amazon       amazon.jobs/en/search.json                      81 seller / 100 jobs
  microsoft    apply.careers.microsoft.com/api/pcsx/search      10 / 10
  nvidia       nvidia.wd5.myworkdayjobs.com CXS (Workday)       50 / 200
  oracle       eeho.fa.us2.oraclecloud.com ORC REST             42 / 200
  google       careers page, AF_initDataCallback data block      3 / 20
  glean        Greenhouse board "gleanwork"                     29 / 125
  voltagepark  kula.ai + Ashby — no open roles, recorded as miss  0

115 seller listings in `listings/portals.json`; 215 rows counted before the
seller-title filter.

## Notes that cost time to find

  - amazon.jobs answers `content-encoding: zstd`, which Node cannot decode, and
    truncates the body at 1024 bytes when it does. Send `accept-encoding: identity`.
  - Workday returns HTTP 400 for `limit` above 20. Page it 20 at a time.
  - Microsoft's old gcsservices host answers 404. The live one is
    `apply.careers.microsoft.com/api/pcsx/search`.
  - `careers.google.com/api/v3/search` is 404. The jobs are server-rendered into
    the results page inside an `AF_initDataCallback({key: 'ds:1'` block.
  - SmartRecruiters and Workable answer 200 with an empty list for names that are
    not really on them, so an empty 200 is not evidence of a feed.
  - Voltage Park links to `jobs.ashbyhq.com/voltagepark.com`, but the Ashby
    posting API is 404 for every slug they use and kula.ai reads "No jobs found".

## Run

  node scripts/scan-portals.mjs
  node scripts/daily-100.mjs --target 100 --where us --out /home/jkw/OmarchyJobs/daily/quality-us.json
  node scripts/verify-daily.mjs /home/jkw/OmarchyJobs/daily/quality-us.json
  node scripts/daily-100.mjs --target 100 --out /home/jkw/OmarchyJobs/daily/quality.json

`--where` picks the location gate:

  boston-remote  Boston, Cambridge, or fully remote. The default. Yields about
                 25 seats on a good day, because Amazon, Oracle, NVIDIA, Google
                 and Microsoft almost never post an AE seat that way.
  us             Anywhere in the United States, foreign countries excluded.
                 Yields 100 from 48 employers, all seven targets among them.

Both gates share one foreign-country test, including the three-letter codes the
portals use ("Canberra, Australian Capital Territory, AUS").