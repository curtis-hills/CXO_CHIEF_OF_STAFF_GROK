"use server";

import { redirect } from "next/navigation";
import { runSync } from "@/lib/sync/runner";
import { databaseConfigured } from "@/lib/sync/store";

export async function runBackfillNow(): Promise<void> {
  if (!databaseConfigured()) redirect("/sync?result=unconfigured");
  const report = await runSync({ kind: "backfill", budgetMs: 20_000, maxPages: 6 });
  const result = report.status === "error" ? "error" : report.pending ? "pending" : "done";
  redirect(`/sync?result=${result}`);
}
