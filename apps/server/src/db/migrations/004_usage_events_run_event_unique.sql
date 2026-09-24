-- 004_usage_events_run_event_unique: align live databases created under the
-- original 001 definition (UNIQUE workspace_id+run_id) with the metering
-- contract the executor inserts against (ON CONFLICT (run_id, event_type) —
-- one recorded terminal event per run, per type).

ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_workspace_id_run_id_key;

-- De-duplicate any rows the old constraint allowed (one per run total).
DELETE FROM usage_events a
USING usage_events b
WHERE a.run_id = b.run_id
  AND a.event_type = b.event_type
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_events_run_event ON usage_events (run_id, event_type);

-- Record the migration so it is not re-applied on every startup.
INSERT INTO schema_migrations (version) VALUES ('004_usage_events_run_event_unique')
ON CONFLICT DO NOTHING;
