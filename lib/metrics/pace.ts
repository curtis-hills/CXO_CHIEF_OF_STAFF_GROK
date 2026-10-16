import { calendarDaysBetween, utcDayNumber } from "./calendar";

/**
 * Launch KPI.
 * Transaction = a live project created on or after the Launched calendar day.
 * Targets: 10 in 30 calendar days, 25 in 60.
 * Expected pace:
 *   E(d) = 10 * d / 30                  for d <= 30
 *   E(d) = 10 + 15 * (d - 30) / 30      for 30 < d <= 60
 * Pace ratio P = T(d) / E(d), used from day 7.
 *   On pace  P >= 1.0
 *   Watch    P >= 0.7 and P < 1.0
 *   At risk  P < 0.7, or no project in the last 7 days, or the required
 *            daily rate to hit the window target is more than 2× the
 *            expected daily rate.
 * Before day 7 the status is Ramping. At day 7, zero transactions is At risk.
 * Achieved when T(d) has reached the active window target (10, then 25).
 * Missed when a window closes below its target. The 30-day result is kept
 * after day 30; the 60-day window is then the active status.
 */

export const TARGET_30 = 10;
export const TARGET_60 = 25;
export const ON_PACE_RATIO = 1;
export const WATCH_RATIO = 0.7;
export const RAMP_DAYS = 7;
export const QUIET_DAYS = 7;
export const REQUIRED_RATE_MULTIPLE = 2;

export type PaceStatus =
  | "ramping"
  | "on_pace"
  | "watch"
  | "at_risk"
  | "achieved"
  | "missed";

export type TransactionPoint = {
  createdAt: string;
  isTest?: boolean;
  deleted?: boolean;
};

export type PaceEvaluation = {
  day: number;
  actual: number;
  actualAt30: number | null;
  expected: number;
  ratio: number | null;
  status: PaceStatus;
  status30: PaceStatus | "open";
  status60: PaceStatus | "open";
  projected: number;
  projectsLast7Days: number;
  projectsLast14Days: number;
  daysRemaining: number;
  windowTarget: number;
  lastProjectAt: string | null;
  excludedPreLaunch: number;
  excludedTestOrDeleted: number;
};

export function expectedTransactions(day: number): number {
  if (day <= 0) return 0;
  if (day <= 30) return (TARGET_30 * day) / 30;
  if (day <= 60) return TARGET_30 + (15 * (day - 30)) / 30;
  return TARGET_60;
}

export function isLiveTransaction(
  txn: TransactionPoint,
  launchedAt: string,
  asOf: string,
): boolean {
  if (txn.isTest || txn.deleted) return false;
  const created = utcDayNumber(txn.createdAt);
  const launch = utcDayNumber(launchedAt);
  const end = utcDayNumber(asOf);
  return created >= launch && created <= end;
}

function countInDayRange(
  dates: number[],
  startExclusive: number,
  endInclusive: number,
): number {
  return dates.filter((day) => day > startExclusive && day <= endInclusive).length;
}

function statusForOpenWindow(input: {
  day: number;
  actual: number;
  projectsLast7Days: number;
}): PaceStatus {
  const { day, actual, projectsLast7Days } = input;
  const windowEnd = day <= 30 ? 30 : 60;
  const target = day <= 30 ? TARGET_30 : TARGET_60;
  if (actual >= target) return "achieved";
  if (day < RAMP_DAYS) return "ramping";

  const expected = expectedTransactions(day);
  const ratio = expected === 0 ? 0 : actual / expected;
  const daysRemaining = windowEnd - day;
  const expectedDaily = day <= 30 ? TARGET_30 / 30 : 15 / 30;
  const requiredRate = daysRemaining > 0 ? (target - actual) / daysRemaining : Infinity;
  const rateTooHigh =
    daysRemaining > 0 && requiredRate > REQUIRED_RATE_MULTIPLE * expectedDaily;
  const quiet = projectsLast7Days === 0;

  if (ratio < WATCH_RATIO || quiet || rateTooHigh) return "at_risk";
  if (ratio >= ON_PACE_RATIO) return "on_pace";
  return "watch";
}

function closedWindowStatus(actual: number, target: number): "achieved" | "missed" {
  return actual >= target ? "achieved" : "missed";
}

export function evaluatePace(input: {
  launchedAt: string;
  asOf: string;
  transactions: TransactionPoint[];
}): PaceEvaluation | null {
  const day = calendarDaysBetween(input.launchedAt, input.asOf);
  if (day < 0) return null;

  const launchDay = utcDayNumber(input.launchedAt);
  const asOfDay = utcDayNumber(input.asOf);

  let excludedPreLaunch = 0;
  let excludedTestOrDeleted = 0;
  const liveDays: number[] = [];
  let lastProjectAt: string | null = null;

  for (const txn of input.transactions) {
    if (txn.isTest || txn.deleted) {
      excludedTestOrDeleted += 1;
      continue;
    }
    const created = utcDayNumber(txn.createdAt);
    if (created < launchDay) {
      excludedPreLaunch += 1;
      continue;
    }
    if (created > asOfDay) continue;
    liveDays.push(created);
    if (!lastProjectAt || txn.createdAt > lastProjectAt) lastProjectAt = txn.createdAt;
  }

  const actual = liveDays.length;
  const actualAt30 = day >= 30 ? liveDays.filter((d) => d <= launchDay + 30).length : null;
  const projectsLast7Days = countInDayRange(liveDays, asOfDay - QUIET_DAYS, asOfDay);
  const projectsLast14Days = countInDayRange(liveDays, asOfDay - 14, asOfDay);
  const expected = expectedTransactions(day);
  const ratio = expected === 0 ? null : actual / expected;

  let status30: PaceEvaluation["status30"] = "open";
  let status60: PaceEvaluation["status60"] = "open";
  let status: PaceStatus;

  if (day < 30) {
    status = statusForOpenWindow({ day, actual, projectsLast7Days });
    status30 = status;
  } else if (day === 30) {
    status = closedWindowStatus(actual, TARGET_30);
    status30 = status;
  } else if (day < 60) {
    status30 = closedWindowStatus(actualAt30 ?? 0, TARGET_30);
    status = statusForOpenWindow({ day, actual, projectsLast7Days });
    status60 = status;
  } else if (day === 60) {
    status30 = closedWindowStatus(actualAt30 ?? 0, TARGET_30);
    status = closedWindowStatus(actual, TARGET_60);
    status60 = status;
  } else {
    status30 = closedWindowStatus(actualAt30 ?? 0, TARGET_30);
    status = closedWindowStatus(actual, TARGET_60);
    status60 = status;
  }

  const windowEnd = day <= 30 ? 30 : 60;
  const windowTarget = day <= 30 ? TARGET_30 : TARGET_60;
  const daysRemaining = day >= 60 ? 0 : Math.max(0, windowEnd - day);
  const recentRate = projectsLast14Days / 14;
  const projected =
    day >= 60 ? actual : Math.round((actual + recentRate * daysRemaining) * 10) / 10;

  return {
    day,
    actual,
    actualAt30,
    expected,
    ratio,
    status,
    status30,
    status60,
    projected,
    projectsLast7Days,
    projectsLast14Days,
    daysRemaining,
    windowTarget,
    lastProjectAt,
    excludedPreLaunch,
    excludedTestOrDeleted,
  };
}

export function paceStatusLabel(status: PaceStatus | "open"): string {
  switch (status) {
    case "ramping":
      return "Ramping";
    case "on_pace":
      return "On pace";
    case "watch":
      return "Watch";
    case "at_risk":
      return "At risk";
    case "achieved":
      return "Achieved";
    case "missed":
      return "Missed";
    default:
      return "Open";
  }
}
