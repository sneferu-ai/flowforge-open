/**
 * Audit event types and canonical JSON hashing for the append-only audit chain.
 */

export const AUDIT_ACTIONS = {
  USER_REGISTERED: 'user.registered',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  WORKSPACE_CREATED: 'workspace.created',
  WORKSPACE_DELETED: 'workspace.deleted',
  WORKFLOW_CREATED: 'workflow.created',
  WORKFLOW_UPDATED: 'workflow.updated',
  WORKFLOW_DELETED: 'workflow.deleted',
  WORKFLOW_VERSION_CREATED: 'workflow.version_created',
  WORKFLOW_PROMOTED: 'workflow.promoted',
  WORKFLOW_DISABLED: 'workflow.disabled',
  WORKFLOW_ENABLED: 'workflow.enabled',
  TRIGGER_CREATED: 'trigger.created',
  TRIGGER_UPDATED: 'trigger.updated',
  TRIGGER_DELETED: 'trigger.deleted',
  RUN_CREATED: 'run.created',
  RUN_SUCCEEDED: 'run.succeeded',
  RUN_FAILED: 'run.failed',
  RUN_CANCELED: 'run.canceled',
  APPROVAL_APPROVED: 'approval.approved',
  APPROVAL_REJECTED: 'approval.rejected',
  APPROVAL_TIMEOUT: 'approval.timeout',
  CREDENTIAL_CREATED: 'credential.created',
  CREDENTIAL_DELETED: 'credential.deleted',
  MEMBER_INVITED: 'member.invited',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  SESSION_REVOKED: 'session.revoked',
  PLAN_CHANGED: 'plan.changed',
  API_TOKEN_CREATED: 'api_token.created',
  API_TOKEN_REVOKED: 'api_token.revoked',
  ALLOWLIST_ENTRY_ADDED: 'allowlist.entry_added',
  ALLOWLIST_ENTRY_REMOVED: 'allowlist.entry_removed',
  WEBHOOK_SECRET_CREATED: 'webhook_secret.created',
  WEBHOOK_SECRET_DELETED: 'webhook_secret.deleted',
  OIDC_PROVIDER_ADDED: 'oidc.provider_added',
  OIDC_PROVIDER_REMOVED: 'oidc.provider_removed',
  BILLING_PERIOD_CLOSED: 'billing.period_closed',
  RUN_LIMIT_EXCEEDED: 'run.limit_exceeded',
  SYSTEM_JOB_FAILED: 'system_job.failed',
  NOTIFICATION_PERMANENT_FAILURE: 'notification.permanent_failure',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEvent {
  id: string;
  workspace_id: string;
  sequence_num: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  prev_hash: string;
  hash: string;
  created_at: string;
}

/**
 * Canonical JSON: keys sorted lexicographically, no whitespace, UTF-8.
 * Numbers in shortest decimal. null included. Strings escaped per JSON spec.
 * Timestamps in ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ).
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean') return obj ? 'true' : 'false';
  if (typeof obj === 'number') {
    if (Number.isInteger(obj)) return String(obj);
    return String(obj);
  }
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
  }
  return 'null';
}

/**
 * Hash: SHA256(prev_hash_hex_utf8_bytes || canonical_json_utf8_bytes)
 */
export async function computeAuditHash(
  prevHash: string,
  data: Record<string, unknown>
): Promise<string> {
  const canon = canonicalJson(data);
  const input = prevHash + canon;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** First event prev_hash: SHA256("") */
export const GENESIS_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
