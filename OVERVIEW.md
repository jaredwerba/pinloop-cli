Project overview
22 September 2026

1. Purpose

This project finds account executive jobs for one person.
The person works in Boston.
The project keeps a job only when the job is in Boston or fully remote in the United States.
The project shows those jobs on one page.
The page does not divide the jobs into groups.

2. Parts

The project has 4 parts.

The pinloop command reads the Pinloop job service.
The free account can take 5 new jobs each day from that service.
The first day on this version gave 10 jobs.
The client cannot change that limit.

The daily search reads public company job boards.
The daily search does not use the Pinloop daily limit.

The page address is omarchy-jobs.vercel.app.
The page shows one list of jobs.

Neon Postgres keeps each run by date.
A later run adds new jobs.
A later run does not delete jobs from an earlier date.
The same job address keeps the first date.

3. Work from agent 2

Agent 2 added a third public board type.
The board type is Lever.
The board file now has 85 live boards.
The count is 53 Greenhouse boards, 28 Ashby boards, and 4 Lever boards.

Agent 2 added loaders for 7 employer career sites.
The employers are Amazon, Microsoft, NVIDIA, Oracle, Google, Glean, and Voltage Park.
On 22 September 2026, Voltage Park had no open jobs.
The other 6 sites returned 215 seller jobs.

Agent 2 added a location control.
The default control keeps Boston jobs and fully remote jobs in the United States.
The wide control keeps jobs in the United States.
The wide control still rejects jobs in other countries.
A test of the wide control returned 100 jobs from 48 employers.

Agent 2 added an apply queue for a coding agent.
The queue gives one job packet to one agent.
The packet has the form fields and the answers.
The queue does not send the application.
The agent must do that step.
A test run queued 98 jobs.
The test did not send an application.

4. Work from agent 3

Agent 3 added tests for the fit commands.
The test count at the end of the work was 54.
All 54 tests passed.

Agent 3 removed private figures from the profile text.
The figures included pay, quota, rank, and award names.
The profile files stay off the public repository.

Agent 3 added a local intake store.
The store reads Greenhouse, Lever, and Ashby boards.
One board error does not stop the run.
One live run stored 4117 jobs.

Agent 3 found a location error in the Greenhouse reader.
The reader did not read the location name.
2788 Greenhouse rows had no location.
Agent 3 corrected the reader.
Agent 3 restored locations on 2776 stored rows.

Agent 3 added a Boston and remote gate.
The gate blocks a job brief for a job in another city.
On 22 September 2026 the gate left 4 strong jobs for a resume brief.

Agent 3 added commands for a job brief, an applied mark, an external score, and store cleanup.

5. Current page

The page shows 16 jobs from 22 September 2026.
4 jobs are in Boston.
12 jobs are fully remote in the United States.
The page is one list.
Each row shows the date, the employer, and the location.

6. Limits

The Pinloop service sets the free daily limit.
This repository cannot raise that limit.
A Boston and remote search does not return 100 jobs each day.
On 22 September 2026 that search returned 16 jobs.
A wider United States search can return 100 jobs.
The wider search includes jobs that are not in Boston.
The wider search includes jobs that are not fully remote.

7. How to run the daily search

Do this procedure to collect jobs and keep earlier jobs.

1. Go to the pinloop-cli directory.
2. Run the daily search.
3. Give the command an output file.
4. The command writes the file.
5. The command saves the new jobs in Neon Postgres.
6. Open the page omarchy-jobs.vercel.app.
7. Read the full list.
8. Confirm that jobs from earlier dates remain on the page.
