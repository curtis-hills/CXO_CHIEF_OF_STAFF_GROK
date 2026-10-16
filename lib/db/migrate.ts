import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeSnippet } from "../api/body";
import { databaseUrl, getSql, splitSql } from "./sql";

/** Two-int advisory lock held for the migration transaction. */
export const MIGRATION_LOCK = [872431, 1] as const;
export const MIGRATION_ID = "0001_sync";
export const MIGRATION_LOCK_SQL = `SELECT pg_advisory_xact_lock(${MIGRATION_LOCK[0]}, ${MIGRATION_LOCK[1]})`;

export type SetupStatus = {
  databaseConnected: boolean;
  migrationsApplied: boolean;
  cronSecretSet: boolean;
};

export type MigrationResult = {
  applied: boolean;
  error: string | null;
};

export type SqlStatement = {
  text: string;
  params?: unknown[];
};

/** Small query surface so the lock and the idempotent re-run can be tested without Neon. */
export type SqlExecutor = {
  query: (text: string, params?: unknown[]) => Promise<unknown[]>;
  transaction: (queries: SqlStatement[]) => Promise<void>;
};

export function cronSecretSet(): boolean {
  return Boolean(process.env.CRON_SECRET?.trim());
}

export function loadMigrationSql(): string {
  return readFileSync(join(process.cwd(), "db/migrations/0001_sync.sql"), "utf8");
}

export function migrationStatements(): SqlStatement[] {
  return [
    { text: MIGRATION_LOCK_SQL },
    ...splitSql(loadMigrationSql()).map((text) => ({ text })),
    {
      text: "INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
      params: [MIGRATION_ID],
    },
  ];
}

function missingRelation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "message" in error ? String((error as { message: unknown }).message) : "";
  return code === "42P01" || /does not exist/i.test(message);
}

async function recorded(sql: SqlExecutor): Promise<boolean> {
  try {
    const rows = await sql.query("SELECT id FROM schema_migrations WHERE id = $1", [MIGRATION_ID]);
    return rows.length > 0;
  } catch (error) {
    if (missingRelation(error)) return false;
    throw error;
  }
}

function neonExecutor(): SqlExecutor {
  const sql = getSql();
  return {
    query: (text, params) => sql.query(text, params),
    transaction: async (queries) => {
      await sql.transaction((txn) => queries.map((query) => txn.query(query.text, query.params)));
    },
  };
}

function executor(given?: SqlExecutor): SqlExecutor | null {
  if (given) return given;
  if (!databaseUrl()) return null;
  return neonExecutor();
}

export async function readSetupStatus(given?: SqlExecutor): Promise<SetupStatus> {
  const status: SetupStatus = {
    databaseConnected: false,
    migrationsApplied: false,
    cronSecretSet: cronSecretSet(),
  };
  const sql = executor(given);
  if (!sql) return status;
  try {
    await sql.query("SELECT 1");
    status.databaseConnected = true;
  } catch {
    return status;
  }
  try {
    status.migrationsApplied = await recorded(sql);
  } catch {
    status.migrationsApplied = false;
  }
  return status;
}

/**
 * Applies db/migrations/0001_sync.sql once.
 * The lock is transactional (`pg_advisory_xact_lock`) because the Neon HTTP driver
 * does not keep a session between statements. A second caller waits, then the
 * CREATE TABLE IF NOT EXISTS statements and the version insert are no-ops.
 */
export async function ensureMigrations(given?: SqlExecutor): Promise<MigrationResult> {
  const sql = executor(given);
  if (!sql) return { applied: false, error: "DATABASE_URL is not set." };
  try {
    if (await recorded(sql)) return { applied: true, error: null };
    await sql.transaction(migrationStatements());
    return { applied: true, error: null };
  } catch (error) {
    const url = databaseUrl();
    const safe = sanitizeSnippet(error instanceof Error ? error.message : "Database setup failed.", url ? [url] : []);
    console.error(safe);
    return { applied: false, error: safe };
  }
}
