import { loadPortfolio } from "@/lib/data/load";
import { formatUtcWeekday } from "@/lib/metrics/calendar";
import { SideNav } from "./side-nav";

export async function ConnectionBanner() {
  const portfolio = await loadPortfolio();
  if (portfolio.notice) {
    return (
      <p>
        <span className="font-semibold">Demo data.</span> The live API could not be read, so this is a labeled stand-in.{" "}
        <span className="break-words">{portfolio.notice}</span>
      </p>
    );
  }
  if (portfolio.mode === "mock") {
    return (
      <p>
        <span className="font-semibold">Demo data.</span> API credentials are not set, so this is a labeled stand-in
        portfolio. Lifecycle dates are proxies until engineering ships them.
      </p>
    );
  }
  return (
    <p>
      <span className="font-semibold">Live API.</span> Dates the API does not return yet stay blank unless someone saved a
      manual stand-in.
    </p>
  );
}

export async function AlertNav() {
  const portfolio = await loadPortfolio();
  return <SideNav alertCount={portfolio.alerts.length} />;
}

export async function AsOfLine() {
  const portfolio = await loadPortfolio();
  return <p className="mb-4 text-xs text-muted">{formatUtcWeekday(portfolio.asOf)} · UTC</p>;
}
