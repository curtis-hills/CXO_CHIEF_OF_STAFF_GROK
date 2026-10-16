import type { ReactNode } from "react";
import { isPaymentFlagged } from "@/lib/data/filters";
import type { DateSource } from "@/lib/domain";
import type { HealthBand } from "@/lib/metrics/health";
import type { PaceStatus } from "@/lib/metrics/pace";
import { paceStatusLabel } from "@/lib/metrics/pace";
import type { SlaTone } from "@/lib/metrics/stage";

export function PageHeader({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: string }) {
  return (
    <header className="mb-6 max-w-3xl">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-tide">{eyebrow}</p>
      <h1 className="mt-1 font-serif text-[2rem] leading-tight text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted">{lede}</p>
    </header>
  );
}

const chipClass: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-950 ring-emerald-700/15",
  watch: "bg-amber-50 text-amber-950 ring-amber-700/20",
  bad: "bg-red-50 text-red-950 ring-red-700/15",
  info: "bg-sky-50 text-sky-950 ring-sky-800/15",
  neutral: "bg-stone-100 text-stone-700 ring-stone-500/15",
  achieved: "bg-[#e7eef6] text-navy ring-navy/15",
  missed: "bg-rose-50 text-rose-950 ring-rose-800/15",
};

export function Chip({ tone, children }: { tone: keyof typeof chipClass; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${chipClass[tone]}`}>
      {children}
    </span>
  );
}

export function paceTone(status: PaceStatus | "open"): keyof typeof chipClass {
  switch (status) {
    case "on_pace":
      return "good";
    case "watch":
      return "watch";
    case "at_risk":
      return "bad";
    case "achieved":
      return "achieved";
    case "missed":
      return "missed";
    default:
      return "neutral";
  }
}

export function PaceChip({ status }: { status: PaceStatus | "open" }) {
  return <Chip tone={paceTone(status)}>{paceStatusLabel(status)}</Chip>;
}

export function healthTone(band: HealthBand): keyof typeof chipClass {
  switch (band) {
    case "green":
      return "good";
    case "yellow":
      return "watch";
    case "red":
      return "bad";
    case "unscored":
      return "info";
    default:
      return "neutral";
  }
}

export function healthLabel(band: HealthBand): string {
  switch (band) {
    case "green":
      return "Green";
    case "yellow":
      return "Yellow";
    case "red":
      return "Red";
    case "ramping":
      return "Ramping";
    case "prelaunch":
      return "Pre-launch";
    default:
      return "Not scored";
  }
}

export function HealthChip({ band }: { band: HealthBand }) {
  return <Chip tone={healthTone(band)}>{healthLabel(band)}</Chip>;
}

export function slaTone(tone: SlaTone | null): keyof typeof chipClass {
  if (tone === "green") return "good";
  if (tone === "amber") return "watch";
  if (tone === "red") return "bad";
  return "neutral";
}

export function SlaChip({ tone, children }: { tone: SlaTone | null; children: ReactNode }) {
  return <Chip tone={slaTone(tone)}>{children}</Chip>;
}

const sourceCopy: Record<DateSource, { label: string; tone: keyof typeof chipClass }> = {
  api: { label: "API", tone: "neutral" },
  manual: { label: "Manual", tone: "info" },
  proxy: { label: "Proxy", tone: "watch" },
  missing: { label: "Missing", tone: "bad" },
};

export function SourceBadge({ source }: { source: DateSource }) {
  const item = sourceCopy[source];
  return <Chip tone={item.tone}>{item.label}</Chip>;
}

export function PaymentChip({ status }: { status: string }) {
  if (!isPaymentFlagged(status)) return null;
  const label = status.toLowerCase() === "canceled" ? "cancelled" : status.toLowerCase();
  return <Chip tone="bad">Payment {label}</Chip>;
}

export function LaunchDateLabel({ unknown, source }: { unknown: boolean; source: DateSource }) {
  if (!unknown) return <SourceBadge source={source} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-xs font-medium text-amber-950">Launch date unknown</span>
      <SourceBadge source={source} />
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="num mt-1 text-2xl text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-card">
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
