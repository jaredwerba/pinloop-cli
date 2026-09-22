import { readFileSync } from 'node:fs';

const path = process.argv[2] || '/home/jkw/OmarchyJobs/daily/quality-us.json';
const report = JSON.parse(readFileSync(path, 'utf8'));
const jobs = report.jobs;

const FOREIGN = /\b(israel|london|paris|tokyo|berlin|dublin|india|germany|canada|singapore|australia|france|brazil|japan|ireland|netherlands|spain|mexico|poland|sweden|switzerland|austria|belgium|italy|korea|china|taiwan|hong kong|AUS|BRA|MYS|DEU|CAN|GBR|IND|SGP|JPN|CHN|MEX|KOR|TWN|ISR|FRA|NLD|ESP|ITA|POL|SWE|CHE|AUT|BEL|DNK|NOR|FIN|PRT|IRL|NZL|ZAF|ARG|CHL|COL|PER|THA|VNM|IDN|PHL|TUR|EGY|NGA|KEN|SAU|ARE|CZE|HUN|ROU|GRC|UKR|RUS)\b/i;
const BLOCKED = /\b(intern|sdr|bdr|sales development|campus|co-?op|technical account manager)\b/i;
const INFRA = /\b(cloud|gpu|iaas|paas|hyperscale|data center|kubernetes|ai)\b/i;

const wrong = jobs.filter((j) => FOREIGN.test(j.location || ''));
const blocked = jobs.filter((j) => BLOCKED.test(j.title));
const badStrong = jobs.filter((j) => j.screen === 'strong' && !INFRA.test(j.title));
const noUrl = jobs.filter((j) => !j.url);
const dupes = jobs.length - new Set(jobs.map((j) => j.url)).size;
const counts = new Map();
for (const j of jobs) counts.set(j.company, (counts.get(j.company) ?? 0) + 1);
const over = [...counts.entries()].filter(([, n]) => n > 8);

console.log('file            ', path);
console.log('count           ', jobs.length, '| field check:', ['title','company','location','url','screen','posted'].every((k) => k in jobs[0]) ? 'ok' : 'MISSING');
console.log('where mode      ', report.where);
console.log('companies       ', counts.size, '| max per company:', Math.max(...counts.values()));
console.log('strong/fair     ', report.strong, '/', report.fair, '| undated:', report.undated);
console.log('boards hit/miss ', (report.boardsHit||[]).length, '/', (report.boardsMissed||[]).length);
console.log('portals hit/miss', (report.portalsHit||[]).length, '/', (report.portalsMissed||[]).length, report.portalsMissed);
console.log('foreign leaks   ', wrong.length, wrong.slice(0, 4).map((j) => `${j.company} :: ${j.location}`));
console.log('blocked titles  ', blocked.length, blocked.slice(0, 4).map((j) => j.title));
console.log('bad strong      ', badStrong.length, badStrong.slice(0, 3).map((j) => j.title));
console.log('missing url     ', noUrl.length, '| duplicate url:', dupes);
console.log('over 8/company  ', over.length, over.slice(0, 5));
console.log('');
console.log('employers present:');
for (const [company, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(2)}  ${company}`);
}
const pass = jobs.length === 100 && wrong.length === 0 && blocked.length === 0 && badStrong.length === 0 && noUrl.length === 0 && dupes === 0 && over.length === 0 && counts.size >= 15;
console.log('\nVERDICT:', pass ? 'PASS' : 'FAIL');