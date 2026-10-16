import { after, NextResponse } from "next/server";
import { cronAuthorized } from "./cron";
import { dispatchCronFollowUp, planCronFollowUp } from "./follow";
import { runSync, type SyncKind } from "./runner";
import { databaseConfigured } from "./store";

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
  // Return the follow-up promise from after(). A floating fetch was frozen with
  // the instance, so the hop never ran and the hourly org job never reached projects.
  const followKind = report.backfillPending ? "backfill" : kind;
  const plan = report.pending ? planCronFollowUp(request.url, hop, followKind) : null;
  if (plan) after(() => dispatchCronFollowUp(plan));
  return NextResponse.json(
    {
      pending: report.pending,
      backfillPending: report.backfillPending,
      rows: report.rows,
      pages: report.pages,
      endpoint: report.endpoint,
      status: report.status,
      error: report.error,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
