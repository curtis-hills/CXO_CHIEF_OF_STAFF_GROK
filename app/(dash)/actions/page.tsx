import Link from "next/link";
import { Chip, PageHeader } from "@/components/ui";
import { loadPortfolio } from "@/lib/data/load";
import { one } from "@/lib/format";
import type { AlertSeverity } from "@/lib/domain";

export const metadata = { title: "Action queue" };

const SEVERITY: { id: AlertSeverity; tone: "bad" | "watch" | "neutral" }[] = [
  { id: "high", tone: "bad" },
  { id: "medium", tone: "watch" },
  { id: "low", tone: "neutral" },
];

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const severity = one(query.severity);
  const type = one(query.type);
  const portfolio = await loadPortfolio();
  const types = [...new Set(portfolio.alerts.map((alert) => alert.type))].sort();
  const rows = portfolio.alerts
    .filter((alert) => !severity || alert.severity === severity)
    .filter((alert) => !type || alert.type === type);

  return (
    <>
      <PageHeader
        eyebrow="Action queue"
        title="What the signals are asking for"
        lede="Items are derived on each load. Acknowledging them will wait for the Postgres store. Owners follow the operating model: CX Admin for setup delays, the assigned CXM for pace and launch, Amanda Hatch as the post-launch support contact inside the suggested action, and Craig Kersey when the item is an escalation."
      />
      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-xs text-muted">
          Severity
          <select name="severity" defaultValue={severity} className="field mt-1 block">
            <option value="">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Type
          <select name="type" defaultValue={type} className="field mt-1 block">
            <option value="">All</option>
            {types.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
          Filter
        </button>
      </form>
      <div className="space-y-3">
        {rows.length === 0 ? <p className="text-sm text-muted">Nothing in this filter.</p> : null}
        {rows.map((alert) => {
          const tone = SEVERITY.find((item) => item.id === alert.severity)?.tone ?? "neutral";
          return (
            <article key={alert.id} className="rounded-lg border border-line bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={tone}>{alert.severity}</Chip>
                <span className="text-xs uppercase tracking-wide text-muted">{alert.type.replaceAll("_", " ")}</span>
                <span className="ml-auto text-xs text-muted">{alert.owner}</span>
              </div>
              <h2 className="mt-2 text-base font-semibold">
                <Link href={`/accounts/${alert.orgId}`} className="hover:underline">
                  {alert.orgName}
                </Link>
                <span className="font-normal text-muted"> · {alert.title}</span>
              </h2>
              <p className="mt-1 text-sm leading-6">{alert.detail}</p>
              <p className="mt-2 text-sm leading-6 text-muted">{alert.suggestedAction}</p>
            </article>
          );
        })}
      </div>
    </>
  );
}
