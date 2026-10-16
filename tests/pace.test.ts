import { describe, expect, it } from "vitest";
import { calendarDaysBetween } from "../lib/metrics/calendar";
import {
  evaluatePace,
  expectedTransactions,
  type TransactionPoint,
} from "../lib/metrics/pace";

const LAUNCH = "2026-10-01T15:00:00.000Z";

function daysAfter(days: number, hour = 16): string {
  const d = new Date(LAUNCH);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function tx(offset: number, extra: Partial<TransactionPoint> = {}): TransactionPoint {
  return { createdAt: daysAfter(offset), ...extra };
}

function pace(day: number, transactions: TransactionPoint[]) {
  const result = evaluatePace({
    launchedAt: LAUNCH,
    asOf: daysAfter(day, 18),
    transactions,
  });
  if (!result) throw new Error("expected a pace result");
  expect(result.day).toBe(day);
  return result;
}

describe("expected pace curve", () => {
  it("follows 10*d/30 through day 30, then 10+15*(d-30)/30 through day 60", () => {
    expect(expectedTransactions(0)).toBe(0);
    expect(expectedTransactions(15)).toBe(5);
    expect(expectedTransactions(30)).toBe(10);
    expect(expectedTransactions(45)).toBe(17.5);
    expect(expectedTransactions(60)).toBe(25);
    expect(expectedTransactions(90)).toBe(25);
  });
});

describe("pace status", () => {
  it("is ramping before day 7, including when there are zero projects", () => {
    expect(pace(4, []).status).toBe("ramping");
    expect(pace(6, [tx(1)]).status).toBe("ramping");
  });

  it("is achieved before day 7 once the 10-project target is already met", () => {
    const offsets = Array.from({ length: 10 }, (_, i) => i % 6);
    expect(pace(6, offsets.map((offset) => tx(offset))).status).toBe("achieved");
  });

  it("is at risk at day 7 when there are still zero projects", () => {
    const result = pace(7, []);
    expect(result.status).toBe("at_risk");
    expect(result.ratio).toBe(0);
  });

  it("classifies ratio bands: on pace >= 1, watch >= 0.7, at risk below 0.7", () => {
    // Day 15 expected is 5.
    expect(pace(15, [0, 2, 4, 6, 8, 14].map((n) => tx(n))).status).toBe("on_pace");
    expect(pace(15, [0, 2, 4, 6, 8, 14].map((n) => tx(n))).ratio).toBeCloseTo(1.2);

    const watch = pace(15, [1, 4, 8, 14].map((n) => tx(n)));
    expect(watch.ratio).toBeCloseTo(0.8);
    expect(watch.status).toBe("watch");

    const risk = pace(15, [1, 5, 14].map((n) => tx(n)));
    expect(risk.ratio).toBeCloseTo(0.6);
    expect(risk.status).toBe("at_risk");
  });

  it("marks a quiet account at risk even when the ratio is still on pace", () => {
    // Day 20 expected is 6.666…, 8 projects is ratio 1.2, but the newest is 8 days ago.
    const result = pace(20, [1, 2, 3, 4, 5, 6, 10, 12].map((n) => tx(n)));
    expect(result.ratio).toBeGreaterThan(1);
    expect(result.projectsLast7Days).toBe(0);
    expect(result.status).toBe("at_risk");
  });

  it("keeps a project from 6 days ago inside the 7-day window", () => {
    const result = pace(20, [1, 2, 3, 4, 5, 14].map((n) => tx(n)));
    expect(result.projectsLast7Days).toBe(1);
    expect(result.status).toBe("watch");
  });

  it("is at risk when the required daily rate is more than twice the expected rate", () => {
    // Day 28 expected is 9.333…, 7 projects is ratio 0.75 (watch),
    // but 3 projects are still required over 2 days.
    const result = pace(28, [1, 4, 8, 12, 16, 20, 27].map((n) => tx(n)));
    expect(result.ratio).toBeCloseTo(0.75);
    expect(result.projectsLast7Days).toBeGreaterThan(0);
    expect(result.status).toBe("at_risk");
  });

  it("closes the 30-day window as achieved or missed and keeps that result", () => {
    const nine = [1, 3, 5, 8, 12, 16, 20, 24, 29].map((n) => tx(n));
    const missed = pace(30, nine);
    expect(missed.status).toBe("missed");
    expect(missed.status30).toBe("missed");

    const later = pace(36, [...nine, tx(32), tx(34), tx(35)]);
    expect(later.status30).toBe("missed");
    expect(later.actualAt30).toBe(9);
    expect(later.actual).toBe(12);
    expect(later.expected).toBeCloseTo(13);
    expect(later.status).toBe("watch");
    expect(later.status60).toBe("watch");
  });

  it("marks the 60-day window achieved at 25 and missed below it", () => {
    const early = Array.from({ length: 11 }, (_, i) => tx(i + 1));
    const rest = Array.from({ length: 14 }, (_, i) => tx(32 + i));
    const hit = pace(60, [...early, ...rest]);
    expect(hit.actual).toBe(25);
    expect(hit.status).toBe("achieved");
    expect(hit.status30).toBe("achieved");
    expect(hit.status60).toBe("achieved");

    const miss = pace(62, [...early, ...rest.slice(0, 7)]);
    expect(miss.actual).toBe(18);
    expect(miss.status).toBe("missed");
    expect(miss.status60).toBe("missed");
    expect(miss.status30).toBe("achieved");
  });

  it("excludes pre-launch, test, and deleted projects", () => {
    const result = pace(12, [
      tx(-3),
      tx(-1, { isTest: true }),
      tx(2, { isTest: true }),
      tx(4, { deleted: true }),
      tx(3),
      tx(6),
      tx(8),
      tx(11),
    ]);
    expect(result.actual).toBe(4);
    expect(result.excludedPreLaunch).toBe(1);
    expect(result.excludedTestOrDeleted).toBe(3);
    expect(result.expected).toBeCloseTo(4);
    expect(result.status).toBe("on_pace");
  });

  it("returns null when the launch date is after as-of", () => {
    expect(
      evaluatePace({
        launchedAt: daysAfter(3),
        asOf: LAUNCH,
        transactions: [],
      }),
    ).toBeNull();
    expect(calendarDaysBetween(daysAfter(3), LAUNCH)).toBeLessThan(0);
  });
});
