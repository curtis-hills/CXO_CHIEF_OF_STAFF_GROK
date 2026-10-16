import type { ApiOrg, ApiProject } from "../api/types";
import type { Account, AccountType, Alert, DateSource, Person, ProjectView, ResolvedDate } from "../domain";
import { projectDaysAgo, unscoredHealth, evaluateHealth } from "../metrics/health";
import { calendarDaysBetween, utcDayNumber } from "../metrics/calendar";
import { evaluatePace } from "../metrics/pace";
import { evaluateStage, type StageName } from "../metrics/stage";
import { buildAlerts } from "./alerts";
import { buildChecklist } from "./checklists";
import type { LifecycleOverride } from "./overrides-types";
import type { ProxyProfile } from "./mock";

export type { LifecycleOverride } from "./overrides-types";

const P0_NOTE = "The Executive API does not return this yet (P0-1).";

function resolveDate(
  apiValue: string | null | undefined,
  manualValue: string | null | undefined,
  proxyValue: string | null | undefined,
  label: string,
): ResolvedDate {
  if (apiValue) {
    return { iso: apiValue, source: "api", note: "Returned by the Executive API." };
  }
  if (manualValue) {
    return { iso: manualValue, source: "manual", note: `Manual stand-in for ${label}. ${P0_NOTE}` };
  }
  if (proxyValue) {
    return { iso: proxyValue, source: "proxy", note: `Proxy stand-in for ${label}. ${P0_NOTE}` };
  }
  return { iso: null, source: "missing", note: `${label} is missing. ${P0_NOTE}` };
}

function mapStage(status: string | null | undefined, subStatus: string | null | undefined): StageName | "other" {
  const blob = `${status ?? ""} ${subStatus ?? ""}`.toLowerCase();
  if (blob.includes("ready")) return "ready_to_launch";
  if (blob.includes("launch")) return "launched";
  if (blob.includes("onboard")) return "onboarding";
  return "other";
}

function person(value: ApiOrg["customer_experience_manager"]): Person | null {
  if (!value?.name) return null;
  return {
    id: String(value.id ?? value.email ?? value.name),
    name: value.name,
    email: value.email ?? "",
  };
}

function accountTypeFromApi(value: string | null | undefined, legacyFlag: boolean | null | undefined): {
  type: AccountType;
  legacy: boolean;
} | null {
  if (!value) return null;
  const text = value.toLowerCase();
  if (text.includes("install")) return { type: "seamless_installing_dealer", legacy: false };
  if (text.includes("sales")) {
    return { type: "sales_org", legacy: Boolean(legacyFlag) || text.includes("seamless dealer") };
  }
  if (text.includes("epc")) return { type: "epc", legacy: false };
  return null;
}

function inferAccountType(org: ApiOrg): { type: AccountType; legacy: boolean } {
  const planNames = (org.subscriptions ?? []).map((subscription) => subscription.plan?.name ?? "");
  const blob = [...(org.customer_types ?? []), ...(org.products ?? []), ...planNames, org.name ?? ""].join(" ").toLowerCase();
  if (blob.includes("installing")) return { type: "seamless_installing_dealer", legacy: false };
  if (blob.includes("seamless dealer")) return { type: "sales_org", legacy: true };
  if (blob.includes("sales and referrals") || blob.includes("sales")) return { type: "sales_org", legacy: false };
  return { type: "epc", legacy: false };
}

function planInterval(name: string, interval: string | null | undefined): string {
  if (typeof interval === "string" && interval.trim()) return interval.trim();
  if (/per contract|per sign/i.test(name)) return "contract";
  if (/year/i.test(name)) return "year";
  if (/month/i.test(name)) return "month";
  return "month";
}

function textField(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function money(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

export function assemblePortfolio(input: {
  mode: "mock" | "live";
  asOf: string;
  orgs: ApiOrg[];
  projectsByOrg: Record<string, ApiProject[]>;
  /** When false, orgs are real and project counts must not be treated as zero. */
  projectsAvailable?: boolean;
  proxies: Record<string, ProxyProfile>;
  overrides: Record<string, LifecycleOverride>;
}): { accounts: Account[]; alerts: Alert[] } {
  const accounts = input.orgs.map((org) => toAccount(org, input));
  accounts.sort((a, b) => a.name.localeCompare(b.name));
  return { accounts, alerts: buildAlerts(accounts, input.asOf) };
}

function toAccount(
  org: ApiOrg,
  input: {
    mode: "mock" | "live";
    asOf: string;
    projectsByOrg: Record<string, ApiProject[]>;
    projectsAvailable?: boolean;
    proxies: Record<string, ProxyProfile>;
    overrides: Record<string, LifecycleOverride>;
  },
): Account {
  const id = String(org.id);
  const proxy = input.proxies[id];
  const manual = input.overrides[id];
  const stage = mapStage(org.status, org.sub_status);

  const onboardingAt = resolveDate(org.onboarding_at, manual?.onboardingAt, proxy?.onboardingAt, "Onboarding date");
  const readyToLaunchAt = resolveDate(
    org.ready_to_launch_at,
    manual?.readyToLaunchAt,
    proxy?.readyToLaunchAt,
    "Ready to Launch date",
  );
  const orgProjects = input.projectsByOrg[id] ?? [];
  let launchedAt = resolveDate(org.launched_at, manual?.launchedAt, proxy?.launchedAt, "Launched date");
  let launchDateUnknown = false;
  if (!org.launched_at && !manual?.launchedAt && !proxy?.launchedAt && stage === "launched" && input.mode === "live") {
    launchDateUnknown = true;
    const earliest = earliestInstant(orgProjects.map((project) => project.created_at));
    launchedAt = earliest
      ? {
          iso: earliest,
          source: "proxy",
          note: "Launch date unknown. The earliest stored project date is a proxy until engineering ships launched_at (P0-1).",
        }
      : {
          iso: null,
          source: "missing",
          note: "Launch date unknown. No project date is stored yet to use as a proxy (P0-1).",
        };
  }

  const apiType = accountTypeFromApi(org.account_type, org.legacy_seamless_dealer);
  let accountType: AccountType;
  let legacySeamlessDealer: boolean;
  let accountTypeSource: DateSource;
  let accountTypeNote: string;
  if (apiType) {
    accountType = apiType.type;
    legacySeamlessDealer = apiType.legacy;
    accountTypeSource = "api";
    accountTypeNote = "Returned by the Executive API.";
  } else if (proxy) {
    accountType = proxy.accountType;
    legacySeamlessDealer = Boolean(proxy.legacySeamlessDealer);
    accountTypeSource = "proxy";
    accountTypeNote = `Proxy stand-in. account_type is not in the API yet. ${P0_NOTE}`;
  } else {
    const inferred = inferAccountType(org);
    accountType = inferred.type;
    legacySeamlessDealer = inferred.legacy;
    accountTypeSource = "proxy";
    accountTypeNote = `Inferred from customer type or plan name until account_type ships. ${P0_NOTE}`;
  }

  const subStatus = org.sub_status ?? null;
  let waitingOnCustomer = false;
  let waitingReason: string | null = null;
  let waitingSource: DateSource = "missing";
  if (subStatus && /wait/i.test(subStatus)) {
    waitingOnCustomer = true;
    waitingSource = "api";
  } else if (manual && manual.waitingOnCustomer !== undefined) {
    waitingOnCustomer = Boolean(manual.waitingOnCustomer);
    waitingReason = manual.waitingReason ?? null;
    waitingSource = "manual";
  } else if (proxy?.waitingOnCustomer) {
    waitingOnCustomer = true;
    waitingReason = proxy.waitingReason ?? null;
    waitingSource = "proxy";
  }

  const paymentStatus = (org.payment_status ?? "unknown").toLowerCase();
  const failed = paymentStatus === "failed" || paymentStatus === "past_due";
  let failedPaymentDays: number | null = null;
  let paymentAgeSource: Account["paymentAgeSource"] = "not_applicable";
  if (failed) {
    if (typeof proxy?.failedPaymentDays === "number") {
      failedPaymentDays = proxy.failedPaymentDays;
      paymentAgeSource = "proxy";
    } else {
      paymentAgeSource = "missing";
    }
  }

  const projectsAvailable = input.projectsAvailable !== false;
  const launchDay = launchedAt.iso ? utcDayNumber(launchedAt.iso) : null;
  const asOfDay = utcDayNumber(input.asOf);
  const projects: ProjectView[] = projectsAvailable
    ? orgProjects.map((project) => {
    const createdAt = project.created_at ?? input.asOf;
    const isTest = project.is_test === true;
    const deleted = Boolean(project.deleted_at);
    const createdDay = utcDayNumber(createdAt);
    const live =
      launchDay !== null && !isTest && !deleted && createdDay >= launchDay && createdDay <= asOfDay;
    const testFlagSource: ProjectView["testFlagSource"] =
      project.is_test === true || project.is_test === false ? (input.mode === "live" ? "api" : "stand-in") : "none";
    return {
      id: String(project.id),
      createdAt,
      jobType: project.job_type ?? null,
      systemSize: project.system_size == null ? null : String(project.system_size),
      grossAmount: project.sales_metrics?.gross_amount ?? null,
      netAmount: project.sales_metrics?.net_amount ?? null,
      isTest,
      deleted,
      live,
      testFlagSource,
    };
  })
    : [];
  projects.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const pace =
    projectsAvailable && stage === "launched" && launchedAt.iso
      ? evaluatePace({
          launchedAt: launchedAt.iso,
          asOf: input.asOf,
          transactions: projects.map((project) => ({
            createdAt: project.createdAt,
            isTest: project.isTest,
            deleted: project.deleted,
          })),
        })
      : null;

  const stageTiming = evaluateStage({
    stage: stage === "other" ? "onboarding" : stage,
    onboardingAt: onboardingAt.iso,
    readyToLaunchAt: readyToLaunchAt.iso,
    launchedAt: launchedAt.iso,
    asOf: input.asOf,
    waitingOnCustomer,
  });

  const liveDates = projects.filter((project) => project.live).map((project) => project.createdAt);
  const health = !projectsAvailable
    ? unscoredHealth("Projects could not be loaded, so pace and health are not scored from volume.")
    : stage === "launched" && !launchedAt.iso
      ? unscoredHealth(
          launchDateUnknown
            ? "Launch date unknown, and no project date is available as a proxy, so pace and health are not scored (P0-1)."
            : "Launched date is missing, so pace and health are not scored.",
        )
      : evaluateHealth({
          launched: stage === "launched",
          paceStatus: pace?.status ?? null,
          kpiDay: pace?.day ?? (launchedAt.iso ? calendarDaysBetween(launchedAt.iso, input.asOf) : null),
          projectDaysAgo: projectDaysAgo(liveDates, input.asOf),
          paymentStatus,
          failedPaymentDays,
          cancellationRequested: false,
        });

  const checklistTracked = input.mode === "mock" && Boolean(proxy?.checklist);
  const checklist = buildChecklist(
    accountType,
    legacySeamlessDealer,
    checklistTracked ? (proxy?.checklist ?? null) : null,
  );

  const dailyCounts = Array.from({ length: 14 }, () => 0);
  for (const project of projects) {
    if (!project.live) continue;
    const ago = asOfDay - utcDayNumber(project.createdAt);
    if (ago >= 0 && ago < 14) dailyCounts[13 - ago] += 1;
  }

  return {
    id,
    name: org.name?.trim() || "Unnamed account",
    email: org.email ?? "",
    status: org.status ?? "Unknown",
    subStatus,
    stage,
    accountType,
    accountTypeSource,
    accountTypeNote,
    legacySeamlessDealer,
    paymentStatus,
    failedPaymentDays,
    paymentAgeSource,
    cancellationRequested: false,
    city: textField(org.city, org.address?.city),
    state: textField(org.state, org.address?.state),
    postalCode: textField(org.postal_code, org.address?.postal_code),
    street: textField(org.street, org.address?.street),
    country: textField(org.country, org.address?.country),
    products: org.products ?? [],
    customerTypes: org.customer_types ?? [],
    activeUserCount: org.active_user_count ?? 0,
    cxm: person(org.customer_experience_manager),
    ae: person(org.account_executive),
    subscriptions: (org.subscriptions ?? []).map((subscription) => {
      const planName = subscription.plan?.name?.trim() || "Plan";
      return {
        status: subscription.status ?? "unknown",
        planName,
        unitPrice: money(subscription.plan?.unit_price),
        interval: planInterval(planName, subscription.plan?.interval),
      };
    }),
    onboardingAt,
    readyToLaunchAt,
    launchedAt,
    launchDateUnknown,
    waitingOnCustomer,
    waitingReason,
    waitingSource,
    projects,
    projectsAvailable,
    checklist,
    checklistTracked,
    pace,
    stageTiming: stage === "other" ? blankStage(stageTiming) : stageTiming,
    health,
    dailyCounts,
  };
}

function earliestInstant(values: Array<string | null | undefined>): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (!best || ms < best.ms) best = { iso: value, ms };
  }
  return best?.iso ?? null;
}

function blankStage(timing: Account["stageTiming"]): Account["stageTiming"] {
  return {
    ...timing,
    businessDaysInStage: null,
    inStageGoal: null,
    inStageFlag: null,
    inStageTone: null,
    cxmCalendarDay: null,
  };
}
