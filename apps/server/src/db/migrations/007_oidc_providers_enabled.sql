-- Migration: 007_oidc_providers_enabled.sql
-- §8.6 — enable/disable flag on OIDC providers. Pre-workspace provider
-- resolution and login only consider enabled providers; existing rows
-- default to enabled so nothing silently stops working.

ALTER TABLE oidc_providers ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

-- Record migration
INSERT INTO schema_migrations (version) VALUES ('007_oidc_providers_enabled')
ON CONFLICT DO NOTHING;
