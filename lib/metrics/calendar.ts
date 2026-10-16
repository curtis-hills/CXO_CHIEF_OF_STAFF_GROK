/** UTC calendar helpers. KPI windows are calendar days. Stage targets are weekdays. */

export function utcDayNumber(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${iso}`);
  }
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

/** Whole UTC calendar days from start to end. Same calendar day is 0. */
export function calendarDaysBetween(startIso: string, endIso: string): number {
  return utcDayNumber(endIso) - utcDayNumber(startIso);
}

export function isWeekendUtc(dayNumber: number): boolean {
  const dow = new Date(dayNumber * 86_400_000).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Business days elapsed after `startIso` up to and including `endIso`.
 * Weekends count as zero. The start calendar day itself is not counted,
 * so a stage entered today is 0 business days.
 * Holiday calendars are not applied (still an open decision).
 */
export function businessDaysBetween(startIso: string, endIso: string): number {
  const start = utcDayNumber(startIso);
  const end = utcDayNumber(endIso);
  if (end <= start) return 0;
  let count = 0;
  for (let day = start + 1; day <= end; day += 1) {
    if (!isWeekendUtc(day)) count += 1;
  }
  return count;
}

export function subtractCalendarDays(iso: string, days: number, hourUtc = 16): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

/**
 * The UTC instant `businessDays` before `iso`, using the same weekday rule as
 * `businessDaysBetween`: the start day is not counted, and weekends add nothing.
 * Works when `iso` itself falls on a weekend.
 */
export function subtractBusinessDays(iso: string, businessDays: number, hourUtc = 15): string {
  let start = utcDayNumber(iso);
  let counted = 0;
  while (counted < businessDays) {
    const included = start;
    start -= 1;
    if (!isWeekendUtc(included)) counted += 1;
  }
  const d = new Date(start * 86_400_000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

export function formatUtcDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatUtcWeekday(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatUtcTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}
