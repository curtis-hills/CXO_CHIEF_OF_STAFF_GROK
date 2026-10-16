import { businessDaysBetween, calendarDaysBetween } from "./calendar";

/**
 * CXM clock. D0 is the Onboarding date.
 * Goal / flag, in business days (weekdays; the clock is not paused):
 *   Onboarding → Ready to Launch   1 / 3
 *   Ready to Launch → Launched     3 / 5
 *   Onboarding → Launched          5 / 7
 * Green ≤ goal, amber between goal and flag (inclusive), red above the flag.
 * Waiting on the customer does not stop the clock. Callers surface that separately.
 */

export const STAGE_TARGETS = {
  onboardingToRtl: { goal: 1, flag: 3 },
  rtlToLaunched: { goal: 3, flag: 5 },
  onboardingToLaunched: { goal: 5, flag: 7 },
} as const;

export type SlaTone = "green" | "amber" | "red";

export type StageName = "onboarding" | "ready_to_launch" | "launched";

export function classifyStageDuration(businessDays: number, goal: number, flag: number): SlaTone {
  if (businessDays <= goal) return "green";
  if (businessDays <= flag) return "amber";
  return "red";
}

export type StageSpan = {
  businessDays: number | null;
  goal: number;
  flag: number;
  tone: SlaTone | null;
  complete: boolean;
};

export type StageTiming = {
  businessDaysInStage: number | null;
  inStageGoal: number | null;
  inStageFlag: number | null;
  inStageTone: SlaTone | null;
  cxmCalendarDay: number | null;
  onboardingToRtl: StageSpan;
  rtlToLaunched: StageSpan;
  onboardingToLaunched: StageSpan;
  /** Always false. Waiting on the customer is flagged beside the clock. */
  clockPaused: false;
};

function span(
  start: string | null,
  end: string | null,
  goal: number,
  flag: number,
  complete: boolean,
): StageSpan {
  if (!start || !end) {
    return { businessDays: null, goal, flag, tone: null, complete: false };
  }
  const businessDays = businessDaysBetween(start, end);
  return {
    businessDays,
    goal,
    flag,
    tone: classifyStageDuration(businessDays, goal, flag),
    complete,
  };
}

/**
 * Clock that put a pre-launch account past a flag.
 * The current stage wins when it is red. Otherwise the total Onboarding → Launched clock is used,
 * so a green "2 bd" in Ready to Launch does not hide a total clock past 7 business days.
 */
export function flaggedClock(timing: StageTiming): { tone: SlaTone; businessDays: number } | null {
  if (timing.inStageTone === "red" && timing.businessDaysInStage !== null) {
    return { tone: "red", businessDays: timing.businessDaysInStage };
  }
  const total = timing.onboardingToLaunched;
  if (total.tone === "red" && total.businessDays !== null) {
    return { tone: "red", businessDays: total.businessDays };
  }
  return null;
}

export function evaluateStage(input: {
  stage: StageName;
  onboardingAt: string | null;
  readyToLaunchAt: string | null;
  launchedAt: string | null;
  asOf: string;
  waitingOnCustomer: boolean;
}): StageTiming {
  // waitingOnCustomer is accepted so callers pass it explicitly, and ignored
  // so a wait cannot pause the business-day clock.
  void input.waitingOnCustomer;

  const { stage, onboardingAt, readyToLaunchAt, launchedAt, asOf } = input;

  let stageStart: string | null = null;
  let goal: number | null = null;
  let flag: number | null = null;
  if (stage === "onboarding") {
    stageStart = onboardingAt;
    goal = STAGE_TARGETS.onboardingToRtl.goal;
    flag = STAGE_TARGETS.onboardingToRtl.flag;
  } else if (stage === "ready_to_launch") {
    stageStart = readyToLaunchAt;
    goal = STAGE_TARGETS.rtlToLaunched.goal;
    flag = STAGE_TARGETS.rtlToLaunched.flag;
  }

  const businessDaysInStage = stageStart ? businessDaysBetween(stageStart, asOf) : null;
  const inStageTone =
    businessDaysInStage !== null && goal !== null && flag !== null
      ? classifyStageDuration(businessDaysInStage, goal, flag)
      : null;

  const rtlEnd = readyToLaunchAt ?? (stage === "onboarding" ? null : null);
  const launchedEnd = launchedAt;

  return {
    businessDaysInStage,
    inStageGoal: goal,
    inStageFlag: flag,
    inStageTone,
    cxmCalendarDay: onboardingAt ? calendarDaysBetween(onboardingAt, asOf) : null,
    onboardingToRtl: span(
      onboardingAt,
      rtlEnd,
      STAGE_TARGETS.onboardingToRtl.goal,
      STAGE_TARGETS.onboardingToRtl.flag,
      Boolean(readyToLaunchAt),
    ),
    rtlToLaunched: span(
      readyToLaunchAt,
      launchedEnd,
      STAGE_TARGETS.rtlToLaunched.goal,
      STAGE_TARGETS.rtlToLaunched.flag,
      Boolean(launchedAt && readyToLaunchAt),
    ),
    onboardingToLaunched: span(
      onboardingAt,
      launchedAt ?? (stage === "launched" ? null : asOf),
      STAGE_TARGETS.onboardingToLaunched.goal,
      STAGE_TARGETS.onboardingToLaunched.flag,
      Boolean(launchedAt),
    ),
    clockPaused: false,
  };
}
