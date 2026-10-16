import { NextResponse } from "next/server";
import { databaseConfigured, getStore } from "@/lib/sync/store";

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
    const last = (await store.listRuns(1))[0] ?? null;
    return NextResponse.json(
      {
        status: orgs > 0 ? "ready" : "empty",
        orgs,
        dataAsOf,
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
