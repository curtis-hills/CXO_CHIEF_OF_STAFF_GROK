import { NextResponse } from "next/server";
import { ENDPOINTS, type EndpointId } from "@/lib/sync/catalog";
import { storedCopyStatus } from "@/lib/sync/progress";
import { databaseConfigured, getStore } from "@/lib/sync/store";
import type { CursorState } from "@/lib/sync/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!databaseConfigured()) {
    return NextResponse.json(
      { status: "unconfigured", orgs: 0, dataAsOf: null, lastRun: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const store = getStore();
    const orgs = await store.orgCount();
    const dataAsOf = await store.lastSuccessAt();
    const cursors = {} as Partial<Record<EndpointId, CursorState | null>>;
    for (const endpoint of ENDPOINTS) cursors[endpoint.id] = await store.getCursor(endpoint.id);
    const progress = storedCopyStatus(orgs, cursors);
    const last = (await store.listRuns(1))[0] ?? null;
    return NextResponse.json(
      {
        status: progress.status,
        orgs,
        dataAsOf,
        endpoints: progress.endpoints,
        lastRun: last
          ? {
              endpoint: last.endpoint,
              status: last.status,
              startedAt: last.startedAt,
              finishedAt: last.finishedAt,
              rows: last.rows,
              error: last.error,
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "error", detail: "The database could not be read." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
