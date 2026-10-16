import "server-only";

import { cache } from "react";
import { connectionNotice } from "../api/body";
import type { Account, Alert } from "../domain";
import { assemblePortfolio } from "./assemble";
import { buildMockInputs } from "./mock";
import { readOverrides } from "./overrides";
import { databaseConfigured, getStore } from "../sync/store";

export type Portfolio = {
  mode: "mock" | "live";
  /** Clock used for pace and stage math. This is the current request time. */
  asOf: string;
  /** When the last successful sync finished. Null on demo data. */
  dataAsOf: string | null;
  projectsAvailable: boolean;
  accounts: Account[];
  alerts: Alert[];
  /** Demo label, a partial project sync, or a database error. */
  notice: string | null;
};

const UNCONFIGURED = "DATABASE_URL is not set, so this is a labeled stand-in. Lifecycle dates are proxies until engineering ships them.";
const EMPTY = "The database has no synced accounts yet. Run the backfill from Sync.";

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

function secrets(): string[] {
  return [process.env.SUBHUB_API_PASSWORD, process.env.SUBHUB_API_KEY, process.env.DATABASE_URL, process.env.POSTGRES_URL].filter(
    (value): value is string => Boolean(value && value.length >= 3),
  );
}

export async function readPortfolio(): Promise<Portfolio> {
  const asOf = new Date().toISOString();
  const overrides = readOverrides();
  try {
    const store = getStore();
    const orgs = await store.loadOrgPayloads();
    if (orgs.length === 0) return demoPortfolio(asOf, overrides, databaseConfigured() ? EMPTY : UNCONFIGURED);
    const projectsByOrg = await store.loadProjectsByOrg();
    const cursor = await store.getCursor("projects");
    const projectRows = await store.projectRowCount();
    const projectsAvailable = Boolean(cursor?.backfillComplete) || projectRows > 0;
    let notice: string | null = null;
    if (!projectsAvailable && cursor?.lastError) {
      notice = `Projects could not be loaded, so project counts are unavailable. Organizations are the stored list. ${cursor.lastError}`;
    } else if (!projectsAvailable) {
      notice = "Projects have not been synced yet, so project counts are unavailable. Organizations are the stored list.";
    }
    const assembled = assemblePortfolio({
      mode: "live",
      asOf,
      orgs,
      projectsByOrg,
      projectsAvailable,
      proxies: {},
      overrides,
    });
    return {
      mode: "live",
      asOf,
      dataAsOf: await store.lastSuccessAt(),
      projectsAvailable,
      notice,
      ...assembled,
    };
  } catch (error) {
    const notice = connectionNotice(error, secrets());
    console.error(`CXM database read failed: ${notice}`);
    return demoPortfolio(asOf, overrides, `The database could not be read. ${notice}`);
  }
}

export const loadPortfolio = cache(readPortfolio);
