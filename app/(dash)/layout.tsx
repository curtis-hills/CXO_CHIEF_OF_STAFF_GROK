import { Suspense } from "react";
import { AlertNav, AsOfLine, ConnectionBanner } from "@/components/portfolio-chrome";
import { Shell, ShellNavFallback } from "@/components/shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell
      authRequired={Boolean(process.env.DASHBOARD_PASSWORD)}
      nav={
        <Suspense fallback={<ShellNavFallback />}>
          <AlertNav />
        </Suspense>
      }
      banner={
        <Suspense fallback={<p>Loading the portfolio…</p>}>
          <ConnectionBanner />
        </Suspense>
      }
      meta={
        <Suspense fallback={null}>
          <AsOfLine />
        </Suspense>
      }
    >
      {children}
    </Shell>
  );
}
