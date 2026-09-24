/**
 * Dashboard stats — counts shown on the SPA landing page.
 */

import type { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

export async function dashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/dashboard', { preHandler: requireAuth }, async (request) => {
    const workspaceId = request.auth!.workspaceId;

    const [workflows, runs, approvals, notifications, recentRuns, recentWorkflows] = await Promise.all([
      query<{ n: number }>('SELECT count(*)::int AS n FROM workflows WHERE workspace_id = $1 AND is_enabled = true', [workspaceId]),
      query<{ n: number }>('SELECT count(*)::int AS n FROM runs WHERE workspace_id = $1', [workspaceId]),
      query<{ n: number }>(
        `SELECT count(*)::int AS n FROM approval_tasks a
         JOIN runs r ON r.id = a.run_id
         WHERE r.workspace_id = $1 AND a.status = 'pending'`,
        [workspaceId]
      ),
      query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND is_read = false', [workspaceId]),
      query(
        `SELECT r.id, r.status, r.created_at::text, r.finished_at::text, r.trigger_id, w.name AS workflow_name
         FROM runs r JOIN workflows w ON w.id = r.workflow_id
         WHERE r.workspace_id = $1
         ORDER BY r.created_at DESC LIMIT 8`,
        [workspaceId]
      ),
      query(
        `SELECT w.id, w.name, w.updated_at::text
         FROM workflows w WHERE w.workspace_id = $1 AND w.is_enabled = true
         ORDER BY w.updated_at DESC LIMIT 6`,
        [workspaceId]
      ),
    ]);

    return {
      data: {
        workflow_count: workflows.rows[0]?.n ?? 0,
        run_count: runs.rows[0]?.n ?? 0,
        pending_approval_count: approvals.rows[0]?.n ?? 0,
        unread_notification_count: notifications.rows[0]?.n ?? 0,
        recent_runs: recentRuns.rows,
        recent_workflows: recentWorkflows.rows,
      },
    };
  });
}
