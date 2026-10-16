import "server-only";

import { cache } from "react";
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
};

export const loadPortfolio = cache(async (): Promise<Portfolio> => {
  const asOf = new Date().toISOString();
  const overrides = readOverrides();
  const config = getApiConfig();

  if (!config.live) {
    const mock = buildMockInputs(asOf);
    const assembled = assemblePortfolio({
      mode: "mock",
      asOf,
      orgs: mock.orgs,
      projectsByOrg: mock.projectsByOrg,
      proxies: mock.proxies,
      overrides,
    });
    return { mode: "mock", asOf, ...assembled };
  }

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
  return { mode: "live", asOf, ...assembled };
});
