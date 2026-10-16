import Link from "next/link";
import { Chip, PageHeader, SlaChip, SourceBadge } from "@/components/ui";
import { accountTypeLabel, requiredCompletion, type Account } from "@/lib/domain";
import { loadPortfolio } from "@/lib/data/load";
import { one } from "@/lib/format";

export const metadata = { title: "Pre-launch" };

const LANES = [
  { id: "onboarding", title: "Onboarding", goal: "Goal 1 business day", flag: "Flag 3" },
  { id: "ready_to_launch", title: "Ready to Launch", goal: "Goal 3 business days", flag: "Flag 5" },
] as const;

export default async function PrelaunchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const portfolio = await loadPortfolio();
  const type = one(query.type);
  const cxm = one(query.cxm);
  const cxms = uniqueCxms(portfolio.accounts);

  const lanes = LANES.map((lane) => {
    const cards = portfolio.accounts
      .filter((account) => account.stage === lane.id)
      .filter((account) => matchesType(account, type))
      .filter((account) => !cxm || account.cxm?.name === cxm || (cxm === "unassigned" && !account.cxm))
      .sort((a, b) => (b.stageTiming.businessDaysInStage ?? -1) - (a.stageTiming.businessDaysInStage ?? -1));
    return { ...lane, cards };
  });

  return (
    <>
      <PageHeader
        eyebrow="Pre-launch"
        title="Onboarding and Ready to Launch"
        lede="CX Admin does the setup. The CXM verifies it and is the person who later sets Launched. Time in stage is business days. Green is at or under the goal, amber through the flag, red after it. Waiting on the customer is flagged, and the clock still runs."
      />
      <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
        <label className="text-xs text-muted">
          Account type
          <select name="type" defaultValue={type} className="field mt-1 block">
            <option value="">All</option>
            <option value="epc">EPC</option>
            <option value="sales_org">Sales Org</option>
            <option value="seamless_dealer">Seamless Dealer (legacy)</option>
            <option value="seamless_installing_dealer">Seamless Installing Dealer</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          CXM
          <select name="cxm" defaultValue={cxm} className="field mt-1 block">
            <option value="">All</option>
            <option value="unassigned">Unassigned</option>
            {cxms.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
          Filter
        </button>
      </form>
      <div className="grid gap-4 lg:grid-cols-2">
        {lanes.map((lane) => (
          <section key={lane.id}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-serif text-2xl">{lane.title}</h2>
              <p className="text-xs text-muted">
                {lane.goal} · {lane.flag} · {lane.cards.length}
              </p>
            </div>
            <div className="space-y-3">
              {lane.cards.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted">No accounts in this lane.</p>
              ) : null}
              {lane.cards.map((account) => (
                <LaneCard key={account.id} account={account} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function LaneCard({ account }: { account: Account }) {
  const completion = account.checklistTracked ? requiredCompletion(account.checklist) : null;
  const total = account.stageTiming.onboardingToLaunched;
  return (
    <article className="rounded-lg border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/accounts/${account.id}`} className="font-semibold hover:underline">
            {account.name}
          </Link>
          <p className="mt-1 text-xs text-muted">
            {accountTypeLabel(account.accountType, account.legacySeamlessDealer)}
            {account.city ? ` · ${account.city}, ${account.state}` : ""}
          </p>
        </div>
        <SlaChip tone={account.stageTiming.inStageTone}>
          {account.stageTiming.businessDaysInStage ?? "—"} bd
        </SlaChip>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted">CXM</dt>
          <dd>{account.cxm?.name ?? "Unassigned"}</dd>
        </div>
        <div>
          <dt className="text-muted">Checklist</dt>
          <dd>{completion === null ? "Not tracked" : `${Math.round(completion * 100)}% required`}</dd>
        </div>
        <div>
          <dt className="text-muted">Since Onboarding</dt>
          <dd className="flex items-center gap-2">
            <span>{total.businessDays ?? "—"} bd</span>
            <SlaChip tone={total.tone}>{total.tone ?? "—"}</SlaChip>
          </dd>
        </div>
        <div>
          <dt className="text-muted">Onboarding date</dt>
          <dd className="mt-1">
            <SourceBadge source={account.onboardingAt.source} />
          </dd>
        </div>
      </dl>
      {account.waitingOnCustomer ? (
        <p className="mt-3">
          <Chip tone="watch">Waiting on customer{account.waitingReason ? ` · ${account.waitingReason}` : ""}</Chip>
          <span className="ml-2 text-xs text-muted">Clock still running.</span>
        </p>
      ) : null}
    </article>
  );
}

function matchesType(account: Account, type: string): boolean {
  if (!type) return true;
  if (type === "seamless_dealer") return account.legacySeamlessDealer;
  if (type === "sales_org") return account.accountType === "sales_org" && !account.legacySeamlessDealer;
  return account.accountType === type;
}

function uniqueCxms(accounts: Account[]): string[] {
  return [...new Set(accounts.map((account) => account.cxm?.name).filter((name): name is string => Boolean(name)))].sort();
}
