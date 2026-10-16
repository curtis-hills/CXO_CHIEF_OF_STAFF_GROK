import "server-only";

import { databaseUrl } from "../db/sql";
import { MemoryStore } from "./memory-store";
import { PostgresStore } from "./postgres-store";
import type { SyncStore } from "./types";

const globalStore = globalThis as typeof globalThis & { __cxmSyncStore?: MemoryStore };

export function databaseConfigured(): boolean {
  return Boolean(databaseUrl());
}

export function getStore(): SyncStore {
  if (databaseConfigured()) return new PostgresStore();
  globalStore.__cxmSyncStore ??= new MemoryStore();
  return globalStore.__cxmSyncStore;
}

export function resetMemoryStore(): void {
  globalStore.__cxmSyncStore = new MemoryStore();
}

export function memoryStore(): MemoryStore | null {
  return databaseConfigured() ? null : (getStore() as MemoryStore);
}
