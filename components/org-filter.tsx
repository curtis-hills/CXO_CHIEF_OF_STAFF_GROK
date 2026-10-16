import type { Account } from "@/lib/domain";
import {
  countByPerson,
  countByStatus,
  isPaymentFlagged,
  personChoices,
  statusChoices,
  type PortfolioFilter,
} from "@/lib/data/filters";

export function OrgFilterFields({
  filter,
  accounts,
}: {
  filter: PortfolioFilter;
  accounts: Account[];
}) {
  const statuses = statusChoices(accounts);
  const cxms = personChoices(accounts, "cxm");
  const aes = personChoices(accounts, "ae");
  return (
    <>
      <input type="hidden" name="orgSet" value="1" />
      <label className="text-xs text-muted">
        Status
        <select name="org" multiple defaultValue={filter.statuses} size={6} className="field mt-1 block min-w-40">
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        CXM
        <select name="cxm" defaultValue={filter.cxm} className="field mt-1 block">
          <option value="">All</option>
          <option value="unassigned">Unassigned</option>
          {cxms.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        AE
        <select name="ae" defaultValue={filter.ae} className="field mt-1 block">
          <option value="">All</option>
          <option value="unassigned">Unassigned</option>
          {aes.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        Payment flag
        <select name="pay" defaultValue={filter.payment === "all" ? "" : filter.payment} className="field mt-1 block">
          <option value="">All, flag cancelled and suspended</option>
          <option value="flagged">Flagged only</option>
          <option value="clear">Not flagged</option>
        </select>
      </label>
      <label className="flex items-center gap-2 pb-2 text-xs text-muted">
        <input type="checkbox" name="tests" value="1" defaultChecked={filter.includeTests} />
        Include test and demo orgs
      </label>
    </>
  );
}

export function OrgBreakdown({
  accounts,
  highlightStatuses,
  sliceLabel,
  sliceCount,
}: {
  accounts: Account[];
  highlightStatuses: string[];
  sliceLabel: string;
  sliceCount: number;
}) {
  const statuses = countByStatus(accounts, highlightStatuses);
  const cxms = countByPerson(accounts, "cxm");
  const flagged = accounts.filter((account) => isPaymentFlagged(account.paymentStatus)).length;
  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-2">
      <section className="rounded-lg border border-line bg-card px-4 py-3">
        <h2 className="text-sm font-semibold">Orgs by status</h2>
        <p className="mt-1 text-xs text-muted">
          {accounts.length} in this filter · {sliceCount} {sliceLabel}
          {flagged > 0 ? ` · ${flagged} payment ${flagged === 1 ? "flag" : "flags"}` : ""}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
          {statuses.length === 0 ? <li className="text-muted">No orgs in this filter.</li> : null}
          {statuses.map((row) => (
            <li key={row.name} className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs">
              {row.name} <span className="num">{row.count}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-lg border border-line bg-card px-4 py-3">
        <h2 className="text-sm font-semibold">Orgs by CXM</h2>
        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
          {cxms.length === 0 ? <li className="text-xs text-muted">No orgs in this filter.</li> : null}
          {cxms.map((row) => (
            <li key={row.name} className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs">
              {row.name} <span className="num">{row.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function filterNote(mode: "mock" | "live"): string {
  if (mode === "live") {
    return "Live data defaults to Won, Onboarding, Launched, and Retention. A name with the word test or demo, a QA Bot name, and status Demo or Demo Org stay hidden until Include tests is on. Cancelled and suspended payments stay in the list and are flagged.";
  }
  return "This stand-in shows every demo status until you choose some. The same test, demo, and payment rules apply.";
}
