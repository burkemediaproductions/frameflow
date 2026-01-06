// admin/src/utils/datetime.js
import { DateTime } from "luxon";

/**
 * Combine a local date + time in a TZ into a UTC ISO string.
 */
export function combineDateAndTimeToUTC(
  dateISO,
  time,
  tz = "America/Los_Angeles"
) {
  const [y, m, d] = String(dateISO).split("-").map(Number);

  let hh = 0,
    mm = 0,
    ss = 0;

  if (typeof time === "string") {
    const parts = time.split(":").map(Number);
    hh = parts[0] || 0;
    mm = parts[1] || 0;
    ss = parts[2] || 0;
  } else if (time && typeof time === "object") {
    hh = Math.floor((time.minutes || 0) / 60);
    mm = (time.minutes || 0) % 60;
    ss = time.seconds || 0;
  }

  return DateTime.fromObject(
    { year: y, month: m, day: d, hour: hh, minute: mm, second: ss },
    { zone: tz }
  )
    .toUTC()
    .toISO();
}

/**
 * Default “pretty” formats you asked for:
 * Date:  December 22, 2025
 * Time:  6:50pm
 */
export function fmtDateLong(isoOrDate, locale = "en-US") {
  if (!isoOrDate) return "";
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export function fmtTimeShortLower(isoOrDate, locale = "en-US", timeZone) {
  if (!isoOrDate) return "";
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "";

  // "6:50 PM" -> "6:50pm"
  const s = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  }).format(d);

  return s.replace(/\s?([AP]M)$/i, (_, ampm) => ampm.toLowerCase());
}

/**
 * Format a UTC ISO string into a readable date+time in a TZ.
 * By default uses your “December 22, 2025” + “6:50pm”
 */
export function fmtDateTimeUTC(
  utcIso,
  tz = "America/Los_Angeles",
  locale = "en-US",
  opt = null
) {
  if (!utcIso) return "";
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return "";

  // If caller provides Intl options, respect them
  if (opt && typeof opt === "object") {
    return new Intl.DateTimeFormat(locale, { ...opt, timeZone: tz }).format(d);
  }

  // Default: "December 22, 2025 6:50pm"
  return `${fmtDateLong(d, locale)} ${fmtTimeShortLower(d, locale, tz)}`.trim();
}

/**
 * For <input type="date"> value display (expects YYYY-MM-DD).
 * Returns "December 22, 2025" by default.
 */
export function fmtDateISO(iso, locale = "en-US", style = "long") {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return "";

  // Use local date object but anchor as UTC midnight
  const dt = new Date(Date.UTC(y, m - 1, d));

  if (style === "long") return fmtDateLong(dt, locale);

  const map = {
    short: { dateStyle: "short" },
    medium: { dateStyle: "medium" },
    long: { dateStyle: "long" },
  };
  return new Intl.DateTimeFormat(locale, map[style] || map.long).format(dt);
}
