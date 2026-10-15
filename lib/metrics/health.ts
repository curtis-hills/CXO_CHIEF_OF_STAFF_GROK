import type { PaceStatus } from "./pace";
import { utcDayNumber } from "./calendar";

/**
 * Post-launch health score v1.
 * Only volume and billing are scored. The full model weights them 30 and 10;
 * v1 renormalizes those two inputs onto a 0–100 score (75 volume / 25 billing).
 *
 * Volume, after KPI day 60: projects in the last 30 days divided by the
 * trailing 90-day count / 3 (a monthly baseline). The 90-day window includes
 * the last 30, so a flat account scores about 1.0.
 *   ≥ 100% of baseline → full credit
 *   60–99%            → half credit
 *   < 60%             → no credit
 *
 * Through KPI day 60 the volume input follows the pace status instead:
 *   Achieved / On pace → full
 *   Watch              → half
 *   At risk / Missed   → none
 *   Ramping (before day 7) → not scored yet
 *
 * Billing: paid / current / active scores full credit. Failed, past due, or
 * cancelled scores 0.
 * Auto-red overrides: failed payment open 7 days or more, or a cancellation request.
 * Bands: Green ≥ 70, Yellow 45–69, Red < 45.
 */

export const VOLUME_POINTS = 75;
export const BILLING_POINTS = 25;
export const GREEN_MIN = 70;
export const YELLOW_MIN = 45;
export const VOLUME_FULL_RATIO = 1;
export const VOLUME_HALF_RATIO = 0.6;
export const FAILED_PAYMENT_AUTO_RED_DAYS = 7;

export type HealthBand = "green" | "yellow" | "red" | "ramping" | "prelaunch" | "unscored";

export type HealthScore = {
  score: number | null;
  band: HealthBand;
  volumePoints: number;
  billingPoints: number;
  volumeRatio: number | null;
  basis: "pace" | "baseline" | "unscored";
  last30: number;
  last90: number;
  drivers: string[];
  autoRed: boolean;
  autoRedReason: string | null;
};

export function bandForScore(score: number): "green" | "yellow" | "red" {
  if (score >= GREEN_MIN) return "green";
  if (score >= YELLOW_MIN) return "yellow";
  return "red";
}

export function pointsForVolumeRatio(ratio: number | null): number {
  if (ratio === null) return 0;
  if (ratio >= VOLUME_FULL_RATIO) return VOLUME_POINTS;
  if (ratio >= VOLUME_HALF_RATIO) return VOLUME_POINTS / 2;
  return 0;
}

export function pointsForPaceStatus(status: PaceStatus): number | null {
  switch (status) {
    case "achieved":
    case "on_pace":
      return VOLUME_POINTS;
    case "watch":
      return VOLUME_POINTS / 2;
    case "at_risk":
    case "missed":
      return 0;
    case "ramping":
      return null;
  }
}

/** Last-30 count vs trailing-90 monthly average. Null only when there is no history to compare. */
export function baselineVolumeRatio(last30: number, last90: number): number {
  if (last90 <= 0) return last30 > 0 ? Number.POSITIVE_INFINITY : 0;
  return last30 / (last90 / 3);
}

const HEALTHY_PAYMENT = new Set(["paid", "current", "active"]);

export function billingPointsFor(paymentStatus: string): number {
  return HEALTHY_PAYMENT.has(paymentStatus.toLowerCase()) ? BILLING_POINTS : 0;
}

export function evaluateHealth(input: {
  launched: boolean;
  paceStatus: PaceStatus | null;
  kpiDay: number | null;
  projectDaysAgo: number[];
  paymentStatus: string;
  failedPaymentDays: number | null;
  cancellationRequested: boolean;
}): HealthScore {
  const ages = input.projectDaysAgo.filter((d) => d >= 0);
  const last30 = ages.filter((d) => d <= 30).length;
  const last90 = ages.filter((d) => d <= 90).length;
  const volumeRatio = baselineVolumeRatio(last30, last90);

  const drivers: string[] = [];
  let autoRed = false;
  let autoRedReason: string | null = null;
  const paymentStatus = input.paymentStatus.toLowerCase();

  if (input.cancellationRequested || paymentStatus === "cancelled") {
    autoRed = true;
    autoRedReason = "Cancellation requested";
  } else if (
    paymentStatus === "failed" &&
    input.failedPaymentDays !== null &&
    input.failedPaymentDays >= FAILED_PAYMENT_AUTO_RED_DAYS
  ) {
    autoRed = true;
    autoRedReason = `Failed payment open for ${input.failedPaymentDays} days`;
  }

  const billingPoints = billingPointsFor(paymentStatus);
  if (billingPoints === BILLING_POINTS) {
    drivers.push("Billing status is current.");
  } else if (paymentStatus === "past_due") {
    drivers.push("Payment is past due. Billing credit is withheld.");
  } else if (paymentStatus === "failed") {
    drivers.push(
      input.failedPaymentDays === null
        ? "A failed payment is open. Billing credit is withheld."
        : `A failed payment has been open for ${input.failedPaymentDays} days. Billing credit is withheld.`,
    );
  } else if (paymentStatus === "cancelled") {
    drivers.push("Payment status is cancelled.");
  } else {
    drivers.push(`Billing status “${input.paymentStatus || "unknown"}” does not earn billing credit.`);
  }

  if (!input.launched) {
    return {
      score: null,
      band: "prelaunch",
      volumePoints: 0,
      billingPoints,
      volumeRatio: null,
      basis: "unscored",
      last30,
      last90,
      drivers: ["Health starts at Launched. This account is still pre-launch.", ...drivers],
      autoRed: false,
      autoRedReason: null,
    };
  }

  const usePace = input.kpiDay !== null && input.kpiDay <= 60;
  if (usePace) {
    if (!input.paceStatus || input.paceStatus === "ramping") {
      return {
        score: null,
        band: autoRed ? "red" : "ramping",
        volumePoints: 0,
        billingPoints,
        volumeRatio: null,
        basis: "pace",
        last30,
        last90,
        drivers: [
          autoRed && autoRedReason ? `Auto-red: ${autoRedReason}.` : "Before KPI day 7 the pace curve is not applied.",
          "Volume will be scored from the pace curve starting day 7.",
          ...drivers,
        ],
        autoRed,
        autoRedReason,
      };
    }

    const volumePoints = pointsForPaceStatus(input.paceStatus) ?? 0;
    const raw = volumePoints + billingPoints;
    drivers.unshift(
      `KPI day ${input.kpiDay} is inside the first 60 days, so volume follows pace (${input.paceStatus.replaceAll("_", " ")}).`,
    );
    return finish(raw, volumePoints, billingPoints, null, "pace", last30, last90, drivers, autoRed, autoRedReason);
  }

  const volumePoints = pointsForVolumeRatio(volumeRatio);
  const raw = volumePoints + billingPoints;
  const ratioLabel = Number.isFinite(volumeRatio) ? `${Math.round(volumeRatio * 100)}%` : "above any baseline";
  drivers.unshift(
    `Last 30 days are ${ratioLabel} of the trailing 90-day monthly average (${last30} vs ${last90} / 3).`,
  );
  return finish(raw, volumePoints, billingPoints, volumeRatio, "baseline", last30, last90, drivers, autoRed, autoRedReason);
}

function finish(
  raw: number,
  volumePoints: number,
  billingPoints: number,
  volumeRatio: number | null,
  basis: "pace" | "baseline",
  last30: number,
  last90: number,
  drivers: string[],
  autoRed: boolean,
  autoRedReason: string | null,
): HealthScore {
  const band = autoRed ? "red" : bandForScore(raw);
  if (autoRed && autoRedReason) {
    drivers.unshift(`Auto-red: ${autoRedReason}.`);
  }
  return {
    score: raw,
    band,
    volumePoints,
    billingPoints,
    volumeRatio: volumeRatio !== null && Number.isFinite(volumeRatio) ? volumeRatio : volumeRatio,
    basis,
    last30,
    last90,
    drivers,
    autoRed,
    autoRedReason,
  };
}

export function unscoredHealth(reason: string): HealthScore {
  return {
    score: null,
    band: "unscored",
    volumePoints: 0,
    billingPoints: 0,
    volumeRatio: null,
    basis: "unscored",
    last30: 0,
    last90: 0,
    drivers: [reason],
    autoRed: false,
    autoRedReason: null,
  };
}

/** Days-ago list for live project timestamps, relative to asOf (UTC calendar days). */
export function projectDaysAgo(projectDates: string[], asOf: string): number[] {
  const end = utcDayNumber(asOf);
  return projectDates.map((iso) => end - utcDayNumber(iso));
}
