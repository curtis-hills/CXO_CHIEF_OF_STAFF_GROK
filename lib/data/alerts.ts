import type { Account, Alert } from "../domain";
import { requiredCompletion } from "../domain";
import { calendarDaysBetween, utcDayNumber } from "../metrics/calendar";
import { paceStatusLabel } from "../metrics/pace";

const CRAIG = "Craig Kersey";

function cxmOrCraig(account: Account): string {
  return account.cxm?.name ?? CRAIG;
}

export function buildAlerts(accounts: Account[], asOf: string): Alert[] {
  const alerts: Alert[] = [];

  for (const account of accounts) {
    const owner = cxmOrCraig(account);

    if (!account.cxm && account.stage !== "other") {
      alerts.push({
        id: `unassigned_cxm:${account.id}`,
        type: "unassigned_cxm",
        severity: "high",
        orgId: account.id,
        orgName: account.name,
        title: "No CXM assigned",
        detail: "Craig assigns the CXM before the onboarding clock is meaningful.",
        suggestedAction: "Assign a CXM and book the kickoff.",
        owner: CRAIG,
      });
    }

    if (account.stage === "launched" && account.launchedAt.source === "missing") {
      alerts.push({
        id: `missing_launch_date:${account.id}`,
        type: "missing_launch_date",
        severity: "high",
        orgId: account.id,
        orgName: account.name,
        title: "Launched, but the KPI clock has no day 0",
        detail: "launched_at is not in the API. Pace and health stay unscored until a stand-in is entered.",
        suggestedAction: "Enter the Launched date on the account. Label it as a manual stand-in.",
        owner,
      });
    }

    if (account.pace?.status === "at_risk") {
      alerts.push({
        id: `pace_at_risk:${account.id}`,
        type: "pace_at_risk",
        severity: "high",
        orgId: account.id,
        orgName: account.name,
        title: `Pace is at risk on KPI day ${account.pace.day}`,
        detail: `${account.pace.actual} live projects versus ${account.pace.expected.toFixed(1)} expected.`,
        suggestedAction:
          "CXM runs the rescue plan. Amanda Hatch’s chat support is the first post-launch contact. Escalate to Craig Kersey if it stays red.",
        owner,
      });
    }

    if (account.pace && (account.pace.status === "missed" || account.pace.status60 === "missed")) {
      const parts: string[] = [];
      if (account.pace.status30 === "missed") {
        parts.push(`Day 30 closed at ${account.pace.actualAt30 ?? account.pace.actual} of 10.`);
      }
      if (account.pace.day >= 60) {
        parts.push(`Day 60 closed at ${account.pace.actual} of 25.`);
      }
      alerts.push({
        id: `pace_missed:${account.id}`,
        type: "pace_missed",
        severity: "high",
        orgId: account.id,
        orgName: account.name,
        title: account.pace.day <= 30 ? "30-day pace was missed" : "60-day pace was missed",
        detail: parts.join(" ") || `${account.pace.actual} live projects on day ${account.pace.day}.`,
        suggestedAction: "Review the miss with the CXM and decide whether a later window can still recover.",
        owner,
      });
    } else if (account.pace?.status30 === "missed") {
      alerts.push({
        id: `pace_missed:${account.id}`,
        type: "pace_missed",
        severity: "medium",
        orgId: account.id,
        orgName: account.name,
        title: "30-day target was missed",
        detail: `The 60-day window is ${paceStatusLabel(account.pace.status)}. Day 30 closed at ${account.pace.actualAt30} of 10.`,
        suggestedAction: "Keep the 60-day plan visible. The 30-day miss stays on the record.",
        owner,
      });
    }

    if (
      account.stage === "launched" &&
      account.pace &&
      account.pace.day >= 7 &&
      account.pace.projectsLast7Days === 0
    ) {
      alerts.push({
        id: `no_project_7d:${account.id}`,
        type: "no_project_7d",
        severity: account.pace.status === "achieved" ? "medium" : "high",
        orgId: account.id,
        orgName: account.name,
        title: "No live project in the last 7 days",
        detail: account.pace.lastProjectAt
          ? `Last live project was ${account.pace.lastProjectAt.slice(0, 10)}.`
          : "No live project since launch.",
        suggestedAction: "Ask the CXM to confirm the account is actually transacting.",
        owner,
      });
    }

    if (account.stage === "onboarding" && account.stageTiming.inStageTone === "red") {
      alerts.push({
        id: `stage_sla_breach:${account.id}`,
        type: "stage_sla_breach",
        severity: "high",
        orgId: account.id,
        orgName: account.name,
        title: `Onboarding is past the ${account.stageTiming.inStageFlag}-day flag`,
        detail: waitingDetail(account, `${account.stageTiming.businessDaysInStage} business days in Onboarding. Goal is 1.`),
        suggestedAction: "CX Admin clears the remaining setup items. The clock does not pause for a customer wait.",
        owner: "CX Admin",
      });
    }

    if (account.stage === "ready_to_launch" && account.stageTiming.inStageTone === "red") {
      alerts.push({
        id: `ready_to_launch_stalled:${account.id}`,
        type: "ready_to_launch_stalled",
        severity: "high",
        orgId: account.id,
        orgName: account.name,
        title: `Ready to Launch is past the ${account.stageTiming.inStageFlag}-day flag`,
        detail: waitingDetail(
          account,
          `${account.stageTiming.businessDaysInStage} business days since Ready to Launch. Goal is 3.`,
        ),
        suggestedAction: "CXM finishes training and sets Launched, or records what is still blocking it.",
        owner,
      });
    }

    if (
      account.stage !== "launched" &&
      account.stage !== "other" &&
      account.stageTiming.onboardingToLaunched.tone === "red" &&
      account.stageTiming.inStageTone !== "red"
    ) {
      alerts.push({
        id: `stage_sla_breach:${account.id}`,
        type: "stage_sla_breach",
        severity: "high",
        orgId: account.id,
        orgName: account.name,
        title: "Total onboarding clock is past 7 business days",
        detail: waitingDetail(
          account,
          `${account.stageTiming.onboardingToLaunched.businessDays} business days since Onboarding. Goal is 5, flag is 7.`,
        ),
        suggestedAction: "CXM reviews the remaining path to Launched.",
        owner,
      });
    }

    if (account.onboardingAt.iso && account.stage !== "launched") {
      const age = calendarDaysBetween(account.onboardingAt.iso, asOf);
      if (age >= 0 && age <= 7) {
        alerts.push({
          id: `new_handoff:${account.id}`,
          type: "new_handoff",
          severity: "low",
          orgId: account.id,
          orgName: account.name,
          title: "New handoff in the last 7 days",
          detail: `Onboarding date is a ${account.onboardingAt.source} stand-in or source.`,
          suggestedAction: account.cxm ? "CXM runs the kickoff." : "Craig assigns a CXM, then the CXM runs the kickoff.",
          owner,
        });
      }
    }

    if (account.stage === "onboarding" && account.checklistTracked) {
      const entry = requiredCompletion(account.checklist, "entry");
      if (entry !== null && entry < 1) {
        alerts.push({
          id: `handoff_incomplete:${account.id}`,
          type: "handoff_incomplete",
          severity: "medium",
          orgId: account.id,
          orgName: account.name,
          title: "Clean handoff is incomplete",
          detail: `${Math.round(entry * 100)}% of required entry items are checked. Checklist progress is a dashboard stand-in until P1-1.`,
          suggestedAction: "Return the open items to the AE before setup goes further.",
          owner: account.cxm?.name ?? CRAIG,
        });
      }
    }

    if (account.paymentStatus === "failed" || account.paymentStatus === "past_due") {
      alerts.push({
        id: `payment_status_change:${account.id}`,
        type: "payment_status_change",
        severity: account.health.autoRed ? "high" : "medium",
        orgId: account.id,
        orgName: account.name,
        title: account.paymentStatus === "failed" ? "Payment failed" : "Payment past due",
        detail:
          account.paymentAgeSource === "proxy"
            ? `Failed-payment age (${account.failedPaymentDays} days) is a stand-in. The API has no billing history yet (P2-4).`
            : "Only the current payment status is known. Age needs P2-4.",
        suggestedAction: "Renewal follow-up. Escalate to Craig Kersey if the failure is still open after 7 days. Do not change billing from this dashboard.",
        owner: CRAIG,
      });
    }

    if (account.health.band === "red" && (account.health.basis === "baseline" || account.health.autoRed)) {
      alerts.push({
        id: `health_red:${account.id}`,
        type: "health_red",
        severity: "high",
        orgId: account.id,
        orgName: account.name,
        title: account.health.autoRed ? "Health is auto-red" : "Post-launch health is red",
        detail: account.health.drivers[0] ?? "Volume or billing pulled the score under 45.",
        suggestedAction: "CXM takes the matching play. Craig Kersey is the escalation.",
        owner: account.health.autoRed ? CRAIG : owner,
      });
    }

    const strayTest = account.projects.some((project) => {
      if (!project.isTest || project.deleted || !account.launchedAt.iso) return false;
      return utcDayNumber(project.createdAt) >= utcDayNumber(account.launchedAt.iso);
    });
    if (strayTest) {
      alerts.push({
        id: `live_test_project:${account.id}`,
        type: "live_test_project",
        severity: "medium",
        orgId: account.id,
        orgName: account.name,
        title: "A test project sits on or after launch",
        detail: "The test flag is a stand-in until is_test exists (P0-3). It is excluded from the KPI.",
        suggestedAction: "Confirm the project is flagged and is not a real signed customer.",
        owner,
      });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.orgName.localeCompare(b.orgName) || a.type.localeCompare(b.type));
}

function waitingDetail(account: Account, base: string): string {
  if (!account.waitingOnCustomer) return base;
  const reason = account.waitingReason ? ` (${account.waitingReason})` : "";
  return `${base} Waiting on the customer${reason}. The clock keeps running.`;
}
