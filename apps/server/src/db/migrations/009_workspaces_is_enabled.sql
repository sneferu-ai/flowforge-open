-- Migration: 009_workspaces_is_enabled.sql
-- §7 — workspaces carries is_enabled (default true): delete-workspace
-- soft-disables the row, and disabled workspaces refuse runs/webhooks.
-- Databases migrated under the pre-repair 001 (which lacked the column) need
-- the backfill; on fresh databases where 001 already defines it this is a
-- no-op.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT true;

-- Record migration
INSERT INTO schema_migrations (version) VALUES ('009_workspaces_is_enabled')
ON CONFLICT DO NOTHING;
