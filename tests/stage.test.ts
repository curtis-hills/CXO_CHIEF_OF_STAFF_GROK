import { describe, expect, it } from "vitest";
import { businessDaysBetween, subtractBusinessDays } from "../lib/metrics/calendar";
import { classifyStageDuration, evaluateStage } from "../lib/metrics/stage";

describe("stage clocks", () => {
  it("counts weekdays and skips the start day", () => {
    expect(businessDaysBetween("2026-10-15T15:00:00.000Z", "2026-10-15T23:00:00.000Z")).toBe(0);
    // Friday to Monday is one business day.
    expect(businessDaysBetween("2026-10-09T15:00:00.000Z", "2026-10-12T15:00:00.000Z")).toBe(1);
    // Monday to the next Monday is five business days.
    expect(businessDaysBetween("2026-10-12T15:00:00.000Z", "2026-10-19T15:00:00.000Z")).toBe(5);
  });

  it("can step backward by the same business-day count, including over a weekend", () => {
    for (const end of ["2026-10-15T18:00:00.000Z", "2026-10-17T18:00:00.000Z", "2026-10-18T18:00:00.000Z"]) {
      for (const days of [0, 1, 2, 3, 5, 6, 7]) {
        expect(businessDaysBetween(subtractBusinessDays(end, days), end)).toBe(days);
      }
    }
  });

  it("uses green at or under the goal, amber through the flag, and red above it", () => {
    expect(classifyStageDuration(0, 1, 3)).toBe("green");
    expect(classifyStageDuration(1, 1, 3)).toBe("green");
    expect(classifyStageDuration(2, 1, 3)).toBe("amber");
    expect(classifyStageDuration(3, 1, 3)).toBe("amber");
    expect(classifyStageDuration(4, 1, 3)).toBe("red");

    expect(classifyStageDuration(3, 3, 5)).toBe("green");
    expect(classifyStageDuration(5, 3, 5)).toBe("amber");
    expect(classifyStageDuration(6, 3, 5)).toBe("red");

    expect(classifyStageDuration(5, 5, 7)).toBe("green");
    expect(classifyStageDuration(7, 5, 7)).toBe("amber");
    expect(classifyStageDuration(8, 5, 7)).toBe("red");
  });

  it("keeps the clock running while the account is waiting on the customer", () => {
    const base = {
      stage: "onboarding" as const,
      onboardingAt: "2026-10-07T15:00:00.000Z",
      readyToLaunchAt: null,
      launchedAt: null,
      asOf: "2026-10-15T18:00:00.000Z",
    };
    const running = evaluateStage({ ...base, waitingOnCustomer: false });
    const waiting = evaluateStage({ ...base, waitingOnCustomer: true });
    expect(waiting.businessDaysInStage).toBe(running.businessDaysInStage);
    expect(waiting.businessDaysInStage).toBe(6);
    expect(waiting.inStageTone).toBe("red");
    expect(waiting.clockPaused).toBe(false);
    expect(waiting.onboardingToLaunched.businessDays).toBe(running.onboardingToLaunched.businessDays);
    expect(waiting.onboardingToLaunched.complete).toBe(false);
  });

  it("scores a finished Onboarding to Launched span against the 5/7 target", () => {
    const timing = evaluateStage({
      stage: "launched",
      onboardingAt: "2026-10-05T15:00:00.000Z",
      readyToLaunchAt: "2026-10-08T15:00:00.000Z",
      launchedAt: "2026-10-14T15:00:00.000Z",
      asOf: "2026-10-15T18:00:00.000Z",
      waitingOnCustomer: false,
    });
    expect(timing.onboardingToRtl).toEqual(
      expect.objectContaining({ businessDays: 3, tone: "amber", complete: true }),
    );
    expect(timing.rtlToLaunched).toEqual(
      expect.objectContaining({ businessDays: 4, tone: "amber", complete: true }),
    );
    expect(timing.onboardingToLaunched).toEqual(
      expect.objectContaining({ businessDays: 7, tone: "amber", complete: true }),
    );
    expect(timing.inStageTone).toBeNull();
  });
});
