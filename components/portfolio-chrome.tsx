import { connectionMessage } from "@/lib/data/connection-message";
import { alertsForAccounts, applyPortfolioFilter, readPortfolioFilter } from "@/lib/data/filters";
import { loadPortfolio } from "@/lib/data/load";
import { formatUtcTimestamp, formatUtcWeekday } from "@/lib/metrics/calendar";
import { SideNav } from "./side-nav";

export async function ConnectionBanner() {
  const portfolio = await loadPortfolio();
  const message = connectionMessage(portfolio);
  return (
    <p>
      <span className="font-semibold">{message.title}</span> <span className="break-words">{message.body}</span>
    </p>
  );
}

export async function AlertNav() {
  const portfolio = await loadPortfolio();
  const accounts = applyPortfolioFilter(portfolio.accounts, readPortfolioFilter({}, portfolio.mode));
  return <SideNav alertCount={alertsForAccounts(portfolio.alerts, accounts).length} />;
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
