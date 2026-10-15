export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const query = await searchParams;
  const configured = Boolean(process.env.DASHBOARD_PASSWORD);
  const next = query.next && query.next.startsWith("/") ? query.next : "/";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-tide">SubcontractorHub</p>
      <h1 className="mt-2 font-serif text-4xl">CXM</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        Placeholder sign-in until Google SSO. The API key never passes through this form.
      </p>
      {configured ? (
        <form method="post" action="/api/auth" className="mt-6 space-y-3 rounded-lg border border-line bg-card p-5">
          <input type="hidden" name="intent" value="login" />
          <input type="hidden" name="next" value={next} />
          <label className="block text-sm" htmlFor="password">
            Password
            <input id="password" name="password" type="password" required className="field mt-1 w-full" autoComplete="current-password" />
          </label>
          {query.error ? <p className="text-sm text-red-800">That password didn’t match.</p> : null}
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
            Continue
          </button>
        </form>
      ) : (
        <div className="mt-6 rounded-lg border border-line bg-card p-5 text-sm leading-6">
          <p>DASHBOARD_PASSWORD is not set, so the dashboard is open on this deployment.</p>
          <a href="/" className="mt-3 inline-block text-tide">
            Open the daily brief
          </a>
        </div>
      )}
    </main>
  );
}
