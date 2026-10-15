import { describe, expect, it } from "vitest";
import {
  BILLING_POINTS,
  VOLUME_POINTS,
  baselineVolumeRatio,
  bandForScore,
  evaluateHealth,
  pointsForVolumeRatio,
} from "../lib/metrics/health";

function health(
  overrides: Partial<Parameters<typeof evaluateHealth>[0]> = {},
) {
  return evaluateHealth({
    launched: true,
    paceStatus: "on_pace",
    kpiDay: 80,
    projectDaysAgo: [],
    paymentStatus: "paid",
    failedPaymentDays: null,
    cancellationRequested: false,
    ...overrides,
  });
}

describe("health score v1", () => {
  it("gives full, half, or zero volume credit against the 90-day baseline", () => {
    expect(VOLUME_POINTS + BILLING_POINTS).toBe(100);
    expect(pointsForVolumeRatio(1)).toBe(75);
    expect(pointsForVolumeRatio(1.4)).toBe(75);
    expect(pointsForVolumeRatio(0.99)).toBe(37.5);
    expect(pointsForVolumeRatio(0.6)).toBe(37.5);
    expect(pointsForVolumeRatio(0.599)).toBe(0);
    expect(baselineVolumeRatio(12, 30)).toBeCloseTo(1.2);
    expect(baselineVolumeRatio(8, 30)).toBeCloseTo(0.8);
    expect(baselineVolumeRatio(4, 30)).toBeCloseTo(0.4);
  });

  it("bands a flat or growing account green, a soft decline yellow, and a sharp decline red", () => {
    const green = health({
      projectDaysAgo: [...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: 18 }, (_, i) => 40 + i)],
    });
    expect(green.basis).toBe("baseline");
    expect(green.volumeRatio).toBeCloseTo(1.2);
    expect(green.score).toBe(100);
    expect(green.band).toBe("green");

    const yellow = health({
      projectDaysAgo: [...Array.from({ length: 8 }, (_, i) => i + 1), ...Array.from({ length: 22 }, (_, i) => 35 + i)],
    });
    expect(yellow.volumeRatio).toBeCloseTo(0.8);
    expect(yellow.score).toBe(62.5);
    expect(yellow.band).toBe("yellow");
    expect(bandForScore(62.5)).toBe("yellow");

    const red = health({
      projectDaysAgo: [...Array.from({ length: 4 }, (_, i) => i), ...Array.from({ length: 26 }, (_, i) => 40 + i)],
    });
    expect(red.volumeRatio).toBeCloseTo(0.4);
    expect(red.score).toBe(25);
    expect(red.band).toBe("red");
  });

  it("scores the first 60 days from pace instead of the baseline", () => {
    const onPace = health({ kpiDay: 22, paceStatus: "on_pace", projectDaysAgo: [1] });
    expect(onPace.basis).toBe("pace");
    expect(onPace.score).toBe(100);
    expect(onPace.band).toBe("green");

    const watch = health({ kpiDay: 36, paceStatus: "watch" });
    expect(watch.score).toBe(62.5);
    expect(watch.band).toBe("yellow");

    const atRisk = health({ kpiDay: 18, paceStatus: "at_risk" });
    expect(atRisk.score).toBe(25);
    expect(atRisk.band).toBe("red");

    const achieved = health({ kpiDay: 58, paceStatus: "achieved" });
    expect(achieved.score).toBe(100);

    const missed = health({ kpiDay: 60, paceStatus: "missed" });
    expect(missed.score).toBe(25);
    expect(missed.band).toBe("red");
  });

  it("does not score volume before day 7", () => {
    const ramping = health({ kpiDay: 3, paceStatus: "ramping", projectDaysAgo: [1] });
    expect(ramping.score).toBeNull();
    expect(ramping.band).toBe("ramping");
  });

  it("withholds billing credit for a recent failed payment without forcing red", () => {
    const recent = health({
      projectDaysAgo: [...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: 18 }, (_, i) => 40 + i)],
      paymentStatus: "failed",
      failedPaymentDays: 2,
    });
    expect(recent.billingPoints).toBe(0);
    expect(recent.score).toBe(75);
    expect(recent.autoRed).toBe(false);
    expect(recent.band).toBe("green");
  });

  it("forces red when a failed payment has been open for 7 days", () => {
    const aged = health({
      projectDaysAgo: [...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: 18 }, (_, i) => 40 + i)],
      paymentStatus: "failed",
      failedPaymentDays: 8,
    });
    expect(aged.score).toBe(75);
    expect(aged.band).toBe("red");
    expect(aged.autoRed).toBe(true);
    expect(aged.autoRedReason).toMatch(/8 days/);
  });

  it("forces red on a cancellation request", () => {
    const cancelled = health({
      kpiDay: 40,
      paceStatus: "achieved",
      cancellationRequested: true,
    });
    expect(cancelled.band).toBe("red");
    expect(cancelled.autoRedReason).toMatch(/Cancellation/);
  });

  it("leaves pre-launch accounts unscored", () => {
    const pre = health({ launched: false, kpiDay: null, paceStatus: null });
    expect(pre.band).toBe("prelaunch");
    expect(pre.score).toBeNull();
    expect(pre.basis).toBe("unscored");
  });
});
