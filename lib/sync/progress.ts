import { ENDPOINTS, type EndpointId } from "./catalog";
import type { CursorState } from "./types";

export type EndpointPhase = "complete" | "in_progress" | "unsupported";

export type EndpointProgress = {
  state: EndpointPhase;
  highWater: string | null;
  resume: boolean;
  lastError: string | null;
};

export function endpointPhase(cursor: CursorState | null | undefined): EndpointPhase {
  if (cursor?.disabled) return "unsupported";
  if (cursor?.backfillComplete) return "complete";
  return "in_progress";
}

export function endpointProgress(cursor: CursorState | null | undefined): EndpointProgress {
  return {
    state: endpointPhase(cursor),
    highWater: cursor?.highWater ?? null,
    resume: Boolean(cursor?.cursor || cursor?.page),
    lastError: cursor?.lastError ?? null,
  };
}

/** Page label. A repeated cursor stays in progress for /api/health and reads as Stalled here. */
export function backfillLabel(cursor: CursorState | null | undefined): string {
  if (cursor?.disabled) return "Unsupported";
  if (cursor?.backfillComplete) return "Complete";
  if (cursor?.lastError?.includes("did not advance")) return "Stalled";
  return "In progress";
}

/** A missing cursor is still in progress. Unsupported endpoints are finished. */
export function backfillOpen(cursors: Partial<Record<EndpointId, CursorState | null>>): boolean {
  return ENDPOINTS.some((endpoint) => endpointPhase(cursors[endpoint.id]) === "in_progress");
}

export function storedCopyStatus(
  orgs: number,
  cursors: Partial<Record<EndpointId, CursorState | null>>,
): { status: "ready" | "backfilling" | "empty"; endpoints: Record<EndpointId, EndpointProgress> } {
  const endpoints = {} as Record<EndpointId, EndpointProgress>;
  for (const endpoint of ENDPOINTS) endpoints[endpoint.id] = endpointProgress(cursors[endpoint.id]);
  const finished = ENDPOINTS.every((endpoint) => endpoints[endpoint.id].state !== "in_progress");
  return { status: finished ? (orgs > 0 ? "ready" : "empty") : "backfilling", endpoints };
}
