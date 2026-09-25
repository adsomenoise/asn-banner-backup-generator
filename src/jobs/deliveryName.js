import path from 'path';

export const DEFAULT_DELIVERY_TIMEZONE = 'Europe/Brussels';

const SEPARATOR_RE = /[-_. ]/;
// Characters that are unsafe in a download filename on common filesystems.
// eslint-disable-next-line no-control-regex
const UNSAFE_RE = /[/\\:*?"<>|\x00-\x1f]/g;

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function getDeliveryTimeZone(env = process.env) {
  const tz = env.DELIVERY_TIMEZONE;
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_DELIVERY_TIMEZONE;
}

/**
 * The shared start of all filenames (extensions dropped), cut back to a whole
 * separator-delimited segment and without trailing separators:
 *   tel-...-display-970x250-nl, tel-...-display-320x480-nl → tel-...-display
 *   banner-300x250, banner-300x600                         → banner (not banner-300x)
 * A single name (or identical names) is returned whole. Returns '' when the
 * names share nothing.
 */
export function commonDenominator(fileNames) {
  const names = fileNames.map(n => path.parse(path.basename(n)).name).filter(Boolean);
  if (names.length === 0) return '';

  let prefix = names[0];
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++;
    prefix = prefix.slice(0, i);
  }

  const endsOnBoundary = names.every(n => n.length === prefix.length || SEPARATOR_RE.test(n[prefix.length]))
    || SEPARATOR_RE.test(prefix[prefix.length - 1] || '');
  if (!endsOnBoundary) {
    let cut = prefix.length - 1;
    while (cut >= 0 && !SEPARATOR_RE.test(prefix[cut])) cut--;
    prefix = prefix.slice(0, Math.max(cut, 0));
  }

  return prefix.replace(/[-_. ]+$/, '').replace(UNSAFE_RE, '');
}

/** YYMMDDHHmm in the given time zone, e.g. 2609251516 for 2026-09-25 15:16. */
export function deliveryTimestamp(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

/**
 * <YYMMDDHHmm>_delivery_<common denominator>.zip, or <YYMMDDHHmm>_delivery.zip
 * when the filenames share nothing.
 */
export function deliveryZipName(fileNames, { date = new Date(), timeZone = DEFAULT_DELIVERY_TIMEZONE } = {}) {
  const stem = commonDenominator(fileNames);
  const ts = deliveryTimestamp(date, timeZone);
  return stem ? `${ts}_delivery_${stem}.zip` : `${ts}_delivery.zip`;
}
