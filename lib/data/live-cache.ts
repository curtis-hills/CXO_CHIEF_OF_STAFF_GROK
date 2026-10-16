import "server-only";

import { connectionNotice } from "../api/body";
import { PORTFOLIO_REVALIDATE_SECONDS, PORTFOLIO_TTL_MS, STALE_RETRY_MS } from "../api/limits";
import type { ApiOrg, ApiProject } from "../api/types";

export type LiveInputs = {
  fetchedAt: string;
  orgs: ApiOrg[];
  projectsByOrg: Record<string, ApiProject[]>;
  projectsAvailable: boolean;
  /** Set when this snapshot is partial or is being served after a failed refresh. */
  warning: string | null;
};

let cached: { savedAt: number; value: LiveInputs } | null = null;
let inflight: Promise<LiveInputs> | null = null;
let holdUntil = 0;

export function clearLiveInputsCache(): void {
  cached = null;
  inflight = null;
  holdUntil = 0;
}

/** Test helper. Moves the snapshot into the past and clears the refresh hold. */
export function ageLiveInputsCache(ms: number): void {
  if (cached) cached.savedAt -= ms;
  holdUntil = 0;
}

async function loadLiveInputs(): Promise<LiveInputs> {
  const { fetchOrgs, fetchProjectsByOrg } = await import("../api/client");
  const fetchedAt = new Date().toISOString();
  const orgs = await fetchOrgs();
  try {
    const projectsByOrg = await fetchProjectsByOrg(orgs.map((org) => String(org.id)));
    return { fetchedAt, orgs, projectsByOrg, projectsAvailable: true, warning: null };
  } catch (error) {
    const notice = connectionNotice(error, configuredSecrets());
    return {
      fetchedAt,
      orgs,
      projectsByOrg: {},
      projectsAvailable: false,
      warning: `Projects could not be loaded, so project counts are unavailable. Organizations are the live list. ${notice}`,
    };
  }
}

async function loadFreshInputs(): Promise<LiveInputs> {
  if (process.env.VITEST) return loadLiveInputs();
  const { unstable_cache } = await import("next/cache");
  return unstable_cache(loadLiveInputs, ["cxm-portfolio"], {
    revalidate: PORTFOLIO_REVALIDATE_SECONDS,
    tags: ["cxm-portfolio"],
  })();
}

function configuredSecrets(): string[] {
  return [process.env.SUBHUB_API_PASSWORD, process.env.SUBHUB_API_KEY].filter(
    (value): value is string => Boolean(value && value.length >= 3),
  );
}

export async function getLiveInputs(): Promise<LiveInputs> {
  const now = Date.now();
  if (cached && (now - cached.savedAt < PORTFOLIO_TTL_MS || now < holdUntil)) return cached.value;
  if (inflight) return inflight;
  const pending = loadFreshInputs()
    .then((value) => {
      cached = { savedAt: Date.now(), value };
      holdUntil = 0;
      return value;
    })
    .catch((error: unknown) => {
      if (!cached) throw error;
      const notice = connectionNotice(error, configuredSecrets());
      cached = {
        savedAt: cached.savedAt,
        value: {
          ...cached.value,
          warning: `The live API could not be refreshed. Showing the last snapshot. ${notice}`,
        },
      };
      holdUntil = Date.now() + STALE_RETRY_MS;
      console.error(`CXM API refresh failed: ${notice}`);
      return cached.value;
    })
    .finally(() => {
      if (inflight === pending) inflight = null;
    });
  inflight = pending;
  return pending;
}
