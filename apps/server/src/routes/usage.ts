/**
 * Usage + subscription surface (§3.3, §9).
 */

import type { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { getPlanDefinition, PERMISSIONS, ERROR_CODES, AUDIT_ACTIONS } from '@flowforge/shared';
import { emitAuditEvent } from '../audit/emit.js';

export async function usageRoutes(fastify: FastifyInstance): Promise<void> {
  // Current-period usage with plan limits (§3.3, §7)
  fastify.get('/usage', { preHandler: requireAuth }, async (request) => {
    const workspaceId = request.auth!.workspaceId;

    // §3.3: runs_consumed is the authoritative counter on the active
    // subscription within the current billing period, and the subscription's
    // plan_id — not the workspaces.plan_id cache — drives the limit. The
    // period bounds come from subscriptions.current_period_start/end (rolling
    // 30-day), NOT a calendar month.
    const sub = await query<{ plan_id: string; runs_consumed: number; current_period_start: string; current_period_end: string }>(
      `SELECT plan_id, runs_consumed, current_period_start::text, current_period_end::text
       FROM subscriptions
       WHERE workspace_id = $1 AND status = 'active'
         AND now() >= current_period_start AND now() < current_period_end
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId]
    );
    // §6.5 — the active count (and therefore `projected`) matches admission:
    // concurrency-blocked runs are not active.
    const active = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM runs
       WHERE workspace_id = $1 AND status IN ('queued','running','waiting','paused')
         AND concurrency_block = false`,
      [workspaceId]
    );

    const subRow = sub.rows[0];
    const planId = subRow?.plan_id ??
      (await query<{ plan_id: string }>('SELECT plan_id FROM workspaces WHERE id = $1', [workspaceId])).rows[0]?.plan_id ??
      'free';
    const plan = getPlanDefinition(planId);

    const used = subRow?.runs_consumed ?? 0;
    const limit = plan?.run_limit ?? null;
    const activeN = active.rows[0]?.n ?? 0;
    const projected = limit !== null ? used + activeN : null;
    // §3.3: Pro/Studio activate overage past the included allowance (plans
    // with a positive overage_rate_cents); Free has a hard cap and Community
    // is unlimited — both carry zero overage here. The definitive overage
    // count lands on the invoice at billing_period_close.
    const overage =
      plan !== undefined && plan.run_limit !== null && (plan.overage_rate_cents ?? 0) > 0
        ? Math.max(0, used - plan.run_limit)
        : 0;

    return {
      data: {
        used,
        overage,
        active: activeN,
        limit,
        projected,
        reset_at: subRow?.current_period_end ?? null,
        plan: plan ? { id: plan.id, name: plan.name, price_cents: plan.price_cents } : { id: planId },
      },
    };
  });

  // Subscription + plan info
  fastify.get('/subscription', { preHandler: requireAuth }, async (request) => {
    const workspaceId = request.auth!.workspaceId;
    const sub = await query(
      `SELECT s.id, s.plan_id, s.status, s.current_period_start::text, s.current_period_end::text,
              s.cancel_at_period_end, p.name AS plan_name, p.price_cents,
              p.run_limit, p.seat_limit, p.overage_rate_cents, p.run_history_days,
              p.audit_retention_days, p.workflow_timeout_hours, p.rate_limit_per_min,
              p.concurrency_limit, p.feature_flags
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.workspace_id = $1
       ORDER BY s.created_at DESC LIMIT 1`,
      [workspaceId]
    );
    if (sub.rows.length === 0) {
      const ws = await query<{ plan_id: string }>('SELECT plan_id FROM workspaces WHERE id = $1', [workspaceId]);
      const plan = getPlanDefinition(ws.rows[0]?.plan_id ?? 'free');
      return {
        data: { plan_id: ws.rows[0]?.plan_id ?? 'free', status: 'active', plan: plan ?? null },
      };
    }
    return { data: sub.rows[0] };
  });

  // Change plan (§9) — Owner-only (RBAC: manage_subscription). The plan row's
  // feature_flags re-evaluate immediately; entitlement caching is read-time.
  fastify.post('/subscription', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_SUBSCRIPTION)],
  }, async (request, reply) => {
    const { plan_id } = (request.body ?? {}) as { plan_id?: string };
    const workspaceId = request.auth!.workspaceId;
    if (!plan_id) {
      return reply.code(400).send({ error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'plan_id is required' } });
    }
    const plan = getPlanDefinition(plan_id);
    if (!plan || plan.id === 'demo') {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'unknown plan (choose free, pro, or studio)' },
      });
    }

    await query(
      `UPDATE subscriptions SET plan_id = $1, updated_at = now() WHERE workspace_id = $2`,
      [plan_id, workspaceId]
    );
    await query(
      `UPDATE workspaces SET plan_id = $1, updated_at = now() WHERE id = $2`,
      [plan_id, workspaceId]
    );
    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.PLAN_CHANGED, 'workspace', workspaceId, { plan_id });
    return {
      data: { plan_id, plan: { id: plan.id, name: plan.name, price_cents: plan.price_cents } },
    };
  });

  // Invoices (§9) — Owner-only billing surface (§3.3 RBAC), newest first.
  fastify.get('/invoices', { preHandler: [requireAuth, requirePermission(PERMISSIONS.MANAGE_SUBSCRIPTION)] }, async (request) => {
    const result = await query(
      `SELECT id, period_start::text, period_end::text, plan_base_cents, overage_runs,
              overage_cents, total_cents, status, created_at::text
       FROM invoices WHERE workspace_id = $1 ORDER BY period_start DESC LIMIT 24`,
      [request.auth!.workspaceId]
    );
    return { data: result.rows };
  });
}
