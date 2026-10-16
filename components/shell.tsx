import type { ReactNode } from "react";
import { SideNav } from "./side-nav";

export function Shell({
  children,
  banner,
  nav,
  meta,
  authRequired,
}: {
  children: ReactNode;
  banner: ReactNode;
  nav: ReactNode;
  meta: ReactNode;
  authRequired: boolean;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="bg-navy text-paper lg:min-h-screen">
        <div className="px-5 pt-5 pb-2">
          <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/55">SubcontractorHub</p>
          <p className="mt-1 font-serif text-2xl text-white">CXM</p>
        </div>
        {nav}
        <div className="hidden px-5 pt-4 pb-6 text-xs leading-5 text-white/55 lg:block">
          <p>CX Admin sets up.</p>
          <p>CXM launches.</p>
          <p>Amanda Hatch is first contact after launch.</p>
          <p>Craig Kersey escalates.</p>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="border-b border-line bg-[#efe8db] px-5 py-2 text-sm text-ink lg:px-8">
          {banner}
          {authRequired ? null : (
            <p className="text-muted">Sign-in is off until DASHBOARD_PASSWORD is set. Company SSO comes later.</p>
          )}
        </div>
        <div className="px-5 py-6 lg:px-8 lg:py-8">
          {meta}
          {children}
        </div>
      </div>
    </div>
  );
}

export function ShellNavFallback() {
  return <SideNav alertCount={0} />;
}
