/**
 * InMemoryStorageAdapter — JavaScript Maps-based storage for CLI `forge run`.
 */

import type {
  StorageAdapter,
  Run,
  RunStep,
  Trigger,
  CreateRunParams,
  InsertRunStepParams,
} from './storage-adapter.js';

export class InMemoryStorageAdapter implements StorageAdapter {
  private runs: Map<string, Run> = new Map();
  private runSteps: Map<string, RunStep[]> = new Map();
  private triggers: Map<string, Trigger> = new Map();

  async createRun(params: CreateRunParams): Promise<Run> {
    const run: Run = {
      id: params.id,
      workspace_id: params.workspace_id,
      workflow_id: params.workflow_id,
      workflow_version_id: params.workflow_version_id,
      trigger_id: params.trigger_id,
      status: 'queued',
      state: { inputs: params.inputs },
      cursor: null,
      job_id: null,
      idempotency_key: params.idempotency_key,
      started_at: null,
      finished_at: null,
      heartbeat_at: null,
      recovery_count: 0,
      total_running_seconds: 0,
      resume_at: null,
      timeout_at: params.timeout_at,
      concurrency_block: false,
    };
    this.runs.set(params.id, run);
    this.runSteps.set(params.id, []);
    return run;
  }

  async updateRunStatus(runId: string, status: string, updates?: Record<string, unknown>): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    run.status = status;
    if (updates) {
      Object.assign(run, updates);
    }
  }

  async getRun(runId: string): Promise<Run | null> {
    return this.runs.get(runId) ?? null;
  }

  async insertRunStep(params: InsertRunStepParams): Promise<RunStep> {
    const step: RunStep = {
      id: params.id,
      run_id: params.run_id,
      step_id: params.step_id,
      step_path: params.step_path,
      iteration: params.iteration,
      attempt: params.attempt,
      status: 'pending',
      input: params.input,
      output: null,
      logs: '',
      started_at: null,
      finished_at: null,
    };
    const steps = this.runSteps.get(params.run_id) ?? [];
    steps.push(step);
    this.runSteps.set(params.run_id, steps);
    return step;
  }

  async updateRunStep(stepId: string, updates: Record<string, unknown>): Promise<void> {
    for (const [runId, steps] of this.runSteps) {
      const step = steps.find((s) => s.id === stepId);
      if (step) {
        Object.assign(step, updates);
        return;
      }
    }
    throw new Error(`Run step not found: ${stepId}`);
  }

  async queryDueTriggers(): Promise<Trigger[]> {
    const now = new Date();
    const due: Trigger[] = [];
    for (const trigger of this.triggers.values()) {
      if (trigger.is_enabled && trigger.next_fire_at && new Date(trigger.next_fire_at) <= now) {
        due.push(trigger);
      }
    }
    return due;
  }

  async advanceTriggerNextFire(triggerId: string, nextFireAt: Date): Promise<void> {
    const trigger = this.triggers.get(triggerId);
    if (trigger) {
      trigger.next_fire_at = nextFireAt.toISOString();
    }
  }

  async getRunSteps(runId: string): Promise<RunStep[]> {
    return this.runSteps.get(runId) ?? [];
  }

  async updateRunHeartbeat(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run) {
      run.heartbeat_at = new Date().toISOString();
    }
  }

  // Test helpers
  addTrigger(trigger: Trigger): void {
    this.triggers.set(trigger.id, trigger);
  }

  clear(): void {
    this.runs.clear();
    this.runSteps.clear();
    this.triggers.clear();
  }
}
