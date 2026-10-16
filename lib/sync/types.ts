import type { ApiOrg, ApiProject } from "../api/types";
import type { EndpointId } from "./catalog";
import type { GenericRow, OrgRow, ProjectRow, SubscriptionRow } from "./rows";

export type CursorState = {
  cursor: string | null;
  page: number | null;
  highWater: string | null;
  passComplete: boolean;
  backfillComplete: boolean;
  disabled: boolean;
  strategy: "platform" | "per-org";
  orgIndex: number;
  fullPass: boolean;
  lastReconcileDay: string | null;
  unsupportedFilters: string[];
  unsupportedSorts: string[];
  lastError: string | null;
};

export type SyncRunRow = {
  id: string;
  endpoint: string;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  rows: number;
  pages: number;
  status: "running" | "ok" | "error" | "unsupported";
  error: string | null;
};

export type SnapshotRow = {
  orgId: string;
  day: string;
  stage: string;
  status: string;
  projectCount: number | null;
  liveProjectCount: number | null;
  healthBand: string;
  healthScore: number | null;
  paceStatus: string | null;
  paceRatio: number | null;
  paceDay: number | null;
  capturedAt: string;
};

export type StoredPage = {
  orgs: OrgRow[];
  projects: ProjectRow[];
  generic: GenericRow[];
  subscriptions: SubscriptionRow[];
};

export interface SyncStore {
  upsertOrgs(rows: OrgRow[], subscriptions: SubscriptionRow[]): Promise<void>;
  upsertProjects(rows: ProjectRow[]): Promise<void>;
  upsertGeneric(endpoint: Exclude<EndpointId, "orgs" | "projects">, rows: GenericRow[]): Promise<void>;
  getCursor(endpoint: EndpointId): Promise<CursorState | null>;
  saveCursor(endpoint: EndpointId, state: CursorState): Promise<void>;
  insertRun(run: Omit<SyncRunRow, "finishedAt" | "rows" | "pages" | "error"> & { rows?: number; pages?: number }): Promise<void>;
  finishRun(id: string, patch: Pick<SyncRunRow, "rows" | "pages" | "status" | "error">): Promise<void>;
  listRuns(limit: number): Promise<SyncRunRow[]>;
  orgCount(): Promise<number>;
  listOrgIds(): Promise<string[]>;
  loadOrgPayloads(): Promise<ApiOrg[]>;
  loadProjectsByOrg(): Promise<Record<string, ApiProject[]>>;
  projectRowCount(): Promise<number>;
  lastSuccessAt(): Promise<string | null>;
  upsertSnapshots(rows: SnapshotRow[]): Promise<void>;
}

export function emptyCursor(): CursorState {
  return {
    cursor: null,
    page: null,
    highWater: null,
    passComplete: false,
    backfillComplete: false,
    disabled: false,
    strategy: "platform",
    orgIndex: 0,
    fullPass: false,
    lastReconcileDay: null,
    unsupportedFilters: [],
    unsupportedSorts: [],
    lastError: null,
  };
}
