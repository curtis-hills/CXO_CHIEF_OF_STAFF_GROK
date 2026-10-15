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

Open http://localhost:3000. With no API key, every page renders labeled demo data.

## Environment variables

Set these in `.env.local` and in the Vercel project. Do not prefix them with `NEXT_PUBLIC_`. Do not commit a real key.

| Variable | Required | Purpose |
|---|---|---|
| `SUBHUB_API_KEY` | No | Bearer token for the read-only Executive API. When it is empty, the app uses demo data. |
| `SUBHUB_API_BASE_URL` | No | Defaults to `https://api.virtualsaleportal.com`. |
| `DASHBOARD_PASSWORD` | No | Turns on the placeholder password gate. When it is empty, the app is open and says so. |

The key is read only in server modules (`lib/api/client.ts` imports `server-only`). It is not sent to the browser and it is not written to logs. API errors report the status code and the path only.

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

Unit tests cover the pace curve, status bands, the quiet-account rule, window close, pre-launch and test exclusion, business-day stage flags (including a customer wait that does not pause the clock), and the health score.

## Deploy on Vercel

1. Import this repository. Framework preset is Next.js. Do not set a custom build command.
2. In Project Settings → Environment Variables, add `SUBHUB_API_BASE_URL` if you need to override it.
3. Add `SUBHUB_API_KEY` only on the environments that should call the API. Leave it unset on Preview if you want those deployments to stay on demo data. Put the key in the Vercel UI. Do not paste it into chat or commit it.
4. Set `DASHBOARD_PASSWORD` on any deployment other people can open. This is a placeholder until Google SSO and a role list (admin, CX leader, support, CXM).
5. Deploy. `npm run build` is the production build.

There is no cron sync and no database in this phase. Each request reads the API, or demo data, and applies any manual dates saved on that instance.

## Later

Postgres snapshots (org snapshots, start dates, stage events, daily counts, checklist rows) replace the JSON stand-in and the per-request API reads. The engineering page tracks the API work those snapshots are waiting on. Agent cards stay placeholders until that data, and a human approval step, exist.
