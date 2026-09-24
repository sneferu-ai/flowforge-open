-- Migration: 002_additions.sql
-- FlowForge Open — additive schema updates (idempotent; safe on fresh and migrated DBs)

-- Workspace enable/disable flag (§7 data model: is_enabled default true)
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT true;

-- Workspace + workflow slugs for webhook path derivation (§9 API contract)
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slug TEXT;

ALTER TABLE workflows ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS current_version_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_slug_key') THEN
    ALTER TABLE workspaces ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflows_ws_slug_key') THEN
    ALTER TABLE workflows ADD CONSTRAINT workflows_ws_slug_key UNIQUE (workspace_id, slug);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oidc_providers_ws_name_key') THEN
    ALTER TABLE oidc_providers ADD CONSTRAINT oidc_providers_ws_name_key UNIQUE (workspace_id, name);
  END IF;
END $$;

-- Manual approval timeout policy persisted on the task (§5.3 manual_approval)
ALTER TABLE approval_tasks ADD COLUMN IF NOT EXISTS on_timeout TEXT NOT NULL DEFAULT 'skip';

-- In-app inbox read tracking (§8.7)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;

-- Run failure reason (§19 run failure reasons)
ALTER TABLE runs ADD COLUMN IF NOT EXISTS error TEXT;

-- Append-only metering ledger; reconciled against usage_counters (§3.3 billing)
CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, event_type)
);
CREATE INDEX IF NOT EXISTS idx_usage_events_ws ON usage_events(workspace_id, created_at);

-- Per-workspace egress allowlist (§8.8) — scheme/host/port rows; ip_allowlist stays for IP-CIDR fencing
CREATE TABLE IF NOT EXISTS workspace_allowlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    scheme TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, scheme, host, port)
);
CREATE INDEX IF NOT EXISTS idx_workspace_allowlist_ws ON workspace_allowlist(workspace_id);

-- Step attempt uniqueness (§6.2): run-steps keyed by (run_id, step_path, attempt)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_run_steps_path_attempt ON run_steps (run_id, step_path, attempt);

INSERT INTO schema_migrations (version) VALUES ('002_additions')
ON CONFLICT DO NOTHING;
