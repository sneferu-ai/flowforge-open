/**
 * Template gallery (§3.2, §12 Unit 12) — the five freelancer workflow
 * templates as validated YAML manifests, served to the SPA and creatable
 * via POST /workflows/from-template.
 */

import type { FastifyInstance } from 'fastify';
import { validateManifest } from '@flowforge/engine';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { createWorkflowFromManifest } from './workflows.js';
import { AUDIT_ACTIONS, PERMISSIONS } from '@flowforge/shared';
import { emitAuditEvent } from '../audit/emit.js';

export interface TemplateDef {
  id: string;
  name: string;
  summary: string;
  icon: string;
  workflow: string; // one of the five target workflows
  manifest: string;
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'invoice-chaser',
    name: 'Invoice Chaser',
    summary: 'Weekday mornings, find invoices 14+ days overdue, send a reminder; >30 days asks for approval before escalating.',
    icon: 'receipt',
    workflow: 'invoice_chaser',
    manifest: `api_version: flowforge/v1
name: invoice-chaser
summary: Weekday sweep for invoices 14+ days overdue, escalate >30 days
allow_concurrent: false
inputs:
  - name: escalation_threshold
    type: integer
    default: 30
triggers:
  - type: schedule
    cron: "30 9 * * 1-5"
    timezone: UTC
defaults:
  retry: { attempts: 3, backoff: exponential, base_ms: 500, max_ms: 30000, jitter: true }
  timeout_seconds: 60
steps:
  - id: fetch_overdue
    type: http
    timeout_seconds: 15
    with:
      method: GET
      url: "{{ env.FF_APP_URL }}/api/v1/demo/invoices?status=overdue"
    on_error: abort
  - id: per_invoice
    type: for_each
    with:
      over: "steps.fetch_overdue.output.body.invoices"
      limit: 100
    steps:
      - id: send_reminder
        type: notify
        with:
          channel: email
          to: "{{ loop.item.client_email }}"
          subject: "Invoice {{ loop.item.number }} — {{ loop.item.days_overdue }} days overdue"
          body: "Hi {{ loop.item.client_name }}, a friendly nudge that invoice {{ loop.item.number }} is now {{ loop.item.days_overdue }} days overdue."
      - id: check_escalation
        type: condition
        with:
          when: "loop.item.days_overdue > inputs.escalation_threshold"
          then:
            - id: request_approval
              type: manual_approval
              with:
                prompt: "Approve escalation email for invoice {{ loop.item.number }} ({{ loop.item.days_overdue }} days overdue)?"
                timeout_seconds: 86400
                on_timeout: skip
            - id: send_escalation_email
              type: notify
              if: "steps.request_approval.output.decision == 'approved'"
              with:
                channel: email
                to: "{{ loop.item.client_email }}"
                subject: "URGENT: Invoice {{ loop.item.number }} — {{ loop.item.days_overdue }} days overdue"
                body: "Hi {{ loop.item.client_name }}, this is an urgent reminder that invoice {{ loop.item.number }} is now {{ loop.item.days_overdue }} days overdue. Please contact us immediately."
  - id: log_completion
    type: log
    with:
      level: info
      message: "Pursued {{ len(steps.per_invoice.output.results) }} invoices"
`,
  },
  {
    id: 'client-onboarding',
    name: 'Client Onboarding',
    summary: 'A webhook fires when a new client form posts; the welcome sequence replies synchronously and emails the client.',
    icon: 'user-plus',
    workflow: 'client_onboarding',
    manifest: `api_version: flowforge/v1
name: client-onboarding
summary: Webhook-triggered welcome sequence for newly signed clients
inputs:
  - name: client_email
    type: string
    required: true
  - name: client_name
    type: string
    required: true
triggers:
  - type: webhook
    auth_mode: none
    sync: true
    input_mapping:
      client_email: "{{ trigger.payload.email }}"
      client_name: "{{ trigger.payload.name }}"
steps:
  - id: send_welcome
    type: notify
    with:
      channel: email
      to: "{{ inputs.client_email }}"
      subject: "Welcome aboard, {{ inputs.client_name }}"
      body: "Hi {{ inputs.client_name }}, thanks for signing. Your onboarding checklist is on its way."
  - id: acknowledge
    type: reply
    with:
      status: 200
      headers:
        Content-Type: application/json
      body: '{"status":"queued","email":"{{ inputs.client_email }}"}'
`,
  },
  {
    id: 'order-follow-up',
    name: 'Order Follow-Up',
    summary: 'On schedule, find stalled orders and nudge the client; orders stalled past your threshold require an approval.',
    icon: 'package',
    workflow: 'order_follow_up',
    manifest: `api_version: flowforge/v1
name: order-follow-up
summary: Find stuck orders, notify clients, escalate long stalls
inputs:
  - name: stall_threshold_hours
    type: integer
    default: 48
triggers:
  - type: schedule
    cron: "0 08 * * 1-5"
    timezone: UTC
steps:
  - id: fetch_stalled
    type: http
    timeout_seconds: 15
    with:
      method: GET
      url: "{{ env.FF_APP_URL }}/api/v1/demo/orders?status=stalled"
    on_error: abort
  - id: per_order
    type: for_each
    with:
      over: "steps.fetch_stalled.output.body.orders"
      limit: 100
    steps:
      - id: nudge_client
        type: notify
        with:
          channel: email
          to: "{{ loop.item.client_email }}"
          subject: "A quick note about order {{ loop.item.number }}"
          body: "Hi {{ loop.item.client_name }}, your order {{ loop.item.number }} is waiting on something. A quick reply keeps it moving."
      - id: check_long_stall
        type: condition
        with:
          when: "loop.item.stalled_hours > inputs.stall_threshold_hours"
          then:
            - id: request_followup_approval
              type: manual_approval
              with:
                prompt: "Order {{ loop.item.number }} has been stalled {{ loop.item.stalled_hours }}h. Escalate to a call with {{ loop.item.client_name }}?"
                timeout_seconds: 86400
                on_timeout: skip
  - id: log_sweep
    type: log
    with:
      level: info
      message: "Order sweep complete for {{ len(steps.per_order.output.results) }} stalled orders"
`,
  },
  {
    id: 'review-request',
    name: 'Review Request',
    summary: 'After a job closes, ask the client for a review and log the request for your own records.',
    icon: 'star',
    workflow: 'review_request',
    manifest: `api_version: flowforge/v1
name: review-request
summary: Ask recently-finished clients for a review
triggers:
  - type: schedule
    cron: "0 10 * * 1"
    timezone: UTC
steps:
  - id: fetch_clients
    type: http
    timeout_seconds: 15
    with:
      method: GET
      url: "{{ env.FF_APP_URL }}/api/v1/demo/clients"
    on_error: abort
  - id: per_client
    type: for_each
    with:
      over: "steps.fetch_clients.output.body.clients"
      limit: 100
    steps:
      - id: ask_for_review
        type: notify
        with:
          channel: email
          to: "{{ loop.item.email }}"
          subject: "How did we do on {{ loop.item.last_project }}?"
          body: "Hi {{ loop.item.name }}, it was a pleasure working on {{ loop.item.last_project }}. If you have two minutes, a review would mean a lot."
  - id: log_review_run
    type: log
    with:
      level: info
      message: "Sent review requests to {{ len(steps.per_client.output.results) }} clients"
`,
  },
  {
    id: 'renewal-reminder',
    name: 'Renewal Reminder',
    summary: 'A configurable number of days before contract renewal, email the client and log the entry.',
    icon: 'rotate-cw',
    workflow: 'renewal_reminder',
    manifest: `api_version: flowforge/v1
name: renewal-reminder
summary: Remind clients and the team ahead of contract renewals
inputs:
  - name: days_before
    type: integer
    default: 30
triggers:
  - type: schedule
    cron: "0 09 * * 3"
    timezone: UTC
steps:
  - id: compute_renewal
    type: transform
    with:
      set:
        days_left: "{{ inputs.days_before }}"
  - id: check_window
    type: condition
    with:
      when: "steps.compute_renewal.output.days_left > 0"
      then:
        - id: email_client
          type: notify
          with:
            channel: email
            to: "billing@acme.test"
            subject: "Your contract renews in {{ steps.compute_renewal.output.days_left }} days"
            body: "Heads up: your retainer renews in {{ steps.compute_renewal.output.days_left }} days. Nothing to do — just a friendly reminder."
  - id: log_renewal
    type: log
    with:
      level: info
      message: "Renewal reminder sent {{ steps.compute_renewal.output.days_left }} days ahead"
`,
  },
];

async function assertTemplatesValid(): Promise<void> {
  for (const t of TEMPLATES) {
    const result = validateManifest(t.manifest);
    if (!result.valid) {
      throw new Error(
        `Template ${t.id} is invalid: ${result.errors.map((e) => `${e.code}: ${e.message}`).join('; ')}`
      );
    }
  }
}

export async function templateRoutes(fastify: FastifyInstance): Promise<void> {
  await assertTemplatesValid();

  // List templates (manifests included — they are open-source demo content).
  fastify.get('/templates', { preHandler: requireAuth }, async () => {
    return {
      data: TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        summary: t.summary,
        icon: t.icon,
        workflow: t.workflow,
        manifest: t.manifest,
      })),
    };
  });

  // Create a workflow from a template.
  fastify.post('/workflows/from-template', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.CREATE_EDIT_WORKFLOWS)],
  }, async (request, reply) => {
    const { template_id, name } = request.body as { template_id: string; name?: string };
    const template = TEMPLATES.find((t) => t.id === template_id);
    if (!template) {
      return reply.code(404).send({
        error: { code: 'not_found', message: `Unknown template: ${template_id}` },
      });
    }

    const manifest = (await import('@flowforge/engine')).parseManifest(template.manifest);
    // Default to the human template name the user picked; an explicit `name`
    // still wins.
    const desiredName = name?.trim() || template.name;

    try {
      const created = await createWorkflowFromManifest({
        workspaceId: request.auth!.workspaceId,
        name: desiredName,
        summary: manifest.summary || template.summary,
        manifestYaml: template.manifest,
        manifest,
        actorId: request.auth!.user.id,
      });
      await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.WORKFLOW_CREATED, 'workflow', created.workflowId, {
        name: desiredName,
        template: template_id,
      });
      return {
        data: {
          id: created.workflowId,
          name: desiredName,
          summary: manifest.summary || template.summary,
          version: created.versionNum,
          version_id: created.versionId,
          template: template_id,
        },
      };
    } catch (err) {
      if ((err as Error).message.includes('duplicate key')) {
        return reply.code(409).send({
          error: { code: 'webhook_path_conflict', message: `A workflow named '${desiredName}' already exists (webhook path conflict)` },
        });
      }
      throw err;
    }
  });
}
