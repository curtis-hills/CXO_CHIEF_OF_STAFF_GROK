import Link from "next/link";
import { notFound } from "next/navigation";
import { PaceChart } from "@/components/charts";
import { Chip, HealthChip, PaceChip, SlaChip, SourceBadge } from "@/components/ui";
import { saveLifecycleOverride } from "./actions";
import { TRANSACTION_FEE_USD, accountTypeLabel, requiredCompletion, type Account, type ChecklistItem, type ResolvedDate } from "@/lib/domain";
import { loadPortfolio } from "@/lib/data/load";
import { dayInputValue, formatDate, formatNumber, formatUsd, one } from "@/lib/format";
import type { StageSpan } from "@/lib/metrics/stage";

export async function generateMetadata({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const portfolio = await loadPortfolio();
  const account = portfolio.accounts.find((item) => item.id === orgId);
  return { title: account?.name ?? "Account" };
}

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const query = await searchParams;
  const portfolio = await loadPortfolio();
  const account = portfolio.accounts.find((item) => item.id === orgId);
  if (!account) notFound();
  const saved = one(query.saved) === "1";
  const liveProjects = account.projects.filter((project) => project.live);

  return (
    <>
      <Link href={account.stage === "launched" ? "/accounts" : "/pre-launch"} className="text-sm text-tide">
        {account.stage === "launched" ? "Launched cohort" : "Pre-launch board"}
      </Link>
      <header className="mt-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="neutral">{accountTypeLabel(account.accountType, account.legacySeamlessDealer)}</Chip>
          <Chip tone="neutral">{account.status}{account.subStatus ? ` / ${account.subStatus}` : ""}</Chip>
          <Chip tone={account.paymentStatus === "paid" ? "good" : "bad"}>{account.paymentStatus}</Chip>
          <SourceBadge source={account.accountTypeSource} />
        </div>
        <h1 className="mt-3 font-serif text-[2rem] leading-tight">{account.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {account.city || account.state || account.postalCode
            ? [ [account.city, account.state].filter(Boolean).join(", "), account.postalCode ].filter(Boolean).join(" ")
            : "No address"}
          {account.email ? ` · ${account.email}` : ""}
          {account.products.length ? ` · ${account.products.join(", ")}` : ""}
        </p>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">{account.accountTypeNote}</p>
      </header>

      {account.waitingOnCustomer ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          Waiting on the customer{account.waitingReason ? ` · ${account.waitingReason}` : ""}. The business-day clock keeps running.
          <span className="ml-2"><SourceBadge source={account.waitingSource} /></span>
        </p>
      ) : null}
      {saved ? <p className="mb-4 text-sm text-tide">Manual stand-in saved on this server.</p> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Clock
          label="CXM clock"
          value={account.stageTiming.cxmCalendarDay === null ? "—" : `Day ${account.stageTiming.cxmCalendarDay}`}
          hint="Day 0 is Onboarding. Stage targets are business days."
          date={account.onboardingAt}
        />
        <Clock
          label="KPI clock"
          value={account.pace ? `Day ${account.pace.day} of 60` : account.stage === "launched" ? "No day 0" : "Starts at Launched"}
          hint={account.pace ? `${account.pace.actual} live · ${formatNumber(account.pace.expected, 1)} expected` : "Billing and live projects start here."}
          date={account.launchedAt}
        />
        <div className="rounded-lg border border-line bg-card px-4 py-3">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">Pace</p>
          <div className="mt-2">{account.pace ? <PaceChip status={account.pace.status} /> : <span className="text-sm text-muted">Not started</span>}</div>
          <p className="mt-2 text-xs text-muted">
            {account.pace ? `Projected ${formatNumber(account.pace.projected, 1)} / ${account.pace.windowTarget}` : "Needs a Launched date"}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-card px-4 py-3">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">Health</p>
          <div className="mt-2 flex items-center gap-2">
            <HealthChip band={account.health.band} />
            <span className="num text-lg">{account.health.score === null ? "—" : formatNumber(account.health.score, 0)}</span>
          </div>
          <p className="mt-2 text-xs text-muted">{account.health.basis === "unscored" ? "Not scored" : `Basis: ${account.health.basis}`}</p>
        </div>
      </div>

      <section className="mt-6 rounded-lg border border-line bg-card p-4">
        <h2 className="text-sm font-semibold">Lifecycle</h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          <TimelineStep title="Onboarding" date={account.onboardingAt} active={account.stage === "onboarding"} note="CXM day 0. AE has handed off." />
          <TimelineStep title="Ready to Launch" date={account.readyToLaunchAt} active={account.stage === "ready_to_launch"} note="CX Admin setup verified by the CXM." />
          <TimelineStep title="Launched" date={account.launchedAt} active={account.stage === "launched"} note="KPI day 0. Billing starts. $35 per project." />
        </ol>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Span label="Onboarding → Ready to Launch" span={account.stageTiming.onboardingToRtl} />
          <Span label="Ready to Launch → Launched" span={account.stageTiming.rtlToLaunched} />
          <Span label="Onboarding → Launched" span={account.stageTiming.onboardingToLaunched} />
        </div>
        {account.stage !== "launched" && account.stageTiming.inStageTone ? (
          <p className="mt-3 text-sm">
            In this stage: <SlaChip tone={account.stageTiming.inStageTone}>{account.stageTiming.businessDaysInStage} business days</SlaChip>
            <span className="ml-2 text-xs text-muted">
              Goal {account.stageTiming.inStageGoal} / flag {account.stageTiming.inStageFlag}
            </span>
          </p>
        ) : null}
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-line bg-card p-4">
          <h2 className="text-sm font-semibold">Pace curve</h2>
          {account.pace && account.launchedAt.iso ? (
            <>
              <div className="mt-3">
                <PaceChart pace={account.pace} launchedAt={account.launchedAt.iso} createdAts={liveProjects.map((project) => project.createdAt)} />
              </div>
              <p className="mt-2 text-xs leading-5 text-muted">
                Gray is expected. Green is live projects. {account.pace.excludedPreLaunch} pre-launch and {account.pace.excludedTestOrDeleted} test or deleted projects are left out.
                {account.projects.some((project) => project.testFlagSource === "stand-in" && project.isTest)
                  ? " The test flag is a stand-in until P0-3."
                  : ""}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">The curve starts once this account is Launched and has a day 0.</p>
          )}
        </section>
        <section className="rounded-lg border border-line bg-card p-4">
          <h2 className="text-sm font-semibold">Health drivers</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6">
            {account.health.drivers.map((driver) => (
              <li key={driver}>{driver}</li>
            ))}
          </ul>
          {account.paymentAgeSource === "proxy" ? (
            <p className="mt-3 text-xs text-muted">Payment age is a proxy. The API has no billing history yet (P2-4).</p>
          ) : null}
        </section>
      </div>

      <section className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-line bg-card p-4 text-sm leading-6">
          <h2 className="font-semibold">People</h2>
          <p className="mt-2"><span className="text-muted">CXM. </span>{account.cxm ? `${account.cxm.name}` : "Unassigned — Craig Kersey assigns one."}</p>
          <p><span className="text-muted">AE. </span>{account.ae?.name ?? "—"}</p>
          <p><span className="text-muted">Setup. </span>CX Admin, later the CXM Admin agent.</p>
          <p><span className="text-muted">Launch. </span>The CXM runs training and sets Launched.</p>
          <p><span className="text-muted">After launch. </span>Amanda Hatch’s chat support is first contact. Escalate to Craig Kersey.</p>
          <p className="mt-3 text-muted">
            {account.subscriptions.map((plan) => `${plan.planName} ${formatUsd(plan.unitPrice)}/${plan.interval}`).join(" · ") || "No subscription on file"}
            {" · "}
            {account.activeUserCount} active users
          </p>
          <p className="text-muted">Transaction fee {formatUsd(TRANSACTION_FEE_USD)} per live project. Seats are not revenue.</p>
        </div>
        <Checklist account={account} />
      </section>

      <section className="mt-6 overflow-x-auto rounded-lg border border-line bg-card">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Projects</h2>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Created</th>
              <th>Job</th>
              <th>Size</th>
              <th>Gross</th>
              <th>Counts</th>
            </tr>
          </thead>
          <tbody>
            {account.projects.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-sm text-muted">No projects returned for this account.</td>
              </tr>
            ) : null}
            {account.projects.map((project) => (
              <tr key={project.id}>
                <td className="num">{formatDate(project.createdAt)}</td>
                <td>{project.jobType ?? "—"}</td>
                <td className="num">{project.systemSize ?? "—"}</td>
                <td className="num">{project.grossAmount === null ? "—" : formatUsd(project.grossAmount)}</td>
                <td className="text-xs">
                  {project.live ? "Live" : project.isTest ? "Test, excluded" : project.deleted ? "Deleted, excluded" : "Before launch, excluded"}
                  {project.isTest && project.testFlagSource === "stand-in" ? " · flag is a stand-in" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <OverrideForm account={account} />
    </>
  );
}

function Clock({ label, value, hint, date }: { label: string; value: string; hint: string; date: ResolvedDate }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="num mt-1 text-2xl">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      <p className="mt-2 flex items-center gap-2 text-xs">
        <span>{formatDate(date.iso)}</span>
        <SourceBadge source={date.source} />
      </p>
    </div>
  );
}

function TimelineStep({ title, date, active, note }: { title: string; date: ResolvedDate; active: boolean; note: string }) {
  return (
    <li className={`rounded-md border px-3 py-3 ${active ? "border-tide bg-[#f3f8f7]" : "border-line"}`}>
      <p className="text-xs uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-1 font-medium">{formatDate(date.iso)}</p>
      <p className="mt-2"><SourceBadge source={date.source} /></p>
      <p className="mt-2 text-xs leading-5 text-muted">{date.note || note}</p>
    </li>
  );
}

function Span({ label, span }: { label: string; span: StageSpan }) {
  return (
    <div className="rounded-md bg-paper px-3 py-2 text-sm">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 flex items-center gap-2">
        <span className="num">{span.businessDays === null ? "—" : `${span.businessDays} bd`}</span>
        <SlaChip tone={span.tone}>{span.complete ? "Done" : span.tone ?? "Open"}</SlaChip>
      </p>
      <p className="text-xs text-muted">Goal {span.goal} / flag {span.flag}</p>
    </div>
  );
}

function Checklist({ account }: { account: Account }) {
  const sections = [
    { id: "entry" as const, title: "Entry · AE" },
    { id: "setup" as const, title: "Setup · CX Admin" },
    { id: "launch" as const, title: "Launch · CXM" },
  ];
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Checklist</h2>
        <span className="text-xs text-muted">
          {account.checklistTracked
            ? `${Math.round((requiredCompletion(account.checklist) ?? 0) * 100)}% of required items`
            : "Not tracked"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">
        {account.checklistTracked
          ? "Checks are a labeled stand-in for this demo. The API does not return setup progress (P1-1)."
          : "No checklist progress is stored for live accounts yet. The template is shown so the work is visible, and nothing is marked done."}
      </p>
      <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
        {sections.map((section) => (
          <div key={section.id}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{section.title}</p>
            <ul className="mt-1">
              {account.checklist
                .filter((item) => item.section === section.id)
                .map((item) => (
                  <CheckRow key={item.id} item={item} tracked={account.checklistTracked} />
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function CheckRow({ item, tracked }: { item: ChecklistItem; tracked: boolean }) {
  return (
    <li className="flex gap-2 py-1 text-sm">
      <span className={`mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded-sm border ${tracked && item.done ? "border-tide bg-tide" : "border-line bg-white"}`} aria-hidden="true" />
      <span>
        <span className={tracked && item.done ? "text-ink" : "text-muted"}>{item.label}</span>
        <span className="ml-2 text-xs text-muted">{item.owner}</span>
      </span>
    </li>
  );
}

function OverrideForm({ account }: { account: Account }) {
  return (
    <form action={saveLifecycleOverride} className="mt-6 rounded-lg border border-line bg-card p-4">
      <h2 className="text-sm font-semibold">Manual date stand-in</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        Use this when the API has no Onboarding, Ready to Launch, or Launched timestamp. The value is stored for this deployment only, flagged Manual, and gives way to the API when that field arrives. Leave a date blank to drop a manual value and fall back to the proxy. This is the stand-in for the Postgres <span className="font-medium">org start dates</span> table.
      </p>
      <input type="hidden" name="orgId" value={account.id} />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <DateField label="Onboarding" name="onboardingAt" date={account.onboardingAt} />
        <DateField label="Ready to Launch" name="readyToLaunchAt" date={account.readyToLaunchAt} />
        <DateField label="Launched" name="launchedAt" date={account.launchedAt} />
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="waitingOnCustomer" defaultChecked={account.waitingOnCustomer} />
          Waiting on customer
        </label>
        <label className="text-xs text-muted">
          Reason
          <select name="waitingReason" defaultValue={account.waitingReason ?? ""} className="field mt-1 block">
            <option value="">None</option>
            <option value="intake">Intake</option>
            <option value="credentials">Credentials</option>
            <option value="coi">COI</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="clear" />
          Clear manual overrides
        </label>
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
          Save stand-in
        </button>
      </div>
    </form>
  );
}

function DateField({ label, name, date }: { label: string; name: string; date: ResolvedDate }) {
  return (
    <label className="text-xs text-muted">
      {label}
      <input
        type="date"
        name={name}
        defaultValue={date.source === "manual" ? dayInputValue(date.iso) : ""}
        className="field mt-1 block w-full"
      />
      <span className="mt-1 block">Current {formatDate(date.iso)}</span>
    </label>
  );
}
