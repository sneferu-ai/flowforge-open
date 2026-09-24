/**
 * Idempotency key helpers — bucket/dedup keys for webhooks and manual runs.
 */

import { createHash } from 'node:crypto';

export function getIdempotencyKey(kind: string, workspaceId: string, basis: string): string {
  const hash = createHash('sha256').update(`${kind}:${workspaceId}:${basis}`).digest('hex').slice(0, 40);
  return `${kind}:${hash}`;
}

export function manualRunIdempotencyKey(workspaceId: string, workflowId: string, inputs: Record<string, unknown>): string {
  // §9 manual run dedup: 10-second bucket on identical inputs.
  const bucket = Math.floor(Date.now() / 10000);
  const hash = createHash('sha256').update(`${workspaceId}:${workflowId}:${JSON.stringify(inputs)}:${bucket}`).digest('hex').slice(0, 40);
  return `manual:${hash}`;
}
