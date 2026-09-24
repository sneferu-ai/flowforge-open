/**
 * Workflow routes — CRUD, versions, enable/disable, promotion, validation.
 *
 * `createWorkflowFromManifest` is the single creation chokepoint shared by
 * POST /workflows, POST /workflows/from-template, and the seeder.
 */

import type { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validateManifest, parseManifest, type Manifest } from '@flowforge/engine';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS, ERROR_CODES, PERMISSIONS } from '@flowforge/shared';
import { computeNextFire } from '../lib/cron.js';
import { parsePageParams } from '../lib/pagination.js';

export interface CreateWorkflowParams {
  workspaceId: string;
  name: string;
  summary?: string | null;
  manifestYaml: string;
  manifest: Manifest;
  actorId: string | null;
  slug?: string | null;
}

export interface CreatedWorkflow {
  workflowId: string;
  versionId: string;
  versionNum: number;
  slug: string;
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'workflow';
}

/** §9 validate contract — `{ valid, errors, warnings }` for both spellings. */
function validateManifestResponse(manifest: string) {
  if (typeof manifest !== 'string' || !manifest.trim()) {
    return {
      data: {
        valid: false,
        errors: [{ code: ERROR_CODES.VALIDATION_ERROR, message: 'manifest is required', path: 'manifest' }],
        warnings: [],
      },
    };
  }
  const result = validateManifest(manifest);
  return { data: { valid: result.valid, errors: result.errors, warnings: result.warnings } };
}

async function nextFreeSlug(workspaceId: string, desired: string): Promise<string> {
  const existing = await query<{ slug: string }>(
    'SELECT slug FROM workflows WHERE workspace_id = $1 AND slug LIKE $2',
    [workspaceId, `${desired}%`]
  );
  const taken = new Set(existing.rows.map((r) => r.slug));
  if (!taken.has(desired)) return desired;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${desired}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${desired}-${Date.now().toString(36)}`;
}

/** Create the triggers declared in `manifest`, keeping existing matching ones. */
async function reconcileTriggers(
  workspaceId: string,
  workflowId: string,
  manifest: Manifest,
  slug: string,
  auditActor: string | null
): Promise<void> {
  const existingRows = await query<{ id: string; type: string; config: Record<string, unknown> }>(
    'SELECT id, type, config FROM triggers WHERE workflow_id = $1',
    [workflowId]
  );
  // Webhook paths derive from the workflow slug (§9), so duplicate template
  // instances (invoice-chaser, invoice-chaser-2, …) each get a unique path.
  const desiredWebhookPaths = new Set(
    manifest.triggers
      .filter((t) => t.type === 'webhook')
      .map((t) => String(t.path ?? slug))
  );
  const desiredTypes = new Set<string>(manifest.triggers.map((t) => t.type as string));

  // Disable triggers that no longer exist in the manifest (never delete —
  // run history references them via trigger_id).
  for (const existing of existingRows.rows) {
    const stillThere =
      desiredTypes.has(existing.type) &&
      (existing.type !== 'webhook' || desiredWebhookPaths.has(existing.config.path as string));
    if (!stillThere) {
      await query('UPDATE triggers SET is_enabled = false, updated_at = now() WHERE id = $1', [existing.id]);
    }
  }

  // Ensure every declared trigger exists with a derived path and next fire.
  for (const trigger of manifest.triggers) {
    const wPath = trigger.type === 'webhook' ? String(trigger.path ?? slug) : null;
    const match = await query<{ id: string }>(
      `SELECT id FROM triggers WHERE workflow_id = $1 AND type = $2
       AND (($3::text IS NULL AND config->>'path' IS NULL) OR config->>'path' = $3)`,
      [workflowId, trigger.type, wPath]
    );
    const nextFire = trigger.type === 'schedule' && trigger.cron
      ? computeNextFire(trigger.cron)
      : null;

    // §5.1/§6.4 — webhook auth/path/sync config lives in triggers.config.
    // The path is ALWAYS stored as data (derived from the slug when the
    // manifest omits it), or the /hooks route could never match the trigger.
    const storedConfig: Record<string, unknown> =
      trigger.type === 'webhook'
        ? { ...trigger, path: String(trigger.path ?? slug) }
        : { ...trigger };

    let triggerId: string;
    if (match.rows.length > 0) {
      triggerId = match.rows[0].id;
    } else {
      // §6.4 path uniqueness — webhook paths are unique per workspace; a path
      // owned by another trigger is a conflict (explicit manifest paths can
      // collide while slugs cannot).
      if (trigger.type === 'webhook') {
        const path = String(trigger.path ?? slug);
        const conflict = await query(
          `SELECT t.id FROM triggers t
           JOIN workflows w ON w.id = t.workflow_id
           WHERE w.workspace_id = $1 AND t.type = 'webhook' AND t.config ->> 'path' = $2
           LIMIT 1`,
          [workspaceId, path]
        );
        if (conflict.rows.length > 0) {
          throw new Error(`webhook_path_conflict: ${path}`);
        }
      }
      const created = await query<{ id: string }>(
        `INSERT INTO triggers (workflow_id, type, config, next_fire_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [workflowId, trigger.type, JSON.stringify(storedConfig), nextFire]
      );
      triggerId = created.rows[0].id;
    }

    await query(
      `UPDATE triggers SET config = $1, is_enabled = true, next_fire_at = $2, updated_at = now()
       WHERE id = $3`,
      [JSON.stringify(storedConfig), nextFire, triggerId]
    );
  }
  void auditActor;
}

export async function createWorkflowFromManifest(params: CreateWorkflowParams): Promise<CreatedWorkflow> {
  const { workspaceId, name, summary, manifestYaml, manifest } = params;
  const slug = params.slug || (await nextFreeSlug(workspaceId, slugify(name)));

  const wfResult = await query<{ id: string }>(
    'INSERT INTO workflows (workspace_id, name, summary, slug) VALUES ($1, $2, $3, $4) RETURNING id',
    [workspaceId, name, summary || null, slug]
  );
  const workflowId = wfResult.rows[0].id;

  const versionResult = await query<{ id: string; version_num: number }>(
    `INSERT INTO workflow_versions (workflow_id, version_num, manifest_yaml, manifest_json, is_current)
     VALUES ($1, 1, $2, $3, true) RETURNING id, version_num`,
    [workflowId, manifestYaml, JSON.stringify(manifest)]
  );

  await query('UPDATE workflows SET current_version_id = $1 WHERE id = $2', [
    versionResult.rows[0].id,
    workflowId,
  ]);

  await reconcileTriggers(workspaceId, workflowId, manifest, slug, params.actorId);

  return {
    workflowId,
    versionId: versionResult.rows[0].id,
    versionNum: versionResult.rows[0].version_num,
    slug,
  };
}

export async function workflowRoutes(fastify: FastifyInstance): Promise<void> {
  // List workflows
  fastify.get('/workflows', { preHandler: requireAuth }, async (request) => {
    const { limit, offset } = parsePageParams(request.query as Record<string, unknown>, {
      defaultLimit: 200,
      maxLimit: 500,
    });
    const includeDisabled = (request.query as Record<string, string>).include_disabled === 'true';
    const result = await query(
      `SELECT w.id, w.name, w.summary, w.slug, w.is_enabled, w.created_at::text, w.updated_at::text,
              (SELECT version_num FROM workflow_versions WHERE workflow_id = w.id AND is_current = true LIMIT 1) as current_version,
              (SELECT count(*)::int FROM runs r WHERE r.workflow_id = w.id) as run_count,
              (SELECT count(*)::int FROM triggers t WHERE t.workflow_id = w.id AND t.is_enabled = true) as trigger_count
       FROM workflows w
       WHERE w.workspace_id = $1 ${includeDisabled ? '' : 'AND w.is_enabled = true'}
       ORDER BY w.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [request.auth!.workspaceId, limit, offset]
    );
    return { data: result.rows };
  });

  // Validate a manifest without persisting it
  fastify.post('/workflows/validate', { preHandler: requireAuth }, async (request) => {
    const { manifest } = request.body as { manifest: string };
    return validateManifestResponse(manifest);
  });

  // §9 — workspace-scoped spelling of the validate endpoint.
  fastify.post('/workflows/:id/validate', { preHandler: requireAuth }, async (request) => {
    const { manifest } = request.body as { manifest: string };
    return validateManifestResponse(manifest);
  });

  // Get workflow
  fastify.get('/workflows/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await query(
      `SELECT w.id, w.name, w.summary, w.slug, w.is_enabled, w.created_at::text, w.updated_at::text,
              w.current_version_id,
              (SELECT version_num FROM workflow_versions WHERE workflow_id = w.id AND is_current = true LIMIT 1) as current_version
       FROM workflows w
       WHERE w.id = $1 AND w.workspace_id = $2`,
      [id, request.auth!.workspaceId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.WORKFLOW_NOT_FOUND, message: 'Workflow not found' } });
    }
    return { data: result.rows[0] };
  });

  // Create workflow
  fastify.post('/workflows', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.CREATE_EDIT_WORKFLOWS)],
  }, async (request, reply) => {
    const { name, summary, manifest_yaml, manifest } = request.body as {
      name: string;
      summary?: string;
      manifest_yaml?: string;
      manifest?: string;
    };
    // Accept the raw YAML as `manifest` (§9) or `manifest_yaml` (legacy spelling).
    const yaml = manifest ?? manifest_yaml;

    if (!name || !yaml) {
      return reply.code(400).send({ error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'name and manifest (YAML string) are required' } });
    }

    const validation = validateManifest(yaml);
    if (!validation.valid) {
      return reply.code(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Manifest validation failed',
          details: validation.errors,
        },
      });
    }

    const parsed = parseManifest(yaml);
    const workspaceId = request.auth!.workspaceId;

    try {
      const created = await createWorkflowFromManifest({
        workspaceId,
        name,
        summary: summary || parsed.summary || null,
        manifestYaml: yaml,
        manifest: parsed,
        actorId: request.auth!.user.id,
      });

      await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.WORKFLOW_CREATED, 'workflow', created.workflowId, {
        name,
        slug: created.slug,
        version: 1,
      });

      return {
        data: {
          id: created.workflowId,
          name,
          slug: created.slug,
          summary: summary || parsed.summary || null,
          version: created.versionNum,
          version_id: created.versionId,
        },
      };
    } catch (err) {
      if ((err as Error).message.includes('webhook_path_conflict')) {
        return reply.code(400).send({
          error: { code: ERROR_CODES.WEBHOOK_PATH_CONFLICT, message: (err as Error).message },
        });
      }
      throw err;
    }
  });

  // Update workflow (metadata or a new manifest version)
  fastify.put('/workflows/:id', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.CREATE_EDIT_WORKFLOWS)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, summary, is_enabled, slug, manifest } = request.body as {
      name?: string;
      summary?: string;
      is_enabled?: boolean;
      slug?: string;
      manifest?: string;
    };

    const workspaceId = request.auth!.workspaceId;

    const existing = await query<{ name: string; slug: string }>(
      'SELECT name, slug FROM workflows WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.WORKFLOW_NOT_FOUND, message: 'Workflow not found' } });
    }

    let versionNum: number | null = null;
    let versionId: string | null = null;
    let finalSlug = existing.rows[0].slug;

    if (typeof manifest === 'string' && manifest.trim()) {
      const validation = validateManifest(manifest);
      if (!validation.valid) {
        return reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Manifest validation failed',
            details: validation.errors,
          },
        });
      }
      const parsed = parseManifest(manifest);
      const maxRow = await query<{ max_version: number }>(
        'SELECT COALESCE(MAX(version_num), 0)::int as max_version FROM workflow_versions WHERE workflow_id = $1',
        [id]
      );
      const nextVersion = maxRow.rows[0].max_version + 1;

      // A manifest supplied here creates a DRAFT version (§9): it is not
      // promoted until POST /promote/:versionId. This keeps in-flight runs on
      // their pinned version and keeps trigger reconciliation promote-time.
      const newVersionResult = await query<{ id: string }>(
        `INSERT INTO workflow_versions (workflow_id, version_num, manifest_yaml, manifest_json, is_current)
         VALUES ($1, $2, $3, $4, false) RETURNING id`,
        [id, nextVersion, manifest, JSON.stringify(parsed)]
      );
      versionNum = nextVersion;
      versionId = newVersionResult.rows[0].id;
    }

    if (typeof slug === 'string' && slug.trim()) {
      finalSlug = await nextFreeSlug(workspaceId, slugify(slug));
      // Webhook trigger paths are derived from the workflow slug (§9 promotion
      // semantics); §5.1 stores the derived path in triggers.config.
      if (finalSlug !== existing.rows[0].slug) {
        await query(
          `UPDATE triggers t
           SET config = jsonb_set(config, '{path}', to_jsonb($2::text)), updated_at = now()
           FROM workflows w
           WHERE t.workflow_id = w.id AND w.workspace_id = $1
             AND t.type = 'webhook' AND t.config ->> 'path' = $3`,
          [workspaceId, finalSlug, existing.rows[0].slug]
        );
      }
    }

    await query(
      `UPDATE workflows SET
         name = COALESCE($1, name),
         slug = $2,
         is_enabled = COALESCE($3, is_enabled),
         updated_at = now()
       WHERE id = $4`,
      [name || null, finalSlug, is_enabled ?? null, id]
    );
    if (summary !== undefined) {
      await query('UPDATE workflows SET summary = $1, updated_at = now() WHERE id = $2', [summary || null, id]);
    }

    // Disable triggers when the workflow is disabled (in-flight runs complete).
    if (is_enabled === false) {
      await query('UPDATE triggers SET is_enabled = false WHERE workflow_id = $1', [id]);
    } else if (is_enabled === true) {
      await query(
        `UPDATE triggers SET is_enabled = true WHERE workflow_id = $1 AND config->>'type' IS NOT NULL`,
        [id]
      );
    }

    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.WORKFLOW_UPDATED, 'workflow', id, {
      version: versionNum ?? null,
      name: name ?? null,
      is_enabled: is_enabled ?? null,
    });

    return {
      data: {
        id,
        name: name || existing.rows[0].name,
        slug: finalSlug,
        version: versionNum,
        version_id: versionId,
        // A manifest change lands as a DRAFT awaiting promotion (§9).
        draft: versionNum !== null,
      },
    };
  });

  // Delete workflow (soft delete — set is_enabled = false; runs history preserved)
  fastify.delete('/workflows/:id', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.DELETE_WORKFLOWS)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = request.auth!.workspaceId;

    const result = await query(
      'UPDATE workflows SET is_enabled = false, updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [id, workspaceId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.WORKFLOW_NOT_FOUND, message: 'Workflow not found' } });
    }

    await query('UPDATE triggers SET is_enabled = false WHERE workflow_id = $1', [id]);

    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.WORKFLOW_DELETED, 'workflow', id, {});
    return { data: { ok: true } };
  });

  // Get workflow manifest (current version)
  fastify.get('/workflows/:id/manifest', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await query<{ manifest_yaml: string; version_num: number }>(
      `SELECT manifest_yaml, version_num FROM workflow_versions
       WHERE workflow_id = $1 AND is_current = true`,
      [id]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.WORKFLOW_NOT_FOUND, message: 'Workflow or version not found' } });
    }
    return { data: result.rows[0] };
  });

  // List versions — includes manifest_yaml so the web UI can render the
  // §10.2 side-by-side YAML diff without a second fetch per version.
  fastify.get('/workflows/:id/versions', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await query(
      `SELECT id, version_num, is_current, created_at::text, manifest_yaml
       FROM workflow_versions WHERE workflow_id = $1 ORDER BY version_num DESC`,
      [id]
    );
    return { data: result.rows };
  });

  // Create a new version (draft) without promoting it (§9 API contract).
  fastify.post('/workflows/:id/versions', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.CREATE_EDIT_WORKFLOWS)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { manifest } = request.body as { manifest: string };
    const workspaceId = request.auth!.workspaceId;

    if (typeof manifest !== 'string' || !manifest.trim()) {
      return reply.code(400).send({
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'manifest (YAML string) is required' },
      });
    }
    const wf = await query('SELECT id FROM workflows WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
    if (wf.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.WORKFLOW_NOT_FOUND, message: 'Workflow not found' } });
    }
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return reply.code(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Manifest validation failed',
          details: validation.errors,
        },
      });
    }
    const parsed = parseManifest(manifest);
    const maxRow = await query<{ max_version: number }>(
      'SELECT COALESCE(MAX(version_num), 0)::int as max_version FROM workflow_versions WHERE workflow_id = $1',
      [id]
    );
    const nextVersion = maxRow.rows[0].max_version + 1;
    const inserted = await query<{ id: string }>(
      `INSERT INTO workflow_versions (workflow_id, version_num, manifest_yaml, manifest_json, is_current)
       VALUES ($1, $2, $3, $4, false) RETURNING id`,
      [id, nextVersion, manifest, JSON.stringify(parsed)]
    );

    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.WORKFLOW_UPDATED, 'workflow', id, {
      version: nextVersion,
      draft: true,
    });

    return reply.code(201).send({
      data: { id: inserted.rows[0].id, version_num: nextVersion, is_current: false },
    });
  });

  // Promote a version (§9 — rollback supported; triggers reconciled)
  fastify.post('/workflows/:id/promote/:versionId', {
    preHandler: [requireAuth, requirePermission(PERMISSIONS.CREATE_EDIT_WORKFLOWS)],
  }, async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
    const workspaceId = request.auth!.workspaceId;

    const wf = await query<{ id: string; slug: string }>('SELECT id, slug FROM workflows WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
    if (wf.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.WORKFLOW_NOT_FOUND, message: 'Workflow not found' } });
    }
    const version = await query<{ manifest_json: Record<string, unknown>; version_num: number }>(
      'SELECT manifest_json, version_num FROM workflow_versions WHERE id = $1 AND workflow_id = $2',
      [versionId, id]
    );
    if (version.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Version not found' } });
    }

    await query('UPDATE workflow_versions SET is_current = false WHERE workflow_id = $1', [id]);
    await query('UPDATE workflow_versions SET is_current = true WHERE id = $1', [versionId]);
    await query('UPDATE workflows SET current_version_id = $1, updated_at = now() WHERE id = $2', [versionId, id]);

    const manifest = version.rows[0].manifest_json as unknown as Manifest;
    await reconcileTriggers(workspaceId, id, manifest, wf.rows[0].slug, request.auth!.user.id);

    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.WORKFLOW_UPDATED, 'workflow', id, {
      promoted_version: version.rows[0].version_num,
    });

    return {
      data: { workflow: { id }, promoted_version: version.rows[0].version_num },
    };
  });
}
