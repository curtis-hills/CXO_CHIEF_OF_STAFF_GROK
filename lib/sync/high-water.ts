import { FILTER_PARAMS, SORT_PARAMS, type FilterParam, type SortParam } from "./catalog";

export type SyncQuery = {
  params: Record<string, string>;
  filter: FilterParam | null;
  sort: SortParam | null;
};

const MIN_GAP_MS = 1_100;

export function rowActivityAt(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  for (const key of ["updated_at", "updatedAt", "created_at", "createdAt"]) {
    const value = record[key];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(Date.parse(value)).toISOString();
  }
  return null;
}

/** Moves the mark forward to the newest updated_at / created_at in the page. Never backward. */
export function advanceHighWater(current: string | null, rows: unknown[]): string | null {
  let bestMs = current ? Date.parse(current) : Number.NaN;
  let bestIso = current && Number.isFinite(bestMs) ? new Date(bestMs).toISOString() : null;
  for (const row of rows) {
    const iso = rowActivityAt(row);
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(bestMs) || ms > bestMs) {
      bestMs = ms;
      bestIso = iso;
    }
  }
  return bestIso;
}

export function pageOrder(rows: unknown[]): "newest-first" | "oldest-first" | "unknown" {
  const times = rows
    .map((row) => rowActivityAt(row))
    .map((iso) => (iso ? Date.parse(iso) : Number.NaN))
    .filter((ms) => Number.isFinite(ms));
  if (times.length < 2) return "unknown";
  if (times[0] > times[times.length - 1]) return "newest-first";
  if (times[0] < times[times.length - 1]) return "oldest-first";
  return "unknown";
}

/**
 * On a newest-first page, rows older than the high-water mark are already stored.
 * Rows that share the mark stay in the page: a tie is not the end of the list.
 * Oldest-first pages are not cut off here: stopping would drop newer rows that sit at the end.
 */
export function splitAtHighWater(
  rows: unknown[],
  highWater: string | null,
  order: "newest-first" | "oldest-first" | "unknown",
): { fresh: unknown[]; reached: boolean } {
  if (!highWater || order !== "newest-first") return { fresh: rows, reached: false };
  const mark = Date.parse(highWater);
  if (!Number.isFinite(mark)) return { fresh: rows, reached: false };
  const fresh: unknown[] = [];
  for (const row of rows) {
    const iso = rowActivityAt(row);
    if (!iso) {
      fresh.push(row);
      continue;
    }
    if (Date.parse(iso) < mark) return { fresh, reached: true };
    fresh.push(row);
  }
  return { fresh, reached: false };
}

export type ResumeToken = {
  cursor: string | null;
  page: number | null;
};

/** A timestamp cursor is the same instant even when the string drops milliseconds. */
export function canonicalCursor(cursor: string | null): string | null {
  if (!cursor) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cursor) && cursor.length <= 40) {
    const ms = Date.parse(cursor);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return cursor;
}

export function resumeAdvanced(before: ResumeToken, after: ResumeToken): boolean {
  if (canonicalCursor(before.cursor) !== canonicalCursor(after.cursor)) return true;
  return (before.page ?? null) !== (after.page ?? null);
}

export function rowIds(rows: unknown[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
    else if (typeof id === "number" && Number.isFinite(id)) ids.push(String(id));
  }
  return ids;
}

/** True when this page is entirely rows we already saw on the previous page. */
export function pageRepeated(previousIds: readonly string[], nextIds: readonly string[]): boolean {
  if (previousIds.length === 0 || nextIds.length === 0) return false;
  const seen = new Set(previousIds);
  return nextIds.every((id) => seen.has(id));
}

/** Next 1-based offset page after `storedRows` rows of `pageSize`. */
export function nextOffsetPage(storedRows: number, pageSize: number): number {
  if (!Number.isFinite(storedRows) || storedRows <= 0) return 1;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.floor(storedRows / pageSize) + 1;
}

export function cursorStallMessage(endpoint: string): string {
  return `${endpoint} cursor did not advance. The same page came back, so this run stopped instead of repeating it.`;
}

export type TieKey = { at: string; id: string };

const TIMESTAMP_CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)$/;

/** A cursor that is only an updated_at instant. A composite `updated_at|id` is not. */
export function timestampCursorMs(cursor: string | null): number | null {
  if (!cursor) return null;
  const value = cursor.trim();
  if (value.length > 40 || !TIMESTAMP_CURSOR.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function tieKeyOf(row: unknown): TieKey | null {
  if (!row || typeof row !== "object") return null;
  const id = (row as { id?: unknown }).id;
  const idText =
    typeof id === "string" && id.trim()
      ? id.trim()
      : typeof id === "number" && Number.isFinite(id)
        ? String(id)
        : null;
  const at = rowActivityAt(row);
  if (!idText || !at) return null;
  return { at, id: idText };
}

function compareId(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    try {
      const delta = BigInt(a) - BigInt(b);
      if (delta !== BigInt(0)) return delta > BigInt(0) ? 1 : -1;
      return 0;
    } catch {
      // Fall through to text order when an id is not a safe integer.
    }
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Order by (updated_at, id). Equal timestamps compare by id. */
export function compareTie(a: TieKey, b: TieKey): number {
  const at = Date.parse(a.at) - Date.parse(b.at);
  if (Number.isFinite(at) && at !== 0) return at;
  return compareId(a.id, b.id);
}

/** The last row on the page that sits on the cursor's instant, or the last keyed row. */
export function tieKeyFromPage(rows: unknown[], cursor: string | null): TieKey | null {
  const instant = timestampCursorMs(cursor) ?? (parseTieCursor(cursor) ? Date.parse(parseTieCursor(cursor)!.at) : null);
  let fallback: TieKey | null = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const key = tieKeyOf(rows[index]);
    if (!key) continue;
    if (instant == null || Date.parse(key.at) === instant) return key;
    if (!fallback) fallback = key;
  }
  return fallback;
}

export function compositeCursor(at: string, id: string): string {
  const ms = Date.parse(at);
  const iso = Number.isFinite(ms) ? new Date(ms).toISOString() : at;
  return `${iso}|${id}`;
}

export function parseTieCursor(cursor: string | null): TieKey | null {
  if (!cursor) return null;
  const split = cursor.indexOf("|");
  if (split <= 0 || split === cursor.length - 1) return null;
  const at = cursor.slice(0, split);
  const id = cursor.slice(split + 1);
  if (timestampCursorMs(at) == null || !id || id.includes("|")) return null;
  return { at: new Date(timestampCursorMs(at)!).toISOString(), id };
}

/** True when any row is strictly after the composite key already consumed. */
export function tieAdvanced(previous: TieKey | null, rows: unknown[]): boolean {
  if (!previous) return false;
  return rows.some((row) => {
    const key = tieKeyOf(row);
    return key != null && compareTie(key, previous) > 0;
  });
}

/**
 * Persist a timestamp watermark as `updated_at|id` so the next request can
 * move through rows that share that instant. Opaque cursors are unchanged.
 */
export function cursorToPersist(returned: string | null, rows: unknown[]): string | null {
  if (!returned) return null;
  if (parseTieCursor(returned)) return returned;
  const ms = timestampCursorMs(returned);
  if (ms == null) return returned;
  const key = tieKeyFromPage(rows, returned);
  if (!key || Date.parse(key.at) !== ms) return returned;
  return compositeCursor(key.at, key.id);
}

export function nextFilter(unsupported: readonly string[]): FilterParam | null {
  return FILTER_PARAMS.find((param) => !unsupported.includes(param)) ?? null;
}

export function nextSort(unsupported: readonly string[]): SortParam | null {
  return SORT_PARAMS.find((param) => !unsupported.includes(param)) ?? null;
}

export function selectSyncQuery(input: {
  mode: "backfill" | "incremental";
  full: boolean;
  highWater: string | null;
  cursor: string | null;
  page: number | null;
  orgId?: string | null;
  unsupportedFilters: readonly string[];
  unsupportedSorts: readonly string[];
}): SyncQuery {
  const params: Record<string, string> = {};
  if (input.cursor) params.cursor = input.cursor;
  if (input.page) params.page = String(input.page);
  if (input.orgId) params.org_id = input.orgId;
  if (input.mode === "backfill" || input.full || !input.highWater) {
    return { params, filter: null, sort: null };
  }
  const filter = nextFilter(input.unsupportedFilters);
  if (filter) {
    params[filter] = input.highWater;
    return { params, filter, sort: null };
  }
  const sort = nextSort(input.unsupportedSorts);
  if (sort) {
    params.sort = sort;
    return { params, filter: null, sort };
  }
  return { params, filter: null, sort: null };
}

/** Stay under the observed 60 requests/minute. A nearly empty remaining count waits for the reset. */
export function paceDelayMs(remaining: string | null, reset: string | null, now = Date.now()): number {
  const left = remaining && /^\d+$/.test(remaining) ? Number(remaining) : null;
  if (left !== null && left <= 1 && reset && /^\d+$/.test(reset)) {
    const value = Number(reset);
    const at = value >= 1e12 ? value : value >= 1e9 ? value * 1000 : now + value * 1000;
    const wait = at - now;
    if (Number.isFinite(wait) && wait > MIN_GAP_MS) return Math.min(60_000, wait);
  }
  return MIN_GAP_MS;
}

export function pacificDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function shouldFullReconcile(now: Date, lastReconcileDay: string | null): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(now);
  if (weekday !== "Sun") return false;
  return lastReconcileDay !== pacificDay(now);
}

export function upsertById<T extends { id: string }>(existing: Map<string, T>, rows: T[]): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    if (existing.has(row.id)) updated += 1;
    else inserted += 1;
    existing.set(row.id, row);
  }
  return { inserted, updated };
}
