import { NextResponse } from "next/server";
import { healthPayload } from "@/lib/api/health-payload";
import { checkApiConnection } from "@/lib/api/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const report = await checkApiConnection();
  return NextResponse.json(healthPayload(report), {
    status: report.httpStatus,
    headers: { "Cache-Control": "no-store" },
  });
}
