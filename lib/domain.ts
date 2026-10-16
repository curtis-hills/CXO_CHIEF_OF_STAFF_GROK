import type { HealthScore } from "./metrics/health";
import type { PaceEvaluation } from "./metrics/pace";
import type { StageName, StageTiming } from "./metrics/stage";

export type AccountType = "epc" | "sales_org" | "seamless_installing_dealer";

export type DateSource = "api" | "manual" | "proxy" | "missing";

export type ResolvedDate = {
  iso: string | null;
  source: DateSource;
  note: string;
};

export type Person = {
  id: string;
  name: string;
  email: string;
};

export type ChecklistSection = "entry" | "setup" | "launch";

export type ChecklistItem = {
  id: string;
  section: ChecklistSection;
  label: string;
  owner: string;
  required: boolean;
  done: boolean;
};

export type ProjectView = {
  id: string;
  createdAt: string;
  jobType: string | null;
  systemSize: string | null;
  grossAmount: number | null;
  netAmount: number | null;
  isTest: boolean;
  deleted: boolean;
  /** Counts toward the KPI: on/after launch, not test, not deleted. */
  live: boolean;
  /** The API has no is_test field yet. Demo rows say so. */
  testFlagSource: "api" | "stand-in" | "none";
};

export type SubscriptionView = {
  status: string;
  planName: string;
  unitPrice: number;
  interval: string;
};

export type Account = {
  id: string;
  name: string;
  email: string;
  status: string;
  subStatus: string | null;
  stage: StageName | "other";
  accountType: AccountType;
  accountTypeSource: DateSource;
  accountTypeNote: string;
  legacySeamlessDealer: boolean;
  paymentStatus: string;
  /** Age of an open failed payment. Not in the API (P2-4). */
  failedPaymentDays: number | null;
  paymentAgeSource: "api" | "proxy" | "missing" | "not_applicable";
  cancellationRequested: boolean;
  city: string;
  state: string;
  postalCode: string;
  street: string;
  country: string;
  products: string[];
  customerTypes: string[];
  activeUserCount: number;
  cxm: Person | null;
  ae: Person | null;
  subscriptions: SubscriptionView[];
  onboardingAt: ResolvedDate;
  readyToLaunchAt: ResolvedDate;
  launchedAt: ResolvedDate;
  waitingOnCustomer: boolean;
  waitingReason: string | null;
  waitingSource: DateSource;
  projects: ProjectView[];
  /** False when the org list loaded and the project list did not. */
  projectsAvailable: boolean;
  checklist: ChecklistItem[];
  checklistTracked: boolean;
  pace: PaceEvaluation | null;
  stageTiming: StageTiming;
  health: HealthScore;
  /** Live projects per day for the last 14 UTC days, oldest first. */
  dailyCounts: number[];
};

export type AlertSeverity = "high" | "medium" | "low";

export type Alert = {
  id: string;
  type: string;
  severity: AlertSeverity;
  orgId: string;
  orgName: string;
  title: string;
  detail: string;
  suggestedAction: string;
  owner: string;
};

export const TRANSACTION_FEE_USD = 35;

export function accountTypeLabel(type: AccountType, legacy: boolean): string {
  if (type === "epc") return "EPC";
  if (type === "seamless_installing_dealer") return "Seamless Installing Dealer";
  return legacy ? "Sales Org · Seamless Dealer" : "Sales Org";
}

export function requiredCompletion(items: ChecklistItem[], section?: ChecklistSection): number | null {
  const required = items.filter((item) => item.required && (!section || item.section === section));
  if (required.length === 0) return null;
  return required.filter((item) => item.done).length / required.length;
}
