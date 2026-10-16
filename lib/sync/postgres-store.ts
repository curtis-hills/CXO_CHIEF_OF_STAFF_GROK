import "server-only";

import type { ApiOrg, ApiProject } from "../api/types";
import { projectsByOrg, type StoredChildLinkRow, type StoredProjectLinkRow } from "../data/project-orgs";
import { getSql } from "../db/sql";
import type { EndpointId } from "./catalog";
import type { GenericRow, OrgRow, ProjectRow, SubscriptionRow } from "./rows";
import type { CursorState, SnapshotRow, SyncRunRow, SyncStore } from "./types";

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(Date.parse(value)).toISOString();
  return null;
}

function day(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function integerOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

function boolOf(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1 || value === "1";
}

/** Neon sometimes returns integers and booleans as strings. A missed page number restarts the list. */
export function cursorStateFromRow(row: Record<string, unknown>): CursorState {
  return {
    cursor: typeof row.cursor === "string" ? row.cursor : null,
    page: integerOf(row.page),
    highWater: iso(row.high_water),
    passComplete: boolOf(row.pass_complete),
    backfillComplete: boolOf(row.backfill_complete),
    disabled: boolOf(row.disabled),
    strategy: row.strategy === "per-org" ? "per-org" : "platform",
    orgIndex: integerOf(row.org_index) ?? 0,
    fullPass: boolOf(row.full_pass),
    lastReconcileDay: day(row.last_reconcile_day),
    unsupportedFilters: asStringList(row.unsupported_filters),
    unsupportedSorts: asStringList(row.unsupported_sorts),
    lastError: typeof row.last_error === "string" ? row.last_error : null,
  };
}

export const ORG_UPSERT = `
INSERT INTO orgs (
  id, name, email, status, sub_status, payment_status, account_type, city, state,
  cxm_id, cxm_name, ae_id, ae_name, active_user_count, created_at, updated_at, raw, synced_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  status = EXCLUDED.status,
  sub_status = EXCLUDED.sub_status,
  payment_status = EXCLUDED.payment_status,
  account_type = EXCLUDED.account_type,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  cxm_id = EXCLUDED.cxm_id,
  cxm_name = EXCLUDED.cxm_name,
  ae_id = EXCLUDED.ae_id,
  ae_name = EXCLUDED.ae_name,
  active_user_count = EXCLUDED.active_user_count,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  raw = EXCLUDED.raw,
  synced_at = now()
`;

export const PROJECT_UPSERT = `
INSERT INTO projects (
  id, org_id, job_type, system_size, is_test, deleted_at, created_at, updated_at, raw, synced_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now()
)
ON CONFLICT (id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  job_type = EXCLUDED.job_type,
  system_size = EXCLUDED.system_size,
  is_test = EXCLUDED.is_test,
  deleted_at = EXCLUDED.deleted_at,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  raw = EXCLUDED.raw,
  synced_at = now()
`;

const GENERIC_UPSERT = (table: string) => `
INSERT INTO ${table} (
  id, org_id, project_id, status, amount, created_at, updated_at, raw, synced_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8::jsonb, now()
)
ON CONFLICT (id) DO UPDATE SET
  org_id = EXCLUDED.org_id,
  project_id = EXCLUDED.project_id,
  status = EXCLUDED.status,
  amount = EXCLUDED.amount,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  raw = EXCLUDED.raw,
  synced_at = now()
`;

export class PostgresStore implements SyncStore {
  async upsertOrgs(rows: OrgRow[], subscriptions: SubscriptionRow[]): Promise<void> {
    const sql = getSql();
    for (const row of rows) {
      await sql.query(ORG_UPSERT, [
        row.id,
        row.name,
        row.email,
        row.status,
        row.subStatus,
        row.paymentStatus,
        row.accountType,
        row.city,
        row.state,
        row.cxmId,
        row.cxmName,
        row.aeId,
        row.aeName,
        row.activeUserCount,
        row.createdAt,
        row.updatedAt,
        JSON.stringify(row.raw),
      ]);
    }
    if (rows.length === 0) return;
    await sql.query(`DELETE FROM org_subscriptions WHERE org_id = ANY($1::text[])`, [rows.map((row) => row.id)]);
    for (const row of subscriptions) {
      await sql.query(
        `INSERT INTO org_subscriptions (id, org_id, status, plan_name, unit_price, interval, raw, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET
           org_id = EXCLUDED.org_id,
           status = EXCLUDED.status,
           plan_name = EXCLUDED.plan_name,
           unit_price = EXCLUDED.unit_price,
           interval = EXCLUDED.interval,
           raw = EXCLUDED.raw,
           synced_at = now()`,
        [row.id, row.orgId, row.status, row.planName, row.unitPrice, row.interval, JSON.stringify(row.raw)],
      );
    }
  }

  async upsertProjects(rows: ProjectRow[]): Promise<void> {
    const sql = getSql();
    for (const row of rows) {
      await sql.query(PROJECT_UPSERT, [
        row.id,
        row.orgId,
        row.jobType,
        row.systemSize,
        row.isTest,
        row.deletedAt,
        row.createdAt,
        row.updatedAt,
        JSON.stringify(row.raw),
      ]);
    }
  }

  async upsertGeneric(endpoint: Exclude<EndpointId, "orgs" | "projects">, rows: GenericRow[]): Promise<void> {
    const table = endpoint === "financials" ? "financials" : endpoint === "esign_status" ? "esign_status" : "commissions";
    const sql = getSql();
    const statement = GENERIC_UPSERT(table);
    for (const row of rows) {
      await sql.query(statement, [
        row.id,
        row.orgId,
        row.projectId,
        row.status,
        row.amount,
        row.createdAt,
        row.updatedAt,
        JSON.stringify(row.raw),
      ]);
    }
  }

  async getCursor(endpoint: EndpointId): Promise<CursorState | null> {
    const rows = await getSql().query(`SELECT * FROM sync_cursors WHERE endpoint = $1`, [endpoint]);
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? cursorStateFromRow(row) : null;
  }

  async saveCursor(endpoint: EndpointId, state: CursorState): Promise<void> {
    await getSql().query(
      `INSERT INTO sync_cursors (
         endpoint, cursor, page, high_water, pass_complete, backfill_complete, disabled, strategy,
         org_index, full_pass, last_reconcile_day, unsupported_filters, unsupported_sorts, last_error, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, now()
       )
       ON CONFLICT (endpoint) DO UPDATE SET
         cursor = EXCLUDED.cursor,
         page = EXCLUDED.page,
         high_water = EXCLUDED.high_water,
         pass_complete = EXCLUDED.pass_complete,
         backfill_complete = EXCLUDED.backfill_complete,
         disabled = EXCLUDED.disabled,
         strategy = EXCLUDED.strategy,
         org_index = EXCLUDED.org_index,
         full_pass = EXCLUDED.full_pass,
         last_reconcile_day = EXCLUDED.last_reconcile_day,
         unsupported_filters = EXCLUDED.unsupported_filters,
         unsupported_sorts = EXCLUDED.unsupported_sorts,
         last_error = EXCLUDED.last_error,
         updated_at = now()`,
      [
        endpoint,
        state.cursor,
        state.page,
        state.highWater,
        state.passComplete,
        state.backfillComplete,
        state.disabled,
        state.strategy,
        state.orgIndex,
        state.fullPass,
        state.lastReconcileDay,
        JSON.stringify(state.unsupportedFilters),
        JSON.stringify(state.unsupportedSorts),
        state.lastError,
      ],
    );
  }

  async insertRun(run: Omit<SyncRunRow, "finishedAt" | "rows" | "pages" | "error"> & { rows?: number; pages?: number }): Promise<void> {
    await getSql().query(
      `INSERT INTO sync_runs (id, endpoint, kind, started_at, rows, pages, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [run.id, run.endpoint, run.kind, run.startedAt, run.rows ?? 0, run.pages ?? 0, run.status],
    );
  }

  async finishRun(id: string, patch: Pick<SyncRunRow, "rows" | "pages" | "status" | "error">): Promise<void> {
    await getSql().query(
      `UPDATE sync_runs SET rows = $2, pages = $3, status = $4, error = $5, finished_at = now() WHERE id = $1`,
      [id, patch.rows, patch.pages, patch.status, patch.error],
    );
  }

  async listRuns(limit: number): Promise<SyncRunRow[]> {
    const rows = await getSql().query(
      `SELECT id, endpoint, kind, started_at, finished_at, rows, pages, status, error
       FROM sync_runs ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: String(record.id),
        endpoint: String(record.endpoint),
        kind: String(record.kind),
        startedAt: iso(record.started_at) ?? new Date(0).toISOString(),
        finishedAt: iso(record.finished_at),
        rows: Number(record.rows ?? 0),
        pages: Number(record.pages ?? 0),
        status: record.status as SyncRunRow["status"],
        error: typeof record.error === "string" ? record.error : null,
      };
    });
  }

  async orgCount(): Promise<number> {
    return this.rowCount("orgs");
  }

  async rowCount(endpoint: EndpointId): Promise<number> {
    const table =
      endpoint === "orgs"
        ? "orgs"
        : endpoint === "projects"
          ? "projects"
          : endpoint === "financials"
            ? "financials"
            : endpoint === "esign_status"
              ? "esign_status"
              : "commissions";
    const rows = await getSql().query(`SELECT count(*)::int AS count FROM ${table}`);
    return Number((rows[0] as { count?: number } | undefined)?.count ?? 0);
  }

  async listOrgIds(): Promise<string[]> {
    const rows = await getSql().query(`SELECT id FROM orgs ORDER BY id`);
    return rows.map((row) => String((row as { id: string }).id));
  }

  async loadOrgPayloads(): Promise<ApiOrg[]> {
    const rows = await getSql().query(`SELECT raw FROM orgs ORDER BY name`);
    return rows.map((row) => (row as { raw: ApiOrg }).raw);
  }

  async loadProjectsByOrg(): Promise<Record<string, ApiProject[]>> {
    const sql = getSql();
    const [orgRows, projectRows, commissionRows, esignRows, financialRows] = await Promise.all([
      sql.query(`SELECT id FROM orgs`),
      sql.query(`SELECT id, org_id, job_type, system_size, is_test, deleted_at, created_at, raw FROM projects`),
      sql.query(`SELECT org_id, project_id, raw FROM commissions`),
      sql.query(`SELECT org_id, project_id, raw FROM esign_status`),
      sql.query(`SELECT org_id, project_id, raw FROM financials`),
    ]);
    const child = (row: Record<string, unknown>): StoredChildLinkRow => ({
      orgId: typeof row.org_id === "string" ? row.org_id : null,
      projectId: typeof row.project_id === "string" ? row.project_id : null,
      raw: row.raw,
    });
    const projects: StoredProjectLinkRow[] = projectRows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: String(record.id),
        orgId: typeof record.org_id === "string" ? record.org_id : null,
        raw: record.raw,
        createdAt: iso(record.created_at),
        deletedAt: iso(record.deleted_at),
        isTest: typeof record.is_test === "boolean" ? record.is_test : null,
        jobType: typeof record.job_type === "string" ? record.job_type : null,
        systemSize: typeof record.system_size === "string" ? record.system_size : null,
      };
    });
    return projectsByOrg({
      orgIds: orgRows.map((row) => String((row as { id: string }).id)),
      projects,
      commissions: commissionRows.map((row) => child(row as Record<string, unknown>)),
      esign: esignRows.map((row) => child(row as Record<string, unknown>)),
      financials: financialRows.map((row) => child(row as Record<string, unknown>)),
    }).projectsByOrg;
  }

  async projectRowCount(): Promise<number> {
    const rows = await getSql().query(`SELECT count(*)::int AS count FROM projects`);
    return Number((rows[0] as { count?: number } | undefined)?.count ?? 0);
  }

  async lastSuccessAt(): Promise<string | null> {
    const rows = await getSql().query(
      `SELECT finished_at FROM sync_runs WHERE status = 'ok' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`,
    );
    return iso((rows[0] as { finished_at?: unknown } | undefined)?.finished_at);
  }

  async upsertSnapshots(rows: SnapshotRow[]): Promise<void> {
    const sql = getSql();
    for (const row of rows) {
      await sql.query(
        `INSERT INTO account_snapshots (
           org_id, day, stage, status, project_count, live_project_count, health_band, health_score,
           pace_status, pace_ratio, pace_day, captured_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (org_id, day) DO UPDATE SET
           stage = EXCLUDED.stage,
           status = EXCLUDED.status,
           project_count = EXCLUDED.project_count,
           live_project_count = EXCLUDED.live_project_count,
           health_band = EXCLUDED.health_band,
           health_score = EXCLUDED.health_score,
           pace_status = EXCLUDED.pace_status,
           pace_ratio = EXCLUDED.pace_ratio,
           pace_day = EXCLUDED.pace_day,
           captured_at = EXCLUDED.captured_at`,
        [
          row.orgId,
          row.day,
          row.stage,
          row.status,
          row.projectCount,
          row.liveProjectCount,
          row.healthBand,
          row.healthScore,
          row.paceStatus,
          row.paceRatio,
          row.paceDay,
          row.capturedAt,
        ],
      );
    }
  }
}
