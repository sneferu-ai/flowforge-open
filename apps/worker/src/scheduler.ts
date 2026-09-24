/**
 * Scheduler tick (standalone worker) — delegates to the server's scheduler
 * service so embedded and standalone modes share exactly one implementation
 * (DB-led, Redis-lock serialized, BullMQ enqueue). See §6.3.
 */

import { setupScheduler } from '@flowforge/server/services/scheduler';

let handle: ReturnType<typeof setupScheduler> | null = null;

export function startScheduler(): void {
  if (handle) return;
  handle = setupScheduler();
  console.log('[scheduler] started (shared server tick)');
}

export function stopScheduler(): void {
  if (handle) {
    handle.stop();
    handle = null;
  }
  console.log('[scheduler] stopped');
}
