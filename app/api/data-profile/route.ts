import { NextResponse } from "next/server";
import { dashboardAuthorized } from "@/lib/dashboard-auth";
import { loadDataProfile } from "@/lib/data/profile-load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await dashboardAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const report = await loadDataProfile();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
