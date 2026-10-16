"use client";

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tide">CXM</p>
      <h1 className="mt-2 font-serif text-3xl">The dashboard couldn’t load</h1>
      <p className="mt-3 text-sm leading-6 text-muted">{error.message}</p>
      <button type="button" onClick={reset} className="mt-6 rounded-md bg-navy px-3 py-2 text-sm text-white">
        Try again
      </button>
    </main>
  );
}
