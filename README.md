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
| `/engineering` | Draft engineering request list |
| `/login` | Password placeholder until company SSO |

Setup is CX Admin’s work (later, the CXM Admin agent). The CXM runs kickoff and training and sets Launched. Amanda Hatch’s chat support is first contact after launch. Craig Kersey, Director of CX, is the escalation.

## Local setup

```bash
npm install
cp .env.example .env.local
npm test
npm run dev
```

Open http://localhost:3000. With no API credentials, every page renders labeled demo data.

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
| `DASHBOARD_PASSWORD` | No | Turns on the placeholder password gate. When it is empty, the app is open and says so. |

`auto` uses Laravel Sanctum when `SUBHUB_API_USERNAME` and `SUBHUB_API_PASSWORD` are set. HTTP Basic is not used in auto mode: the API answers it with the HTML login page. A key alone still uses `Authorization: Bearer`. Set `SUBHUB_AUTH_MODE` to `basic` or `basic+key` only to force Basic.

Login POSTs `{email, password}` (the username field defaults to `email`) and sends `Accept: application/json`. It tries `SUBHUB_LOGIN_PATH` first when that is set, then `/api/auth/login`, `/api/login`, and `/api/v1/login`, and stops at the first JSON body that contains a token (`token`, `access_token`, `data.token`, and the same names one level down). A 401 or 403 stops the search. HTML and 404 responses are recorded and the next path is tried. The token is cached in memory until the `expiry` on the login JSON (`expiry` may be a timestamp, unix seconds, seconds from now, or a date). `persistent: true` without an expiry lasts 12 hours. A missing expiry lasts one hour. Later requests reuse that token, including a page render and `/api/health` in the same process. A 401 refreshes it once. A 429 does not log in again. The token is never written to `/api/health` or the page.

`GET /api/health` reports `demo`, `connected`, `auth failed`, or `unexpected body`, plus the auth mode. Login attempts are listed with path, upstream status, content type, and top-level keys. The token and the password are never included. When the orgs call answers, the JSON also includes `upstreamStatus`, `contentType`, `bodyKind`, `topLevelKeys`, `recordCount`, `hasNextCursor`, and a short `detail`. `recordCount` is the number of rows in `results.data` on that page (page size 50), not the `results` object. `hasNextCursor` is true when `next_cursor` is a non-empty string. The cursor value is not included. When the API sends `Retry-After` or `X-RateLimit-*`, those values are included as `rateLimit` (no token). A 429 snapshot is kept when a later response in the same process also sends rate-limit headers. HTTP 200 is demo, connected, or an unexpected body you can paste back. HTTP 401 means login did not yield a usable token. HTTP 503 means the API could not be reached or kept returning 429 after retries.

Org and project lists use the superadmin wrapper `results.data`, with `results.next_cursor` sent back as `?cursor=`. Each request uses page size 50, follows `next_cursor` until it runs out, and stops after 40 pages (2,000 rows). Each request times out after 15 seconds. A 429 waits for `Retry-After` or `X-RateLimit-Reset`, otherwise exponential backoff with jitter, and retries at most four more times. Projects are read in one platform-wide list when each row includes an org id. Otherwise each org is requested one at a time, never in parallel. The crawl is cached for 30 minutes. Concurrent page renders share one in-flight crawl. If a refresh fails, the last snapshot stays on screen with a warning and a “Data as of” time. If projects fail and orgs succeed, the real orgs stay up and projects are marked unavailable. Manual date overrides are applied after that cache, so a saved date shows up immediately. The shell renders before the crawl finishes and the page shows “Loading the portfolio…”. Flat org fields (`street`, `city`, `state`, `postal_code`, `country`) and plan names are mapped. `Sales and Referrals Monthly` is the $500 monthly plan. `Solar Per Contract Sign` is the $35 per-contract plan. Other list shapes still parse. If the org list itself cannot be read and there is no snapshot yet, every page stays up on labeled demo data and the banner quotes the sanitized error.

Credentials are read only in server modules (`lib/api/client.ts` imports `server-only`). They are not sent to the browser. Errors include the status code, content type, body kind, top-level keys, and a short sanitized snippet. Secrets and email addresses are redacted.

## Demo data and missing fields

The Executive API does not yet return `onboarding_at`, `ready_to_launch_at`, or `launched_at` (request P0-1). In demo mode those dates are **proxy** stand-ins, badged on the page. `account_type` and failed-payment age are badged the same way.

On an account page you can save a **manual** date. It is stored in `.data/overrides.json` (or `/tmp/cxm-overrides.json` if the project directory is not writable). A manual value is used only while the API field is empty. Clearing the override falls back to the proxy. On Vercel this file is ephemeral. The Postgres shapes for a later snapshot phase are in `lib/data/schema.ts`. Phase 1 does not need a database.

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

Unit tests cover the pace curve, status bands, the quiet-account rule, window close, pre-launch and test exclusion, business-day stage flags (including a customer wait that does not pause the clock), the health score, API auth, Sanctum login paths (with `/api/auth/login` first), token expiry, `results.data` row counts and `next_cursor`, cursor pagination, the portfolio cache, plan and address mapping, sanitized API errors, and the demo fallback when the API body cannot be used.

## Deploy on Vercel

1. Import this repository. Framework preset is Next.js. Do not set a custom build command.
2. In Project Settings → Environment Variables, set `SUBHUB_API_BASE_URL` to `https://api.virtualsaleportal.com` for production. The code default remains `https://app.subcontractorhub.com`.
3. For a live environment, set `SUBHUB_API_USERNAME` to the Executive Leadership Read Only user's email and set `SUBHUB_API_PASSWORD`. Leave `SUBHUB_AUTH_MODE` as `auto`. Leave both unset on Preview if that deployment should stay on demo data. Put secrets in the Vercel UI. Do not paste them into chat or commit them.
4. Leave `SUBHUB_LOGIN_PATH` blank. The first path tried is `/api/auth/login`. Set the variable only to force a different path, and read `loginAttempts` from `/api/health`.
5. Set `DASHBOARD_PASSWORD` on any deployment other people can open. This is a placeholder until Google SSO and a role list (admin, CX leader, support, CXM).
6. Deploy. `npm run build` is the production build. Open `/api/health` and expect `status: "connected"`, `mode: "login"`, and a `loginPath` when the service user is set.

There is no cron sync and no database in this phase. Live org and project pages share a cached API read for about 30 minutes. A failed refresh keeps the last snapshot. Manual dates saved on that instance are applied on top of the cache.

## Later

Postgres snapshots (org snapshots, start dates, stage events, daily counts, checklist rows) replace the JSON stand-in and the per-request API reads. The engineering page tracks the API work those snapshots are waiting on. Agent cards stay placeholders until that data, and a human approval step, exist.
