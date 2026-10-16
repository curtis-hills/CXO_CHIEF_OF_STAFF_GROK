import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export function databaseUrl(): string | null {
  const value = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || "";
  return value || null;
}

let client: NeonQueryFunction<false, false> | null = null;
let clientUrl = "";

export function getSql(): NeonQueryFunction<false, false> {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!client || clientUrl !== url) {
    client = neon(url);
    clientUrl = url;
  }
  return client;
}

export function splitSql(source: string): string[] {
  return source
    .split(";")
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((statement) => statement.length > 0);
}
