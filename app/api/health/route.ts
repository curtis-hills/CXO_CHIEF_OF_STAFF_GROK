import { NextResponse } from "next/server";
import { checkApiConnection } from "@/lib/api/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const report = await checkApiConnection();
  const body = report.mode ? { status: report.status, mode: report.mode } : { status: report.status };
  return NextResponse.json(body, {
    status: report.httpStatus,
    headers: { "Cache-Control": "no-store" },
  });
}
