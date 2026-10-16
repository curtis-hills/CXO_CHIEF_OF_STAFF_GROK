import type { ApiOrg, ApiProject } from "../api/types";
import { projectsByOrg } from "../data/project-orgs";
import type { EndpointId } from "./catalog";
import { upsertById } from "./high-water";
import type { GenericRow, OrgRow, ProjectRow, SubscriptionRow } from "./rows";
import { emptyCursor, type CursorState, type SnapshotRow, type SyncRunRow, type SyncStore } from "./types";

export class MemoryStore implements SyncStore {
  readonly orgs = new Map<string, OrgRow>();
  readonly projects = new Map<string, ProjectRow>();
  readonly financials = new Map<string, GenericRow>();
  readonly esign = new Map<string, GenericRow>();
  readonly commissions = new Map<string, GenericRow>();
  readonly subscriptions = new Map<string, SubscriptionRow>();
  readonly cursors = new Map<EndpointId, CursorState>();
  readonly runs: SyncRunRow[] = [];
  readonly snapshots = new Map<string, SnapshotRow>();

  async upsertOrgs(rows: OrgRow[], subscriptions: SubscriptionRow[]): Promise<void> {
    upsertById(this.orgs, rows);
    const orgIds = new Set(rows.map((row) => row.id));
    for (const [id, row] of this.subscriptions) {
      if (orgIds.has(row.orgId)) this.subscriptions.delete(id);
    }
    upsertById(this.subscriptions, subscriptions);
  }

  async upsertProjects(rows: ProjectRow[]): Promise<void> {
    upsertById(this.projects, rows);
  }

  async upsertGeneric(endpoint: Exclude<EndpointId, "orgs" | "projects">, rows: GenericRow[]): Promise<void> {
    const table = endpoint === "financials" ? this.financials : endpoint === "esign_status" ? this.esign : this.commissions;
    upsertById(table, rows);
  }

  async getCursor(endpoint: EndpointId): Promise<CursorState | null> {
    const state = this.cursors.get(endpoint);
    return state ? structuredClone(state) : null;
  }

  async saveCursor(endpoint: EndpointId, state: CursorState): Promise<void> {
    this.cursors.set(endpoint, structuredClone(state));
  }

  async insertRun(run: Omit<SyncRunRow, "finishedAt" | "rows" | "pages" | "error"> & { rows?: number; pages?: number }): Promise<void> {
    this.runs.push({
      id: run.id,
      endpoint: run.endpoint,
      kind: run.kind,
      startedAt: run.startedAt,
      finishedAt: null,
      rows: run.rows ?? 0,
      pages: run.pages ?? 0,
      status: run.status,
      error: null,
    });
  }

  async finishRun(id: string, patch: Pick<SyncRunRow, "rows" | "pages" | "status" | "error">): Promise<void> {
    const run = this.runs.find((item) => item.id === id);
    if (!run) return;
    run.rows = patch.rows;
    run.pages = patch.pages;
    run.status = patch.status;
    run.error = patch.error;
    run.finishedAt = new Date().toISOString();
  }

  async listRuns(limit: number): Promise<SyncRunRow[]> {
    return [...this.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, limit);
  }

  async orgCount(): Promise<number> {
    return this.orgs.size;
  }

  async rowCount(endpoint: EndpointId): Promise<number> {
    if (endpoint === "orgs") return this.orgs.size;
    if (endpoint === "projects") return this.projects.size;
    if (endpoint === "financials") return this.financials.size;
    if (endpoint === "esign_status") return this.esign.size;
    return this.commissions.size;
  }

  async listOrgIds(): Promise<string[]> {
    return [...this.orgs.keys()];
  }

  async loadOrgPayloads(): Promise<ApiOrg[]> {
    return [...this.orgs.values()].map((row) => row.raw);
  }

  async loadProjectsByOrg(): Promise<Record<string, ApiProject[]>> {
    const child = (row: GenericRow) => ({ orgId: row.orgId, projectId: row.projectId, raw: row.raw });
    return projectsByOrg({
      orgIds: this.orgs.keys(),
      projects: [...this.projects.values()].map((row) => ({
        id: row.id,
        orgId: row.orgId,
        raw: row.raw,
        createdAt: row.createdAt,
        deletedAt: row.deletedAt,
        isTest: row.isTest,
        jobType: row.jobType,
        systemSize: row.systemSize,
      })),
      commissions: [...this.commissions.values()].map(child),
      esign: [...this.esign.values()].map(child),
      financials: [...this.financials.values()].map(child),
    }).projectsByOrg;
  }

  async projectRowCount(): Promise<number> {
    return this.projects.size;
  }

  async lastSuccessAt(): Promise<string | null> {
    const ok = this.runs.filter((run) => run.status === "ok" && run.finishedAt);
    if (ok.length === 0) return null;
    return ok.map((run) => run.finishedAt as string).sort().at(-1) ?? null;
  }

  async upsertSnapshots(rows: SnapshotRow[]): Promise<void> {
    for (const row of rows) this.snapshots.set(`${row.orgId}:${row.day}`, row);
  }
}

export function freshCursor(overrides: Partial<CursorState> = {}): CursorState {
  return { ...emptyCursor(), ...overrides };
}
