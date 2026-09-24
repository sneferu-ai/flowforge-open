import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCheck, Hourglass } from 'lucide-react';
import { api, type ApprovalTask } from '../lib/api';
import { toast } from '../lib/toast';
import { formatWhen } from '../lib/status';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

/**
 * Pending approval tasks (§10.2 /settings/approvals).
 * Per-task approve/reject + batch "approve all" riding the server's
 * POST /runs/:id/approve-all (one call per affected run).
 */
export default function SettingsApprovals() {
  const [tasks, setTasks] = useState<ApprovalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ data: ApprovalTask[] }>('/approvals')
      .then((r) => {
        setTasks(r.data);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const decide = async (task: ApprovalTask, decision: 'approve' | 'reject') => {
    setBusyId(task.id);
    try {
      await api.post(`/approvals/${task.id}/${decision}`, {});
      toast(decision === 'approve' ? 'Approved — run resumed' : 'Rejected — run resumed');
      load();
    } catch (err) {
      toast(`${decision === 'approve' ? 'Approve' : 'Reject'} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const approveAll = async () => {
    setApprovingAll(true);
    try {
      const runIds = [...new Set(tasks.map((t) => t.run_id))];
      for (const runId of runIds) {
        try {
          await api.post(`/runs/${runId}/approve-all`, {});
        } catch {
          /* per-run failures surface via the reload below */
        }
      }
      toast(`${runIds.length} ${runIds.length === 1 ? 'run' : 'runs'} approved — all pending tasks cleared`);
      load();
    } finally {
      setApprovingAll(false);
    }
  };

  return (
    <motion.div
      className="enter-fade-up"
      initial={{ opacity: 0, y: enterOffset() }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur('base'), ease: ease('default') }}
      style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
            Pending approvals
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
            Escalation gates from manual_approval steps, waiting on a workspace owner.
          </p>
        </div>
        {tasks.length > 1 && (
          <button
            data-testid="approve-all-btn"
            onClick={() => void approveAll()}
            disabled={approvingAll}
            className="btn-secondary"
            aria-label={`Approve all (${tasks.length}) tasks`}
          >
            <CheckCheck style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            {approvingAll ? 'Approving…' : `Approve all (${tasks.length})`}
          </button>
        )}
      </div>

      {error && (
        <div className="surface-card" style={{ padding: 'var(--space-6) var(--space-8)', textAlign: 'center', marginBottom: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-2)' }}>
            Could not load approvals: {error}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-4)' }}>
            Check your connection and try again.
          </p>
          <button className="btn-secondary" onClick={load}>Try again</button>
        </div>
      )}

      {loading && !error ? (
        <div className="flex flex-col" style={{ gap: 'var(--space-3)' }} role="status" aria-label="Loading pending approvals">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton" style={{ height: 'calc(var(--space-8) * 3)', borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : !error && tasks.length === 0 ? (
        <div className="surface-card flex flex-col items-center text-center" data-testid="approvals-empty" style={{ padding: 'var(--space-16) var(--space-8)' }}>
          <Hourglass style={{ width: 'var(--icon-xl)', height: 'var(--icon-xl)', color: 'var(--fg-disabled)', marginBottom: 'var(--space-4)' }} />
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-2)' }}>
            Nothing waiting for approval.
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
            When a workflow's manual_approval step fires, the task lands here.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
          {tasks.map((t) => (
            <li key={t.id} className="surface-card" style={{ padding: 'var(--space-5)' }} data-testid={`approval-task-${t.id}`}>
              <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-2)' }}>
                <Hourglass style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--status-paused)' }} />
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                  {t.workflow_name}
                </span>
                <span className="tabular-nums" style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                  since {formatWhen(t.created_at)}
                </span>
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-2)' }}>
                {t.prompt}
              </p>
              <p className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-3)' }}>
                step <code style={{ fontFamily: 'var(--font-mono)' }}>{t.step_path}</code>
                {' · '}run <code style={{ fontFamily: 'var(--font-mono)' }}>{t.run_id.slice(0, 12)}</code>
                {' · '}auto-{t.on_timeout} on timeout
              </p>
              <div className="flex" style={{ gap: 'var(--space-2)' }}>
                <button
                  data-testid={`approval-approve-${t.id}`}
                  className="btn-primary btn-sm"
                  aria-label="Approve"
                  disabled={busyId === t.id}
                  style={{ padding: '0 var(--space-3)', fontSize: 'var(--text-sm)' }}
                  onClick={() => void decide(t, 'approve')}
                >
                  {busyId === t.id ? 'Deciding…' : 'Approve'}
                </button>
                <button
                  data-testid={`approval-reject-${t.id}`}
                  className="btn-danger btn-sm"
                  aria-label="Reject"
                  disabled={busyId === t.id}
                  style={{ padding: '0 var(--space-3)', fontSize: 'var(--text-sm)' }}
                  onClick={() => void decide(t, 'reject')}
                >
                  {busyId === t.id ? 'Rejecting…' : 'Reject'}
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </motion.div>
  );
}
