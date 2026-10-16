import Link from "next/link";
import { LaunchDateLabel, PaceChip, PageHeader, PaymentChip } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import { OrgBreakdown, OrgFilterFields, filterNote } from "@/components/org-filter";
import { accountTypeLabel, type Account } from "@/lib/domain";
import { visibleBook } from "@/lib/data/filters";
import { loadPortfolio } from "@/lib/data/load";
import { cohortAccounts } from "@/lib/data/views";
import { formatNumber, one } from "@/lib/format";
import type { PaceStatus } from "@/lib/metrics/pace";

export const metadata = { title: "Launched cohort" };

export default async function CohortPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const portfolio = await loadPortfolio();
  const { filter, accounts } = visibleBook(portfolio, query);
  const status = one(query.status);
  const type = one(query.type);
  const stage = one(query.stage);
  const health = one(query.health);
  const from = one(query.from);
  const to = one(query.to);

  const pool = stage ? accounts.filter((account) => account.stage === stage) : cohortAccounts(accounts);
  const rows = pool
    .filter((account) => !status || account.pace?.status === status || (status === "missing" && !account.pace))
    .filter((account) => !health || account.health.band === health)
    .filter((account) => inRange(account.launchedAt.iso, from, to))
    .filter((account) => {
      if (!type) return true;
      if (type === "seamless_dealer") return account.legacySeamlessDealer;
      if (type === "sales_org") return account.accountType === "sales_org" && !account.legacySeamlessDealer;
      return account.accountType === type;
    })
    .sort((a, b) => (a.pace?.day ?? 999) - (b.pace?.day ?? 999));

  return (
    <>
      <PageHeader
        eyebrow="Launched cohort"
        title="Pace against 10 in 30 and 25 in 60"
        lede="A transaction is a new project created on or after Launched, which is also the signed customer billed at $35. The KPI clock starts at Launched. Expected pace is 10×day/30 through day 30, then 10+15×(day−30)/30 through day 60. On pace is a ratio of at least 1.0. Watch is at least 0.7. At risk is under 0.7, or no project in 7 days. Accounts past day 90 move to post-launch health. Until launched_at exists (P0-1), a launched account is labeled Launch date unknown and the earliest project date is the proxy."
      />
      <form key={JSON.stringify(query)} className="mb-3 flex flex-wrap items-end gap-3" method="get">
        <OrgFilterFields filter={filter} accounts={portfolio.accounts} />
        <label className="text-xs text-muted">
          Pace
          <select name="status" defaultValue={status} className="field mt-1 block">
            <option value="">All</option>
            <option value="on_pace">On pace</option>
            <option value="watch">Watch</option>
            <option value="at_risk">At risk</option>
            <option value="achieved">Achieved</option>
            <option value="missed">Missed</option>
            <option value="ramping">Ramping</option>
            <option value="missing">Date missing</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Type
          <select name="type" defaultValue={type} className="field mt-1 block">
            <option value="">All</option>
            <option value="epc">EPC</option>
            <option value="sales_org">Sales Org</option>
            <option value="seamless_dealer">Seamless Dealer (legacy)</option>
            <option value="seamless_installing_dealer">Seamless Installing Dealer</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Stage
          <select name="stage" defaultValue={stage} className="field mt-1 block">
            <option value="">Launched cohort</option>
            <option value="onboarding">Onboarding</option>
            <option value="ready_to_launch">Ready to Launch</option>
            <option value="launched">Launched</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Health
          <select name="health" defaultValue={health} className="field mt-1 block">
            <option value="">All</option>
            <option value="green">Green</option>
            <option value="yellow">Yellow</option>
            <option value="red">Red</option>
            <option value="ramping">Ramping</option>
            <option value="unscored">Unscored</option>
            <option value="prelaunch">Pre-launch</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Launched from
          <input name="from" type="date" defaultValue={from} className="field mt-1 block" />
        </label>
        <label className="text-xs text-muted">
          Launched to
          <input name="to" type="date" defaultValue={to} className="field mt-1 block" />
        </label>
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
          Apply
        </button>
      </form>
      <p className="mb-4 max-w-3xl text-xs leading-5 text-muted">{filterNote(portfolio.mode)}</p>
      <OrgBreakdown
        accounts={accounts}
        highlightStatuses={filter.statuses}
        sliceLabel="in this pace table"
        sliceCount={rows.length}
      />
      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="data">
          <thead>
            <tr>
              <th>Account</th>
              <th>Day</th>
              <th>Live</th>
              <th>Expected</th>
              <th>Gap</th>
              <th>Pace</th>
              <th>30</th>
              <th>60</th>
              <th>14 days</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-sm text-muted">
                  No launched accounts match.
                </td>
              </tr>
            ) : null}
            {rows.map((account) => (
              <CohortRow key={account.id} account={account} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function inRange(iso: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!iso) return false;
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function CohortRow({ account }: { account: Account }) {
  const pace = account.pace;
  const gap = pace ? pace.actual - pace.expected : null;
  return (
    <tr>
      <td>
        <Link href={`/accounts/${account.id}`} className="font-medium hover:underline">
          {account.name}
        </Link>
        <p className="mt-0.5 text-xs text-muted">
          {accountTypeLabel(account.accountType, account.legacySeamlessDealer)} · {account.cxm?.name ?? "Unassigned"}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <LaunchDateLabel unknown={account.launchDateUnknown} source={account.launchedAt.source} />
          <PaymentChip status={account.paymentStatus} />
        </p>
      </td>
      <td className="num">{pace ? pace.day : "—"}</td>
      <td className="num">{pace ? pace.actual : "—"}</td>
      <td className="num">{pace ? formatNumber(pace.expected, 1) : "—"}</td>
      <td className="num">{gap === null ? "—" : formatNumber(gap, 1)}</td>
      <td>{pace ? <PaceChip status={pace.status} /> : <span className="text-xs text-muted">No day 0</span>}</td>
      <td>{pace ? <PaceChip status={pace.status30 as PaceStatus | "open"} /> : "—"}</td>
      <td>{pace ? <PaceChip status={pace.status60 as PaceStatus | "open"} /> : "—"}</td>
      <td>
        <Sparkline values={account.dailyCounts} />
      </td>
    </tr>
  );
}
