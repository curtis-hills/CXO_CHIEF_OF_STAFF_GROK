/**
 * Postgres shapes for a later snapshot phase.
 * Phase 1 does not open a database. Pages call the Executive API (or demo data)
 * on each request. Manual date stand-ins are a JSON file until these tables exist.
 */

export type OrgSnapshotRow = {
  orgId: string;
  capturedAt: string;
  paymentStatus: string | null;
  status: string | null;
  subStatus: string | null;
  activeUserCount: number | null;
  cxmId: string | null;
  aeId: string | null;
  subscriptionStatus: string | null;
  planName: string | null;
};

export type OrgStartDateRow = {
  orgId: string;
  onboardingAt: string | null;
  readyToLaunchAt: string | null;
  launchedAt: string | null;
  source: "api" | "proxy" | "manual";
};

export type StageEventRow = {
  orgId: string;
  status: string;
  subStatus: string | null;
  enteredAt: string;
  source: "api" | "snapshot" | "manual";
};

export type DailyOrgCountRow = {
  orgId: string;
  date: string;
  transactions: number;
  cumulative: number;
};

export type ChecklistRow = {
  orgId: string;
  checklist: "entry" | "setup" | "launch";
  item: string;
  required: boolean;
  status: "open" | "done";
  evidence: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
};
