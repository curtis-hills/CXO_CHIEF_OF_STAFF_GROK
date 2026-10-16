import type { ApiOrg, ApiProject, ApiSubscription } from "../api/types";
import type { EndpointId } from "./catalog";
import { rowActivityAt } from "./high-water";

export type OrgRow = {
  id: string;
  name: string | null;
  email: string | null;
  status: string | null;
  subStatus: string | null;
  paymentStatus: string | null;
  accountType: string | null;
  city: string | null;
  state: string | null;
  cxmId: string | null;
  cxmName: string | null;
  aeId: string | null;
  aeName: string | null;
  activeUserCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: ApiOrg;
};

export type SubscriptionRow = {
  id: string;
  orgId: string;
  status: string | null;
  planName: string | null;
  unitPrice: number | null;
  interval: string | null;
  raw: ApiSubscription;
};

export type ProjectRow = {
  id: string;
  orgId: string | null;
  jobType: string | null;
  systemSize: string | null;
  isTest: boolean | null;
  deletedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: ApiProject;
};

export type GenericRow = {
  id: string;
  orgId: string | null;
  projectId: string | null;
  status: string | null;
  amount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function idOf(row: Record<string, unknown>): string | null {
  return text(row.id);
}

export function orgIdOf(row: unknown): string | null {
  const recordRow = record(row);
  if (!recordRow) return null;
  const nested = record(recordRow.org);
  return text(recordRow.org_id) ?? text(recordRow.organization_id) ?? text(nested?.id);
}

function projectIdOf(row: Record<string, unknown>): string | null {
  const nested = record(row.project);
  return text(row.project_id) ?? text(nested?.id);
}

export function normalizeOrg(raw: unknown): OrgRow | null {
  const row = record(raw);
  const id = row ? idOf(row) : null;
  if (!row || !id) return null;
  const org = raw as ApiOrg;
  const address = record(row.address);
  const cxm = record(row.customer_experience_manager);
  const ae = record(row.account_executive);
  return {
    id,
    name: text(row.name),
    email: text(row.email),
    status: text(row.status),
    subStatus: text(row.sub_status),
    paymentStatus: text(row.payment_status),
    accountType: text(row.account_type),
    city: text(row.city) ?? text(address?.city),
    state: text(row.state) ?? text(address?.state),
    cxmId: text(cxm?.id),
    cxmName: text(cxm?.name),
    aeId: text(ae?.id),
    aeName: text(ae?.name),
    activeUserCount: typeof row.active_user_count === "number" ? row.active_user_count : null,
    createdAt: rowActivityAt({ created_at: row.created_at }) ,
    updatedAt: rowActivityAt({ updated_at: row.updated_at }),
    raw: { ...org, id },
  };
}

export function subscriptionsForOrg(org: OrgRow): SubscriptionRow[] {
  const list = org.raw.subscriptions ?? [];
  return list.map((subscription, index) => {
    const planId = subscription.plan?.id;
    return {
      id: planId != null ? `${org.id}:plan:${planId}` : `${org.id}:${index}`,
      orgId: org.id,
      status: subscription.status ?? null,
      planName: subscription.plan?.name ?? null,
      unitPrice: money(subscription.plan?.unit_price),
      interval: subscription.plan?.interval ?? null,
      raw: subscription,
    };
  });
}

export function normalizeProject(raw: unknown): ProjectRow | null {
  const row = record(raw);
  const id = row ? idOf(row) : null;
  if (!row || !id) return null;
  const project = raw as ApiProject;
  return {
    id,
    orgId: orgIdOf(row),
    jobType: text(row.job_type),
    systemSize: text(row.system_size),
    isTest: typeof row.is_test === "boolean" ? row.is_test : null,
    deletedAt: text(row.deleted_at),
    createdAt: rowActivityAt({ created_at: row.created_at }),
    updatedAt: rowActivityAt({ updated_at: row.updated_at }),
    raw: { ...project, id },
  };
}

export function normalizeGeneric(raw: unknown): GenericRow | null {
  const row = record(raw);
  const id = row ? idOf(row) : null;
  if (!row || !id) return null;
  const metrics = record(row.sales_metrics);
  return {
    id,
    orgId: orgIdOf(row),
    projectId: projectIdOf(row),
    status: text(row.status),
    amount: money(row.amount) ?? money(row.total) ?? money(metrics?.gross_amount),
    createdAt: rowActivityAt({ created_at: row.created_at }),
    updatedAt: rowActivityAt({ updated_at: row.updated_at }),
    raw: row,
  };
}

export function normalizeFor(endpoint: EndpointId, raw: unknown): OrgRow | ProjectRow | GenericRow | null {
  if (endpoint === "orgs") return normalizeOrg(raw);
  if (endpoint === "projects") return normalizeProject(raw);
  return normalizeGeneric(raw);
}
