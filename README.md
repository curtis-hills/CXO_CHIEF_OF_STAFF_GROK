# SubcontractorHub CXM dashboard

Phase 1 of the customer-experience dashboard. It is a Next.js app (App Router, TypeScript, Tailwind) meant to deploy on Vercel.

A transaction is a new project created. That is the signed customer, billed at $35. The CXM clock starts at Onboarding. The KPI clock starts at Launched, which is also when billing and live projects start. The target is 10 projects in 30 calendar days and 25 in 60.

## Pages

| Route | What it shows |
|---|---|
| `/` | Daily brief |
| `/pre-launch` | Onboarding and Ready to Launch lanes, with time in stage |
| `/accounts` | Launched cohort, pace against the 10/30 and 25/60 curve |
| `/accounts/[orgId]` | Timeline, both clocks, checklist, health, manual date stand-in |
| `/health` | v1 health score from volume trend and billing |
| `/actions` | Alerts derived from those signals |
| `/agents` | One card per planned agent. None of them run yet |
| `/engineering` | Draft engineering request list, including the `updated_since` ask |
| `/sync` | Sync history and a backfill button. Behind the dashboard password |
| `/login` | Password placeholder until company SSO |

Setup is CX Admin’s work (later, the CXM Admin agent). The CXM runs kickoff and training and sets Launched. Amanda Hatch’s chat support is first contact after launch. Craig Kersey, Director of CX, is the escalation.

## Local setup

```bash
npm install
cp .env.example .env.local
npm test
npm run dev
```

Open http://localhost:3000. With no `DATABASE_URL`, every page renders labeled demo data.

## Environment variables

Set these in `.env.local` and in the Vercel project. Do not prefix them with `NEXT_PUBLIC_`. Do not commit a real key or password.

| Variable | Required | Purpose |
|---|---|---|
| `SUBHUB_API_BASE_URL` | No | Defaults to `https://app.subcontractorhub.com`. The connected production host is `https://api.virtualsaleportal.com`. |
| `SUBHUB_AUTH_MODE` | No | `auto` (default), `bearer`, `basic`, `basic+key`, or `login`. |
| `SUBHUB_API_KEY` | No | Bearer token, or the key sent beside Basic auth. |
| `SUBHUB_API_USERNAME` | No | Service-user username for Basic auth or Sanctum login. |
| `SUBHUB_API_PASSWORD` | No | Service-user password. |
| `SUBHUB_API_KEY_HEADER` | No | Header for the key in `basic+key`. Defaults to `X-API-Key`. |
| `SUBHUB_LOGIN_PATH` | No | Sanctum path tried first. Blank tries `/api/auth/login`, then `/api/login`, then `/api/v1/login`. |
| `SUBHUB_LOGIN_USERNAME_FIELD` | No | JSON field for the username. Defaults to `email`. |
| `SUBHUB_LOGIN_PASSWORD_FIELD` | No | JSON field for the password. Defaults to `password`. |
| `SUBHUB_LOGIN_KEY_FIELD` | No | Optional JSON field for a key. Blank omits it. |
| `SUBHUB_LOGIN_DEVICE_NAME` | No | Optional Sanctum `device_name`. Blank omits it. |
| `DASHBOARD_PASSWORD` | No | Turns on the placeholder password gate. When it is empty, the app is open and says so. `/sync` is behind this gate. |
| `DATABASE_URL` | For a stored copy | Neon pooled URL. `POSTGRES_URL` is accepted as the same value. The Vercel Neon integration sets both. |
| `CRON_SECRET` | For scheduled sync | Vercel sends `Authorization: Bearer <CRON_SECRET>` to the cron routes. |

`auto` uses Laravel Sanctum when `SUBHUB_API_USERNAME` and `SUBHUB_API_PASSWORD` are set. HTTP Basic is not used in auto mode: the API answers it with the HTML login page. A key alone still uses `Authorization: Bearer`. Set `SUBHUB_AUTH_MODE` to `basic` or `basic+key` only to force Basic.

The sync job is the only caller of SubcontractorHub. Login POSTs `{email, password}` (the username field defaults to `email`) and sends `Accept: application/json`. It tries `SUBHUB_LOGIN_PATH` first when that is set, then `/api/auth/login`, `/api/login`, and `/api/v1/login`, and stops at the first JSON body that contains a token (`token`, `access_token`, `data.token`, and the same names one level down). A 401 or 403 stops the search. HTML and 404 responses are recorded and the next path is tried. The token is cached until its `expiry`. `persistent: true` without an expiry lasts 12 hours. A missing expiry lasts one hour. A 401 refreshes it once. A 429 does not log in again. The token is never written to `/api/health`, `/sync`, or the page.

`GET /api/health` reports the stored copy: `unconfigured`, `empty`, `backfilling`, `ready`, or `error`, plus `orgs`, `dataAsOf`, `endpoints`, and the latest `sync_runs` row. `ready` means every cursor is complete. While any list is still open the status is `backfilling` and `endpoints` shows that list. It does not call SubcontractorHub and it never includes a token or a database URL.

Org and project lists use the superadmin wrapper `results.data`, with `results.next_cursor` sent back as `?cursor=`. Each sync request uses page size 50. A 429 waits for `Retry-After` or `X-RateLimit-Reset`, otherwise exponential backoff with jitter, and retries at most four more times. Between pages the job waits at least 1.1 seconds so it stays under the observed 60 requests per minute. Projects are read in one platform-wide list when each row includes an org id. Otherwise each org is requested one at a time, never in parallel. One invocation stores a few pages and resumes from `sync_cursors`. If projects fail and orgs succeeded, the real orgs stay up and projects are marked unavailable. With no database, or an empty one, every page stays on labeled demo data. Flat org fields (`street`, `city`, `state`, `postal_code`, `country`) and plan names are mapped. `Sales and Referrals Monthly` is the $500 monthly plan. `Solar Per Contract Sign` is the $35 per-contract plan.

Credentials are read only in server modules (`lib/api/client.ts` imports `server-only`). They are not sent to the browser. Errors include the status code, content type, body kind, top-level keys, and a short sanitized snippet. Secrets and email addresses are redacted.

## Demo data and missing fields

The Executive API does not yet return `onboarding_at`, `ready_to_launch_at`, or `launched_at` (request P0-1). In demo mode those dates are **proxy** stand-ins, badged on the page. `account_type` and failed-payment age are badged the same way.

On an account page you can save a **manual** date. It is stored in `.data/overrides.json` (or `/tmp/cxm-overrides.json` if the project directory is not writable). A manual value is used only while the API field is empty. Clearing the override falls back to the proxy. On Vercel this file is ephemeral. Daily account history (stage, project counts, health, pace) is written to `account_snapshots`.

Checklist checks in the demo are also stand-ins. Live mode shows the template with nothing marked done.

## Metric rules

Stage targets are business days (weekdays, no holiday calendar). The clock does not pause while waiting on the customer. That wait is flagged.

| Span | Goal | Flag |
|---|---|---|
| Onboarding → Ready to Launch | 1 | 3 |
| Ready to Launch → Launched | 3 | 5 |
| Onboarding → Launched | 5 | 7 |

Green is at or under the goal. Amber is through the flag. Red is past the flag.

Expected projects on KPI day `d`:

- `10 * d / 30` through day 30
- `10 + 15 * (d - 30) / 30` from day 31 through day 60

Pace ratio is actual / expected, starting day 7. On pace is at least 1.0. Watch is at least 0.7. At risk is under 0.7, or no live project in the last 7 days, or the daily rate required to hit the window is more than twice the expected daily rate. Before day 7 the status is Ramping, unless the account has already reached the target. A closed window is Achieved or Missed. The 30-day result is kept after day 30.

Pre-launch projects, test projects, and deleted projects are excluded. The test flag does not exist on the API yet (P0-3), so demo test rows are labeled as stand-ins. Without that flag, live data can only exclude projects dated before Launched.

Health v1 scores volume (75) and billing (25). Through day 60, volume follows pace. After day 60 it compares the last 30 days with the trailing 90-day monthly average: 100% or more is full credit, 60–99% is half, under 60% is none. Green is 70+, yellow is 45–69, red is under 45. A failed payment open 7 days or more, or a cancellation, forces red.

## Tests

```bash
npm test
```

Unit tests cover the pace curve, status bands, the quiet-account rule, window close, pre-launch and test exclusion, business-day stage flags (including a customer wait that does not pause the clock), the health score, API auth, Sanctum login paths (with `/api/auth/login` first), token expiry, `results.data` row counts and `next_cursor`, cursor pagination, plan and address mapping, sanitized API errors, the demo fallback when the database is empty, and the sync upsert and high-water rules.

## Stored copy on Neon

Pages and the agents hub read Postgres. A backfill pulls every superadmin list. A daily cron pulls what changed. Nothing in a page render calls SubcontractorHub.

The deployed app applies `db/migrations/0001_sync.sql` itself. You do not run `npm run db:migrate` on a laptop. The statements are idempotent (`CREATE TABLE IF NOT EXISTS`). The setup and the first sync each take a Postgres transaction advisory lock (`pg_advisory_xact_lock`) so two callers cannot create the tables at the same time. A finished run records `0001_sync` in `schema_migrations`.

`SUBHUB_API_BASE_URL` is `https://api.virtualsaleportal.com`. `SUBHUB_API_USERNAME` and `SUBHUB_API_PASSWORD` are the Executive Leadership Read Only user. Leave `SUBHUB_AUTH_MODE` as `auto`. Set `DASHBOARD_PASSWORD` so `/sync` is not public.

1. Connect Neon from the Vercel project’s **Storage** tab. That sets `DATABASE_URL`. Do not paste the URL into chat or commit it.
2. Add `CRON_SECRET` (a long random string). Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>`.
3. Redeploy.
4. Open `/sync`. The status line shows whether the database is connected, whether migrations have been applied, and whether `CRON_SECRET` is set. Those are booleans. The page never shows the secret.
5. Click **Set up database**.
6. Click **Run backfill now**. It stores a few pages of the next list that is not Complete. A finished organizations cursor is left alone. The click also asks the cron route to keep going. The hourly job does the same until every cursor is Complete.

The crons in `vercel.json` are registered on production: `/api/cron/sync` at 09:00 UTC (2:00 AM Pacific during daylight time, 1:00 AM during standard time) and `/api/cron/orgs` hourly. Each invocation that still has work schedules the next hop and waits for that request to be sent. The hop sends `Authorization: Bearer <CRON_SECRET>` and, when it is set, `x-vercel-protection-bypass`. Open `/` after the backfill. The banner says **Stored copy** and the line under it says **Data as of** the last successful sync. `/api/health` returns `status: "ready"` only when every cursor is Complete. Until then it returns `backfilling` and the per-endpoint progress. It does not include the token.

The daily job uses `updated_since` when the API accepts it. It does not today. See engineering request P0-5a. Until Ashish adds that filter, the job probes `updated_since`, `updated_after`, `from`, and `updated_at_from`, then `sort=-updated_at` and `sort=-created_at`. A 422 is recorded on the cursor and on that `sync_runs` row, and that param is not sent again. A 404 or 429 is recorded the same way, with the status and a short body snippet. If none of those work, the daily pass waits and Sunday runs a full reconcile. Upserts are by id. A failed refresh leaves the last rows in place.

## Later

Agent cards stay placeholders until a human approval step exists. Checklist rows and lifecycle dates still depend on the engineering requests.
