"use server";

import { redirect } from "next/navigation";
import { ensureMigrations } from "@/lib/db/migrate";
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
  const result = report.status === "error" ? "error" : report.pending ? "pending" : "done";
  redirect(`/sync?result=${result}`);
}
