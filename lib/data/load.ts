import "server-only";

import { cache } from "react";
import { connectionNotice } from "../api/body";
import { getApiConfig } from "../api/client";
import type { Account, Alert } from "../domain";
import { assemblePortfolio } from "./assemble";
import { getLiveInputs } from "./live-cache";
import { buildMockInputs } from "./mock";
import { readOverrides } from "./overrides";

export type Portfolio = {
  mode: "mock" | "live";
  /** Clock used for pace and stage math. This is the current request time. */
  asOf: string;
  /** When the org and project snapshot was read. Null on demo data. */
  dataAsOf: string | null;
  projectsAvailable: boolean;
  accounts: Account[];
  alerts: Alert[];
  /**
   * Demo failure, a stale snapshot, or projects that could not be loaded.
   * Live orgs are never replaced by demo accounts while a snapshot exists.
   */
  notice: string | null;
};

function demoPortfolio(asOf: string, overrides: ReturnType<typeof readOverrides>, notice: string | null): Portfolio {
  const mock = buildMockInputs(asOf);
  const assembled = assemblePortfolio({
    mode: "mock",
    asOf,
    orgs: mock.orgs,
    projectsByOrg: mock.projectsByOrg,
    proxies: mock.proxies,
    overrides,
  });
  return { mode: "mock", asOf, dataAsOf: null, projectsAvailable: true, notice, ...assembled };
}

export async function readPortfolio(): Promise<Portfolio> {
  const asOf = new Date().toISOString();
  const overrides = readOverrides();
  try {
    const config = getApiConfig();
    if (!config.live) return demoPortfolio(asOf, overrides, null);

    const live = await getLiveInputs();
    const assembled = assemblePortfolio({
      mode: "live",
      asOf,
      orgs: live.orgs,
      projectsByOrg: live.projectsByOrg,
      projectsAvailable: live.projectsAvailable,
      proxies: {},
      overrides,
    });
    return {
      mode: "live",
      asOf,
      dataAsOf: live.fetchedAt,
      projectsAvailable: live.projectsAvailable,
      notice: live.warning,
      ...assembled,
    };
  } catch (error) {
    const secrets = [process.env.SUBHUB_API_PASSWORD, process.env.SUBHUB_API_KEY].filter(
      (value): value is string => Boolean(value && value.length >= 3),
    );
    const notice = connectionNotice(error, secrets);
    console.error(`CXM API fallback: ${notice}`);
    return demoPortfolio(asOf, overrides, notice);
  }
}

export const loadPortfolio = cache(readPortfolio);
