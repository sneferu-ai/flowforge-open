-- Migration: 008_api_tokens_role_snapshot.sql
-- §8.2/§8.4: API tokens carry a role_snapshot frozen at creation time.
-- The role is NOT re-resolved from workspace_members on each request —
-- later membership changes do not affect tokens already issued.

ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS role_snapshot TEXT;

-- Backfill role_snapshot from workspace_members for existing tokens so
-- they keep working after the migration. New tokens will have the column
-- set at creation time by the api-tokens route.
UPDATE api_tokens a
SET role_snapshot = wm.role
FROM workspace_members wm
WHERE a.workspace_id = wm.workspace_id
  AND a.user_id = wm.user_id
  AND a.role_snapshot IS NULL;

-- Ensure no token is left without a role_snapshot (default to 'member'
-- for orphaned tokens whose membership was removed but token not revoked).
UPDATE api_tokens SET role_snapshot = 'member' WHERE role_snapshot IS NULL;

ALTER TABLE api_tokens ALTER COLUMN role_snapshot SET NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('008_api_tokens_role_snapshot')
ON CONFLICT DO NOTHING;
