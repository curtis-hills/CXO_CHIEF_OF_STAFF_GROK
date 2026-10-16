import type { ApiProject } from "../api/types";
import { isOrgLinkKey } from "./profile";

/**
 * Projects do not always carry a column org id. A row maps to an org when any
 * of these point at an id in `orgs`, in this order:
 * 1. projects.org_id
 * 2. an org-link key on the project raw payload
 * 3. esign_status organization/org id plus project id
 * 4. commissions, the same way
 * 5. financials, the same way
 */

export type StoredProjectLinkRow = {
  id: string;
  orgId: string | null;
  raw: unknown;
  createdAt?: string | null;
  deletedAt?: string | null;
  isTest?: boolean | null;
  jobType?: string | null;
  systemSize?: string | null;
};

export type StoredChildLinkRow = {
  orgId: string | null;
  projectId: string | null;
  raw: unknown;
};

export type ProjectOrgLink = {
  projectId: string;
  orgId: string;
  route: string;
};

const PROJECT_COLUMN_RANK = 0;
const PROJECT_RAW_RANK = 10;
const ESIGN_COLUMN_RANK = 20;
const ESIGN_RAW_RANK = 21;
const COMMISSION_COLUMN_RANK = 30;
const COMMISSION_RAW_RANK = 31;
const FINANCIAL_COLUMN_RANK = 40;
const FINANCIAL_RAW_RANK = 41;

function rawKeyRank(key: string, base: number): number {
  if (/(^|_)(organization|organisation|org)_id$/i.test(key)) return base;
  if (/(^|_)(organization|organisation|org)$/i.test(key)) return base + 1;
  if (/_id$/i.test(key)) return base + 2;
  return base + 3;
}

export function textId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

/** Scalar id, or the id on an object. Arrays and blanks are not org refs. */
export function orgRefFromValue(value: unknown): string | null {
  const direct = textId(value);
  if (direct) return direct;
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  return textId(record.id);
}

export function projectIdFromChild(row: StoredChildLinkRow): string | null {
  const raw = asRecord(row.raw);
  const nested = asRecord(raw.project);
  return textId(row.projectId) ?? textId(raw.project_id) ?? textId(nested.id);
}

export function linkProjectsToOrgs(input: {
  orgIds: Iterable<string>;
  projects: StoredProjectLinkRow[];
  esign?: StoredChildLinkRow[];
  commissions?: StoredChildLinkRow[];
  financials?: StoredChildLinkRow[];
}): Map<string, ProjectOrgLink> {
  const orgIds = new Set([...input.orgIds].map((id) => id.trim()).filter(Boolean));
  const best = new Map<string, ProjectOrgLink & { rank: number }>();

  function consider(projectId: string | null, orgRef: string | null, route: string, rank: number) {
    if (!projectId || !orgRef || !orgIds.has(orgRef)) return;
    const current = best.get(projectId);
    if (current && current.rank <= rank) return;
    best.set(projectId, { projectId, orgId: orgRef, route, rank });
  }

  function considerRaw(projectId: string | null, raw: unknown, routePrefix: string, rank: number) {
    const record = asRecord(raw);
    for (const key of Object.keys(record).filter((item) => isOrgLinkKey(item)).sort()) {
      consider(projectId, orgRefFromValue(record[key]), `${routePrefix}${key}`, rawKeyRank(key, rank));
    }
  }

  for (const project of input.projects) {
    consider(project.id, textId(project.orgId), "projects.org_id", PROJECT_COLUMN_RANK);
    considerRaw(project.id, project.raw, "projects.raw.", PROJECT_RAW_RANK);
  }

  function considerChildren(rows: StoredChildLinkRow[] | undefined, table: string, columnRank: number, rawRank: number) {
    for (const row of rows ?? []) {
      const projectId = projectIdFromChild(row);
      consider(projectId, textId(row.orgId), `${table}.org_id+project_id`, columnRank);
      const raw = asRecord(row.raw);
      for (const key of Object.keys(raw).filter((item) => isOrgLinkKey(item)).sort()) {
        consider(projectId, orgRefFromValue(raw[key]), `${table}.raw.${key}+project_id`, rawKeyRank(key, rawRank));
      }
    }
  }

  considerChildren(input.esign, "esign_status", ESIGN_COLUMN_RANK, ESIGN_RAW_RANK);
  considerChildren(input.commissions, "commissions", COMMISSION_COLUMN_RANK, COMMISSION_RAW_RANK);
  considerChildren(input.financials, "financials", FINANCIAL_COLUMN_RANK, FINANCIAL_RAW_RANK);

  return new Map([...best.entries()].map(([projectId, link]) => [projectId, { projectId, orgId: link.orgId, route: link.route }]));
}

function projectPayload(row: StoredProjectLinkRow): ApiProject {
  const raw = asRecord(row.raw);
  const payload: ApiProject = { ...(raw as unknown as ApiProject), id: row.id };
  if (!payload.created_at && row.createdAt) payload.created_at = row.createdAt;
  if (!payload.deleted_at && row.deletedAt) payload.deleted_at = row.deletedAt;
  if ((payload.is_test === undefined || payload.is_test === null) && typeof row.isTest === "boolean") payload.is_test = row.isTest;
  if (!payload.job_type && row.jobType) payload.job_type = row.jobType;
  if ((payload.system_size === undefined || payload.system_size === null) && row.systemSize) {
    payload.system_size = row.systemSize;
  }
  return payload;
}

export function projectsByOrg(input: {
  orgIds: Iterable<string>;
  projects: StoredProjectLinkRow[];
  esign?: StoredChildLinkRow[];
  commissions?: StoredChildLinkRow[];
  financials?: StoredChildLinkRow[];
}): { projectsByOrg: Record<string, ApiProject[]>; links: ProjectOrgLink[] } {
  const links = linkProjectsToOrgs(input);
  const grouped: Record<string, ApiProject[]> = {};
  for (const project of input.projects) {
    const link = links.get(project.id);
    if (!link) continue;
    grouped[link.orgId] ??= [];
    grouped[link.orgId].push(projectPayload(project));
  }
  return { projectsByOrg: grouped, links: [...links.values()] };
}
