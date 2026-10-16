import { afterEach, describe, expect, it } from "vitest";
import {
  MIGRATION_ID,
  MIGRATION_LOCK_SQL,
  cronSecretSet,
  ensureMigrations,
  migrationStatements,
  readSetupStatus,
  type SqlExecutor,
  type SqlStatement,
} from "../lib/db/migrate";

afterEach(() => {
  delete process.env.CRON_SECRET;
});

function fakeDatabase(options?: { missingTable?: boolean; fail?: string }): SqlExecutor & { calls: string[] } {
  const calls: string[] = [];
  let recorded = false;
  let chain = Promise.resolve();
  return {
    calls,
    async query(text) {
      calls.push(text);
      if (text === "SELECT 1") return [{ ok: 1 }];
      if (text.includes("FROM schema_migrations")) {
        if (options?.missingTable && !recorded) {
          const error = new Error('relation "schema_migrations" does not exist');
          (error as Error & { code: string }).code = "42P01";
          throw error;
        }
        return recorded ? [{ id: MIGRATION_ID }] : [];
      }
      return [];
    },
    transaction(queries) {
      const run = chain.then(async () => {
        if (options?.fail) throw new Error(options.fail);
        if (!queries[0]?.text.includes("pg_advisory_xact_lock")) throw new Error("migration ran without the advisory lock");
        for (const query of queries) calls.push(query.text);
        recorded = true;
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

describe("automatic migrations", () => {
  it("takes the advisory lock once and is a no-op the second time", async () => {
    const sql = fakeDatabase({ missingTable: true });
    const first = await ensureMigrations(sql);
    const second = await ensureMigrations(sql);
    expect(first).toEqual({ applied: true, error: null });
    expect(second).toEqual({ applied: true, error: null });
    const locks = sql.calls.filter((call) => call.includes("pg_advisory_xact_lock"));
    expect(locks).toEqual([MIGRATION_LOCK_SQL]);
    expect(sql.calls.filter((call) => call.startsWith("INSERT INTO schema_migrations"))).toHaveLength(2);
  });

  it("serializes overlapping setups behind the same lock statement", async () => {
    const sql = fakeDatabase({ missingTable: true });
    const [left, right] = await Promise.all([ensureMigrations(sql), ensureMigrations(sql)]);
    expect(left.applied).toBe(true);
    expect(right.applied).toBe(true);
    const locks = sql.calls.filter((call) => call.includes("pg_advisory_xact_lock"));
    expect(locks.length).toBeGreaterThan(0);
    expect(locks.every((call) => call === MIGRATION_LOCK_SQL)).toBe(true);
  });

  it("builds an idempotent statement list", () => {
    const statements: SqlStatement[] = migrationStatements();
    expect(statements[0]?.text).toBe(MIGRATION_LOCK_SQL);
    const creates = statements.filter((statement) => statement.text.startsWith("CREATE TABLE"));
    expect(creates.length).toBeGreaterThan(0);
    expect(creates.every((statement) => statement.text.includes("IF NOT EXISTS"))).toBe(true);
    expect(statements.some((statement) => statement.text.includes("schema_migrations"))).toBe(true);
    expect(statements.at(-1)?.params).toEqual([MIGRATION_ID]);
  });

  it("reports connection, migrations, and CRON_SECRET as booleans and never the secret", async () => {
    process.env.CRON_SECRET = "super-secret-value";
    const connected = fakeDatabase();
    const ready = await readSetupStatus(connected);
    expect(ready).toEqual({ databaseConnected: true, migrationsApplied: false, cronSecretSet: true });
    expect(JSON.stringify(ready)).not.toContain("super-secret-value");
    expect(cronSecretSet()).toBe(true);

    delete process.env.CRON_SECRET;
    const down: SqlExecutor = {
      async query() {
        throw new Error("connect ECONNREFUSED");
      },
      async transaction() {
        throw new Error("should not migrate");
      },
    };
    const offline = await readSetupStatus(down);
    expect(offline).toEqual({ databaseConnected: false, migrationsApplied: false, cronSecretSet: false });
    expect(JSON.stringify(offline)).not.toContain("ECONNREFUSED");
  });
});
