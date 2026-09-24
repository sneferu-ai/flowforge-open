/**
 * Queue plane (§4.1/§4.2) — Redis 7.4 + BullMQ.
 *
 * BullMQ forbids ':' in queue names, so the spec's `forge:runs`,
 * `forge:scheduler`, and `forge:outbox` queue names are registered dash-spelled
 * (`forge-run`, `forge-scheduler`, `forge-outbox`) at the queue plane — same
 * topology, same semantics. This module is the single source of truth for the
 * queue names and the run producer/consumer shared by the embedded server and
 * the standalone worker.
 */

import { Queue, Worker, type Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { query } from '../db/pool.js';
import { executeWorkflowRun } from './run-executor.js';

export const QUEUE_RUN = 'forge-run';
export const QUEUE_SCHEDULER = 'forge-scheduler';
export const QUEUE_OUTBOX = 'forge-outbox';

/** §6.3 — scheduler tick Redis lock key + TTL. */
export const SCHEDULER_TICK_LOCK_KEY = 'ff:scheduler:tick';
export const SCHEDULER_TICK_LOCK_TTL_MS = 15_000;

export function redisUrl(): string {
  return process.env.FF_REDIS_URL || 'redis://localhost:6379';
}

/**
 * BullMQ Redis key prefix, derived from the database identity: every member
 * of an installation (embedded server, standalone server, workers) shares the
 * same DB and therefore the same queues, while two installations pointed at
 * one Redis can never steal each other's jobs. Processes of an OLDER build
 * (no prefix) see a different key space and stay out of the way too.
 */
export function queueKeyPrefix(): string {
  const db = process.env.FF_DATABASE_URL || 'default';
  const hash = createHash('sha1').update(db).digest('hex').slice(0, 8);
  return `ff${hash}`;
}

export const bullConnection: ConnectionOptions = {
  url: redisUrl(),
  maxRetriesPerRequest: null,
};

/** Queue/Worker options — `prefix` is a QueueBaseOptions field, NOT a
 *  connection field; it namespaces every Redis key BullMQ touches. */
export function bullQueueOpts(): { connection: ConnectionOptions; prefix: string } {
  return { connection: bullConnection, prefix: queueKeyPrefix() };
}

let sharedRedis: Redis | null = null;

/** One process-local Redis client for lock/lease operations (NOT BullMQ's). */
export function getSharedRedis(): Redis {
  if (!sharedRedis) {
    sharedRedis = new Redis(redisUrl(), { maxRetriesPerRequest: null });
    sharedRedis.on('error', (err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[redis] connection error:', err.message);
      }
    });
  }
  return sharedRedis;
}

let runQueue: Queue | null = null;

/** Lazily-built producer for the run-execution queue (single instance per process). */
export function getRunQueue(): Queue {
  if (!runQueue) {
    runQueue = new Queue(QUEUE_RUN, bullQueueOpts());
  }
  return runQueue;
}

let systemJobQueue: Queue | null = null;

/** Lazily-built producer for the system-jobs queue (§7 — jobs dispatched by
 *  the scheduler tick from the `system_jobs` table). */
export function getSystemJobQueue(): Queue {
  if (!systemJobQueue) {
    systemJobQueue = new Queue(QUEUE_SCHEDULER, bullQueueOpts());
  }
  return systemJobQueue;
}

/**
 * Enqueue a run for execution and record the BullMQ job id (`runs.job_id`, §6.3).
 * Returns the BullMQ job id. Reconciliation re-enqueues runs whose job_id is
 * NULL (§6.2 stale sweep), so a enqueue failure after the DB commit is repaired,
 * not lost.
 */
export async function enqueueRunJob(runId: string): Promise<string> {
  const job = await getRunQueue().add(
    'execute-run',
    { run_id: runId },
    {
      attempts: 5,
      backoff: { type: 'fixed', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 200,
    }
  );
  await query('UPDATE runs SET job_id = $2 WHERE id = $1', [runId, String(job.id ?? '')]);
  // §7 SSE shape for run.queued: { run_id } — one event per successful
  // enqueue (create, delay/approval resume, reconciliation re-enqueue).
  await query(
    `INSERT INTO run_events (run_id, event_type, payload)
     VALUES ($1, 'run.queued', jsonb_build_object('run_id', $2::text))`,
    [runId, runId]
  );
  return String(job.id ?? '');
}

export function isTerminalStatus(status: string): boolean {
  return ['succeeded', 'completed', 'failed', 'canceled'].includes(status);
}

/** §D23 — allow_concurrent is workflow-level opt-in; default serializes runs. */
async function workflowAllowsConcurrent(pool: Pool, workflowId: string): Promise<boolean> {
  try {
    const wf = await pool.query('SELECT id FROM workflows WHERE id = $1', [workflowId]);
    if (wf.rows.length === 0) return true; // unknown workflow → let the executor fail loudly
    const version = await pool.query(
      `SELECT manifest_json->>'allow_concurrent' AS allow_concurrent FROM workflow_versions
       WHERE workflow_id = $1 AND is_current = true`,
      [workflowId]
    );
    return version.rows[0]?.allow_concurrent === 'true';
  } catch {
    return true;
  }
}

/** §6.3/§D23 — per-workflow Redis lock. TTL 300s: long enough to cover the
 *  longest bounded step without a lock-renewal path; heartbeat-based renewal
 *  is left for a follow-up (documented, not silent). */
export async function acquireWorkflowLock(workflowId: string, ttlMs = 300_000): Promise<boolean> {
  const key = `ff:run:wf:${workflowId}`;
  const acquired = await getSharedRedis().set(key, process.pid.toString(), 'PX', ttlMs, 'NX');
  return !!acquired;
}

export async function releaseWorkflowLock(workflowId: string): Promise<void> {
  await getSharedRedis().del(`ff:run:wf:${workflowId}`);
}

/**
 * Shared BullMQ job processor — used by the embedded server consumer AND the
 * standalone worker (§4.2), so both modes execute runs identically.
 *
 * On a terminal attempt failure the run goes back to `queued` with
 * `job_id = NULL` so the stale-sweep reconciliation re-enqueues it (crash
 * recovery §6.2); the failed job stays visible in BullMQ's failed set.
 */
export function createRunProcessor(pool: Pool) {
  return async (job: Job): Promise<unknown> => {
    const { run_id, workspace_id, workflow_id } = (job.data ?? {}) as {
      run_id?: string;
      workspace_id?: string;
      workflow_id?: string;
    };
    if (!run_id) throw new Error('run job missing run_id');
    console.log(`[worker] processing run ${run_id}`);

    const wfResult = await pool.query('SELECT workflow_id, status FROM runs WHERE id = $1', [run_id]);
    if (wfResult.rows.length === 0) {
      // Orphan job (§6.3): the run row is gone (e.g. retention purge) or the
      // job belongs to another database behind the same Redis. Retrying can
      // never heal a missing row — log and discard instead of burning attempts.
      console.warn(`[worker] run ${run_id} not found — discarding orphan job`);
      return { run_id, skipped: 'run_not_found' };
    }
    if (isTerminalStatus(wfResult.rows[0].status)) {
      return { run_id, status: wfResult.rows[0].status, skipped: 'already_terminal' };
    }
    const wfId = workflow_id || wfResult.rows[0].workflow_id;

    const allowConcurrent = await workflowAllowsConcurrent(pool, wfId);
    if (!allowConcurrent) {
      const locked = await acquireWorkflowLock(wfId);
      if (!locked) {
        throw new Error(`Workflow ${wfId} is busy — will retry`);
      }
    }
    try {
      const result = await executeWorkflowRun(run_id);
      console.log(`[worker] run ${run_id} → ${result.status}`);
      return result;
    } catch (err) {
      // Return the run to a re-enqueueable state; reconciliation drives it home.
      await pool
        .query(
          "UPDATE runs SET status = 'queued', job_id = NULL WHERE id = $1 AND status IN ('queued','running')",
          [run_id]
        )
        .catch(() => {});
      throw err;
    } finally {
      if (!allowConcurrent) await releaseWorkflowLock(wfId);
      void workspace_id;
    }
  };
}

export interface RunConsumerHandle {
  close(): Promise<void>;
}

/**
 * Start the embedded BullMQ run consumer (FF_WORKER_MODE=embedded, §4.2).
 * In standalone mode the separate worker process owns consumption instead.
 */
export function startRunConsumer(pool: Pool): RunConsumerHandle {
  const concurrency = Math.max(
    1,
    Math.min(parseInt(process.env.FF_WORKER_CONCURRENCY || '4', 10) || 4, 20)
  );
  const worker = new Worker(QUEUE_RUN, createRunProcessor(pool), {
    ...bullQueueOpts(),
    concurrency,
  });
  worker.on('failed', (job, err) => {
    console.error(`[worker] run job ${job?.id} failed:`, err.message);
  });
  console.log(`[worker] embedded BullMQ consumer started on ${QUEUE_RUN} (concurrency ${concurrency})`);
  return {
    async close() {
      await worker.close();
    },
  };
}

export async function closeQueues(): Promise<void> {
  if (runQueue) {
    await runQueue.close().catch(() => {});
    runQueue = null;
  }
  if (systemJobQueue) {
    await systemJobQueue.close().catch(() => {});
    systemJobQueue = null;
  }
  if (sharedRedis) {
    sharedRedis.disconnect();
    sharedRedis = null;
  }
}
