import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2, Pencil, Play, Plus, Workflow as WorkflowIcon, Zap } from 'lucide-react';
import { api, type WorkflowSummary } from '../lib/api';
import { StatusPill, formatWhen } from '../lib/status';
import { toast } from '../lib/toast';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

export default function Workflows() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .get<{ data: WorkflowSummary[] }>('/workflows?include_disabled=true')
      .then((r) => { if (active) { setWorkflows(r.data); setLoading(false); } })
      .catch((e) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { active = false; };
  }, [attempt]);

  const runWorkflow = async (wf: WorkflowSummary) => {
    setBusyId(wf.id);
    try {
      const res = await api.post<{ data: { run_id: string; status: string } }>(
        `/workflows/${wf.id}/run`,
        { inputs: {} },
      );
      toast('Run started');
      navigate(`/runs/${res.data.run_id}`);
    } catch (err) {
      toast(`Could not start run: ${err instanceof Error ? err.message : String(err)}`);
      setBusyId(null);
    }
  };

  if (error) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <h1
          className="page-title"
          style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--fg-primary)',
            marginBottom: 'var(--space-6)',
          }}
        >
          Workflows
        </h1>
        <div className="surface-card" style={{ padding: 'var(--space-6) var(--space-8)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-4)' }}>
            Could not load workflows: {error}
          </p>
          <button className="btn-secondary" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="enter-fade-up"
      initial={reduceMotion ? false : { opacity: 0, y: enterOffset() }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur('base'), ease: ease('emphasized') }}
      style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <h1
            className="page-title"
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--fg-primary)',
            }}
          >
            Workflows
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
            Versioned YAML manifests that run on schedule, webhook, or click.
          </p>
        </div>
        <Link to="/workflows/new" data-testid="new-workflow-btn" className="btn-primary">
          <Plus style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} /> New workflow
        </Link>
      </div>

      {loading ? (
        <WorkflowsSkeleton />
      ) : workflows.length === 0 ? (
        <div
          data-testid="workflows-empty-state"
          className="surface-card flex flex-col items-center justify-center text-center"
          style={{ padding: 'var(--space-16) var(--space-8)' }}
        >
          <WorkflowIcon
            style={{ width: 'var(--empty-icon)', height: 'var(--empty-icon)', color: 'var(--accent)', opacity: 0.5, marginBottom: 'var(--space-4)' }}
          />
          <h2
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--fg-primary)',
              marginBottom: 'var(--space-2)',
            }}
          >
            No workflows yet
          </h2>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--fg-secondary)',
              maxWidth: 'var(--empty-max)',
              marginBottom: 'var(--space-6)',
            }}
          >
            Create one from a template or author the YAML yourself.
          </p>
          <Link to="/templates" className="btn-secondary">
            Browse templates
          </Link>
        </div>
      ) : (
        <div className="surface-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Triggers</th>
                <th>Updated</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((wf) => (
                <tr
                  key={wf.id}
                  data-testid={`workflow-card-${wf.id}`}
                  className="cursor-pointer"
                  onClick={() => navigate(`/workflows/${wf.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <Link
                      to={`/workflows/${wf.id}`}
                      className="row-link"
                      style={{ fontWeight: 'var(--weight-medium)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {wf.name}
                    </Link>
                    {wf.slug && (
                      <div
                        className="font-mono"
                        style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-hairline)' }}
                      >
                        {wf.slug}
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusPill status={wf.is_enabled ? 'active' : 'draft'}>
                      {wf.is_enabled ? 'active' : 'draft'}
                    </StatusPill>
                  </td>
                  <td>
                    <span
                      className="inline-flex items-center"
                      style={{ gap: 'var(--space-1)', color: 'var(--fg-secondary)' }}
                    >
                      <Zap style={{ width: 'var(--icon-xs)', height: 'var(--icon-xs)', color: 'var(--fg-tertiary)' }} />
                      <span className="tabular-nums">{wf.trigger_count}</span>
                    </span>
                  </td>
                  <td className="tabular-nums" style={{ color: 'var(--fg-tertiary)' }}>
                    {formatWhen(wf.updated_at)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="inline-flex items-center" style={{ gap: 'var(--space-1)' }}>
                      <Link
                        to={`/workflows/${wf.id}`}
                        data-testid={`workflow-edit-${wf.id}`}
                        className="btn-ghost btn-sm"
                        onClick={(e) => e.stopPropagation()}
                        title="Edit workflow"
                        aria-label={`Edit ${wf.name}`}
                      >
                        <Pencil style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                      </Link>
                      <button
                        data-testid={`workflow-run-${wf.id}`}
                        className="btn-ghost btn-sm"
                        disabled={busyId === wf.id || !wf.is_enabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          void runWorkflow(wf);
                        }}
                        title={wf.is_enabled ? 'Run now' : 'Enable workflow to run'}
                        aria-label={wf.is_enabled ? `Run ${wf.name} now` : `Enable ${wf.name} to run it`}
                      >
                        {busyId === wf.id ? (
                          <>
                            <Loader2 className="animate-spin" style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                            Starting…
                          </>
                        ) : (
                          <Play style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

function WorkflowsSkeleton() {
  return (
    <div className="surface-panel" role="status" aria-label="Loading workflows">
      <div className="skeleton" style={{ height: 'var(--space-10)', borderRadius: 0 }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 'var(--topbar-height)', borderRadius: 0, borderTop: 'var(--border-width) solid var(--border-subtle)' }}
        />
      ))}
    </div>
  );
}
