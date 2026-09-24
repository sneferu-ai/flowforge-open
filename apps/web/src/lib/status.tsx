import type { ReactNode } from 'react';

/** Map a run/workflow status string to a status-pill CSS class. */
export function statusPillClass(status: string): string {
  const s = status.toLowerCase();
  const map: Record<string, string> = {
    queued: 'status-pill-running',
    running: 'status-pill-running',
    waiting: 'status-pill-running',
    paused: 'status-pill-paused',
    pending: 'status-pill-paused',
    awaiting_approval: 'status-pill-paused',
    succeeded: 'status-pill-succeeded',
    completed: 'status-pill-completed',
    success: 'status-pill-succeeded',
    failed: 'status-pill-failed',
    error: 'status-pill-failed',
    canceled: 'status-pill-canceled',
    cancelled: 'status-pill-canceled',
    halted: 'status-pill-halted',
    skipped: 'status-pill-skipped',
    unknown: 'status-pill-unknown',
    disabled: 'status-pill-disabled',
    draft: 'status-pill-orphan',
    active: 'status-pill-running',
    enabled: 'status-pill-succeeded',
  };
  return map[s] ?? 'status-pill-unknown';
}

/** Status dot — a small filled circle for inline status indicators. */
export function statusDotClass(status: string): string {
  const s = status.toLowerCase();
  if (['queued', 'running', 'waiting', 'active'].includes(s)) return 'var(--status-running)';
  if (['paused', 'pending', 'awaiting_approval'].includes(s)) return 'var(--status-paused)';
  if (['succeeded', 'completed', 'success', 'enabled'].includes(s)) return 'var(--status-complete)';
  if (['failed', 'error', 'halted'].includes(s)) return 'var(--status-failed)';
  return 'var(--status-orphan)';
}

interface StatusPillProps {
  status: string;
  children?: ReactNode;
}

/** Compact status pill — bordered, tinted, icon + label. */
export function StatusPill({ status, children }: StatusPillProps) {
  const cls = statusPillClass(status);
  const label = children ?? status.replace(/_/g, ' ');
  return (
    <span className={`status-pill ${cls}`} data-testid={`run-status-${status.toLowerCase()}`}>
      <span
        className="inline-block rounded-full shrink-0"
        style={{ width: 'var(--status-dot)', height: 'var(--status-dot)', backgroundColor: 'currentColor' }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/** Format an ISO timestamp into a concise relative or absolute string.
 *  Future timestamps (trigger next-fire times) render as "in Xm/Xh/Xd" —
 *  "next just now" would be a lie the precision voice cannot afford. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 0) {
    const aheadMin = -diffMin;
    const aheadHr = Math.floor(aheadMin / 60);
    const aheadDay = Math.floor(aheadHr / 24);
    if (aheadMin < 1) return 'in moments';
    if (aheadHr < 1) return `in ${aheadMin}m`;
    if (aheadHr < 24) return aheadMin % 60 === 0 ? `in ${aheadHr}h` : `in ${aheadHr}h ${aheadMin % 60}m`;
    return `in ${aheadDay}d`;
  }

  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffDay > 365 ? 'numeric' : undefined });
}

/** Format an ISO timestamp to a full date-time for detail views. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
