import "server-only";

import fs from "fs";
import path from "path";
import type { LifecycleOverride } from "./overrides-types";

export type { LifecycleOverride } from "./overrides-types";

function storePath(): string {
  const preferredDir = path.join(process.cwd(), ".data");
  try {
    fs.mkdirSync(preferredDir, { recursive: true });
    fs.accessSync(preferredDir, fs.constants.W_OK);
    return path.join(preferredDir, "overrides.json");
  } catch {
    return path.join("/tmp", "cxm-overrides.json");
  }
}

export function readOverrides(): Record<string, LifecycleOverride> {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, LifecycleOverride>;
  } catch {
    return {};
  }
}

export function writeOverride(orgId: string, patch: LifecycleOverride): void {
  const file = storePath();
  const all = readOverrides();
  all[orgId] = {
    ...all[orgId],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
}

export function clearOverride(orgId: string): void {
  const file = storePath();
  const all = readOverrides();
  delete all[orgId];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
}
