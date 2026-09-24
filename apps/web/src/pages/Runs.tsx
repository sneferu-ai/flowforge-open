import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Clock, Inbox, Zap } from 'lucide-react';
import { api, type RunSummary } from '../lib/api';
import { StatusPill, formatWhen } from '../lib/status';

export default function Runs() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .get<{ data: RunSummary[] }>('/runs?limit=100')
      .then((r) => {
        if (active) {
          setRuns(r.data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (loading) return <RunsSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => setAttempt((a) => a + 1)} />;

  return (
    <motion.div
      className="enter-fade-up"
      initial={false}
      style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}
    >
      {/* Page title */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1
          className="page-title"
          style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--fg-primary)',
          }}
        >
          Runs
        </h1>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--fg-tertiary)',
            marginTop: 'var(--space-1)',
          }}
        >
          {runs.length} {runs.length === 1 ? 'run' : 'runs'} across this workspace
        </p>
      </div>

      {runs.length === 0 ? (
        <div
          data-testid="runs-empty-state"
          className="surface-card flex flex-col items-center justify-center text-center"
          style={{ marginTop: 'var(--space-12)', padding: 'var(--space-16) var(--space-8)' }}
        >
          <Inbox
            style={{
              width: 'var(--empty-icon)',
              height: 'var(--empty-icon)',
              color: 'var(--fg-tertiary)',
              opacity: 0.5,
              marginBottom: 'var(--space-4)',
            }}
            aria-hidden="true"
          />
          <h2
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--fg-primary)',
              marginBottom: 'var(--space-2)',
            }}
          >
            No runs yet
          </h2>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--fg-secondary)',
              maxWidth: 'var(--empty-max)',
              marginBottom: 'var(--space-6)',
            }}
          >
            Trigger a workflow manually, on schedule, or via webhook.
          </p>
          <Link to="/workflows" className="btn-primary">
            <Zap style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} />
            Browse workflows
          </Link>
        </div>
      ) : (
        <div className="surface-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Status</th>
                <th>Trigger</th>
                <th>Started</th>
                <th style={{ width: 'var(--space-8)' }}>
                  <span className="sr-only">View run</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} data-testid={`run-row-${run.id}`}>
                  <td>
                    <Link
                      to={`/runs/${run.id}`}
                      className="link-accent"
                      style={{ fontWeight: 'var(--weight-medium)' }}
                    >
                      {run.workflow_name}
                    </Link>
                    {run.error && (
                      <div
                        className="font-mono"
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--status-failed)',
                          marginTop: 'var(--space-1)',
                          maxWidth: 'var(--col-event-max)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={run.error}
                      >
                        {run.error}
                      </div>
                    )}
                    <div
                      className="font-mono"
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--fg-tertiary)',
                        marginTop: 'var(--space-1)',
                      }}
                    >
                      {run.id.slice(0, 12)}…
                    </div>
                  </td>
                  <td>
                    <StatusPill status={run.status} />
                  </td>
                  <td>
                    {run.trigger_id ? (
                      <span
                        className="inline-flex items-center font-mono"
                        style={{
                          gap: 'var(--space-1)',
                          fontSize: 'var(--text-xs)',
                          color: 'var(--fg-secondary)',
                        }}
                      >
                        <Zap
                          style={{ width: 'var(--icon-xs)', height: 'var(--icon-xs)', color: 'var(--fg-tertiary)' }}
                          aria-hidden="true"
                        />
                        <span className="tabular-nums">{run.trigger_id.slice(0, 8)}…</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-disabled)' }}>
                        —
                      </span>
                    )}
                  </td>
                  <td
                    className="tabular-nums"
                    style={{
                      color: 'var(--fg-tertiary)',
                      fontSize: 'var(--text-xs)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span
                      className="inline-flex items-center"
                      style={{ gap: 'var(--space-1)' }}
                    >
                      <Clock
                        style={{ width: 'var(--icon-xs)', height: 'var(--icon-xs)', color: 'var(--fg-tertiary)' }}
                        aria-hidden="true"
                      />
                      {formatWhen(run.started_at ?? run.created_at)}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link
                      to={`/runs/${run.id}`}
                      className="btn-ghost btn-sm"
                      aria-label={`View run ${run.id}`}
                      title="View run"
                    >
                      <ArrowRight style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                    </Link>
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

function RunsSkeleton() {
  return (
    <div style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }} role="status" aria-label="Loading runs">
      <div
        className="skeleton"
        style={{ height: 'var(--skeleton-row-h)', width: 'calc(var(--space-8) * 3)', marginBottom: 'var(--space-1)' }}
      />
      <div
        className="skeleton"
        style={{ height: 'var(--space-4)', width: 'calc(var(--space-8) * 6 + var(--space-4))', marginBottom: 'var(--space-6)' }}
      />
      <div
        className="skeleton"
        style={{ height: 'var(--skeleton-block-h)', width: '100%', borderRadius: 'var(--radius-md)' }}
      />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}>
      <h1
        className="page-title"
        style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--fg-primary)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Runs
      </h1>
      <div
        className="surface-card"
        style={{ padding: 'var(--space-6) var(--space-8)', textAlign: 'center' }}
      >
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--status-failed)',
            marginBottom: 'var(--space-4)',
          }}
        >
          Could not load runs: {message}
        </p>
        <button className="btn-secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
