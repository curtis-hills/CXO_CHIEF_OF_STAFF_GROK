"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { ensureMigrations } from "@/lib/db/migrate";
import { dispatchCronFollowUp, planCronFollowUp } from "@/lib/sync/follow";
import { runSync } from "@/lib/sync/runner";
import { databaseConfigured } from "@/lib/sync/store";

export async function setupDatabase(): Promise<void> {
  if (!databaseConfigured()) redirect("/sync?result=unconfigured");
  const ready = await ensureMigrations();
  redirect(ready.applied ? "/sync?result=ready" : "/sync?result=setup-error");
}

export async function runBackfillNow(): Promise<void> {
  if (!databaseConfigured()) redirect("/sync?result=unconfigured");
  const report = await runSync({ kind: "backfill", budgetMs: 20_000, maxPages: 6 });
  if (report.backfillPending) {
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    const proto = headerList.get("x-forwarded-proto") ?? "https";
    const plan = host ? planCronFollowUp(`${proto}://${host}/api/cron/sync?kind=backfill&hop=0`, 0, "backfill") : null;
    if (plan) after(() => dispatchCronFollowUp(plan));
  }
  const result = report.status === "error" ? "error" : report.pending ? "pending" : "done";
  redirect(`/sync?result=${result}`);
}
