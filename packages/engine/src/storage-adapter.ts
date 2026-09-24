/**
 * StorageAdapter interface — the storage abstraction for the execution engine.
 * CLI `forge run` uses InMemoryStorageAdapter (JavaScript Maps).
 * Hosted uses PostgresStorageAdapter.
 */

export interface Run {
  id: string;
  workspace_id: string;
  workflow_id: string;
  workflow_version_id: string;
  trigger_id: string | null;
  status: string;
  state: Record<string, unknown>;
  cursor: Record<string, unknown> | null;
  job_id: string | null;
  idempotency_key: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  recovery_count: number;
  total_running_seconds: number;
  resume_at: string | null;
  timeout_at: string;
  concurrency_block: boolean;
}

export interface RunStep {
  id: string;
  run_id: string;
  step_id: string;
  step_path: string;
  iteration: number;
  status: string;
  input: Record<string, unknown> | null;
  output: unknown;
  logs: string;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
}

export interface Trigger {
  id: string;
  workflow_id: string;
  type: string;
  config: Record<string, unknown>;
  is_enabled: boolean;
  next_fire_at: string | null;
}

export interface CreateRunParams {
  id: string;
  workspace_id: string;
  workflow_id: string;
  workflow_version_id: string;
  trigger_id: string | null;
  idempotency_key: string;
  inputs: Record<string, unknown>;
  timeout_at: string;
}

export interface InsertRunStepParams {
  id: string;
  run_id: string;
  step_id: string;
  step_path: string;
  iteration: number;
  attempt: number;
  input: Record<string, unknown> | null;
}

export interface StorageAdapter {
  createRun(params: CreateRunParams): Promise<Run>;
  updateRunStatus(runId: string, status: string, updates?: Record<string, unknown>): Promise<void>;
  getRun(runId: string): Promise<Run | null>;
  insertRunStep(params: InsertRunStepParams): Promise<RunStep>;
  updateRunStep(stepId: string, updates: Record<string, unknown>): Promise<void>;
  queryDueTriggers(): Promise<Trigger[]>;
  advanceTriggerNextFire(triggerId: string, nextFireAt: Date): Promise<void>;
  getRunSteps(runId: string): Promise<RunStep[]>;
  updateRunHeartbeat(runId: string): Promise<void>;
}
