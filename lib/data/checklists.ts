import type { AccountType, ChecklistItem, ChecklistSection } from "../domain";

type Template = Omit<ChecklistItem, "done">;

const entry = (id: string, label: string, owner: string): Template => ({
  id,
  section: "entry",
  label,
  owner,
  required: true,
});

const setup = (id: string, label: string, owner: string): Template => ({
  id,
  section: "setup",
  label,
  owner,
  required: true,
});

const launch = (id: string, label: string, owner: string): Template => ({
  id,
  section: "launch",
  label,
  owner,
  required: true,
});

const ENTRY_SHARED: Template[] = [
  entry("E1", "Basic and sales info complete", "AE"),
  entry("E2", "SubHub User Agreement signed", "AE"),
  entry("E11", "Docs uploaded and the onboarding checklist sent", "AE"),
  entry("E12", "CXM assigned by Craig Kersey", "Craig Kersey"),
  entry("E13", "30-minute onboarding call booked", "AE"),
  entry("E14", "Status is Onboarding / In Progress", "AE"),
  entry("E15", "Handoff notes: goals, lenders, design tool, volume, target launch", "AE"),
  entry("E16", "Client setup packet in (users, territories, equipment, adders)", "Customer"),
];

const ENTRY_PAYMENT = entry("E5", "Subscription set and payment method stored", "AE");
const ENTRY_BYPASS = entry("E5b", "Seamless Dealer payment bypass confirmed", "AE");
const ENTRY_DEALER_AGREEMENT = entry("E3", "Seamless Home Dealer Agreement signed", "AE");
const ENTRY_INSTALLER_AGREEMENT = entry("E4", "Seamless Home Installing Dealer Agreement signed", "AE");
const ENTRY_COMPLIANCE = entry("E6", "Compliance approved and compliance call done", "AE");
const ENTRY_USERS = entry("E7", "User list: one person per user, Recheck ID, HIS where required", "AE");
const ENTRY_COI = entry("E8", "COI approved (limits, additional insured, active, legal name)", "AE");
const ENTRY_APPROVAL = entry("E9", "Installing dealer approval received", "AE");
const ENTRY_FUNDING = entry("E10", "Funding intro sent with W-9 and wire form", "AE");

const LAUNCH_ITEMS: Template[] = [
  launch("L1", "Owner / leadership training", "CXM"),
  launch("L2", "IT / admin training", "CXM"),
  launch("L3", "Sales training", "CXM"),
  launch("L4", "Operations training", "CXM"),
  launch("L5", "User invites sent", "CXM"),
  launch("L6", "Test projects removed or flagged", "CX Admin"),
  launch("L7", "Ready-to-transact email sent", "CXM"),
  launch("L8", "Status set to Launched / Active", "CXM"),
  launch("L9", "Standing post-launch calls booked", "CXM"),
];

const EPC_SETUP: Template[] = [
  setup("S1", "Onboard Organization workflow complete", "CX Admin"),
  setup("S2", "Admin users and users created, invites held", "CX Admin"),
  setup("S3", "Territories and zip codes", "CX Admin"),
  setup("S4", "Panels, inverters, and batteries", "CX Admin"),
  setup("S5", "Adders", "CX Admin"),
  setup("S6", "Perfect Packet configured", "CX Admin"),
  setup("S7", "API lender approval emails sent", "CXM"),
  setup("S8", "API lender connections confirmed (no keys in this dashboard)", "CX Admin"),
  setup("S9", "Non-API lender cards entered from rate sheets", "CX Admin"),
  setup("S10", "SubHub Sign connected", "CX Admin"),
  setup("S11", "SubHub Sign templates mapped and triggers set", "CX Admin"),
  setup("S12", "Design tool connected and users mapped", "CX Admin"),
  setup("S13", "Call Pilot configured", "CX Admin"),
  setup("S14", "Twilio configured", "CX Admin"),
  setup("S15", "Energy Insights set", "CX Admin"),
  setup("S16", "Welcome Call set", "CX Admin"),
  setup("S17", "CRM / e-sign scope decided", "CXM"),
  setup("S18", "End-to-end test transaction flagged as test", "CX Admin"),
  setup("S19", "CXM verifies configuration and sets Ready to Launch", "CXM"),
];

const SALES_ORG_SETUP: Template[] = [
  setup("S1", "Onboard Organization workflow complete", "CX Admin"),
  setup("S2", "Admin users and users created", "CX Admin"),
  setup("S3", "Territories and zip codes", "CX Admin"),
  setup("S4", "Perfect Packet configured", "CX Admin"),
  setup("S5", "Sales Organization connection on, EPC added", "CX Admin"),
  setup("S6", "Default states set", "CX Admin"),
  setup("S7", "Available lenders adjusted", "CX Admin"),
  setup("S8", "Red lines set and saved", "CX Admin"),
  setup("S9", "Parent EPC is Launched, or launching together", "CXM"),
  setup("S10", "Test proposal into the EPC, flagged as test", "CX Admin"),
  setup("S11", "CXM verifies configuration and sets Ready to Launch", "CXM"),
];

const SEAMLESS_DEALER_EXTRA: Template[] = [
  setup("SD-a", "Subscription type verified and payment bypass confirmed", "CX Admin"),
  setup("SD-b", "EPC connection is a Seamless installing dealer", "CX Admin"),
];

const INSTALLER_SETUP: Template[] = [
  setup("S1", "Entry info re-checked (agreements, subscription, funding)", "CX Admin"),
  setup("S2", "Onboard Organization workflow complete", "CX Admin"),
  setup("S3", "Users limited to the approved Recheck / HIS list", "CX Admin"),
  setup("S4", "Territories inside licensed states", "CX Admin"),
  setup("S5", "Equipment matches the Seamless AVL or the client list", "CX Admin"),
  setup("S6", "Adders", "CX Admin"),
  setup("S7", "Perfect Packet configured", "CX Admin"),
  setup("S8", "Seamless Financing toggles on", "CX Admin"),
  setup("S9", "LightReach / SolRite account confirmed with Craig Kersey", "Craig Kersey"),
  setup("S10", "GoodLeap / Concert user list sent and mapped", "CX Admin"),
  setup("S11", "SubHub Sign connected", "CX Admin"),
  setup("S12", "SubHub Sign templates mapped and triggers set", "CX Admin"),
  setup("S13", "Design tool connected and users mapped", "CX Admin"),
  setup("S14", "Call Pilot configured", "CX Admin"),
  setup("S15", "Twilio configured", "CX Admin"),
  setup("S16", "Funding cleared by the funding team", "Funding"),
  setup("S17", "End-to-end Seamless test transaction flagged as test", "CX Admin"),
  setup("S18", "CXM verifies configuration and sets Ready to Launch", "CXM"),
];

export function checklistTemplate(type: AccountType, legacySeamlessDealer: boolean): Template[] {
  if (type === "seamless_installing_dealer") {
    return [
      ...ENTRY_SHARED.slice(0, 2),
      ENTRY_INSTALLER_AGREEMENT,
      ENTRY_PAYMENT,
      ENTRY_COMPLIANCE,
      ENTRY_USERS,
      ENTRY_COI,
      ENTRY_APPROVAL,
      ENTRY_FUNDING,
      ...ENTRY_SHARED.slice(2),
      ...INSTALLER_SETUP,
      ...LAUNCH_ITEMS,
    ];
  }

  if (legacySeamlessDealer) {
    return [
      ...ENTRY_SHARED.slice(0, 2),
      ENTRY_DEALER_AGREEMENT,
      ENTRY_BYPASS,
      ENTRY_USERS,
      ENTRY_FUNDING,
      ...ENTRY_SHARED.slice(2),
      ...SALES_ORG_SETUP,
      ...SEAMLESS_DEALER_EXTRA,
      ...LAUNCH_ITEMS,
    ];
  }

  if (type === "sales_org") {
    return [...ENTRY_SHARED.slice(0, 2), ENTRY_PAYMENT, ...ENTRY_SHARED.slice(2), ...SALES_ORG_SETUP, ...LAUNCH_ITEMS];
  }

  return [...ENTRY_SHARED.slice(0, 2), ENTRY_PAYMENT, ...ENTRY_SHARED.slice(2), ...EPC_SETUP, ...LAUNCH_ITEMS];
}

export type ChecklistSeed = {
  entry: number;
  setup: number;
  launch: number;
  forceOpen?: string[];
};

export function buildChecklist(
  type: AccountType,
  legacySeamlessDealer: boolean,
  seed: ChecklistSeed | null,
): ChecklistItem[] {
  const items = checklistTemplate(type, legacySeamlessDealer);
  if (!seed) return items.map((item) => ({ ...item, done: false }));

  const ratios: Record<ChecklistSection, number> = {
    entry: seed.entry,
    setup: seed.setup,
    launch: seed.launch,
  };
  const progress: Record<ChecklistSection, { seen: number; target: number }> = {
    entry: { seen: 0, target: 0 },
    setup: { seen: 0, target: 0 },
    launch: { seen: 0, target: 0 },
  };
  for (const section of ["entry", "setup", "launch"] as const) {
    const required = items.filter((item) => item.section === section && item.required).length;
    progress[section].target = Math.round(required * ratios[section]);
  }

  return items.map((item) => {
    if (!item.required) return { ...item, done: false };
    const bucket = progress[item.section];
    bucket.seen += 1;
    const opened = seed.forceOpen?.includes(item.id) ?? false;
    return { ...item, done: bucket.seen <= bucket.target && !opened };
  });
}
