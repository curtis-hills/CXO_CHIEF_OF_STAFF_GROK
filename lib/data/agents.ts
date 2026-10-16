export type AgentStatus = "partial" | "blocked";

export type CoverageState = "available" | "partial" | "missing";

export type AgentCoverage = {
  label: string;
  state: CoverageState;
};

export type AgentProfile = {
  slug: string;
  name: string;
  status: AgentStatus;
  purpose: string;
  triggers: string;
  actions: string;
  kpis: string;
  coverage: AgentCoverage[];
};

export const AGENTS: AgentProfile[] = [
  {
    slug: "handoff-setup",
    name: "Handoff / Setup",
    status: "partial",
    purpose: "Watch the AE handoff into Onboarding and the path to Ready to Launch.",
    triggers: "New Onboarding status, missing CXM, stage flag breached.",
    actions: "Flag a deficiency list back to the AE. Does not email the customer.",
    kpis: "Business days Onboarding → Ready to Launch against 1 / 3.",
    coverage: [
      { label: "Current status and sub-status", state: "available" },
      { label: "CXM and AE assignment", state: "available" },
      { label: "Payment status and subscription", state: "available" },
      { label: "Onboarding timestamp", state: "missing" },
      { label: "Clean-handoff checklist", state: "partial" },
      { label: "Agreements via e-sign", state: "partial" },
    ],
  },
  {
    slug: "cxm-admin",
    name: "CXM Admin",
    status: "blocked",
    purpose: "Do CX Admin setup from a clean handoff to Ready to Launch. Never sets Launched and never sees secrets.",
    triggers: "Onboarding with a complete entry checklist, by account type.",
    actions: "Draft setup steps. Lender keys, tokens, and the RTL decision stay with a human.",
    kpis: "Checklist completion and business days to Ready to Launch.",
    coverage: [
      { label: "Org status", state: "available" },
      { label: "Active user count", state: "partial" },
      { label: "Setup workflow and integration status", state: "missing" },
      { label: "Test-project flag", state: "missing" },
    ],
  },
  {
    slug: "training",
    name: "Training",
    status: "blocked",
    purpose: "Track owner, admin, sales, and operations training between Ready to Launch and Launched.",
    triggers: "Account enters Ready to Launch.",
    actions: "Show the training checklist. The CXM runs the sessions and sets Launched.",
    kpis: "Training items complete before Launched. Goal 3 / flag 5 business days.",
    coverage: [
      { label: "Active user count", state: "partial" },
      { label: "Users, invites, and logins", state: "missing" },
      { label: "Training completion", state: "missing" },
    ],
  },
  {
    slug: "transaction-pace",
    name: "Transaction Pace",
    status: "partial",
    purpose: "Score every launched account against 10 projects in 30 days and 25 in 60.",
    triggers: "Daily after Launched. At risk, missed, or no project in 7 days.",
    actions: "Open a pace alert for the CXM. Amanda Hatch’s chat support is first contact after launch.",
    kpis: "Share of the cohort on pace, and accounts at risk.",
    coverage: [
      { label: "Projects and created_at", state: "available" },
      { label: "Launched date", state: "missing" },
      { label: "Test vs live flag", state: "missing" },
      { label: "Per-org rollup", state: "missing" },
    ],
  },
  {
    slug: "support-insights",
    name: "Support Insights",
    status: "blocked",
    purpose: "Read chat themes, CSAT, and repeat issues after launch.",
    triggers: "Ticket spike or low CSAT on a launched account.",
    actions: "Summarize themes for Amanda Hatch and route product issues onward.",
    kpis: "First response, resolution time, CSAT.",
    coverage: [
      { label: "Org email for matching", state: "partial" },
      { label: "Tickets, tags, CSAT", state: "missing" },
    ],
  },
  {
    slug: "product",
    name: "Product",
    status: "blocked",
    purpose: "Watch job-type mix and the feature requests that support and CXMs keep seeing.",
    triggers: "Repeated request or a job type showing up in new accounts.",
    actions: "Keep a prototype backlog. No customer contact.",
    kpis: "Requests tied to an account, and mix of products in the cohort.",
    coverage: [
      { label: "Products and job type", state: "available" },
      { label: "Finance mix", state: "partial" },
      { label: "Feature usage and requests", state: "missing" },
    ],
  },
  {
    slug: "health-retention",
    name: "Health & Retention",
    status: "partial",
    purpose: "Score launched accounts from volume trend and billing. v1 only. Route Red accounts.",
    triggers: "Nightly. Score crosses into Red, or a failed payment ages past 7 days.",
    actions: "Explain the drivers and open a risk task. Outreach is drafted for a CXM to approve.",
    kpis: "Share of accounts in Red, and launch-KPI misses.",
    coverage: [
      { label: "Project volume", state: "available" },
      { label: "Payment status", state: "partial" },
      { label: "90-day baseline needs history", state: "partial" },
      { label: "Adoption, support, NPS", state: "missing" },
    ],
  },
  {
    slug: "growth-expansion",
    name: "Growth / Expansion",
    status: "blocked",
    purpose: "Find module, add-on, and trade expansion. $35 per signed project is the volume lever.",
    triggers: "Sales Velocity only with install volume, or a promoter with room to add a module.",
    actions: "Hand a pitch to the AE or CXM. A human sends it.",
    kpis: "Expansion MRR and module attach.",
    coverage: [
      { label: "Subscription modules", state: "partial" },
      { label: "Trade type and contract value", state: "missing" },
    ],
  },
  {
    slug: "voice-of-customer",
    name: "Voice of Customer / NPS",
    status: "blocked",
    purpose: "Run relationship NPS, ticket CSAT, and onboarding effort, then close the loop.",
    triggers: "Day 90 NPS, a detractor, or CSAT after a ticket.",
    actions: "Theme verbatims. Detractors go to the CXM within 48 hours. Sends need approval.",
    kpis: "Response rate, NPS, detractors contacted.",
    coverage: [{ label: "Survey responses", state: "missing" }],
  },
  {
    slug: "renewal-billing",
    name: "Renewal & Billing",
    status: "blocked",
    purpose: "Treat every month as a renewal. Catch failed payments before they become involuntary churn.",
    triggers: "Failed payment, card expiring, downgrade or cancel request.",
    actions: "Draft a dunning note. Never changes billing. Escalate aged failures to Craig Kersey.",
    kpis: "Involuntary churn and recovery.",
    coverage: [
      { label: "Current payment status", state: "partial" },
      { label: "Invoices, dunning stage, card expiry", state: "missing" },
    ],
  },
  {
    slug: "business-review",
    name: "Business Review Prep",
    status: "blocked",
    purpose: "Assemble the volume, pace, and open-issue brief before a business review.",
    triggers: "14 days before a scheduled review.",
    actions: "Draft the deck for the CXM. A human holds the meeting.",
    kpis: "High-touch accounts reviewed in the last 90 days.",
    coverage: [
      { label: "Volume and pace", state: "partial" },
      { label: "Adoption, peer benchmarks, deal value", state: "missing" },
    ],
  },
  {
    slug: "knowledge-education",
    name: "Knowledge / Education",
    status: "blocked",
    purpose: "Point accounts at the right training and keep help articles aligned with tickets.",
    triggers: "No certified admin, or a ticket cluster with no article.",
    actions: "Recommend a learning path. Publishing an article needs approval.",
    kpis: "Certified admins per account.",
    coverage: [
      { label: "Training records", state: "missing" },
      { label: "Help center and tickets", state: "missing" },
    ],
  },
  {
    slug: "advocacy",
    name: "Advocacy",
    status: "blocked",
    purpose: "Ask healthy promoters for a reference, review, or Ambassador referral. At most once a quarter.",
    triggers: "Green health, promoter NPS, and top-quartile volume.",
    actions: "Draft the ask. A human sends it.",
    kpis: "Referenceable accounts and referral pipeline.",
    coverage: [
      { label: "Health and volume", state: "partial" },
      { label: "NPS and referral data", state: "missing" },
    ],
  },
  {
    slug: "lifecycle-comms",
    name: "Lifecycle Comms",
    status: "blocked",
    purpose: "Cover digital-touch accounts with templated nudges after a human approves the sequence.",
    triggers: "Stage changes and usage gaps on low-touch accounts.",
    actions: "Recommend the next message. Individual sends stay visible to the CXM.",
    kpis: "Activation of the digital-touch cohort.",
    coverage: [
      { label: "Lifecycle stage", state: "partial" },
      { label: "Usage events", state: "missing" },
    ],
  },
  {
    slug: "churn-postmortem",
    name: "Churn Post-Mortem",
    status: "blocked",
    purpose: "After a cancel or a non-payment churn, check whether the health score saw it coming.",
    triggers: "Cancellation or involuntary churn.",
    actions: "Assemble the timeline and feed the next score recalibration.",
    kpis: "Share of churns flagged at least 30 days ahead.",
    coverage: [
      { label: "Churn date, type, and reason", state: "missing" },
      { label: "Historical score", state: "missing" },
    ],
  },
];

export function coveragePercent(agent: AgentProfile): number {
  if (agent.coverage.length === 0) return 0;
  const score = agent.coverage.reduce((sum, item) => {
    if (item.state === "available") return sum + 1;
    if (item.state === "partial") return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((score / agent.coverage.length) * 100);
}

export function agentBySlug(slug: string): AgentProfile | undefined {
  return AGENTS.find((agent) => agent.slug === slug);
}
