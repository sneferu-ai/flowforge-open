import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CheckCircle2, CircleSlash, Clock, Copy, Hourglass, PlayCircle, XCircle,
} from 'lucide-react';
import { api, BASE, type ApprovalTask, type RunDetailData, type RunStep } from '../lib/api';
import { pacing } from '../lib/motion-tokens';
import { toast } from '../lib/toast';
import { StatusPill, formatWhen } from '../lib/status';
import ConfirmDialog from '../components/ConfirmDialog';

const ACTIVE = new Set(['queued', 'running', 'waiting', 'paused']);

export default function RunDetail() {
  const params = useParams<{ id?: string; runId?: string }>();
  const id = params.runId ?? params.id ?? '';
  const [run, setRun] = useState<RunDetailData | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [approvals, setApprovals] = useState<ApprovalTask[]>([]);
  const [error, setError] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const runRes = await api.get<{ data: RunDetailData }>(`/runs/${id}`);
    setRun(runRes.data);
    try {
      const stepsRes = await api.get<{ data: RunStep[] }>(`/runs/${id}/steps`);
      setSteps(stepsRes.data);
    } catch {
      /* steps may 404 on a just-created run */
    }
    try {
      const approvalsRes = await api.get<{ data: ApprovalTask[] }>('/approvals');
      setApprovals(approvalsRes.data.filter((a) => a.run_id === id));
    } catch {
      setApprovals([]);
    }
  }, [id]);

  useEffect(() => {
    setError('');
    setRun(null);
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  /* Live updates (§D13): the server serves the run-event feed as SSE at
   * /runs/:id/events. Keep the 1.5s poll as the reconnect backstop. */
  useEffect(() => {
    if (!run || !ACTIVE.has(run.status)) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${BASE}/runs/${encodeURIComponent(id)}/events`);
      const refresh = () => load().catch(() => {});
      /* The feed emits named events for the run lifecycle (§6.1); every one
       * is a signal to re-read canonical state from the REST endpoints. */
      for (const eventName of ['run.created', 'run.started', 'run.succeeded', 'run.failed', 'run.canceled', 'run.paused', 'run.waiting']) {
        es.addEventListener(eventName, refresh);
      }
      es.onerror = () => {
        /* Transient — the poll below keeps the page live. */
        es?.close();
      };
      timer.current = window.setInterval(refresh, pacing('dur-poll-run'));
    } catch {
      /* EventSource unavailable — fall back to polling only. */
      timer.current = window.setInterval(() => load().catch(() => {}), pacing('dur-poll-run'));
    }
    return () => {
      es?.close();
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [run?.status, id, load]);

  const decide = async (taskId: string, decision: 'approve' | 'reject') => {
    setDeciding(true);
    try {
      await api.post(`/approvals/${taskId}/${decision}`, {});
      toast(decision === 'approve' ? 'Approval accepted — run resumed' : 'Approval rejected');
      await load();
    } catch (err) {
      toast(`${decision === 'approve' ? 'Approve' : 'Reject'} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeciding(false);
    }
  };

  const cancel = async () => {
    setCanceling(true);
    try {
      await api.post(`/runs/${id}/cancel`, {});
      toast('Run canceled');
      await load();
    } catch (err) {
      toast(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCanceling(false);
    }
  };

  if (error && !run) {
    return (
      <div style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-6)' }}>
          Run
        </h1>
        <div className="surface-card" style={{ padding: 'var(--space-6) var(--space-8)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-2)' }}>
            Could not load this run: {error}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-4)' }}>
            The run may have been deleted, or the server is unreachable. Check your connection and retry.
          </p>
          <div className="flex justify-center" style={{ gap: 'var(--space-2)' }}>
            <button className="btn-secondary" onClick={() => { setError(''); void load(); }}>
              Try again
            </button>
            <Link to="/runs" className="btn-ghost">Back to runs</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!run) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <div className="skeleton" style={{ height: 'var(--skeleton-row-h)', width: 'calc(var(--space-8) * 5)', marginBottom: 'var(--space-4)' }} />
        <div className="skeleton" style={{ height: 'calc(var(--skeleton-card-h) - var(--space-2))', width: '100%', marginBottom: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }} />
        <div className="skeleton" style={{ height: 'var(--skeleton-section-lg)', borderRadius: 'var(--radius-md)' }} />
      </div>
    );
  }

  const pendingApproval = approvals.find((a) => a.status === 'pending');

  return (
    <div className="enter-fade-up" style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }} id="run-detail" data-testid="run-detail">
      {/* Header */}
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-3">
            <h1
              className="page-title"
              style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', fontFamily: 'var(--font-display)' }}
            >
              Run
            </h1>
            <span data-testid={`run-status-${run.status}`} className="inline-flex items-center gap-2">
              <StatusPill status={run.status} />
            </span>
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
            <Link className="link-accent" to={`/workflows/${run.workflow_id}`}>
              {run.workflow_name}
            </Link>
            {' · '}
            <code className="tabular-nums" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--fg-disabled)' }}>
              {run.id}
            </code>
            <button
              className="btn-ghost"
              style={{ width: 'var(--btn-touch-min)', height: 'var(--btn-touch-min)', padding: 0, marginLeft: 'var(--space-1)', flexShrink: 0 }}
              onClick={() => {
                void navigator.clipboard?.writeText(run.id).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), pacing('dur-copied-hint'));
                }).catch(() => toast('Copy failed — select the ID manually'));
              }}
              aria-label="Copy run ID"
              title="Copy run ID"
            >
              <Copy style={{ width: 'var(--icon-xs)', height: 'var(--icon-xs)' }} />
            </button>
            {copied && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-complete)', marginLeft: 'var(--space-1)' }}>
                copied
              </span>
            )}
          </p>
        </div>
        {ACTIVE.has(run.status) && (
          <button
            data-testid="cancel-run-btn"
            onClick={() => setConfirmCancel(true)}
            disabled={canceling}
            className="btn-danger"
            style={{ fontSize: 'var(--text-sm)' }}
            aria-label="Cancel run"
          >
            {canceling ? 'Canceling…' : 'Cancel run'}
          </button>
        )}
      </div>

      {/* Meta strip */}
      <div
        className="grid gap-3"
        style={{ marginTop: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(var(--col-cards-min), 1fr))' }}
      >
        <Meta label="Created" value={formatWhen(run.created_at)} />
        <Meta label="Started" value={run.started_at ? formatWhen(run.started_at) : '—'} />
        <Meta label="Finished" value={run.finished_at ? formatWhen(run.finished_at) : '—'} />
        <Meta label="Running time" value={formatDuration(run.total_running_seconds)} />
      </div>

      {/* Run-level failure — the reason must be visible, never just a red pill */}
      {run.error && (
        <div
          data-testid="run-error-banner"
          className="rounded-lg flex items-start gap-2"
          style={{
            marginTop: 'var(--space-6)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--status-failed-subtle)',
            border: 'var(--border-width) solid var(--status-failed-border)',
          }}
          role="alert"
        >
          <XCircle style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--status-failed)', flexShrink: 0, marginTop: 'calc(var(--space-1) / 2)' }} />
          <div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', fontWeight: 'var(--weight-medium)' }}>
              Run failed
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginTop: 'var(--space-1)' }}>
              {run.error}
            </p>
          </div>
        </div>
      )}

      {/* Approval card */}
      {pendingApproval && (
        <div
          className="rounded-lg"
          style={{
            marginTop: 'var(--space-6)',
            padding: 'var(--space-5)',
            background: 'var(--bg-elevated)',
            border: 'var(--border-width) solid var(--status-paused)',
          }}
          data-testid="approval-card"
        >
          <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-2)' }}>
            <Hourglass style={{ width: 'var(--icon-lg)', height: 'var(--icon-lg)', color: 'var(--status-paused)' }} />
            <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
              Approval required
            </h2>
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-1)' }}>
            {pendingApproval.prompt}
          </p>
          <p className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-4)' }}>
            Step <code style={{ fontFamily: 'var(--font-mono)' }}>{pendingApproval.step_path}</code>
            {' · '}waiting since {formatWhen(pendingApproval.created_at)}
          </p>
          <div className="flex gap-3">
            <button
              data-testid="approval-approve-btn"
              onClick={() => void decide(pendingApproval.id, 'approve')}
              disabled={deciding}
              className="btn-primary"
              style={{ fontSize: 'var(--text-sm)' }}
              aria-label={deciding ? 'Approving' : 'Approve'}
            >
              {deciding ? 'Deciding…' : 'Approve'}
            </button>
            <button
              data-testid="approval-reject-btn"
              onClick={() => void decide(pendingApproval.id, 'reject')}
              disabled={deciding}
              className="btn-danger"
              style={{ fontSize: 'var(--text-sm)' }}
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Steps timeline */}
      <div style={{ marginTop: 'var(--space-8)' }}>
        <h2 className="panel-heading" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-3)' }}>
          Steps
        </h2>
        <ol className="flex flex-col gap-2" data-testid="run-inspector-timeline">
          {steps.length === 0 && (
            <li
              className="surface-card"
              style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}
            >
              No steps recorded yet — they appear here as the run executes.
            </li>
          )}
          {steps.map((s) => (
            <li
              key={s.id}
              className="surface-card flex items-start gap-3"
              style={{ padding: 'var(--space-3) var(--space-4)' }}
            >
              <StepIcon status={s.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--fg-primary)' }}>
                    {s.step_path}
                  </code>
                  <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-disabled)' }}>
                    attempt {s.attempt}
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    <StatusPill status={s.status} />
                  </span>
                </div>
                {typeof s.output?.message === 'string' && s.output.message !== '' && (
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', marginTop: 'var(--space-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.output.message}
                  </p>
                )}
                {stepErrorText(s.output) !== null && (
                  <p
                    data-testid={`step-error-${s.step_id}`}
                    style={{ fontSize: 'var(--text-xs)', color: 'var(--status-failed)', marginTop: 'var(--space-1)' }}
                  >
                    {stepErrorText(s.output)}
                  </p>
                )}
                {typeof s.output?.decision === 'string' && (
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', marginTop: 'var(--space-1)' }}>
                    decision: <span style={{ color: 'var(--fg-primary)' }}>{s.output.decision}</span>
                  </p>
                )}
                {s.logs && (
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.logs}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        title="Cancel run"
        message={`Cancel run ${run.id.slice(0, 8)}? This will halt execution immediately. This cannot be undone.`}
        confirmLabel="Cancel run"
        onConfirm={() => {
          setConfirmCancel(false);
          void cancel();
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-card" style={{ padding: 'var(--space-3) var(--space-4)' }}>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-1)' }}>{label}</p>
      <p className="tabular-nums" style={{ color: 'var(--fg-primary)', fontSize: 'var(--text-sm)' }}>{value}</p>
    </div>
  );
}

/** Whole seconds → "14m 32s" / "58s" / "1h 02m 05s". Never "0s" for a
 *  not-yet-started run — an exact reading or an honest dash, per §8 voice. */
function formatDuration(totalSeconds: number): string {
  const n = Math.max(0, Math.floor(totalSeconds ?? 0));
  if (n <= 0) return '—';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** A failed step's durable reason — "code: message" or "failed". */
function stepErrorText(output: Record<string, unknown> | null): string | null {
  const err = output?.error;
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: unknown; message?: unknown };
  const msg = typeof e.message === 'string' ? e.message : 'failed';
  const code = typeof e.code === 'string' ? `${e.code}: ` : '';
  return `${code}${msg}`;
}

function StepIcon({ status }: { status: string }) {
  const style: React.CSSProperties = { width: 'var(--icon-md)', height: 'var(--icon-md)', marginTop: 'calc(var(--space-1) / 2)', flexShrink: 0 };
  switch (status) {
    case 'succeeded':
      return <CheckCircle2 style={{ ...style, color: 'var(--status-complete)' }} />;
    case 'failed':
      return <XCircle style={{ ...style, color: 'var(--status-failed)' }} />;
    case 'paused':
      return <Hourglass style={{ ...style, color: 'var(--status-paused)' }} />;
    case 'waiting':
      return <Clock style={{ ...style, color: 'var(--accent)' }} />;
    case 'running':
      return <PlayCircle style={{ ...style, color: 'var(--accent)' }} />;
    case 'skipped':
      return <CircleSlash style={{ ...style, color: 'var(--fg-tertiary)' }} />;
    default:
      return <Clock style={{ ...style, color: 'var(--fg-disabled)' }} />;
  }
}
