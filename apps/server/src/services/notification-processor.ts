/**
 * Outbox dispatcher (§7, OBL-21) — polls `notification_outbox` (email
 * channel) and hands each due row to the notification provider.
 *
 * Retry contract: exponential backoff 30s → 2m → 10m → 1h → 6h with a
 * five-retry cap (six total send attempts), after which the row is marked
 * `failed` with the last error. Delivery is asynchronous; the notify step
 * only enqueues (§D22). Rows stranded in `sending` by a crash are reclaimed.
 */

import { query } from '../db/pool.js';

const POLL_INTERVAL_MS = 5000;
const RECLAIM_AFTER_SQL = "INTERVAL '1 minute'";

/** Exponential backoff ladder (§7/OBL-21): 30s, 2m, 10m, 1h, 6h. */
export const OUTBOX_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;
/** Five-retry cap — the initial send plus OUTBOX_BACKOFF_MS.length retries. */
export const OUTBOX_MAX_ATTEMPTS = OUTBOX_BACKOFF_MS.length + 1;

export function nextRetryDelayMs(failedAttempts: number): number {
  // failedAttempts counts sends that already failed (1-based).
  const index = Math.max(0, Math.min(failedAttempts - 1, OUTBOX_BACKOFF_MS.length - 1));
  return OUTBOX_BACKOFF_MS[index];
}

interface OutboxRow {
  id: string;
  channel: string;
  recipient: string;
  subject: string | null;
  body: string;
  attempts: number;
}

/**
 * §13.3 — MockNotificationProvider: v1 logs delivery; SMTP is an extension
 * (§15). The provider seam is injectable so a real provider drops in per-call
 * and tests can fault-inject delivery failures.
 */
export type NotificationSender = (
  row: Pick<OutboxRow, 'channel' | 'recipient' | 'subject' | 'body'>
) => Promise<void>;

export function sendNotification(row: Pick<OutboxRow, 'channel' | 'recipient' | 'subject' | 'body'>): Promise<void> {
  return Promise.resolve().then(() => {
    console.log(`[Notification] ${row.channel} → ${row.recipient}: ${row.subject || '(no subject)'}`);
    console.log(`  Body: ${row.body.substring(0, 200)}`);
  });
}

/** One dispatch sweep — exported for the worker and for tests. */
export async function processOutboxDue(send: NotificationSender = sendNotification): Promise<number> {
  // Reclaim rows a crashed dispatcher left mid-send.
  await query(
    `UPDATE notification_outbox SET status = 'pending', next_retry_at = now(), updated_at = now()
     WHERE status = 'sending' AND updated_at < now() - ${RECLAIM_AFTER_SQL}`
  );

  const claimed = await query<OutboxRow>(
    `WITH due AS (
       SELECT id FROM notification_outbox
       WHERE status = 'pending' AND next_retry_at <= now()
       ORDER BY next_retry_at
       LIMIT 5
       FOR UPDATE SKIP LOCKED
     )
     UPDATE notification_outbox o
     SET status = 'sending', updated_at = now()
     FROM due
     WHERE o.id = due.id
     RETURNING o.id, o.channel, o.recipient, o.subject, o.body, o.attempts`
  );

  for (const row of claimed.rows) {
    try {
      await send(row);
      await query(
        `UPDATE notification_outbox SET status = 'sent', updated_at = now() WHERE id = $1`,
        [row.id]
      );
    } catch (err) {
      const attempts = row.attempts + 1;
      const error = (err as Error).message.slice(0, 500);
      if (attempts >= OUTBOX_MAX_ATTEMPTS) {
        await query(
          `UPDATE notification_outbox SET status = 'failed', attempts = attempts + 1, last_error = $2, updated_at = now()
           WHERE id = $1`,
          [row.id, error]
        );
      } else {
        const delayMs = nextRetryDelayMs(attempts);
        await query(
          `UPDATE notification_outbox SET status = 'pending', attempts = attempts + 1, last_error = $2,
             next_retry_at = now() + ($3::double precision * INTERVAL '1 millisecond'), updated_at = now()
           WHERE id = $1`,
          [row.id, error, delayMs]
        );
      }
    }
  }
  return claimed.rows.length;
}

export function setupNotificationProcessor() {
  let running = true;
  let timer: NodeJS.Timeout | null = null;

  async function tick() {
    if (!running) return;
    try {
      await processOutboxDue();
    } catch (err) {
      console.error('Notification processor error:', (err as Error).message);
    }
    if (running) {
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  }

  tick();

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
