import "server-only";

import { cache } from "react";
import { connectionNotice } from "../api/body";
import { fetchOrgs, fetchProjectsByOrg, getApiConfig } from "../api/client";
import type { Account, Alert } from "../domain";
import { assemblePortfolio } from "./assemble";
import { buildMockInputs } from "./mock";
import { readOverrides } from "./overrides";

export type Portfolio = {
  mode: "mock" | "live";
  asOf: string;
  accounts: Account[];
  alerts: Alert[];
  /** Set when live credentials exist but the API response could not be used. */
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
  return { mode: "mock", asOf, notice, ...assembled };
}

export async function readPortfolio(): Promise<Portfolio> {
  const asOf = new Date().toISOString();
  const overrides = readOverrides();
  try {
    const config = getApiConfig();
    if (!config.live) return demoPortfolio(asOf, overrides, null);

    const orgs = await fetchOrgs();
    const projectsByOrg = await fetchProjectsByOrg(orgs.map((org) => String(org.id)));
    const assembled = assemblePortfolio({
      mode: "live",
      asOf,
      orgs,
      projectsByOrg,
      proxies: {},
      overrides,
    });
    return { mode: "live", asOf, notice: null, ...assembled };
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
