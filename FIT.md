This fork of pinloop-cli is tuned for Jared Werba's AE search. Upstream stays the job board. The overlay is `pinloop fit`.

What it is for
  Quota-carrying Account Executive seats in AI infrastructure and AI-native platforms.
  United States. Boston, New England, or remote-US.
  The shape comes from ~/resumes/resume.md and the tailored AE files in ~/resumes/.
  Forward-deployed and pre-sales files in that folder are not the target.

What it does not do
  It does not invent quota, rank, or deal size. Those stay in the local resume.
  It does not upload anything until `pinloop login` and then `pinloop fit load`.
  `pinloop fit score` is a local screen, not Pinloop's judge.

Commands
  pinloop fit              print the count plan. No network.
  pinloop fit docs         write profile documents under fit/profile/ (gitignored).
  pinloop fit load         upload them after login.
  pinloop fit score        screen Pinloop JSON from stdin.
  pinloop search --json | pinloop fit score

Build
  npm install
  npm run build
  node dist/cli/pinloop.js fit plan

Live counts need an account. Nothing is logged in on this machine yet.
