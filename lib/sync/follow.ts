import { sanitizeSnippet } from "../api/body";
import type { SyncKind } from "./runner";

export const MAX_CRON_HOPS = 80;

export type CronFollowUp = {
  url: string;
  headers: Record<string, string>;
};

/**
 * The next hop of a backfill.
 * The bearer secret is a header, never part of the URL.
 * `x-vercel-protection-bypass` is set when Vercel deployment protection would
 * otherwise answer the self-call with its own 401 before this app runs.
 */
export function planCronFollowUp(requestUrl: string, hop: number, kind: SyncKind): CronFollowUp | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !Number.isFinite(hop) || hop >= MAX_CRON_HOPS) return null;
  const next = new URL(requestUrl);
  next.searchParams.set("kind", kind);
  next.searchParams.set("hop", String(hop + 1));
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  return { url: next.toString(), headers };
}

export async function dispatchCronFollowUp(plan: CronFollowUp, fetchImpl: typeof fetch = fetch): Promise<void> {
  const secrets = [process.env.CRON_SECRET, process.env.VERCEL_AUTOMATION_BYPASS_SECRET].filter(
    (value): value is string => Boolean(value && value.length >= 3),
  );
  try {
    const response = await fetchImpl(plan.url, { headers: plan.headers, cache: "no-store" });
    if (response.ok) return;
    const body = await response.text().catch(() => "");
    console.error(`CXM sync follow-up failed: ${response.status} ${sanitizeSnippet(body, secrets)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "follow-up failed";
    console.error(`CXM sync follow-up failed: ${sanitizeSnippet(message, secrets)}`);
  }
}
