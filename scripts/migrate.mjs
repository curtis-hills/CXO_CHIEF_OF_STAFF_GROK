import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set. The deployed app applies migrations from /sync. This script is optional.");
  process.exit(1);
}

const source = readFileSync(new URL("../db/migrations/0001_sync.sql", import.meta.url), "utf8");
const statements = source
  .split(";")
  .map((statement) =>
    statement
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim(),
  )
  .filter((statement) => statement.length > 0);

const sql = neon(url);
await sql.transaction((txn) => [
  txn.query("SELECT pg_advisory_xact_lock(872431, 1)"),
  ...statements.map((statement) => txn.query(statement)),
]);
console.log(`Applied ${statements.length} statements.`);
