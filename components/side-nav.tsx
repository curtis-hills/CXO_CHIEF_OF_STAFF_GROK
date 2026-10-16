"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Daily brief" },
  { href: "/pre-launch", label: "Pre-launch" },
  { href: "/accounts", label: "Launched cohort" },
  { href: "/health", label: "Post-launch health" },
  { href: "/actions", label: "Action queue" },
  { href: "/agents", label: "Agents" },
  { href: "/engineering", label: "Engineering" },
  { href: "/sync", label: "Sync" },
];

export function SideNav({ alertCount }: { alertCount: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 py-3 lg:flex-col lg:px-3 lg:py-4">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm whitespace-nowrap ${
              active ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span>{link.label}</span>
            {link.href === "/actions" && alertCount > 0 ? (
              <span className="num ml-3 rounded-full bg-white/15 px-1.5 text-xs">{alertCount}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
