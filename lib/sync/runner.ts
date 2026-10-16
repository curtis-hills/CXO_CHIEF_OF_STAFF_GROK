import "server-only";

import { connectionNotice, SubhubApiError } from "../api/body";
import { fetchCollectionPage } from "../api/client";
import { assemblePortfolio } from "../data/assemble";
import { readOverrides } from "../data/overrides";
import { ENDPOINTS, endpointById, type EndpointId } from "./catalog";
import {
  advanceHighWater,
  paceDelayMs,
  pacificDay,
  pageOrder,
  selectSyncQuery,
  shouldFullReconcile,
  splitAtHighWater,
} from "./high-water";
import { ensureMigrations } from "../db/migrate";
import { databaseUrl } from "../db/sql";
import { normalizeFor, normalizeOrg, orgIdOf, subscriptionsForOrg, type GenericRow, type OrgRow, type ProjectRow } from "./rows";
import { getStore } from "./store";
import { emptyCursor, type CursorState, type SyncStore } from "./types";

const DEFAULT_PAGES = 6;
const DEFAULT_BUDGET_MS = 45_000;

export type SyncKind = "backfill" | "incremental" | "orgs";

export type SyncOptions = {
  kind?: SyncKind;
  endpoints?: EndpointId[];
  maxPages?: number;
  budgetMs?: number;
  gapMs?: number;
  now?: Date;
};

export type SyncReport = {
  pending: boolean;
  /** True when a later hop still has a list whose backfill is not Complete. */
  backfillPending: boolean;
  rows: number;
  pages: number;
  endpoint: string | null;
  status: "ok" | "error" | "idle" | "unsupported";
  error: string | null;
};

type Inflight = { promise: Promise<SyncReport> | null };
const inflight: Inflight = ((globalThis as typeof globalThis & { __cxmSyncInflight?: Inflight }).__cxmSyncInflight ??= {
  promise: null,
});

export function resetSyncInflight(): void {
  inflight.promise = null;
}

export async function runSync(options: SyncOptions = {}): Promise<SyncReport> {
  if (inflight.promise) return inflight.promise;
  let pending: Promise<SyncReport>;
  pending = runSyncInner(options).finally(() => {
    if (inflight.promise === pending) inflight.promise = null;
  });
  inflight.promise = pending;
  return pending;
}

async function runSyncInner(options: SyncOptions): Promise<SyncReport> {
  if (databaseUrl()) {
    const ready = await ensureMigrations();
    if (!ready.applied) {
      return {
        pending: false,
        backfillPending: false,
        rows: 0,
        pages: 0,
        endpoint: null,
        status: "error",
        error: "Database migrations are not applied.",
      };
    }
  }
  const store = getStore();
  const now = options.now ?? new Date();
  const maxPages = options.maxPages ?? DEFAULT_PAGES;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const gapMs = options.gapMs ?? (process.env.VITEST ? 0 : 1_100);
  const started = Date.now();
  const explicit = options.endpoints;
  const catalogIds = ENDPOINTS.map((endpoint) => endpoint.id);
  const watched = explicit ?? catalogIds;
  const states = new Map<EndpointId, CursorState>();
  for (const id of watched) states.set(id, (await store.getCursor(id)) ?? emptyCursor());

  const backfillOpen = watched.some((id) => {
    const state = states.get(id)!;
    return !state.disabled && !state.backfillComplete;
  });
  let kind: SyncKind = options.kind ?? "backfill";
  // The hourly org route and the daily route both land here. While any list is
  // still unfinished, keep the backfill going instead of refreshing orgs again.
  if (!explicit && backfillOpen) kind = "backfill";
  const requested: EndpointId[] = explicit ? explicit : kind === "backfill" ? catalogIds : options.kind === "orgs" ? (["orgs"] as EndpointId[]) : catalogIds;
  for (const id of requested) {
    if (!states.has(id)) states.set(id, (await store.getCursor(id)) ?? emptyCursor());
  }
  const unfinished = (id: EndpointId) => {
    const state = states.get(id)!;
    if (state.disabled) return false;
    return kind === "backfill" ? !state.backfillComplete : !state.passComplete;
  };

  if (kind !== "backfill") {
    const active = requested.filter((id) => !states.get(id)?.disabled);
    const reconcile = kind === "incremental" && active.some((id) => shouldFullReconcile(now, states.get(id)?.lastReconcileDay ?? null));
    const allDone = active.length > 0 && active.every((id) => states.get(id)?.passComplete);
    if (allDone) {
      for (const id of active) {
        const state = states.get(id)!;
        state.passComplete = false;
        state.cursor = null;
        state.page = null;
        state.orgIndex = 0;
        state.fullPass = reconcile;
        await store.saveCursor(id, state);
      }
    }
  }

  let rows = 0;
  let pages = 0;
  let endpoint: string | null = null;
  let status: SyncReport["status"] = "idle";
  let error: string | null = null;
  let hardError = false;
  let runId: string | null = null;
  let runEndpoint: EndpointId | null = null;
  let runRows = 0;
  let runPages = 0;

  const closeRun = async (nextStatus: "ok" | "error" | "unsupported", nextError: string | null) => {
    if (!runId) return;
    await store.finishRun(runId, { rows: runRows, pages: runPages, status: nextStatus, error: nextError });
    runId = null;
  };

  while (pages < maxPages && Date.now() - started < budgetMs) {
    const next = requested.find((id) => unfinished(id));
    if (!next) break;
    if (runEndpoint !== next) {
      await closeRun(status === "error" || status === "unsupported" ? status : "ok", error);
      runEndpoint = next;
      runRows = 0;
      runPages = 0;
      runId = crypto.randomUUID();
      await store.insertRun({
        id: runId,
        endpoint: next,
        kind,
        startedAt: new Date().toISOString(),
        status: "running",
      });
      status = "ok";
      error = null;
    }
    endpoint = next;
    const outcome = await pullPage(store, next, states.get(next)!, kind, now);
    rows += outcome.rows;
    runRows += outcome.rows;
    if (outcome.countedPage) {
      pages += 1;
      runPages += 1;
    }
    if (outcome.status) status = outcome.status;
    if (outcome.error) error = outcome.error;
    if (outcome.hardError) {
      hardError = true;
      break;
    }
    if (outcome.sleep && gapMs > 0) {
      const wait = Math.max(gapMs, outcome.delayMs);
      if (Date.now() + wait - started > budgetMs) break;
      await sleep(wait);
    }
  }

  await closeRun(hardError || status === "error" ? "error" : status === "unsupported" ? "unsupported" : "ok", error);
  const projects = states.get("projects") ?? (await store.getCursor("projects"));
  if ((await store.orgCount()) > 0 && projects?.backfillComplete) await writeSnapshots(store, now);

  const pending = !hardError && requested.some((id) => unfinished(id));
  return {
    pending,
    backfillPending: pending && kind === "backfill",
    rows,
    pages,
    endpoint,
    status: hardError ? "error" : status,
    error,
  };
}

type PageOutcome = {
  rows: number;
  countedPage: boolean;
  status: SyncReport["status"] | null;
  error: string | null;
  hardError: boolean;
  sleep: boolean;
  delayMs: number;
};

async function pullPage(store: SyncStore, id: EndpointId, state: CursorState, kind: SyncKind, now: Date): Promise<PageOutcome> {
  const endpoint = endpointById(id);
  const mode = kind === "backfill" || !state.backfillComplete ? "backfill" : "incremental";
  if (
    mode === "incremental" &&
    !state.fullPass &&
    state.highWater &&
    !selectSyncQuery({
      mode,
      full: false,
      highWater: state.highWater,
      cursor: null,
      page: null,
      unsupportedFilters: state.unsupportedFilters,
      unsupportedSorts: state.unsupportedSorts,
    }).filter &&
    !selectSyncQuery({
      mode,
      full: false,
      highWater: state.highWater,
      cursor: null,
      page: null,
      unsupportedFilters: state.unsupportedFilters,
      unsupportedSorts: state.unsupportedSorts,
    }).sort
  ) {
    state.passComplete = true;
    state.cursor = null;
    state.page = null;
    state.lastError = "No updated_since filter and no newest-first sort. Waiting for the weekly reconcile.";
    await store.saveCursor(id, state);
    return { rows: 0, countedPage: false, status: "ok", error: state.lastError, hardError: false, sleep: false, delayMs: 0 };
  }

  let orgId: string | null = null;
  if (id === "projects" && state.strategy === "per-org") {
    const ids = await store.listOrgIds();
    orgId = ids[state.orgIndex] ?? null;
    if (!orgId) {
      finishPass(state, now);
      await store.saveCursor(id, state);
      return { rows: 0, countedPage: false, status: "ok", error: null, hardError: false, sleep: false, delayMs: 0 };
    }
  }

  const query = selectSyncQuery({
    mode,
    full: state.fullPass,
    highWater: state.highWater,
    cursor: state.cursor,
    page: state.page,
    orgId,
    unsupportedFilters: state.unsupportedFilters,
    unsupportedSorts: state.unsupportedSorts,
  });

  let page;
  try {
    page = await fetchCollectionPage<unknown>(endpoint.path, query.params);
  } catch (error) {
    if (error instanceof SubhubApiError && error.status === 422 && query.filter) {
      state.unsupportedFilters = [...new Set([...state.unsupportedFilters, query.filter])];
      state.lastError = syncError(error);
      await store.saveCursor(id, state);
      return { rows: 0, countedPage: false, status: "ok", error: state.lastError, hardError: false, sleep: false, delayMs: 0 };
    }
    if (error instanceof SubhubApiError && error.status === 422 && query.sort) {
      state.unsupportedSorts = [...new Set([...state.unsupportedSorts, query.sort])];
      state.lastError = syncError(error);
      await store.saveCursor(id, state);
      return { rows: 0, countedPage: false, status: "ok", error: state.lastError, hardError: false, sleep: false, delayMs: 0 };
    }
    if (error instanceof SubhubApiError && error.status === 404 && !endpoint.required) {
      state.disabled = true;
      state.passComplete = true;
      state.backfillComplete = true;
      state.lastError = syncError(error);
      await store.saveCursor(id, state);
      return { rows: 0, countedPage: true, status: "unsupported", error: state.lastError, hardError: false, sleep: false, delayMs: 0 };
    }
    state.lastError = syncError(error);
    await store.saveCursor(id, state);
    console.error(`CXM sync failed: ${state.lastError}`);
    return { rows: 0, countedPage: true, status: "error", error: state.lastError, hardError: true, sleep: false, delayMs: 0 };
  }

  let items = page.items;
  if (id === "projects" && state.strategy === "platform" && !state.cursor && !state.page) {
    const tagged = items.filter((item) => orgIdOf(item));
    if (tagged.length === 0) {
      state.strategy = "per-org";
      state.orgIndex = 0;
      state.cursor = null;
      state.page = null;
      await store.saveCursor(id, state);
      return {
        rows: 0,
        countedPage: true,
        status: "ok",
        error: null,
        hardError: false,
        sleep: true,
        delayMs: paceDelayMs(page.rateLimit?.remaining ?? null, page.rateLimit?.reset ?? null),
      };
    }
  }
  if (orgId) {
    items = items.map((item) => {
      if (!item || typeof item !== "object" || orgIdOf(item)) return item;
      return { ...(item as Record<string, unknown>), org_id: orgId };
    });
  }

  const order = query.sort ? "newest-first" : pageOrder(items);
  const split =
    mode === "incremental" && !state.fullPass && !query.filter
      ? splitAtHighWater(items, state.highWater, order)
      : { fresh: items, reached: false };
  const stored = await storeRows(store, id, split.fresh);
  state.highWater = advanceHighWater(state.highWater, split.fresh);
  const done = split.reached || !page.next;
  if (done && state.strategy === "per-org") {
    state.orgIndex += 1;
    state.cursor = null;
    state.page = null;
    const ids = await store.listOrgIds();
    if (state.orgIndex >= ids.length) finishPass(state, now);
  } else if (done) {
    finishPass(state, now);
  } else {
    state.cursor = page.next?.cursor ?? null;
    state.page = page.next?.page ?? null;
  }
  await store.saveCursor(id, state);
  return {
    rows: stored,
    countedPage: true,
    status: "ok",
    error: null,
    hardError: false,
    sleep: !state.passComplete,
    delayMs: paceDelayMs(page.rateLimit?.remaining ?? null, page.rateLimit?.reset ?? null),
  };
}

function finishPass(state: CursorState, now: Date): void {
  state.passComplete = true;
  state.backfillComplete = true;
  state.cursor = null;
  state.page = null;
  if (state.fullPass) {
    state.lastReconcileDay = pacificDay(now);
    state.fullPass = false;
  }
}

async function storeRows(store: SyncStore, id: EndpointId, raws: unknown[]): Promise<number> {
  if (id === "orgs") {
    const orgs = raws.map((raw) => normalizeOrg(raw)).filter((row): row is OrgRow => Boolean(row));
    const subscriptions = orgs.flatMap((org) => subscriptionsForOrg(org));
    await store.upsertOrgs(orgs, subscriptions);
    return orgs.length;
  }
  if (id === "projects") {
    const projects = raws.map((raw) => normalizeFor("projects", raw)).filter((row): row is ProjectRow => Boolean(row));
    await store.upsertProjects(projects);
    return projects.length;
  }
  const rows = raws.map((raw) => normalizeFor(id, raw)).filter((row): row is GenericRow => Boolean(row));
  await store.upsertGeneric(id, rows);
  return rows.length;
}

async function writeSnapshots(store: SyncStore, now: Date): Promise<void> {
  const orgs = await store.loadOrgPayloads();
  const projectsByOrg = await store.loadProjectsByOrg();
  const available = (await store.projectRowCount()) > 0 || Boolean((await store.getCursor("projects"))?.backfillComplete);
  const assembled = assemblePortfolio({
    mode: "live",
    asOf: now.toISOString(),
    orgs,
    projectsByOrg,
    projectsAvailable: available,
    proxies: {},
    overrides: readOverrides(),
  });
  const day = pacificDay(now);
  const capturedAt = now.toISOString();
  await store.upsertSnapshots(
    assembled.accounts.map((account) => ({
      orgId: account.id,
      day,
      stage: account.stage,
      status: account.status,
      projectCount: available ? account.projects.length : null,
      liveProjectCount: available ? account.projects.filter((project) => project.live).length : null,
      healthBand: account.health.band,
      healthScore: account.health.score,
      paceStatus: account.pace?.status ?? null,
      paceRatio: account.pace?.ratio ?? null,
      paceDay: account.pace?.day ?? null,
      capturedAt,
    })),
  );
}

function syncError(error: unknown): string {
  const secrets = [process.env.SUBHUB_API_PASSWORD, process.env.SUBHUB_API_KEY].filter(
    (value): value is string => Boolean(value && value.length >= 3),
  );
  return connectionNotice(error, secrets).slice(0, 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
