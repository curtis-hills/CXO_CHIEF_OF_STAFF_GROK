import type { Account, Alert } from "../domain";

/**
 * Curtis's default book of business. Test and demo orgs stay out unless the
 * include-tests toggle is on. Cancelled and suspended payments are flagged
 * and stay in the list.
 */
export const DEFAULT_ORG_STATUSES = ["Won", "Onboarding", "Launched", "Retention"] as const;

export const KNOWN_ORG_STATUSES = [
  "Won",
  "Onboarding",
  "Launched",
  "Retention",
  "Ready to Launch",
  "New",
  "Contacting",
  "Connected",
  "Follow Up",
  "Negotiation",
  "Aged",
  "Dormant",
  "Not Interested",
  "Unqualified",
  "Cancelled",
  "Suspended",
  "Demo",
  "Demo Org",
] as const;

export const EXCLUDED_ORG_STATUSES = ["Demo", "Demo Org"] as const;

export type PaymentFilter = "all" | "flagged" | "clear";

export type StatusMode = "default" | "explicit" | "all";

export type PortfolioFilter = {
  /** Empty means every status. */
  statuses: string[];
  statusMode: StatusMode;
  cxm: string;
  ae: string;
  includeTests: boolean;
  payment: PaymentFilter;
};

export type FilterableOrg = {
  id?: string;
  name: string;
  status: string;
  paymentStatus: string;
  cxm: { name: string } | null;
  ae: { name: string } | null;
};

export type QueryValue = string | string[] | undefined;
export type Query = Record<string, QueryValue>;

const QA_BOT_NAME = /\bqa[\s_-]*bot\b/i;

export function isQaBotName(name: string): boolean {
  return QA_BOT_NAME.test(name);
}

/** The word test or demo, so "Greatest" and "Demonstration" stay in the book. */
function hasWord(name: string, word: string): boolean {
  return new RegExp(`(?:^|[^a-z])${word}(?:[^a-z]|$)`, "i").test(name);
}

export function isTestOrDemoOrg(org: { name: string; status: string }): boolean {
  if (hasWord(org.name, "test") || hasWord(org.name, "demo")) return true;
  if (isQaBotName(org.name)) return true;
  const status = org.status.trim().toLowerCase();
  return status === "demo" || status === "demo org";
}

export function isPaymentFlagged(paymentStatus: string): boolean {
  const value = paymentStatus.trim().toLowerCase();
  return value === "cancelled" || value === "canceled" || value === "suspended";
}

function many(value: QueryValue): string[] {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return source
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function one(value: QueryValue): string {
  const [first] = many(value);
  return first ?? "";
}

export function canonicalStatus(value: string): string {
  const trimmed = value.trim();
  const known = KNOWN_ORG_STATUSES.find((status) => status.toLowerCase() === trimmed.toLowerCase());
  return known ?? trimmed;
}

export function readPortfolioFilter(query: Query, mode: "mock" | "live"): PortfolioFilter {
  const orgSet = one(query.orgSet) === "1";
  const requested = [...new Set(many(query.org).map(canonicalStatus))];
  const statusMode: StatusMode =
    requested.length > 0 ? "explicit" : orgSet ? "all" : mode === "live" ? "default" : "all";
  const paymentValue = one(query.pay);
  const payment: PaymentFilter = paymentValue === "flagged" || paymentValue === "clear" ? paymentValue : "all";
  return {
    statuses: statusMode === "default" ? [...DEFAULT_ORG_STATUSES] : statusMode === "explicit" ? requested : [],
    statusMode,
    cxm: one(query.cxm),
    ae: one(query.ae),
    includeTests: one(query.tests) === "1",
    payment,
  };
}

function personName(person: { name: string } | null): string {
  return person?.name?.trim() ?? "";
}

function matchesPerson(selected: string, person: { name: string } | null): boolean {
  if (!selected) return true;
  if (selected === "unassigned") return !personName(person);
  return personName(person) === selected;
}

export function applyPortfolioFilter<T extends FilterableOrg>(accounts: T[], filter: PortfolioFilter): T[] {
  return accounts.filter((account) => {
    if (!filter.includeTests && isTestOrDemoOrg(account)) return false;
    if (filter.statuses.length > 0) {
      const status = canonicalStatus(account.status);
      const selected = new Set(filter.statuses.map((item) => item.toLowerCase()));
      if (!selected.has(status.toLowerCase())) return false;
    }
    if (!matchesPerson(filter.cxm, account.cxm)) return false;
    if (!matchesPerson(filter.ae, account.ae)) return false;
    const flagged = isPaymentFlagged(account.paymentStatus);
    if (filter.payment === "flagged" && !flagged) return false;
    if (filter.payment === "clear" && flagged) return false;
    return true;
  });
}

export function alertsForAccounts(alerts: Alert[], accounts: { id: string }[]): Alert[] {
  const ids = new Set(accounts.map((account) => account.id));
  return alerts.filter((alert) => ids.has(alert.orgId));
}

export function statusChoices(accounts: { status: string }[]): string[] {
  const choices = new Map<string, string>();
  for (const status of KNOWN_ORG_STATUSES) choices.set(status.toLowerCase(), status);
  for (const account of accounts) {
    const status = canonicalStatus(account.status);
    if (!status || status.toLowerCase() === "unknown") continue;
    if (!choices.has(status.toLowerCase())) choices.set(status.toLowerCase(), status);
  }
  return [...choices.values()];
}

export function personChoices(accounts: FilterableOrg[], field: "cxm" | "ae"): string[] {
  return [...new Set(accounts.map((account) => personName(account[field])).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export type NamedCount = { name: string; count: number };

export function countByStatus(accounts: { status: string }[], include: string[] = []): NamedCount[] {
  const counts = new Map<string, NamedCount>();
  for (const status of include) {
    const name = canonicalStatus(status);
    counts.set(name.toLowerCase(), { name, count: 0 });
  }
  for (const account of accounts) {
    const name = canonicalStatus(account.status || "Unknown");
    const key = name.toLowerCase();
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { name, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function countByPerson(accounts: FilterableOrg[], field: "cxm" | "ae"): NamedCount[] {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    const name = personName(account[field]) || "Unassigned";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function appendOrgFilter(params: URLSearchParams, filter: PortfolioFilter): void {
  params.set("orgSet", "1");
  for (const status of filter.statuses) params.append("org", status);
  if (filter.cxm) params.set("cxm", filter.cxm);
  if (filter.ae) params.set("ae", filter.ae);
  if (filter.includeTests) params.set("tests", "1");
  if (filter.payment !== "all") params.set("pay", filter.payment);
}

export function visibleBook(portfolio: { mode: "mock" | "live"; accounts: Account[]; alerts: Alert[] }, query: Query = {}) {
  const filter = readPortfolioFilter(query, portfolio.mode);
  const accounts = applyPortfolioFilter(portfolio.accounts, filter);
  return { filter, accounts, alerts: alertsForAccounts(portfolio.alerts, accounts) };
}
