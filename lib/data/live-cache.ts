import "server-only";

import { PORTFOLIO_REVALIDATE_SECONDS, PORTFOLIO_TTL_MS } from "../api/limits";
import type { ApiOrg, ApiProject } from "../api/types";

export type LiveInputs = {
  orgs: ApiOrg[];
  projectsByOrg: Record<string, ApiProject[]>;
};

let cached: { at: number; value: LiveInputs } | null = null;
let inflight: Promise<LiveInputs> | null = null;

export function clearLiveInputsCache(): void {
  cached = null;
  inflight = null;
}

async function loadLiveInputs(): Promise<LiveInputs> {
  const { fetchOrgs, fetchProjectsByOrg } = await import("../api/client");
  const orgs = await fetchOrgs();
  const projectsByOrg = await fetchProjectsByOrg(orgs.map((org) => String(org.id)));
  return { orgs, projectsByOrg };
}

async function loadFreshInputs(): Promise<LiveInputs> {
  if (process.env.VITEST) return loadLiveInputs();
  const { unstable_cache } = await import("next/cache");
  return unstable_cache(loadLiveInputs, ["cxm-portfolio"], {
    revalidate: PORTFOLIO_REVALIDATE_SECONDS,
    tags: ["cxm-portfolio"],
  })();
}

export async function getLiveInputs(): Promise<LiveInputs> {
  if (cached && Date.now() - cached.at < PORTFOLIO_TTL_MS) return cached.value;
  if (inflight) return inflight;
  const pending = loadFreshInputs()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (inflight === pending) inflight = null;
    });
  inflight = pending;
  return pending;
}
