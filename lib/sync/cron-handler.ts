import { after, NextResponse } from "next/server";
import { cronAuthorized } from "./cron";
import { runSync, type SyncKind } from "./runner";
import { databaseConfigured } from "./store";

const MAX_HOPS = 80;

export async function handleCron(request: Request, fallbackKind: SyncKind): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!databaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not set." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const url = new URL(request.url);
  const requested = url.searchParams.get("kind");
  const kind: SyncKind =
    requested === "backfill" || requested === "incremental" || requested === "orgs" ? requested : fallbackKind;
  const hop = Number(url.searchParams.get("hop") ?? "0");
  const report = await runSync({ kind });
  if (report.pending && Number.isFinite(hop) && hop < MAX_HOPS && process.env.CRON_SECRET) {
    const next = new URL(request.url);
    next.searchParams.set("kind", kind);
    next.searchParams.set("hop", String(hop + 1));
    const secret = process.env.CRON_SECRET;
    after(() => {
      void fetch(next, { headers: { authorization: `Bearer ${secret}` }, cache: "no-store" }).catch(() => undefined);
    });
  }
  return NextResponse.json(
    { pending: report.pending, rows: report.rows, pages: report.pages, endpoint: report.endpoint, status: report.status, error: report.error },
    { headers: { "Cache-Control": "no-store" } },
  );
}
