export type RequestStatus = "draft" | "requested" | "accepted" | "in_progress" | "shipped";

export type EngineeringRequest = {
  id: string;
  priority: "P0" | "P1" | "P2" | "Later";
  title: string;
  status: RequestStatus;
  unblocks: string;
  summary: string;
};

/** The Oct 15, 2026 request is a draft. Nothing here has been sent. */
export const ENGINEERING_REQUESTS: EngineeringRequest[] = [
  {
    id: "P0-1",
    priority: "P0",
    title: "Org lifecycle dates and status history",
    status: "draft",
    unblocks: "Both clocks, stage flags, cohort day 0",
    summary:
      "onboarding_at, ready_to_launch_at, launched_at, status history, and a Waiting on customer sub-status. This is the stand-in you see on every date badge.",
  },
  {
    id: "P0-2",
    priority: "P0",
    title: "Organization id on projects and financials",
    status: "draft",
    unblocks: "Transaction Pace, account detail",
    summary: "Add organization_id so projects do not have to be fetched one account at a time.",
  },
  {
    id: "P0-3",
    priority: "P0",
    title: "Test vs live projects",
    status: "draft",
    unblocks: "KPI accuracy, launch checklist",
    summary: "is_test, deleted_at, and live_only. Until then, only projects before the launch date can be excluded.",
  },
  {
    id: "P0-4",
    priority: "P0",
    title: "Transaction rollup",
    status: "draft",
    unblocks: "Cohort board, health score",
    summary: "Bulk counts at day 30 and day 60 from launched_at, plus the first live project.",
  },
  {
    id: "P0-5",
    priority: "P0",
    title: "Sync basics",
    status: "draft",
    unblocks: "Hourly snapshots",
    summary: "Document rate limits, add updated_after, raise the page size, publish OpenAPI.",
  },
  {
    id: "P0-6",
    priority: "P0",
    title: "Scoped read token",
    status: "draft",
    unblocks: "Production access",
    summary: "Replace the superadmin Bearer token with a rotatable read-only service token.",
  },
  {
    id: "P1-1",
    priority: "P1",
    title: "Onboarding and setup status",
    status: "draft",
    unblocks: "CXM Admin checklist",
    summary: "Workflow steps, integration status without secrets, and database counts per account type.",
  },
  {
    id: "P1-2",
    priority: "P1",
    title: "Customer intake form",
    status: "draft",
    unblocks: "1–3 day setup",
    summary: "Collect users, territories, equipment, and docs at Onboarding and expose per-item status.",
  },
  {
    id: "P1-3",
    priority: "P1",
    title: "Secure credential handling",
    status: "draft",
    unblocks: "CXM Admin agent",
    summary: "Write-only secrets and a connect action that returns status, never the key.",
  },
  {
    id: "P1-4",
    priority: "P1",
    title: "Scoped setup writes",
    status: "draft",
    unblocks: "CXM Admin agent",
    summary: "Audited writes for users, equipment, and toggles. Agents cannot set Ready to Launch or Launched.",
  },
  {
    id: "P1-5",
    priority: "P1",
    title: "Webhooks or a change feed",
    status: "draft",
    unblocks: "Alerts without polling",
    summary: "Status changes, new projects, payment changes, and assignment changes.",
  },
  {
    id: "P1-6",
    priority: "P1",
    title: "AE handoff record",
    status: "draft",
    unblocks: "Handoff / Setup",
    summary: "Goals, contacts, lenders, design tool, expected volume, and target launch date.",
  },
  {
    id: "P1-7",
    priority: "P1",
    title: "Users and training",
    status: "draft",
    unblocks: "Training agent",
    summary: "Roles, invites, logins, and module completion. Define active_user_count.",
  },
  {
    id: "P2-1",
    priority: "P2",
    title: "Support data",
    status: "draft",
    unblocks: "Amanda Hatch’s view, Support Insights",
    summary: "Tickets joined to an org, with timestamps, tags, assignee, and CSAT.",
  },
  {
    id: "P2-2",
    priority: "P2",
    title: "Product usage and feedback",
    status: "draft",
    unblocks: "Product agent, health adoption input",
    summary: "Feature events and a request feed with org id.",
  },
  {
    id: "P2-3",
    priority: "P2",
    title: "Proposals and milestones",
    status: "draft",
    unblocks: "Activation metrics",
    summary: "Proposal funnel and project milestones past the created project.",
  },
  {
    id: "P2-4",
    priority: "P2",
    title: "Billing history",
    status: "draft",
    unblocks: "Renewal & Billing, health auto-red",
    summary: "Failed-payment age, MRR, plan changes, and cancellation reasons. v1 health uses current payment status only.",
  },
  {
    id: "E-N1",
    priority: "Later",
    title: "Signed-contract attributes",
    status: "draft",
    unblocks: "Reconcile the $35 billing event",
    summary:
      "Phase 1 treats a new project as the signed customer. A contract_signed_at would let finance confirm that.",
  },
  {
    id: "E-N2",
    priority: "Later",
    title: "Invoice line items and add-on entitlements",
    status: "draft",
    unblocks: "Renewal & Billing",
    summary: "Module fees versus the $35 project fee, card expiry, and add-on entitlements.",
  },
  {
    id: "E-N3",
    priority: "Later",
    title: "Integration health",
    status: "draft",
    unblocks: "Health score deployment input",
    summary: "Connection status and error counts. No secrets.",
  },
  {
    id: "E-N4",
    priority: "Later",
    title: "NPS, CSAT, and CES store",
    status: "draft",
    unblocks: "Voice of Customer",
    summary: "Survey responses with org id, plus a contact-frequency log.",
  },
  {
    id: "E-N8",
    priority: "Later",
    title: "Churn records",
    status: "draft",
    unblocks: "Churn Post-Mortem",
    summary: "churned_at, voluntary or involuntary, reason, and a history export to backtest the score.",
  },
];

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "Draft, not sent",
  requested: "Requested",
  accepted: "Accepted",
  in_progress: "In progress",
  shipped: "Shipped",
};
