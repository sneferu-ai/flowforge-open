/**
 * Credential routes — CRUD for stored credentials (§8.3 vault).
 *
 * Deletion guard (§19): deleting a credential that an enabled workflow's
 * current manifest still references fails with 409 credential_in_use — the
 * reference is either the http step's `credential:` field or a `secrets.<name>`
 * expression binding.
 */

import type { FastifyInstance } from 'fastify';
import { query } from '../db/pool.js';
import { requireAuth, requireFeature } from '../middleware/auth.js';
import { encryptWithMeta } from '../crypto.js';
import { ERROR_CODES } from '@flowforge/shared';
import { emitAuditEvent } from '../audit/emit.js';
import { AUDIT_ACTIONS } from '@flowforge/shared';

const vaultGate = [requireAuth, requireFeature('credential_vault')];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find enabled workflows whose CURRENT manifest references the credential:
 *  - `credential: <name>` (http step legacy credential field), or
 *  - `secrets.<name>` expression references.
 * Returns the referencing workflow names for the 409 message.
 */
export async function findWorkflowsReferencingCredential(
  workspaceId: string,
  credentialName: string
): Promise<string[]> {
  // Cheap SQL prefilter, then an exact token match in JS.
  const candidates = await query<{ name: string; manifest_yaml: string }>(
    `SELECT w.name, v.manifest_yaml
     FROM workflows w
     JOIN workflow_versions v ON v.workflow_id = w.id AND v.is_current = true
     WHERE w.workspace_id = $1 AND w.is_enabled = true
       AND v.manifest_yaml ILIKE '%' || $2 || '%'`,
    [workspaceId, credentialName]
  );
  if (candidates.rows.length === 0) return [];

  const escaped = escapeRegExp(credentialName);
  const secretsRef = new RegExp(`(?<![A-Za-z0-9_])secrets\\.${escaped}(?![A-Za-z0-9_])`);
  const credentialField = new RegExp(`(^|[\\s,{])credential\\s*:\\s*["']?${escaped}["']?(?=[\\s,}\\n]|$)`, 'm');

  return candidates.rows
    .filter((row) => secretsRef.test(row.manifest_yaml) || credentialField.test(row.manifest_yaml))
    .map((row) => row.name);
}

export async function credentialRoutes(fastify: FastifyInstance): Promise<void> {
  // List credentials (names only — never return values)
  fastify.get('/credentials', { preHandler: vaultGate }, async (request) => {
    const result = await query(
      `SELECT id, name, type, created_at::text
       FROM credentials WHERE workspace_id = $1 ORDER BY name`,
      [request.auth!.workspaceId]
    );
    return { data: result.rows };
  });

  // Create credential — records the §8.3 rotation columns (nonce, key_version).
  fastify.post('/credentials', { preHandler: vaultGate }, async (request, reply) => {
    const { name, type, value } = request.body as { name: string; type: string; value: string };
    if (!name || !type || !value) {
      return reply.code(400).send({ error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'name, type, and value are required' } });
    }

    const sealed = encryptWithMeta(value, request.auth!.workspaceId);
    try {
      const result = await query<{ id: string }>(
        'INSERT INTO credentials (workspace_id, name, type, value_enc, nonce, key_version) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [request.auth!.workspaceId, name, type, sealed.valueEnc, sealed.nonce, sealed.keyVersion]
      );
      await emitAuditEvent(request.auth!.workspaceId, request.auth!.user.id, AUDIT_ACTIONS.CREDENTIAL_CREATED, 'credential', result.rows[0].id, { name, type });
      return { data: { id: result.rows[0].id, name, type } };
    } catch (err) {
      if ((err as Error).message.includes('unique')) {
        return reply.code(409).send({ error: { code: ERROR_CODES.CONFLICT, message: 'Credential name already exists' } });
      }
      throw err;
    }
  });

  // Delete credential — 409 credential_in_use when an enabled workflow's
  // current manifest still references the credential name (§19).
  fastify.delete('/credentials/:id', { preHandler: vaultGate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspaceId = request.auth!.workspaceId;

    const existing = await query<{ name: string }>(
      'SELECT name FROM credentials WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Credential not found' } });
    }
    const name = existing.rows[0].name;

    const referencing = await findWorkflowsReferencingCredential(workspaceId, name);
    if (referencing.length > 0) {
      return reply.code(409).send({
        error: {
          code: ERROR_CODES.CREDENTIAL_IN_USE,
          message: `Credential '${name}' is referenced by enabled workflow(s): ${referencing.join(', ')}`,
        },
      });
    }

    await query('DELETE FROM credentials WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
    await emitAuditEvent(workspaceId, request.auth!.user.id, AUDIT_ACTIONS.CREDENTIAL_DELETED, 'credential', id, { name });
    return { data: { ok: true } };
  });
}
