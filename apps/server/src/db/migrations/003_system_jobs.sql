-- 003_system_jobs: DB-led system job table (§6.3/§7).
-- The 10-second scheduler tick consults next_run_at; each job's work is
-- implemented by the scheduler service (approval_timeout_check, replay_log_cleanup,
-- reconciliation) and by the app's own background loops, with the table as the
-- schedule of record.

CREATE TABLE IF NOT EXISTS system_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL UNIQUE,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_run_at TIMESTAMPTZ,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Record the migration so it is not re-applied on every startup.
INSERT INTO schema_migrations (version) VALUES ('003_system_jobs')
ON CONFLICT DO NOTHING;
