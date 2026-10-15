import Link from "next/link";
import { PaceChip, PageHeader, SourceBadge } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import { accountTypeLabel, type Account } from "@/lib/domain";
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
  const status = one(query.status);
  const cxm = one(query.cxm);
  const type = one(query.type);
  const cxms = [...new Set(portfolio.accounts.map((account) => account.cxm?.name).filter((name): name is string => Boolean(name)))].sort();

  const rows = cohortAccounts(portfolio.accounts)
    .filter((account) => !status || account.pace?.status === status || (status === "missing" && !account.pace))
    .filter((account) => !cxm || account.cxm?.name === cxm)
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
        lede="A transaction is a new project created on or after Launched, which is also the signed customer billed at $35. The KPI clock starts at Launched. Expected pace is 10×day/30 through day 30, then 10+15×(day−30)/30 through day 60. On pace is a ratio of at least 1.0. Watch is at least 0.7. At risk is under 0.7, or no project in 7 days. Accounts past day 90 move to post-launch health."
      />
      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
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
          CXM
          <select name="cxm" defaultValue={cxm} className="field mt-1 block">
            <option value="">All</option>
            {cxms.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
          Filter
        </button>
      </form>
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
      </td>
      <td className="num">
        {pace ? pace.day : "—"}
        <span className="ml-2 inline-block align-middle">
          <SourceBadge source={account.launchedAt.source} />
        </span>
      </td>
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
