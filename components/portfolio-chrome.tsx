import { loadPortfolio } from "@/lib/data/load";
import { formatUtcTimestamp, formatUtcWeekday } from "@/lib/metrics/calendar";
import { SideNav } from "./side-nav";

export async function ConnectionBanner() {
  const portfolio = await loadPortfolio();
  if (portfolio.mode === "mock") {
    return (
      <p>
        <span className="font-semibold">Demo data.</span>{" "}
        <span className="break-words">
          {portfolio.notice ?? "The database is empty, so this is a labeled stand-in."}
        </span>
      </p>
    );
  }
  if (portfolio.notice) {
    return (
      <p>
        <span className="font-semibold">Warning.</span> <span className="break-words">{portfolio.notice}</span>
      </p>
    );
  }
  return (
    <p>
      <span className="font-semibold">Stored copy.</span> Pages read the last sync, not the live SubcontractorHub API.
      Dates the API does not return yet stay blank unless someone saved a manual stand-in.
    </p>
  );
}

export async function AlertNav() {
  const portfolio = await loadPortfolio();
  return <SideNav alertCount={portfolio.alerts.length} />;
}

export async function AsOfLine() {
  const portfolio = await loadPortfolio();
  return (
    <p className="mb-4 text-xs text-muted">
      {formatUtcWeekday(portfolio.asOf)} · UTC
      {portfolio.dataAsOf ? ` · Data as of ${formatUtcTimestamp(portfolio.dataAsOf)}` : ""}
    </p>
  );
}
