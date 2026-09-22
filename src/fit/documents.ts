/**
 * Profile documents Pinloop judge reads.
 *
 * background is built from the local resume at runtime and is never embedded
 * here. The texts below name no phone number and no dollar figure. The public
 * fork can carry them. The resume cannot.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { TARGET_EMPLOYERS } from './rubric.ts';

export const RESUME_PATH_ENV = 'PINLOOP_RESUME';

export type FitDocument = {
  /** Legal Pinloop document name: lowercase, digits, dashes, 1-40 chars. */
  name: string;
  text: string;
};

const PHONE = /\(\d{3}\)\s*\d{3}-\d{4}/g;
/** Dollar figures, quota percentages, and rank lines stay in the local resume. */
const DOLLAR = /\$\s*[\d,.]+\s*(?:K|M|MM|B|USD|ARR|annual(?:ly)?|pipeline)?\b/gi;
const QUOTA_PCT = /\b\d{1,3}(?:\.\d)?\s?%\s*(?:of\s*)?quota\b/gi;
const PERCENT = /\b\d{1,3}(?:\.\d)?\s?%/g;
const RANK = /\btop\s*\d+\s*(?:of|out of)\s*[\d,]+/gi;
const CLUB = /(?:2\s*[×x]\s*)?president['’]s?\s+club(?:\s*\(fy\d{2}(?:,\s*fy\d{2})*\))?/gi;

export function backgroundFromResume(markdown: string): string {
  const withoutBlocks = markdown
    .replace(/\[GROKBOT[\s\S]*?\[GROKBOT_OUTPUT\]/g, '')
    .replace(/\[GROKBOT[^\]]*\][^\n]*/g, '');
  return withoutBlocks
    .replace(PHONE, '[phone omitted]')
    .replace(DOLLAR, '[figure omitted]')
    .replace(QUOTA_PCT, '[quota omitted]')
    .replace(PERCENT, '[percent omitted]')
    .replace(RANK, '[rank omitted]')
    .replace(CLUB, '[recognition omitted]')
    .trim() + '\n';
}

export function defaultResumePath(): string {
  const override = process.env[RESUME_PATH_ENV];
  if (override && override !== '') return override;
  return join(homedir(), 'resumes', 'resume.md');
}

export function readBackground(resumePath: string = defaultResumePath()): string {
  let markdown: string;
  try {
    markdown = readFileSync(resumePath, 'utf8');
  } catch {
    throw new Error(
      `no resume at ${resumePath}. Set ${RESUME_PATH_ENV} to the AE master, ` +
        'or restore ~/resumes/resume.md. Nothing was invented in its place.',
    );
  }
  const text = backgroundFromResume(markdown);
  if (text.trim() === '') {
    throw new Error(`resume at ${resumePath} was empty after the instruction blocks were removed`);
  }
  return text;
}

export function fitDocuments(background: string): FitDocument[] {
  const employers = TARGET_EMPLOYERS.join(', ');
  return [
    {
      name: 'constraints',
      text:
        'Work location: United States. Boston, greater Boston, New England, and remote-US are in. ' +
        'A posting whose stored country is not the United States is out, unless its own workplace ' +
        'field says remote and the posting is explicit that the role can be done from the United States.\n' +
        'Employment: full time. Intern, new grad, campus, co-op, SDR, and BDR are out.\n' +
        'Do not reject a posting for work authorization, visa, or degree year. Those facts are not ' +
        'in this profile. Say the requirement is unverified instead of inventing a status.\n' +
        'Do not reject a posting for pay. No compensation floor is stored here.\n' +
        'Do not treat a missing quota figure in the posting as a reason to say no.\n',
    },
    {
      name: 'background',
      text: background,
    },
    {
      name: 'preferences',
      text:
        'Primary seat: quota-carrying Account Executive, Strategic Account Executive, Enterprise ' +
        'Account Executive, or Commercial Account Executive selling AI infrastructure or AI-native platforms.\n' +
        'Geography: Boston or remote in the United States. East Coast and New England offices are in. ' +
        'A hybrid Boston office is in. An on-site role in another US city is fair, not strong, unless ' +
        'the title is otherwise the primary seat.\n' +
        'Motion: hunter / net-new and land-and-expand are both in. Financial services, healthcare and ' +
        'life sciences, and ISV are familiar verticals, not requirements.\n' +
        'Not the target: software engineer, forward deployed engineer, pre-sales systems engineer, ' +
        'customer success, recruiting, or SDR. Technical depth is a wedge for AE seats, not a pivot ' +
        'into an individual-contributor engineering job.\n' +
        'Language rule for any text you write about this person: he sold against AWS, Azure, and GCP. ' +
        'Never write that he sold those products. Oracle ended in 2026. Never write Present for it.\n' +
        'Do not invent quota, rank, deal size, CRM, or graduation year. If a number is not in the ' +
        'background document, leave it out.\n',
    },
    {
      name: 'target-employers',
      text:
        'Employers already in the local application set, plus infrastructure sellers the same motion ' +
        `maps onto. A posting at one of these is not automatically strong. The title still has to be a seller seat.\n\n${employers}\n`,
    },
    {
      name: 'judge-prompt',
      text:
        'You are judging one job posting against Jared Werba, for a fork of Pinloop tuned to AE seats.\n' +
        '\n' +
        'You are given the complete stored posting, then every document in the profile, each labelled ' +
        'with the name it is stored under.\n' +
        '\n' +
        '- constraints: rules that cannot be broken. If the posting breaks one, the verdict is `no`, ' +
        'and the reasoning names the rule.\n' +
        '- background: what he has done. Use only what is written there. Do not add quota, rank, ' +
        'deal size, employers, or dates that the document does not contain.\n' +
        '- preferences: what he wants. The primary seat is a quota-carrying account executive for AI ' +
        'infrastructure or AI-native platforms, United States, Boston or remote-US.\n' +
        '- target-employers: a list, not a guarantee. Title still decides.\n' +
        '- resume: the PDF, when one is attached. If none is attached, judge from the text documents. ' +
        'Do not pretend a resume was read.\n' +
        '\n' +
        'He sold against AWS, Azure, and GCP. A posting at those companies can still be a fit. ' +
        'Do not require him to have carried their quota, and do not describe him as having sold their products.\n' +
        '\n' +
        'Give one verdict, exactly one of these four words:\n' +
        '\n' +
        '- `no`: a constraint is broken, or the posting is intern, SDR, engineering IC, or otherwise ' +
        'not a seller seat.\n' +
        '- `weak`: a seller-adjacent seat (pre-sales, forward deployed, customer success, unrelated SaaS AE) ' +
        'he could apply to and should not prioritize.\n' +
        '- `fair`: a real AE seat with a clear gap (wrong vertical, wrong city with no remote, product he ' +
        'has not sold, experience band 2-5).\n' +
        '- `strong`: quota-carrying AE or account manager for cloud, GPU, AI infrastructure, or an ' +
        'AI-native platform, United States, and the posting is what the preferences ask for.\n' +
        '\n' +
        'Then give the reasoning in plain sentences he can act on. Grade honestly. A strong verdict ' +
        'with no title match is a wrong verdict.\n' +
        '\n' +
        'Answer only in the shape you were given.\n',
    },
    {
      name: 'quick-judge-prompt',
      text:
        'You are screening job postings against Jared Werba. You see only the stored facts: title, ' +
        'employer, locations, countries, employment label, workplace, pay if any, and posted date. ' +
        'You do not see the job description. Do not guess at requirements you cannot read.\n' +
        '\n' +
        'Read the profile documents. constraints break a posting into `no`. preferences say the target ' +
        'is a US account-executive seat in AI infrastructure or AI-native platforms, Boston or remote-US.\n' +
        '\n' +
        'Never call a posting remote unless its own workplace field says remote. Check location against ' +
        'that posting only.\n' +
        '\n' +
        'One verdict per posting id, exactly one of `no`, `weak`, `fair`, `strong`.\n' +
        '\n' +
        '- `no`: intern, SDR/BDR, not United States, or nothing to do with a seller seat.\n' +
        '- `weak`: the facts point away (engineering IC, pre-sales, unrelated employer and title).\n' +
        '- `fair`: worth reading. Seller title, or a target employer, and nothing rules it out.\n' +
        '- `strong`: seller title plus cloud, AI, GPU, or infrastructure in the title, or a seller title ' +
        'at an employer named in target-employers, and the country is United States or unstated.\n' +
        '\n' +
        '`fair` means worth a real look, not worth an application. One or two sentences each. ' +
        'A screen that calls everything strong has told him nothing.\n',
    },
  ];
}
