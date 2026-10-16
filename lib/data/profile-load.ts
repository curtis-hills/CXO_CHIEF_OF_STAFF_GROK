import "server-only";

import { sanitizeSnippet } from "../api/body";
import { readSetupStatus } from "../db/migrate";
import { databaseUrl, getSql } from "../db/sql";
import { buildDataProfile, type DataProfileReport, type ProfileDb } from "./profile";

export async function loadDataProfile(now = new Date()): Promise<DataProfileReport> {
  const generatedAt = now.toISOString();
  if (!databaseUrl()) {
    return { databaseConnected: false, migrationsApplied: false, error: null, generatedAt, profile: null };
  }
  const setup = await readSetupStatus();
  if (!setup.databaseConnected) {
    return { databaseConnected: false, migrationsApplied: false, error: null, generatedAt, profile: null };
  }
  if (!setup.migrationsApplied) {
    return { databaseConnected: true, migrationsApplied: false, error: null, generatedAt, profile: null };
  }
  try {
    const profile = await buildDataProfile(neonProfileDb());
    return { databaseConnected: true, migrationsApplied: true, error: null, generatedAt, profile };
  } catch (error) {
    const url = databaseUrl();
    const message = error instanceof Error ? error.message : "The database could not be read.";
    return {
      databaseConnected: true,
      migrationsApplied: true,
      error: sanitizeSnippet(message, url ? [url] : []),
      generatedAt,
      profile: null,
    };
  }
}

function neonProfileDb(): ProfileDb {
  const sql = getSql();
  return {
    query: (text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>,
  };
}
