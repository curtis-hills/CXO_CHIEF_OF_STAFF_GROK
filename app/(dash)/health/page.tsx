import Link from "next/link";
import { OrgBreakdown, OrgFilterFields, filterNote } from "@/components/org-filter";
import { HealthChip, PageHeader, PaymentChip, healthLabel } from "@/components/ui";
import { accountTypeLabel, type Account } from "@/lib/domain";
import { appendOrgFilter, visibleBook, type PortfolioFilter } from "@/lib/data/filters";
import { loadPortfolio } from "@/lib/data/load";
import { launchedAccounts } from "@/lib/data/views";
import { formatNumber, formatPercent, one } from "@/lib/format";
import type { HealthBand } from "@/lib/metrics/health";

export const metadata = { title: "Post-launch health" };

const ORDER: HealthBand[] = ["red", "yellow", "green", "ramping", "unscored", "prelaunch"];

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const band = one(query.band);
  const type = one(query.type);
  const from = one(query.from);
  const to = one(query.to);
  const portfolio = await loadPortfolio();
  const { filter, accounts } = visibleBook(portfolio, query);
  const launched = launchedAccounts(accounts);
  const rows = launched
    .filter((account) => {
      if (!type) return true;
      if (type === "seamless_dealer") return account.legacySeamlessDealer;
      if (type === "sales_org") return account.accountType === "sales_org" && !account.legacySeamlessDealer;
      return account.accountType === type;
    })
    .filter((account) => {
      if (!from && !to) return true;
      const day = account.launchedAt.iso?.slice(0, 10);
      if (!day) return false;
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    })
    .filter((account) => !band || account.health.band === band)
    .sort((a, b) => ORDER.indexOf(a.health.band) - ORDER.indexOf(b.health.band) || (a.health.score ?? 999) - (b.health.score ?? 999));

  const counts = Object.fromEntries(ORDER.map((key) => [key, launched.filter((account) => account.health.band === key).length]));

  return (
    <>
      <PageHeader
        eyebrow="Post-launch health"
        title="Volume trend and billing"
        lede="v1 uses only two inputs. Volume is worth 75 points and billing 25, the 30/10 weights from the fuller model stretched onto 100. Through day 60, volume follows pace: on pace or achieved is full credit, watch is half, at risk or missed is none. After day 60, volume is the last 30 days compared with the trailing 90-day monthly average. At least 100% is full credit, 60–99% is half, and under 60% is none. A failed or past-due payment scores no billing points. A failed payment open 7 days or more, or a cancellation, forces Red even when the points are higher. Green is 70 or above. Yellow is 45–69. Red is under 45."
      />
      <form key={JSON.stringify(query)} className="mb-3 flex flex-wrap items-end gap-3" method="get">
        <OrgFilterFields filter={filter} accounts={portfolio.accounts} />
        {band ? <input type="hidden" name="band" value={band} /> : null}
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
        sliceLabel="on this health table"
        sliceCount={rows.length}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <FilterLink href={healthHref("", type, from, to, filter)} current={!band} label={`All ${launched.length}`} />
        {ORDER.filter((key) => (counts[key] ?? 0) > 0).map((key) => (
          <FilterLink key={key} href={healthHref(key, type, from, to, filter)} current={band === key} label={`${healthLabel(key)} ${counts[key]}`} />
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="data">
          <thead>
            <tr>
              <th>Account</th>
              <th>Score</th>
              <th>Band</th>
              <th>Basis</th>
              <th>Volume</th>
              <th>Billing</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((account) => (
              <HealthRow key={account.id} account={account} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 max-w-3xl text-xs leading-5 text-muted">
        Failed-payment age is a stand-in where the badge says so. The API only has the current payment status (P2-4). Adoption,
        support, and NPS are not in this score yet.
      </p>
    </>
  );
}

function HealthRow({ account }: { account: Account }) {
  const ratio = account.health.volumeRatio;
  return (
    <tr>
      <td>
        <Link href={`/accounts/${account.id}`} className="font-medium hover:underline">
          {account.name}
        </Link>
        <p className="mt-0.5 text-xs text-muted">
          {accountTypeLabel(account.accountType, account.legacySeamlessDealer)}
          {account.pace ? ` · day ${account.pace.day}` : ""}
        </p>
      </td>
      <td className="num">{account.health.score === null ? "—" : formatNumber(account.health.score, 0)}</td>
      <td>
        <HealthChip band={account.health.band} />
      </td>
      <td className="text-xs capitalize">{account.health.basis}</td>
      <td className="num text-xs">
        {account.health.basis === "baseline" && ratio !== null && Number.isFinite(ratio) ? formatPercent(ratio) : "—"}
        <span className="block text-muted">{account.health.volumePoints} pts</span>
      </td>
      <td className="text-xs capitalize">
        <span className="inline-flex flex-wrap items-center gap-2">
          {account.paymentStatus}
          <PaymentChip status={account.paymentStatus} />
        </span>
        <span className="block text-muted">{account.health.billingPoints} pts</span>
      </td>
      <td className="max-w-sm text-xs leading-5 text-muted">{account.health.drivers[0]}</td>
    </tr>
  );
}

function healthHref(band: string, type: string, from: string, to: string, filter: PortfolioFilter): string {
  const params = new URLSearchParams();
  if (band) params.set("band", band);
  if (type) params.set("type", type);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  appendOrgFilter(params, filter);
  const query = params.toString();
  return query ? `/health?${query}` : "/health";
}

function FilterLink({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link href={href} className={`rounded-full px-3 py-1 ring-1 ring-inset ${current ? "bg-navy text-white ring-navy" : "bg-card text-ink ring-line"}`}>
      {label}
    </Link>
  );
}
