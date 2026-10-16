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

type CacheSlot = {
  cached: { savedAt: number; value: LiveInputs } | null;
  inflight: Promise<LiveInputs> | null;
  holdUntil: number;
};

const cacheSlot: CacheSlot = ((globalThis as typeof globalThis & { __cxmLiveCache?: CacheSlot }).__cxmLiveCache ??= {
  cached: null,
  inflight: null,
  holdUntil: 0,
});

export function clearLiveInputsCache(): void {
  cacheSlot.cached = null;
  cacheSlot.inflight = null;
  cacheSlot.holdUntil = 0;
}

/** Test helper. Moves the snapshot into the past and clears the refresh hold. */
export function ageLiveInputsCache(ms: number): void {
  if (cacheSlot.cached) cacheSlot.cached.savedAt -= ms;
  cacheSlot.holdUntil = 0;
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
  if (cacheSlot.cached && (now - cacheSlot.cached.savedAt < PORTFOLIO_TTL_MS || now < cacheSlot.holdUntil)) {
    return cacheSlot.cached.value;
  }
  if (cacheSlot.inflight) return cacheSlot.inflight;
  const pending = loadFreshInputs()
    .then((value) => {
      cacheSlot.cached = { savedAt: Date.now(), value };
      cacheSlot.holdUntil = 0;
      return value;
    })
    .catch((error: unknown) => {
      if (!cacheSlot.cached) throw error;
      const notice = connectionNotice(error, configuredSecrets());
      cacheSlot.cached = {
        savedAt: cacheSlot.cached.savedAt,
        value: {
          ...cacheSlot.cached.value,
          warning: `The live API could not be refreshed. Showing the last snapshot. ${notice}`,
        },
      };
      cacheSlot.holdUntil = Date.now() + STALE_RETRY_MS;
      console.error(`CXM API refresh failed: ${notice}`);
      return cacheSlot.cached.value;
    })
    .finally(() => {
      if (cacheSlot.inflight === pending) cacheSlot.inflight = null;
    });
  cacheSlot.inflight = pending;
  return pending;
}
