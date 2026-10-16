import { Shell } from "@/components/shell";
import { loadPortfolio } from "@/lib/data/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const portfolio = await loadPortfolio();
  return (
    <Shell
      mode={portfolio.mode}
      notice={portfolio.notice}
      alertCount={portfolio.alerts.length}
      authRequired={Boolean(process.env.DASHBOARD_PASSWORD)}
      asOf={portfolio.asOf}
    >
      {children}
    </Shell>
  );
}
