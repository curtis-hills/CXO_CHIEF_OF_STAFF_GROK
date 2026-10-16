import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
if (!url) {
  console.error("Set DATABASE_URL or POSTGRES_URL, then run npm run db:migrate.");
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
for (const statement of statements) {
  await sql.query(statement);
}
console.log(`Applied ${statements.length} statements.`);
