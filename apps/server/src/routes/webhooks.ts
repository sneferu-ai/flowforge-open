/**
 * Webhook ingress — POST /hooks/:workspaceSlug/:path (§6.4, §9).
 *
 * Webhook auth/path/sync config lives in `triggers.config` (§5.1/§7) and
 * signing secrets in `webhook_secrets`. Replay protection uses the
 * `webhook_replay_log` table — unique per (workspace, trigger, payload hash)
 * with a 10-minute TTL pruned by the scheduler.
 *
 * - hmac: X-FlowForge-Signature: sha256=<hex> over
 *   `X-FlowForge-Timestamp\n<raw_body_bytes>`; timestamp (Unix seconds)
 *   required and within ±300s.
 * - header: constant-time exact comparison of the named header against the
 *   decrypted webhook secret.
 * - none: no verification.
 * - Non-JSON or non-object payload → trigger.payload = null.
 * - sync: true executes the run inline and returns the reply step output.
 */

import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { decrypt, hmacSha256, timingSafeEqual } from '../crypto.js';
import { executeWorkflowRun } from '../services/run-executor.js';
import { enqueueRunJob } from '../services/queue.js';
import { getIdempotencyKey } from '../db/idempotency.js';
import { hasHardRunCap } from '../auth/entitlements.js';
import { getPlanDefinition, ERROR_CODES } from '@flowforge/shared';

const TIMESTAMP_TOLERANCE_S = 300;

interface WebhookTriggerConfig {
  path?: string;
  auth_mode?: 'hmac' | 'header' | 'none';
  secret?: string;
  auth_header?: string;
  auth_secret?: string;
  require_signature?: boolean;
  sync?: boolean;
  input_mapping?: Record<string, unknown>;
}

interface WebhookTriggerRow {
  trigger_id: string;
  workflow_id: string;
  is_enabled: boolean;
  config: WebhookTriggerConfig;
}

/** Outcome of the transactional admission gate (§3.3, §6.5). */
type WebhookAdmission =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

export function webhookReplayHash(rawBody: string, clientIdempotencyKey: string | undefined): string {
  return createHash('sha256')
    .update(clientIdempotencyKey ? clientIdempotencyKey + rawBody : rawBody)
    .digest('hex');
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // Capture the exact request bytes WITHOUT consuming the stream: a
  // parseAs:'string' content-type parser receives the raw string and keeps
  // Fastify's own parsing intact (an onRequest data-listener would flow the
  // stream ahead of the parser and break Content-Length validation).
  fastify.addContentTypeParser(
    ['application/json', 'text/plain', 'application/octet-stream', 'application/x-www-form-urlencoded'],
    { parseAs: 'string' },
    (request, body, done) => {
      const raw = typeof body === 'string' ? body : '';
      request.rawBodyString = raw;
      const contentType = (request.headers['content-type'] || '').toLowerCase();
      if (contentType.includes('application/json')) {
        if (raw.trim() === '') {
          return done(null, undefined);
        }
        try {
          return done(null, JSON.parse(raw));
        } catch {
          // Non-JSON payloads are a defined webhook case (§6.4) — hand the raw
          // string through instead of erroring; handlers decide.
          return done(null, raw);
        }
      }
      return done(null, raw);
    }
  );

  fastify.post('/hooks/:workspaceSlug/:path', async (request, reply) => {
    const { workspaceSlug, path } = request.params as { workspaceSlug: string; path: string };

    // §9 — the URL carries the workspace SLUG. Resolve it (UUIDs still pass
    // through for direct API-style callers).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const workspaceResult = UUID_RE.test(workspaceSlug)
      ? { rows: [{ id: workspaceSlug }] }
      : await query<{ id: string }>('SELECT id FROM workspaces WHERE slug = $1', [workspaceSlug]);
    if (workspaceResult.rows.length === 0) {
      return reply.code(404).send({ error: { code: 'webhook_not_found', message: 'Webhook endpoint not found' } });
    }
    const workspaceId = workspaceResult.rows[0].id;

    // §5.1/§7 — the webhook endpoint IS the enabled webhook trigger whose
    // config.path matches (paths derive from the workflow slug by default).
    const triggerResult = await query<WebhookTriggerRow>(
      `SELECT t.id AS trigger_id, t.config, w.id AS workflow_id, w.is_enabled
       FROM triggers t
       JOIN workflows w ON w.id = t.workflow_id
       WHERE w.workspace_id = $1 AND t.type = 'webhook' AND t.is_enabled = true
         AND t.config ->> 'path' = $2
       ORDER BY t.created_at LIMIT 1`,
      [workspaceId, path]
    );

    if (triggerResult.rows.length === 0) {
      return reply.code(404).send({ error: { code: 'webhook_not_found', message: 'Webhook endpoint not found' } });
    }
    const endpoint = triggerResult.rows[0];
    const config: WebhookTriggerConfig = typeof endpoint.config === 'string'
      ? (JSON.parse(endpoint.config as unknown as string) as WebhookTriggerConfig)
      : endpoint.config;

    // Disabled workflow → 410 (§6.3)
    if (!endpoint.is_enabled) {
      return reply.code(410).send({ error: { code: 'workflow_disabled', message: 'Workflow is disabled' } });
    }

    // Raw body bytes for signature/replay.
    const rawBody = request.rawBodyString !== undefined
      ? request.rawBodyString
      : (request.body != null ? JSON.stringify(request.body) : '');

    // --- Auth verification ---
    const authMode = config.auth_mode ?? 'hmac';
    if (authMode === 'hmac' && config.require_signature !== false) {
      const timestampHeader = request.headers['x-flowforge-timestamp'] as string | undefined;
      if (!timestampHeader) {
        return reply.code(401).send({ error: { code: 'timestamp_missing', message: 'X-FlowForge-Timestamp header required' } });
      }
      const parsedTs = parseInt(timestampHeader, 10);
      if (!Number.isFinite(parsedTs) || Math.abs(Date.now() / 1000 - parsedTs) > TIMESTAMP_TOLERANCE_S) {
        return reply.code(401).send({ error: { code: 'timestamp_out_of_tolerance', message: 'Timestamp outside 300s tolerance' } });
      }

      const secret = await lookupSecret(workspaceId, config.secret ?? null);
      if (!secret) {
        return reply.code(401).send({ error: { code: 'invalid_signature', message: 'Webhook secret not found' } });
      }
      const signedPayload = `${timestampHeader}\n${rawBody}`;
      const expected = `sha256=${hmacSha256(secret, signedPayload)}`;
      const provided = (request.headers['x-flowforge-signature'] as string | undefined) ?? '';
      if (!timingSafeEqual(provided, expected)) {
        return reply.code(401).send({ error: { code: 'invalid_signature', message: 'Invalid signature' } });
      }
    } else if (authMode === 'header') {
      const authHeader = config.auth_header;
      const secret = config.auth_secret ? await lookupSecret(workspaceId, config.auth_secret) : null;
      const provided = authHeader ? ((request.headers[authHeader.toLowerCase()] as string | undefined) ?? '') : '';
      if (!authHeader || !secret || !timingSafeEqual(provided, secret)) {
        return reply.code(401).send({ error: { code: 'invalid_signature', message: 'Invalid signature' } });
      }
    }
    // auth_mode none: no verification.

    // --- Replay protection (§6.4: per trigger; 10-minute TTL) ---
    const clientIdempotency = request.headers['x-flowforge-idempotency-key'] as string | undefined;
    const payloadHash = webhookReplayHash(rawBody, clientIdempotency);
    const replayInserted = await query(
      `INSERT INTO webhook_replay_log (workspace_id, trigger_id, payload_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, trigger_id, payload_hash) DO NOTHING
       RETURNING id`,
      [workspaceId, endpoint.trigger_id, payloadHash]
    );
    if (replayInserted.rows.length === 0) {
      return reply.code(409).send({ error: { code: 'duplicate_webhook', message: 'Duplicate webhook payload within 10 minutes' } });
    }

    // --- Payload handling (non-JSON ⇒ trigger.payload = null, §6.4) ---
    const contentType = (request.headers['content-type'] ?? '').toLowerCase();
    let payload: unknown = null;
    if (contentType.includes('application/json')) {
      try {
        payload = rawBody ? JSON.parse(rawBody) : request.body ?? null;
      } catch {
        payload = null;
      }
    }

    // --- Input mapping (bindings: trigger.payload, trigger.type) ---
    const inputs: Record<string, unknown> = {};
    const mapping = config.input_mapping || {};
    for (const [key, source] of Object.entries(mapping)) {
      if (typeof source !== 'string') continue;
      const normalized = source.replace(/^\{\{\s*|\s*\}\}$/g, '');
      let value: unknown = null;
      if (normalized === 'trigger.type') {
        value = 'webhook';
      } else if (normalized === 'trigger.payload') {
        value = payload;
      } else if (normalized.startsWith('trigger.payload.')) {
        value = extractValue(payload as Record<string, unknown> | null, normalized.slice('trigger.payload.'.length));
      } else if (normalized.startsWith('trigger.')) {
        value = normalized === 'trigger.type' ? 'webhook' : null;
      } else {
        value = extractValue(payload as Record<string, unknown> | null, normalized);
      }
      inputs[key] = value ?? null;
    }
    if (Object.keys(inputs).length === 0) {
      inputs['body'] = payload;
    }

    // --- Run creation ---
    const versionResult = await query<{ id: string; manifest_json: { inputs?: Array<{ name: string; required: boolean }> } }>(
      `SELECT v.id, v.manifest_json FROM workflow_versions v
       WHERE v.workflow_id = $1 AND v.is_current = true`,
      [endpoint.workflow_id]
    );
    if (versionResult.rows.length === 0) {
      return reply.code(500).send({ error: { code: 'internal_error', message: 'No current workflow version' } });
    }

    // Manifest-level REQUIRED inputs must be non-null when the webhook maps
    // them; optional mapped inputs resolve to null and the run proceeds (§6.4).
    const requiredNames = new Set(
      (versionResult.rows[0].manifest_json?.inputs ?? [])
        .filter((i) => i.required === true)
        .map((i) => i.name)
    );
    for (const [key, value] of Object.entries(inputs)) {
      if (value === null && requiredNames.has(key)) {
        return reply.code(400).send({
          error: { code: 'input_mapping_failed', message: `required input '${key}' resolved to null` },
        });
      }
    }

    // --- Admission control + run creation (§3.3, §6.5) ---
    // §3.3: Free-plan admission is one transaction that locks the workspace
    // and its active subscription before reading the counters, and creates
    // the run in the SAME transaction. Webhooks are rejected at the cap/limit
    // with 429 — unlike scheduled triggers, which are silently skipped or
    // created concurrency-blocked (§3.3, §6.5).
    const runId = randomUUID();
    const idempotencyKey = getIdempotencyKey('webhook', workspaceId, payloadHash);

    const admitted = await withTransaction(async (tx): Promise<WebhookAdmission> => {
      // Lock the tenant row first — serializes concurrent admission for the
      // same workspace.
      const lockedWs = await tx.query<{ plan_id: string }>(
        'SELECT plan_id FROM workspaces WHERE id = $1 FOR UPDATE',
        [workspaceId]
      );
      const plan = getPlanDefinition(lockedWs.rows[0]?.plan_id ?? 'free');

      // Active count excludes concurrency-blocked runs (§6.5: blocked runs
      // are not active).
      const activeCountResult = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM runs
         WHERE workspace_id = $1 AND status IN ('queued','running','waiting','paused')
           AND concurrency_block = false`,
        [workspaceId]
      );
      const activeCount = activeCountResult.rows[0]?.n ?? 0;

      // §6.5: webhook at concurrency limit → 429 concurrency_limit_exceeded.
      if (plan?.concurrency_limit !== null && plan?.concurrency_limit !== undefined && activeCount >= plan.concurrency_limit) {
        return { ok: false, status: 429, code: ERROR_CODES.CONCURRENCY_LIMIT_EXCEEDED, message: 'Workspace concurrency limit reached' };
      }

      // §3.3: the HARD run cap applies only to plans without overage billing
      // (Free: 500/mo). Pro/Studio limits are soft thresholds — at 100%
      // overage billing activates and runs are still admitted. The
      // authoritative counter is subscriptions.runs_consumed on the active
      // subscription within the current billing period (current_period_start/
      // current_period_end), not a calendar-month COUNT(*) from usage_events.
      if (plan && hasHardRunCap(plan)) {
        const subResult = await tx.query<{ runs_consumed: number }>(
          `SELECT runs_consumed FROM subscriptions
           WHERE workspace_id = $1 AND status = 'active'
             AND now() >= current_period_start AND now() < current_period_end
           ORDER BY created_at DESC LIMIT 1
           FOR UPDATE`,
          [workspaceId]
        );
        const runsConsumed = subResult.rows[0]?.runs_consumed ?? 0;
        if (runsConsumed + activeCount >= (plan.run_limit ?? 0)) {
          return { ok: false, status: 429, code: ERROR_CODES.RUN_LIMIT_EXCEEDED, message: 'Run limit reached' };
        }
      }

      // §6.2: timeout_at = created_at + workflow_timeout_hours from the plan
      // (NOT the old hard-coded 24h).
      const timeoutHours = plan?.workflow_timeout_hours ?? 1;
      const timeoutAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);

      const insertResult = await tx.query(
        `INSERT INTO runs (id, workspace_id, workflow_id, workflow_version_id, trigger_id, idempotency_key, state, timeout_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          runId,
          workspaceId,
          endpoint.workflow_id,
          versionResult.rows[0].id,
          endpoint.trigger_id,
          idempotencyKey,
          // §5.4.6 — run.scheduled_at for webhook runs is the receipt time.
          JSON.stringify({ inputs, trigger: { type: 'webhook', payload, scheduled_at: new Date().toISOString() } }),
          timeoutAt,
        ]
      );
      if (insertResult.rows.length === 0) {
        throw new Error('Failed to create run');
      }

      // §7 SSE shape for run.created: { run_id, workflow_id, trigger_type, inputs }
      await tx.query(
        `INSERT INTO run_events (run_id, event_type, payload) VALUES ($1, 'run.created', $2)`,
        [runId, JSON.stringify({ run_id: runId, workflow_id: endpoint.workflow_id, trigger_type: 'webhook', inputs })]
      );

      return { ok: true };
    });

    if (!admitted.ok) {
      return reply.code(admitted.status).send({ error: { code: admitted.code, message: admitted.message } });
    }

    if (config.sync === true) {
      // Execute synchronously; honor the reply step (§6.4 sync response).
      const result = await executeWorkflowRun(runId);
      const replyValue = (result.output as { _reply?: { status?: number; headers?: Record<string, string>; body?: string } } | null)?._reply;
      if (replyValue) {
        const status = replyValue.status && replyValue.status >= 200 && replyValue.status < 600 ? replyValue.status : 200;
        const headers = replyValue.headers || {};
        for (const [name, value] of Object.entries(headers)) {
          reply.header(name, String(value));
        }
        return reply.code(status).send(replyValue.body ?? '');
      }
      // §6.4 — sync: true without a reply (or the run terminated before one):
      // 202 with the run id and terminal/pending status.
      return reply.code(202).send({ data: { run_id: runId, status: result.status } });
    }

    await enqueueRunJob(runId);
    return reply.code(202).send({ data: { run_id: runId, status: 'queued' } });
  });
}

async function lookupSecret(workspaceId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const result = await query<{ value_enc: string }>(
    'SELECT value_enc FROM webhook_secrets WHERE workspace_id = $1 AND name = $2',
    [workspaceId, name]
  );
  if (result.rows.length === 0) return null;
  return decrypt(result.rows[0].value_enc, workspaceId);
}

function extractValue(obj: Record<string, unknown> | null, path: string): unknown {
  if (obj === null || obj === undefined) return null;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}
