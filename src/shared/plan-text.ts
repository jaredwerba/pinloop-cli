/**
 * Every sentence Pinloop says about what the free plan gives, what Pro gives,
 * and what Pro costs a month, plus the one shape that tells a coding agent to
 * read a sentence out to the person word for word.
 *
 * Why one file. Until 2026-09-14 nothing Pinloop printed named an amount of
 * money at all, so a person who ran out of postings read a refusal that told
 * them what had stopped and nothing about what would un-stop it. Andrew narrowed
 * that rule on 2026-09-14: nothing printed ever names what a run cost Pinloop in
 * model spend, and the one figure "$20 a month" is allowed in a sentence that
 * offers Pro. Every sentence written under the narrowed rule lives here, so
 * there is one file to read when the rule is checked and one file to change when
 * a number moves.
 *
 * Two rules hold every quoted sentence below, both Andrew's, both from
 * 2026-09-14.
 *
 * The first is that a sentence written for the person names no command. The
 * person does not have to know that commands exist: they talk to a coding agent
 * and the agent types. So a sentence a person hears says what they can say out
 * loud — "say 'upgrade Pinloop' and I will open the page" — and the command
 * itself sits outside the quotes, in the half addressed to the agent.
 *
 * The second is that no number stands on its own and the free number never
 * appears without the Pro number and the price beside it. "10 postings instead
 * of the usual 5" reads to somebody who has never used Pinloop as though the
 * whole product hands over five things a day. So every number says what it
 * counts — job postings you have not seen before — and every sentence naming the
 * free number names what Pro gives and what Pro costs in the same breath.
 */

import type { Period } from './postings-text.ts';

// ---------------------------------------------------------------------------
// The shape of what the server sends
// ---------------------------------------------------------------------------

/** The word that stands where a number would be for a count with no limit. */
export const NO_MONTHLY_LIMIT = 'unlimited';

/** What one plan allows, in the six numbers every sentence below is built from. */
export type PlanNumbers = {
  /** Job postings this plan may be handed, over the stretch of time below. */
  postings: number;
  /** Whether that number covers one day measured in UTC or one Stripe month. */
  postingsPeriod: Period;
  /** Postings an AI model may screen quickly in one month. */
  quickJudgments: number;
  /** Postings an AI model may read in full in one month. */
  fullJudgments: number;
  /** Searches by meaning in one month, or the word for having no limit. */
  semantic: number | typeof NO_MONTHLY_LIMIT;
  /** Times a day this plan may go out and collect postings. */
  pullsPerDay: number;
  /** Times a day this plan may ask how many postings match. */
  countsPerDay: number;
  /** Saved routines this plan may have running with nobody at the keyboard. */
  routines: number;
};

/**
 * Both plans' numbers and what Pro costs a month, as the server sends them.
 *
 * The server sends this only to an account that could actually buy Pro: an
 * account on the free plan that is not the owner account. An account that
 * already pays, and the owner account, are sent nothing, and every sentence
 * builder below prints no offer when it is handed nothing. That is what stops a
 * paying account being told to upgrade, which is what src/core/judge.ts did
 * until 2026-09-14.
 */
export type ProOffer = {
  /** What Pro costs a month, in whole dollars. */
  priceUsd: number;
  free: PlanNumbers;
  pro: PlanNumbers;
};

/** One plan's numbers read back out of an answer, or nothing when they are missing. */
function planFrom(value: unknown): PlanNumbers | undefined {
  const held = (value ?? {}) as Record<string, unknown>;
  const postings = Number(held['postings']);
  if (!Number.isFinite(postings)) return undefined;
  const semantic = held['semantic'];
  return {
    postings,
    postingsPeriod: held['postings_period'] === 'day' ? 'day' : 'month',
    quickJudgments: Number(held['quick_judgments'] ?? 0),
    fullJudgments: Number(held['full_judgments'] ?? 0),
    semantic: Number.isFinite(Number(semantic)) ? Number(semantic) : NO_MONTHLY_LIMIT,
    pullsPerDay: Number(held['pulls_per_day'] ?? 0),
    countsPerDay: Number(held['counts_per_day'] ?? 0),
    routines: Number(held['routines'] ?? 0),
  };
}

/**
 * Reads the offer back out of whatever the server sent, or answers nothing.
 *
 * Nothing is the ordinary answer in three cases: this account already pays, this
 * account is the owner account, or the server answering is older than this
 * change and sends no such field. All three print no offer, which is what an
 * account with nothing to buy should read.
 */
export function proOfferFrom(value: unknown): ProOffer | undefined {
  const held = (value ?? {}) as Record<string, unknown>;
  const priceUsd = Number(held['price_usd']);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return undefined;
  const free = planFrom(held['free']);
  const pro = planFrom(held['pro']);
  if (free === undefined || pro === undefined) return undefined;
  return { priceUsd, free, pro };
}

// ---------------------------------------------------------------------------
// The one shape that makes a sentence reach the person
// ---------------------------------------------------------------------------

/**
 * The words that open the last paragraph of any line carrying something the
 * person has to hear (Andrew, 2026-09-14).
 *
 * A coding agent reading a hundred lines of postings output has to be able to
 * find the sentence without reading a paragraph, which is the same reason the
 * line saying a message from Andrew is waiting is kept to one recognisable
 * shape. Everything inside the double quotes is said to the person exactly as
 * printed. Everything outside them is for the agent and is never read aloud.
 */
export const RELAY_OPENING = 'Tell the person now, word for word: ';

/**
 * The relay paragraph: a blank line, the opening above, the sentence in double
 * quotes, and, on the line under it, whatever the agent itself is being told to
 * do.
 */
export function relayParagraph(sentence: string, agentNote?: string): string {
  const note = agentNote === undefined ? '' : `\n${agentNote}`;
  return `\n\n${RELAY_OPENING}"${sentence}"${note}`;
}

/**
 * The sentence back out of a line that carries one, so a run asked for
 * machine-readable output can put the identical words in a field of its own
 * rather than dropping them (Andrew, 2026-09-14).
 *
 * With --json the human-readable line is never printed at all, so an agent
 * piping JSON used to see no sentence anywhere. Reading the sentence back out of
 * the built line, rather than building it a second time, is what makes the two
 * copies unable to drift apart.
 */
export function relayedSentence(line: string | undefined): string | undefined {
  if (typeof line !== 'string') return undefined;
  const at = line.indexOf(RELAY_OPENING);
  if (at < 0) return undefined;
  const rest = line.slice(at + RELAY_OPENING.length);
  if (!rest.startsWith('"')) return undefined;
  const ends = rest.indexOf('"', 1);
  if (ends < 0) return undefined;
  return rest.slice(1, ends);
}

// ---------------------------------------------------------------------------
// The pieces every offer sentence is built out of
// ---------------------------------------------------------------------------

/** A whole number written the way a person reads one. */
function withCommas(value: number): string {
  return Number(value).toLocaleString('en-US');
}

/** "11th", "51st": which try today this one was. */
function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${withCommas(value)}th`;
  const last = value % 10;
  const ending = last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
  return `${withCommas(value)}${ending}`;
}

/**
 * What the person can say out loud to get the page opened, which is the ending
 * every offer sentence has. It names no command, because the person talks and
 * the agent types (Andrew, 2026-09-14).
 */
const THE_ASK = "If you want Pro, say 'upgrade Pinloop' and I will open the page.";

/** What the agent does after it has said the sentence. */
export const OPEN_THE_PAGE = 'Run `pinloop upgrade` when they say yes.';

/**
 * "1,500 job postings a month you have not seen before, for $20": Pro's postings
 * number, what that number counts, and the price, in one clause.
 *
 * It is one clause rather than three sentences because the price and the number
 * have to be read together to be worth anything, and because a person who reads
 * "1,500" without reading "you have not seen before" beside it has been told a
 * number that means nothing.
 */
function proPostings(offer: ProOffer): string {
  const per = offer.pro.postingsPeriod === 'day' ? 'a day' : 'a month';
  return (
    `Pro is ${withCommas(offer.pro.postings)} job postings ${per} you have not seen ` +
    `before, for $${offer.priceUsd} a month`
  );
}

/** "the free plan gives you 5 job postings a day you have not seen before". */
function freePostings(offer: ProOffer): string {
  const per = offer.free.postingsPeriod === 'day' ? 'a day' : 'a month';
  return (
    `the free plan gives you ${withCommas(offer.free.postings)} job postings ${per} ` +
    `you have not seen before`
  );
}

/** The sentence that stops a person reading their own history as a cost. */
const ALREADY_SEEN_IS_FREE =
  'Anything you have already been shown stays free to read, however often.';

// ---------------------------------------------------------------------------
// One function per moment, each answering the exact sentence to say
// ---------------------------------------------------------------------------

/** A search that handed back fewer postings than a page because the day ran out. */
export function searchWasTrimmedSentence(
  offer: ProOffer,
  showing: number,
  matching: number,
): string {
  return (
    `That search matched ${withCommas(matching)} job postings and showed you ` +
    `${withCommas(showing)} of them, because ${freePostings(offer)} and ` +
    `${withCommas(showing)} was all that was left today. ${proPostings(offer)}. ` +
    `${ALREADY_SEEN_IS_FREE} ${THE_ASK}`
  );
}

/** A search or a pull refused because the day's postings are used up. */
export function notEnoughPostingsSentence(
  offer: ProOffer,
  needed: number,
  left: number,
): string {
  return (
    `That needed ${withCommas(needed)} job postings you have not seen before, and ` +
    `${freePostings(offer)}, so only ${withCommas(left)} were left today. ` +
    `${proPostings(offer)}. ${ALREADY_SEEN_IS_FREE} ${THE_ASK}`
  );
}

/** The last of the day's postings has just gone, on a search or a pull. */
export function lastPostingUsedSentence(offer: ProOffer): string {
  return (
    `That used the last of today's ${withCommas(offer.free.postings)}. ` +
    `${freePostings(offer)}. ${ALREADY_SEEN_IS_FREE} ${proPostings(offer)}. ${THE_ASK}`
  );
}

/** The same, on a pull, which can also say how many matched in all. */
export function pullUsedTheLastSentence(
  offer: ProOffer,
  pulled: number,
  matching: number,
): string {
  const wouldFit =
    matching > pulled && matching <= offer.pro.postings
      ? `, so all ${withCommas(matching)} of those would fit in one go`
      : '';
  return (
    `That brought back ${withCommas(pulled)} of the ${withCommas(matching)} job postings ` +
    `that matched, and it used the last of today's ${withCommas(offer.free.postings)}. ` +
    `${freePostings(offer)}. ${proPostings(offer)}${wouldFit}. ${THE_ASK}`
  );
}

/** The day's collecting runs are used up. */
export function tooManyPullsSentence(offer: ProOffer): string {
  return (
    `I have gone out and collected new job postings for you ` +
    `${withCommas(offer.free.pullsPerDay)} times today, which is what the free plan allows ` +
    `in a day. Pro allows ${withCommas(offer.pro.pullsPerDay)} a day, and ` +
    `${withCommas(offer.pro.postings)} job postings a month you have not seen before, for ` +
    `$${offer.priceUsd} a month. ${THE_ASK}`
  );
}

/** The day's match counts are used up. */
export function tooManyCountsSentence(offer: ProOffer): string {
  return (
    `I have asked Pinloop how many job postings match you ` +
    `${withCommas(offer.free.countsPerDay)} times today, which is what the free plan allows ` +
    `in a day. Asking takes none of your own postings: it is how I narrow a search before ` +
    `showing you anything. Pro allows ${withCommas(offer.pro.countsPerDay)} of those a day, ` +
    `for $${offer.priceUsd} a month. ${THE_ASK}`
  );
}

/** A run stopped to ask first, on an account that could not afford it anyway. */
export function cannotRunOnFreeSentence(offer: ProOffer, wouldTake: number): string {
  return (
    `That would need ${withCommas(wouldTake)} job postings you have not seen before, and ` +
    `${freePostings(offer)}, so it cannot run today. ${proPostings(offer)}. ${THE_ASK}`
  );
}

/** The month's judging is used up. */
export function judgingUsedUpSentence(offer: ProOffer, resetsOn: string): string {
  return (
    `An AI model has read ${withCommas(offer.free.quickJudgments)} job postings against your ` +
    `profile this month, which is what the free plan gives, and that returns to full on ` +
    `${resetsOn}. Pro gives ${withCommas(offer.pro.quickJudgments)} of those for ` +
    `$${offer.priceUsd} a month, which is ${withCommas(offer.pro.fullJudgments)} postings ` +
    `read in full or ${withCommas(offer.pro.quickJudgments)} screened quickly. ${THE_ASK}`
  );
}

/** Some of the month is left, but not enough to read one posting in full. */
export function noFullJudgmentsLeftSentence(offer: ProOffer, quickLeft: number): string {
  const screens = quickLeft === 1 ? '1 quick screen' : `${withCommas(quickLeft)} quick screens`;
  return (
    `This month's full readings are used up: the free plan gives ` +
    `${withCommas(offer.free.fullJudgments)} job postings read in full by an AI model, and ` +
    `you have ${screens} left. Pro gives ${withCommas(offer.pro.fullJudgments)} full readings ` +
    `a month, for $${offer.priceUsd} a month. ${THE_ASK}`
  );
}

/** A judging run read some of its postings and then ran out of the month. */
export function judgingStoppedPartWaySentence(
  offer: ProOffer,
  judged: number,
  asked: number,
): string {
  return (
    `An AI model read ${withCommas(judged)} of those ${withCommas(asked)} job postings and ` +
    `then stopped, because the free plan gives ${withCommas(offer.free.fullJudgments)} read ` +
    `in full a month and they are used up. Pro gives ` +
    `${withCommas(offer.pro.fullJudgments)} a month, for $${offer.priceUsd} a month. ${THE_ASK}`
  );
}

/** The month's searches by meaning are used up. */
export function semanticUsedUpSentence(offer: ProOffer): string {
  const proSide =
    offer.pro.semantic === NO_MONTHLY_LIMIT
      ? `Pro has no monthly limit on them at all, for $${offer.priceUsd} a month`
      : `Pro gives ${withCommas(Number(offer.pro.semantic))} a month, for ` +
        `$${offer.priceUsd} a month`;
  return (
    `You have run ${withCommas(Number(offer.free.semantic))} searches by meaning this month, ` +
    `which is what the free plan gives. A search by meaning finds job postings that mean the ` +
    `same thing as what you asked for rather than ones carrying the same words. ` +
    `${proSide}. ${THE_ASK}`
  );
}

/** Saving a schedule, which the free plan cannot do at all. */
export function schedulesArePaidSentence(offer: ProOffer, everyHours: number): string {
  return (
    `Saving a schedule needs Pro, which is $${offer.priceUsd} a month. It lets Pinloop run ` +
    `this saved piece of work on its own servers as often as every ${everyHours} hours while ` +
    `you are away, and you can have ${withCommas(offer.pro.routines)} of those running at ` +
    `once. For now I can run it for you whenever you ask. ${THE_ASK}`
  );
}

/** Saving a watch, which the free plan cannot do at all. */
export function watchesArePaidSentence(offer: ProOffer, everyHours: number): string {
  return (
    `Saving a watch needs Pro, which is $${offer.priceUsd} a month. A watch looks every ` +
    `${everyHours} hours for job postings that arrived since it last looked and runs this ` +
    `saved piece of work over just those, so you stop missing new ones, and you can have ` +
    `${withCommas(offer.pro.routines)} of those running at once. For now I can run it for ` +
    `you whenever you ask. ${THE_ASK}`
  );
}

// ---------------------------------------------------------------------------
// The two moments the person reads for themselves rather than hearing relayed
// ---------------------------------------------------------------------------

/**
 * The one line the bare `pinloop` command prints under this account's own
 * numbers, for an account that could buy Pro.
 *
 * This output is the one thing in the product written for the person rather than
 * for the coding agent, so it is printed rather than relayed, and it names no
 * command for the same reason every relayed sentence does not.
 */
export function proSummaryLine(offer: ProOffer): string {
  const meaning =
    offer.pro.semantic === NO_MONTHLY_LIMIT
      ? `searches by meaning with no monthly limit instead of ${offer.free.semantic} a month`
      : `${withCommas(Number(offer.pro.semantic))} searches by meaning a month instead of ` +
        `${offer.free.semantic}`;
  return (
    `Pro is $${offer.priceUsd} a month: ${withCommas(offer.pro.postings)} job postings a ` +
    `month you have not seen before instead of the free plan's ` +
    `${withCommas(offer.free.postings)} a day, ${withCommas(offer.pro.fullJudgments)} ` +
    `postings read in full by an AI model each month instead of ` +
    `${withCommas(offer.free.fullJudgments)}, ${meaning}, and saved work that runs on ` +
    `Pinloop's servers while you are away instead of none. Say 'upgrade Pinloop' to your ` +
    `coding agent and it will open the page.`
  );
}

/**
 * The comparison `pinloop upgrade` prints above the address it opens, for an
 * account that is not already paying.
 *
 * Every line of it names the free number beside the Pro number, because the
 * whole point of the block is a person deciding, and a column of Pro numbers
 * with nothing to read them against decides nothing.
 */
export function proComparisonBlock(offer: ProOffer): string {
  const meaning =
    offer.pro.semantic === NO_MONTHLY_LIMIT
      ? `searches by meaning with no monthly limit, instead of ${offer.free.semantic} a month`
      : `${withCommas(Number(offer.pro.semantic))} searches by meaning a month, instead of ` +
        `${offer.free.semantic}`;
  const lines = [
    `Pro is $${offer.priceUsd} a month. Against the free plan:`,
    `  ${withCommas(offer.pro.postings)} job postings a month you have not seen before, ` +
      `instead of ${withCommas(offer.free.postings)} a day`,
    `  ${withCommas(offer.pro.fullJudgments)} job postings read in full by an AI model each ` +
      `month, or ${withCommas(offer.pro.quickJudgments)} screened quickly, instead of ` +
      `${withCommas(offer.free.fullJudgments)} and ${withCommas(offer.free.quickJudgments)}`,
    `  ${meaning}`,
    `  ${withCommas(offer.pro.pullsPerDay)} times a day your coding agent can go out and ` +
      `collect new postings, instead of ${withCommas(offer.free.pullsPerDay)}`,
    `  ${withCommas(offer.pro.countsPerDay)} times a day it can ask how many postings match ` +
      `you, instead of ${withCommas(offer.free.countsPerDay)}`,
    `  up to ${withCommas(offer.pro.routines)} saved pieces of work running on Pinloop's ` +
      `servers while you are away, instead of none`,
    `Anything you have already been shown stays free to read on either plan, however often.`,
  ];
  return `${lines.join('\n')}\n`;
}

/** The sentence a coding agent says out loud when it opens the upgrade page. */
export function proOfferSpokenSentence(offer: ProOffer): string {
  const meaning =
    offer.pro.semantic === NO_MONTHLY_LIMIT
      ? 'searches by meaning with no monthly limit'
      : `${withCommas(Number(offer.pro.semantic))} searches by meaning a month`;
  return (
    `Pro is $${offer.priceUsd} a month. It gives you ${withCommas(offer.pro.postings)} job ` +
    `postings a month you have not seen before instead of the free plan's ` +
    `${withCommas(offer.free.postings)} a day, ${withCommas(offer.pro.fullJudgments)} ` +
    `postings read in full by an AI model each month instead of ` +
    `${withCommas(offer.free.fullJudgments)}, ${meaning}, and up to ` +
    `${withCommas(offer.pro.routines)} saved pieces of work that run on Pinloop's servers ` +
    `while you are away. Here is the page.`
  );
}

// ---------------------------------------------------------------------------
// The first day, which nothing in the product mentioned until 2026-09-14
// ---------------------------------------------------------------------------

/** Which of the two first days this is, as the server names it. */
export type FirstDay = 'new-account' | 'new-version';

/**
 * What the person hears on either of the two days their account is handed more
 * job postings than usual: the day the account is created, and the first day it
 * is seen running a version line it has never run before.
 *
 * Until 2026-09-14 nothing anywhere said this rule existed. The account
 * silently had ten, then silently had five, and the drop was the sharpest
 * disappointment in the free experience with no sentence attached to it.
 */
export function firstDaySentence(
  offer: ProOffer,
  which: FirstDay,
  today: number,
): string {
  const why =
    which === 'new-version'
      ? 'Because you updated, today'
      : 'Because today is your first day with Pinloop, today';
  return (
    `${why} I can show you ${withCommas(today)} job postings you have not seen before, ` +
    `instead of the free plan's usual ${withCommas(offer.free.postings)} a day. ` +
    `${proPostings(offer)}. Asking how many postings match you takes none of those, and ` +
    `anything you have already been shown stays free to read, so a good first ask is ` +
    `something like "how many software engineering internships in the US were posted in the ` +
    `last month?" and then "show me the ${withCommas(today)} that fit me best".`
  );
}

/** The line printed above that sentence, which is the agent's half of it. */
export function firstDayLine(which: FirstDay, today: number, ordinary: number): string {
  const why =
    which === 'new-version'
      ? 'this is the first day this account has run this version of Pinloop'
      : 'this is the day this account was created';
  return (
    `Today this account may be handed ${withCommas(today)} postings rather than the usual ` +
    `${withCommas(ordinary)}, because ${why}. Tomorrow it is ` +
    `${withCommas(ordinary)} again.`
  );
}

/** "11th", "51st": which try today a refused one was. */
export function tryNumber(limit: number): string {
  return ordinal(limit + 1);
}
