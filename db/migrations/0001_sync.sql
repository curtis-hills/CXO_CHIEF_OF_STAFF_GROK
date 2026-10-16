-- Stored copy of the SubcontractorHub superadmin lists.
-- The app applies this file from /sync and from the first sync run.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orgs (
  id text PRIMARY KEY,
  name text,
  email text,
  status text,
  sub_status text,
  payment_status text,
  account_type text,
  city text,
  state text,
  cxm_id text,
  cxm_name text,
  ae_id text,
  ae_name text,
  active_user_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  raw jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orgs_updated_at_idx ON orgs (updated_at);

CREATE TABLE IF NOT EXISTS org_subscriptions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  status text,
  plan_name text,
  unit_price numeric,
  interval text,
  raw jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_subscriptions_org_idx ON org_subscriptions (org_id);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  org_id text,
  job_type text,
  system_size text,
  is_test boolean,
  deleted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  raw jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_org_idx ON projects (org_id);
CREATE INDEX IF NOT EXISTS projects_updated_at_idx ON projects (updated_at);

CREATE TABLE IF NOT EXISTS financials (
  id text PRIMARY KEY,
  org_id text,
  project_id text,
  status text,
  amount numeric,
  created_at timestamptz,
  updated_at timestamptz,
  raw jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financials_org_idx ON financials (org_id);

CREATE TABLE IF NOT EXISTS esign_status (
  id text PRIMARY KEY,
  org_id text,
  project_id text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  raw jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS esign_status_org_idx ON esign_status (org_id);

CREATE TABLE IF NOT EXISTS commissions (
  id text PRIMARY KEY,
  org_id text,
  project_id text,
  status text,
  amount numeric,
  created_at timestamptz,
  updated_at timestamptz,
  raw jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commissions_org_idx ON commissions (org_id);

CREATE TABLE IF NOT EXISTS sync_runs (
  id text PRIMARY KEY,
  endpoint text NOT NULL,
  kind text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  rows integer NOT NULL DEFAULT 0,
  pages integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  error text
);

CREATE INDEX IF NOT EXISTS sync_runs_started_idx ON sync_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS sync_cursors (
  endpoint text PRIMARY KEY,
  cursor text,
  page integer,
  high_water timestamptz,
  pass_complete boolean NOT NULL DEFAULT false,
  backfill_complete boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  strategy text NOT NULL DEFAULT 'platform',
  org_index integer NOT NULL DEFAULT 0,
  full_pass boolean NOT NULL DEFAULT false,
  last_reconcile_day date,
  unsupported_filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  unsupported_sorts jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  org_id text NOT NULL,
  day date NOT NULL,
  stage text,
  status text,
  project_count integer,
  live_project_count integer,
  health_band text,
  health_score numeric,
  pace_status text,
  pace_ratio numeric,
  pace_day integer,
  captured_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, day)
);

CREATE INDEX IF NOT EXISTS account_snapshots_day_idx ON account_snapshots (day);

INSERT INTO schema_migrations (id) VALUES ('0001_sync') ON CONFLICT (id) DO NOTHING;
