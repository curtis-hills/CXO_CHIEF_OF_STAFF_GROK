import Link from "next/link";
import { HealthChip, PageHeader, healthLabel } from "@/components/ui";
import { accountTypeLabel, type Account } from "@/lib/domain";
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
  const portfolio = await loadPortfolio();
  const rows = launchedAccounts(portfolio.accounts)
    .filter((account) => !band || account.health.band === band)
    .sort((a, b) => ORDER.indexOf(a.health.band) - ORDER.indexOf(b.health.band) || (a.health.score ?? 999) - (b.health.score ?? 999));

  const counts = Object.fromEntries(ORDER.map((key) => [key, launchedAccounts(portfolio.accounts).filter((account) => account.health.band === key).length]));

  return (
    <>
      <PageHeader
        eyebrow="Post-launch health"
        title="Volume trend and billing"
        lede="v1 uses only two inputs. Volume is worth 75 points and billing 25, the 30/10 weights from the fuller model stretched onto 100. Through day 60, volume follows pace: on pace or achieved is full credit, watch is half, at risk or missed is none. After day 60, volume is the last 30 days compared with the trailing 90-day monthly average. At least 100% is full credit, 60–99% is half, and under 60% is none. A failed or past-due payment scores no billing points. A failed payment open 7 days or more, or a cancellation, forces Red even when the points are higher. Green is 70 or above. Yellow is 45–69. Red is under 45."
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <FilterLink href="/health" current={!band} label={`All ${launchedAccounts(portfolio.accounts).length}`} />
        {ORDER.filter((key) => (counts[key] ?? 0) > 0).map((key) => (
          <FilterLink key={key} href={`/health?band=${key}`} current={band === key} label={`${healthLabel(key)} ${counts[key]}`} />
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
        {account.paymentStatus}
        <span className="block text-muted">{account.health.billingPoints} pts</span>
      </td>
      <td className="max-w-sm text-xs leading-5 text-muted">{account.health.drivers[0]}</td>
    </tr>
  );
}

function FilterLink({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link href={href} className={`rounded-full px-3 py-1 ring-1 ring-inset ${current ? "bg-navy text-white ring-navy" : "bg-card text-ink ring-line"}`}>
      {label}
    </Link>
  );
}
