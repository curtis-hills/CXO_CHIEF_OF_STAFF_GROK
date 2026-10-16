export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="max-w-xl">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-tide">CXM</p>
      <h1 className="mt-1 font-serif text-[2rem] leading-tight">Loading the portfolio…</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Accounts and projects are loading. The rest of the page stays up.</p>
    </div>
  );
}
