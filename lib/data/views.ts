import type { Account } from "../domain";
import { utcDayNumber } from "../metrics/calendar";

export function prelaunchAccounts(accounts: Account[]): Account[] {
  return accounts.filter((account) => account.stage === "onboarding" || account.stage === "ready_to_launch");
}

export function cohortAccounts(accounts: Account[]): Account[] {
  return accounts.filter((account) => account.stage === "launched" && (!account.pace || account.pace.day <= 90));
}

export function launchedAccounts(accounts: Account[]): Account[] {
  return accounts.filter((account) => account.stage === "launched");
}

export function liveProjectsOnDay(accounts: Account[], asOf: string, daysAgo: number): number {
  const end = utcDayNumber(asOf);
  let count = 0;
  for (const account of accounts) {
    for (const project of account.projects) {
      if (project.live && end - utcDayNumber(project.createdAt) === daysAgo) count += 1;
    }
  }
  return count;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}
