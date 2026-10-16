import Link from "next/link";
import { PaceChip, Panel, SlaChip, Stat } from "@/components/ui";
import { TRANSACTION_FEE_USD, accountTypeLabel } from "@/lib/domain";
import { loadPortfolio } from "@/lib/data/load";
import { cohortAccounts, liveProjectsOnDay, median, prelaunchAccounts } from "@/lib/data/views";
import { flaggedClock } from "@/lib/metrics/stage";
import { formatNumber, formatUsd } from "@/lib/format";

export const metadata = { title: "Daily brief" };

export default async function OverviewPage() {
  const portfolio = await loadPortfolio();
  const { accounts, alerts, asOf } = portfolio;
  const prelaunch = prelaunchAccounts(accounts);
  const cohort = cohortAccounts(accounts);
  const active = cohort.filter((account) => account.pace && account.pace.day <= 60 && account.pace.status !== "ramping");
  const onPace = active.filter((account) => account.pace?.status === "on_pace" || account.pace?.status === "achieved");
  const atRisk = cohort.filter((account) => account.pace?.status === "at_risk");
  const waiting = prelaunch.filter((account) => account.waitingOnCustomer);
  const breaches = prelaunch.filter(
    (account) => account.stageTiming.inStageTone === "red" || account.stageTiming.onboardingToLaunched.tone === "red",
  );
  const spans = accounts
    .map((account) => account.stageTiming.onboardingToLaunched)
    .filter((span) => span.complete && span.businessDays !== null)
    .map((span) => span.businessDays as number);
  const handoffs = alerts.filter((alert) => alert.type === "new_handoff");
  const yesterday = liveProjectsOnDay(accounts, asOf, 1);
  const week = Array.from({ length: 7 }, (_, index) => liveProjectsOnDay(accounts, asOf, 6 - index));
  const weekTotal = week.reduce((sum, value) => sum + value, 0);
  const high = alerts.filter((alert) => alert.severity === "high").slice(0, 5);
  const proxyDates = accounts.reduce((sum, account) => {
    return (
      sum +
      [account.onboardingAt, account.readyToLaunchAt, account.launchedAt].filter((date) => date.source === "proxy").length
    );
  }, 0);
  const missingLaunch = accounts.filter((account) => account.stage === "launched" && account.launchedAt.source === "missing");
  const red = accounts.filter((account) => account.health.band === "red");
  const maxBar = Math.max(1, ...week);

  return (
    <>
      <header className="mb-6 max-w-3xl">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-tide">Daily brief</p>
        <h1 className="mt-1 font-serif text-[2rem] leading-tight">What needs a decision this morning</h1>
        <div className="mt-3 space-y-2 text-sm leading-6 text-ink">
          <p>
            {atRisk.length === 0
              ? "No launched account inside 60 days is at risk on pace."
              : `${atRisk.length} launched ${atRisk.length === 1 ? "account is" : "accounts are"} at risk on the 10-in-30 / 25-in-60 pace.`}{" "}
            {breaches.length === 0
              ? "No pre-launch account is past a stage flag."
              : `${breaches.length} pre-launch ${breaches.length === 1 ? "account is" : "accounts are"} past a stage flag.`}{" "}
            {onPace.length} of {active.length || 0} accounts still inside the 60-day window are on pace or have already hit the target.
          </p>
          {waiting.length > 0 ? (
            <p>
              Waiting on the customer:{" "}
              {waiting.map((account, index) => (
                <span key={account.id}>
                  {index > 0 ? ", " : null}
                  <Link href={`/accounts/${account.id}`} className="text-tide underline-offset-2 hover:underline">
                    {account.name}
                  </Link>
                  {account.waitingReason ? ` (${account.waitingReason})` : ""}
                </span>
              ))}
              . The business-day clock keeps running.
            </p>
          ) : null}
          <p className="text-muted">
            This brief is drafted from the accounts on this page. A chief-of-staff assistant is not connected yet. Setup belongs
            to CX Admin. The CXM runs kickoff and training and sets Launched. Amanda Hatch’s chat support is first contact after
            launch. Craig Kersey is the escalation.
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="On pace, first 60 days"
          value={active.length ? `${Math.round((onPace.length / active.length) * 100)}%` : "—"}
          hint={`${onPace.length} of ${active.length} on pace or achieved`}
        />
        <Stat
          label="At risk"
          value={String(atRisk.length)}
          hint="Ratio under 0.7, or no project in 7 days"
        />
        <Stat
          label="Onboarding → Launched"
          value={median(spans) === null ? "—" : `${formatNumber(median(spans) ?? 0, 1)} bd`}
          hint="Median business days. Goal 5, flag 7."
        />
        <Stat
          label="Live projects yesterday"
          value={String(yesterday)}
          hint={`${formatUsd(yesterday * TRANSACTION_FEE_USD)} at $35 · ${weekTotal} in 7 days`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Panel title="Needs a look">
          <ul className="divide-y divide-line">
            {high.length === 0 ? <li className="text-sm text-muted">No high-severity items.</li> : null}
            {high.map((alert) => (
              <li key={alert.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/accounts/${alert.orgId}`} className="text-sm font-medium text-tide hover:underline">
                    {alert.orgName}
                  </Link>
                  <span className="text-xs uppercase tracking-wide text-muted">{alert.owner}</span>
                </div>
                <p className="mt-1 text-sm">{alert.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted">{alert.suggestedAction}</p>
              </li>
            ))}
          </ul>
          <Link href="/actions" className="mt-4 inline-block text-sm text-tide">
            Open the full queue
          </Link>
        </Panel>

        <div className="space-y-4">
          <Panel title="Seven-day volume">
            <div className="flex h-24 items-end gap-2">
              {week.map((value, index) => (
                <div key={index} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-16 w-full items-end">
                    <div className="w-full rounded-sm bg-tide" style={{ height: `${Math.max(6, (value / maxBar) * 100)}%` }} />
                  </div>
                  <span className="num text-[0.65rem] text-muted">{value}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Oldest day on the left. Live projects only, counted from each account’s launch date.</p>
          </Panel>
          <Panel title="Data">
            <ul className="space-y-2 text-sm leading-5">
              <li>
                {portfolio.notice
                  ? "Showing demo data because the live API could not be read."
                  : portfolio.mode === "mock"
                    ? "Reading demo data."
                    : "Reading the Executive API."}
              </li>
              <li>{proxyDates} lifecycle dates are proxies. {missingLaunch.length} launched {missingLaunch.length === 1 ? "account has" : "accounts have"} no day 0.</li>
              <li>{handoffs.length} new handoffs in the last 7 days. {red.length} accounts are red on v1 health.</li>
              <li>No snapshot database yet. The later Postgres shapes live in the data schema file.</li>
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Pre-launch, past a flag"
          action={
            <Link href="/pre-launch" className="text-sm text-tide">
              Board
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {breaches.length === 0 ? <li className="text-sm text-muted">None.</li> : null}
            {breaches.map((account) => {
              const flagged = flaggedClock(account.stageTiming);
              return (
                <li key={account.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <Link href={`/accounts/${account.id}`} className="text-sm font-medium hover:underline">
                      {account.name}
                    </Link>
                    <p className="text-xs text-muted">{accountTypeLabel(account.accountType, account.legacySeamlessDealer)}</p>
                  </div>
                  {flagged ? <SlaChip tone={flagged.tone}>{flagged.businessDays} bd</SlaChip> : null}
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel
          title="At risk in the cohort"
          action={
            <Link href="/accounts?status=at_risk" className="text-sm text-tide">
              Cohort
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {atRisk.length === 0 ? <li className="text-sm text-muted">None.</li> : null}
            {atRisk.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <Link href={`/accounts/${account.id}`} className="text-sm font-medium hover:underline">
                    {account.name}
                  </Link>
                  <p className="num text-xs text-muted">
                    Day {account.pace?.day} · {account.pace?.actual} live
                  </p>
                </div>
                {account.pace ? <PaceChip status={account.pace.status} /> : null}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
