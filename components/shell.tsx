import type { ReactNode } from "react";
import { formatUtcWeekday } from "@/lib/metrics/calendar";
import { SideNav } from "./side-nav";

export function Shell({
  children,
  mode,
  notice,
  alertCount,
  authRequired,
  asOf,
}: {
  children: ReactNode;
  mode: "mock" | "live";
  notice: string | null;
  alertCount: number;
  authRequired: boolean;
  asOf: string;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="bg-navy text-paper lg:min-h-screen">
        <div className="px-5 pt-5 pb-2">
          <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/55">SubcontractorHub</p>
          <p className="mt-1 font-serif text-2xl text-white">CXM</p>
        </div>
        <SideNav alertCount={alertCount} />
        <div className="hidden px-5 pt-4 pb-6 text-xs leading-5 text-white/55 lg:block">
          <p>CX Admin sets up.</p>
          <p>CXM launches.</p>
          <p>Amanda Hatch is first contact after launch.</p>
          <p>Craig Kersey escalates.</p>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="border-b border-line bg-[#efe8db] px-5 py-2 text-sm text-ink lg:px-8">
          {notice ? (
            <p>
              <span className="font-semibold">Demo data.</span> The live API could not be read, so this is a labeled stand-in.{" "}
              <span className="break-words">{notice}</span>
            </p>
          ) : mode === "mock" ? (
            <p>
              <span className="font-semibold">Demo data.</span> API credentials are not set, so this is a labeled stand-in
              portfolio. Lifecycle dates are proxies until engineering ships them.
            </p>
          ) : (
            <p>
              <span className="font-semibold">Live API.</span> Dates the API does not return yet stay blank unless someone
              saved a manual stand-in.
            </p>
          )}
          {authRequired ? null : (
            <p className="text-muted">Sign-in is off until DASHBOARD_PASSWORD is set. Company SSO comes later.</p>
          )}
        </div>
        <div className="px-5 py-6 lg:px-8 lg:py-8">
          <p className="mb-4 text-xs text-muted">{formatUtcWeekday(asOf)} · UTC</p>
          {children}
        </div>
      </div>
    </div>
  );
}
