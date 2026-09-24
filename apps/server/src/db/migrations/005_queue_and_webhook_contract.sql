-- Migration: 005_queue_and_webhook_contract.sql
-- Aligns databases created under earlier revisions with the spec §4.2/§5.1/§6.4/§7
-- contracts (safe on fresh databases where 001 already matches).

-- 1. BullMQ owns the queue plane (§4.2) — the DB-backed queue_jobs polling
--    table no longer exists. runs.job_id stores the BullMQ job id (string).
ALTER TABLE runs ALTER COLUMN job_id TYPE TEXT USING job_id::text;

-- 2. Webhook auth/path/sync config lives in triggers.config (§5.1/§7); replay
--    protection is the webhook_replay_log table (10-minute TTL, per trigger).
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhook_endpoints;
DROP TABLE IF EXISTS queue_jobs;
DROP TABLE IF EXISTS schedule_jobs;
DROP TABLE IF EXISTS idempotency_keys;

CREATE TABLE IF NOT EXISTS webhook_replay_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    trigger_id UUID NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
    payload_hash TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, trigger_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS idx_webhook_replay_log_ws ON webhook_replay_log(workspace_id, trigger_id, received_at);

-- 3. approval_tasks carries workspace_id + unique task_id + on_timeout (§7).
ALTER TABLE approval_tasks ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE approval_tasks ADD COLUMN IF NOT EXISTS task_id UUID;
ALTER TABLE approval_tasks ADD COLUMN IF NOT EXISTS on_timeout TEXT NOT NULL DEFAULT 'skip';

UPDATE approval_tasks SET workspace_id = r.workspace_id
FROM runs r
WHERE approval_tasks.run_id = r.id AND approval_tasks.workspace_id IS NULL;

ALTER TABLE approval_tasks ALTER COLUMN workspace_id SET NOT NULL;
UPDATE approval_tasks SET task_id = id WHERE task_id IS NULL;
ALTER TABLE approval_tasks ALTER COLUMN task_id SET NOT NULL;
ALTER TABLE approval_tasks ALTER COLUMN task_id SET DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_tasks_task_id_key') THEN
    ALTER TABLE approval_tasks ADD CONSTRAINT approval_tasks_task_id_key UNIQUE (task_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_approval_tasks_workspace ON approval_tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_approval_tasks_status ON approval_tasks(status) WHERE status = 'pending';

-- 4. Billing: subscriptions.runs_consumed is the admission counter (§3.3),
--    reconciled against usage_events (§3.3/§7).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS runs_consumed INTEGER NOT NULL DEFAULT 0;

-- 5. Outbox rows are immediately dispatchable (scheduler-driven retry below).
UPDATE notification_outbox SET next_retry_at = now() WHERE status = 'pending' AND next_retry_at IS NULL;
ALTER TABLE notification_outbox ALTER COLUMN next_retry_at SET DEFAULT now();
ALTER TABLE notification_outbox ALTER COLUMN next_retry_at SET NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('005_queue_and_webhook_contract')
ON CONFLICT DO NOTHING;
