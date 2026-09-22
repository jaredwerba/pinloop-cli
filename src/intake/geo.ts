/**
 * Geography gate for the intake pipeline: Boston/Cambridge or fully remote
 * (United States), matching the daily list's policy (scripts/daily-100.mjs
 * whereOf). One definition lives here so the fork screens identically no
 * matter which collector produced the row.
 *
 * A row with no location at all is NOT dropped: many boards omit it and the
 * title may still carry the geography ("Account Executive, Boston"). Such
 * rows pass through with where='unknown' so the caller decides.
 *
 * whereOf returns: 'boston' | 'remote' | 'other' | 'unknown'
 */

const FORBIDDEN = /israel|london|paris|tokyo|berlin|dublin|india|germany|canada|singapore/i;
const NON_US =
  /\b(israel|london|paris|tokyo|berlin|dublin|dach|emea|apac|india|germany|uk\b|united kingdom|canada|singapore|australia|france|brazil|japan|ireland|netherlands|spain|mexico|poland|sweden|switzerland|austria|belgium|italy|korea|china|taiwan|hong kong)\b/i;
const US_PLACE =
  /\b(united states|\busa\b|u\.s\.|san francisco|\bsf\b|new york|\bnyc\b|boston|cambridge|chicago|seattle|austin|denver|atlanta|los angeles|california|massachusetts|washington|texas|illinois|colorado|georgia|oregon|virginia|florida|arizona|remote)\b/i;
const TITLE_FOREIGN =
  /\b(latam|mena|emea|apac|portuguese|spanish[- ]speaking|thai|bilingual|dach|japan|korea|china|india|singapore|australia|brazil|mexico|israel|europe|london|paris|berlin|dublin|tokyo)\b/i;

export function whereOf(location: string | string[] | null | undefined): 'boston' | 'remote' | 'other' | 'unknown' {
  const place = (Array.isArray(location) ? location.join(', ') : String(location ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (place === '') return 'unknown';
  if (FORBIDDEN.test(place) || NON_US.test(place)) return 'other';
  if (/\b(boston|cambridge)\b/i.test(place)) return 'boston';
  if (!/\bremote\b/i.test(place) || /\bhybrid\b/i.test(place)) return 'other';
  const leftover = place
    .replace(/\bremote within united states\b/ig, '')
    .replace(/\bremote\s*[-,]?\s*(united states|u\.s\.|usa|us)\b/ig, '')
    .replace(/\bremote\b/ig, '')
    .replace(/\bunited states of america\b/ig, '')
    .replace(/\bunited states\b/ig, '')
    .replace(/\busa\b/ig, '')
    .replace(/[^a-z]/ig, '');
  return leftover === '' ? 'remote' : 'other';
}

/**
 * True when a row may enter the Boston/remote list. Location decides first;
 * a location-less row is kept only when its title names Boston/Cambridge or
 * says remote, and never when the title names another market.
 */
export function passesGeoGate(row: { title?: unknown; locations?: unknown; location?: unknown; workplace?: unknown }): boolean {
  const title = String(row?.title ?? '');
  if (TITLE_FOREIGN.test(title)) return false;
  if (/\bboston\b|\bcambridge\b/i.test(title)) return true;
  const where = whereOf((row?.locations as string[] | undefined) ?? (row?.location as string | undefined) ?? null);
  if (where === 'boston' || where === 'remote') return true;
  if (where === 'unknown') {
    // no location stored: fall back to the workplace label, then to a
    // remote-mention in the title. ONSITE with no location is not provably
    // Boston/remote, so it is out.
    const workplace = String(row?.workplace ?? '');
    if (/remote/i.test(workplace)) return true;
    return /\bremote\b/i.test(title);
  }
  return false;
}
