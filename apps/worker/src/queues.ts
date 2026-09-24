/**
 * Queue name constants (§4.2) — re-exported from the server's queue service,
 * the single source of truth. BullMQ forbids ':' in queue names, so the
 * spec's forge:runs / forge:scheduler / forge:outbox are dash-spelled at the
 * queue plane (same topology).
 */

export {
  QUEUE_RUN,
  QUEUE_SCHEDULER,
  QUEUE_OUTBOX,
  getRunQueue,
  enqueueRunJob,
  bullConnection,
} from '@flowforge/server/services/queue';
