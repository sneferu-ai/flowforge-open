import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, Bell, Clock, Layers, Workflow as WorkflowIcon, Zap } from 'lucide-react';
import { api, type DashboardData, type RunSummary } from '../lib/api';
import { StatusPill, statusDotClass, formatWhen } from '../lib/status';

interface UsageInfo {
  used: number;
  overage: number;
  active: number;
  limit: number | null;
  projected: number | null;
  reset_at: string;
  plan: { id: string; name: string };
}

/* Sparkline SVG coordinate geometry — these are the internal viewBox
 * coordinate system, not theme dimensions. SVG viewBox needs literal
 * numbers (CSS custom properties are strings and can't drive coordinate
 * math), so they live here as named constants rather than in tokens.css.
 * DESIGN.md §9/#14 exempts SVG data constants documented at module scope. */
const SPARKLINE_W = 288;
const SPARKLINE_H = 56;
const SPARKLINE_STROKE = 1.5;

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [sparkRuns, setSparkRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .get<{ data: DashboardData }>('/dashboard')
      .then((r) => { if (active) { setData(r.data); setLoading(false); } })
      .catch((e) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    api
      .get<{ data: UsageInfo }>('/usage')
      .then((r) => { if (active) setUsage(r.data); })
      .catch(() => { if (active) setUsage(null); });
    api
      .get<{ data: RunSummary[] }>('/runs?limit=100')
      .then((r) => { if (active) setSparkRuns(r.data); })
      .catch(() => { if (active) setSparkRuns([]); });
    return () => { active = false; };
  }, [attempt]);

  /* Runs-per-day over the last 14 days, from the most recent run history.
   * Derived client-side from the /runs feed — an aggregate view, not runoff. */
  const spark = useMemo(() => {
    const days: number[] = Array.from({ length: 14 }, () => 0);
    const now = new Date();
    for (const run of sparkRuns) {
      const d = new Date(run.created_at);
      const dayIndex = Math.floor((now.getTime() - d.getTime()) / 86400000);
      if (dayIndex >= 0 && dayIndex < 14) days[13 - dayIndex] += 1;
    }
    return days;
  }, [sparkRuns]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => setAttempt((a) => a + 1)} />;

  const isEmpty =
    (data?.workflow_count ?? 0) === 0 &&
    (data?.run_count ?? 0) === 0 &&
    (data?.recent_runs?.length ?? 0) === 0;

  if (isEmpty) {
    return (
      <div className="enter-fade-up" style={{ padding: 'var(--space-8)' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-2)' }}>
          Dashboard
        </h1>
        <div
          data-testid="dashboard-empty-state"
          className="surface-card flex flex-col items-center justify-center text-center"
          style={{ marginTop: 'var(--space-12)', padding: 'var(--space-16) var(--space-8)' }}
        >
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 'var(--empty-icon)', height: 'var(--empty-icon)', marginBottom: 'var(--space-4)', opacity: 0.5, flexShrink: 0 }}>
            <path d="M12 2L22 7.5V16.5L12 22L2 16.5V7.5L12 2Z" stroke="var(--accent)" strokeWidth="1" strokeLinejoin="round" />
            <path d="M12 7L17 9.75V14.25L12 17L7 14.25V9.75L12 7Z" fill="var(--accent)" fillOpacity="0.15" stroke="var(--accent)" strokeWidth="0.8" strokeLinejoin="round" />
          </svg>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-2)' }}>
            No workflows yet
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', maxWidth: 'var(--empty-max)', marginBottom: 'var(--space-6)' }}>
            Pick a template from the gallery and run your first workflow.
          </p>
          <Link
            to="/templates"
            data-testid="dashboard-browse-templates"
            className="btn-primary"
          >
            <Layers style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} />
            Browse templates
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="enter-fade-up" style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}>
      {/* Page title */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1
          className="page-title"
          style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}
        >
          Dashboard
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
          {data?.recent_runs?.length ?? 0} recent runs · {data?.pending_approval_count ?? 0} pending approvals
        </p>
      </div>

      {/* Compact stat strip — NOT big KPI cards */}
      <div
        className="surface-card flex items-stretch flex-wrap"
        style={{ marginBottom: 'var(--space-6)', padding: 0, overflow: 'hidden' }}
      >
        <StatInline icon={WorkflowIcon} label="Total Workflows" value={data?.workflow_count ?? 0} />
        <Divider />
        <StatInline icon={Activity} label="Total Runs" value={data?.run_count ?? 0} />
        <Divider />
        <StatInline
          icon={Clock}
          label="Pending approvals"
          value={data?.pending_approval_count ?? 0}
          accent={(data?.pending_approval_count ?? 0) > 0}
        />
        <Divider />
        <StatInline
          icon={Bell}
          label="Unread"
          value={data?.unread_notification_count ?? 0}
          accent={(data?.unread_notification_count ?? 0) > 0}
        />
      </div>

      {/* Two-column layout: recent runs + side panel */}
      <div className="grid gap-6 page-two-col">
        {/* Recent runs */}
        <div className="surface-panel">
          <div
            className="flex items-center justify-between border-b"
            style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}
          >
            <h2
              className="panel-heading"
              style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}
            >
              Recent runs
            </h2>
            <Link
              to="/runs"
              className="link-accent"
              style={{ fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
            >
              View all
              <ArrowRight style={{ width: 'var(--icon-xs)', height: 'var(--icon-xs)' }} />
            </Link>
          </div>
          {(data?.recent_runs?.length ?? 0) === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                No runs yet. Pick a template and run your first workflow.
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 'var(--col-gutter)' }}></th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>When</th>
                </tr>
              </thead>
              <tbody>
                {data!.recent_runs.slice(0, 8).map((run) => (
                  <tr
                    key={run.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/runs/${run.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <span
                        className="inline-block rounded-full shrink-0"
                        style={{ width: 'var(--status-dot)', height: 'var(--status-dot)', backgroundColor: statusDotClass(run.status) }}
                        aria-hidden="true"
                      />
                    </td>
                    <td>
                      <Link
                        to={`/runs/${run.id}`}
                        className="row-link"
                        style={{ fontWeight: 'var(--weight-medium)' }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`View run of ${run.workflow_name ?? run.id.slice(0, 8)}`}
                      >
                        {run.workflow_name ?? run.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td><StatusPill status={run.status} /></td>
                    <td className="tabular-nums" style={{ textAlign: 'right', color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }}>
                      {formatWhen(run.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Side panel: approvals + quick links */}
        <div className="flex flex-col gap-4">
          {/* Pending approvals */}
          <div className="surface-panel">
            <div
              className="flex items-center gap-2 border-b"
              style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}
            >
              <Clock style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)', color: 'var(--status-paused)' }} />
              <h2
                className="panel-heading"
                style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}
              >
                Approvals
              </h2>
              {(data?.pending_approval_count ?? 0) > 0 && (
                <span className="badge badge-accent" style={{ marginLeft: 'auto' }}>
                  {data?.pending_approval_count}
                </span>
              )}
            </div>
            <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
              {(data?.pending_approval_count ?? 0) === 0 ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                  No approvals waiting.
                </p>
              ) : (
                <Link
                  to="/settings/approvals"
                  className="link-accent"
                  style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
                >
                  Review {data?.pending_approval_count} pending
                  <ArrowRight style={{ width: 'var(--icon-xs)', height: 'var(--icon-xs)' }} />
                </Link>
              )}
            </div>
          </div>

          {/* Run usage meter (§3.3 plan caps) */}
          {usage && (
            <div className="surface-panel">
              <div
                className="flex items-center justify-between border-b"
                style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}
              >
                <h2 className="panel-heading" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                  Run usage
                </h2>
                <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                  {usage.plan?.name ?? 'plan'}
                </span>
              </div>
              <div style={{ padding: 'var(--space-4)' }}>
                <div className="flex items-baseline tabular-nums" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                    {usage.used}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                    of {usage.limit === null ? 'unlimited' : `${usage.limit} runs`} used
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={usage.used}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(usage.used, usage.limit ?? 0)}
                  aria-label="Runs used this period"
                  style={{ height: 'var(--progress-bar-h)', background: 'var(--bg-base)', borderRadius: 'var(--radius-pill)', overflow: 'hidden', border: 'var(--border-width) solid var(--border-subtle)' }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: usage.limit ? `${Math.min(100, Math.round((usage.used / usage.limit) * 100))}%` : '100%',
                      background: usage.limit && usage.used / usage.limit >= 0.8 ? 'var(--status-paused)' : 'var(--accent)',
                    }}
                  />
                </div>
                <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-2)' }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                    {usage.active > 0 ? `${usage.active} running` : 'idle'}
                    {usage.overage > 0 ? ` · ${usage.overage} overage` : ''}
                  </span>
                  <Link to="/settings/plan" className="link-accent" style={{ fontSize: 'var(--text-xs)' }}>
                    Plan & billing
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Runs per day — recent history sparkline */}
          {sparkRuns.length > 0 && (
            <div className="surface-panel">
              <div
                className="flex items-center justify-between border-b"
                style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}
              >
                <h2 className="panel-heading" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                  Runs per day
                </h2>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>last 14 days</span>
              </div>
              <div style={{ padding: 'var(--space-4)' }}>
                <Sparkline values={spark} />
                <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                  From the most recent run history.
                </p>
              </div>
            </div>
          )}

          {/* Quick links */}
          <div className="surface-panel">
            <div
              className="border-b"
              style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}
            >
              <h2
                className="panel-heading"
                style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}
              >
                Quick actions
              </h2>
            </div>
            <div className="flex flex-col" style={{ padding: 'var(--space-2)' }}>
              <Link to="/workflows/new" className="nav-item" style={{ margin: 0 }}>
                <Zap style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} />
                <span>New workflow</span>
              </Link>
              <Link to="/templates" className="nav-item" style={{ margin: 0 }}>
                <Layers style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} />
                <span>Browse templates</span>
              </Link>
              <Link to="/credentials" className="nav-item" style={{ margin: 0 }}>
                <WorkflowIcon style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} />
                <span>Add credential</span>
              </Link>
            </div>
          </div>

          {/* Recent workflows */}
          {(data?.recent_workflows?.length ?? 0) > 0 && (
            <div className="surface-panel">
              <div
                className="border-b"
                style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}
              >
                <h2
                  className="panel-heading"
                  style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}
                >
                  Recent workflows
                </h2>
              </div>
              <div className="flex flex-col" style={{ padding: 'var(--space-2)' }}>
                {data!.recent_workflows.slice(0, 5).map((wf) => (
                  <Link
                    key={wf.id}
                    to={`/workflows/${wf.id}`}
                    className="nav-item"
                    style={{ margin: 0, justifyContent: 'space-between' }}
                  >
                    <span className="truncate">{wf.name}</span>
                    <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                      {formatWhen(wf.updated_at)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatInline({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: number; accent?: boolean }) {
  return (
    <div className="stat-card flex-1 flex items-center gap-3" style={{ padding: 'var(--space-3) var(--space-4)', background: 'transparent', border: 'none', borderRadius: 0 }}>
      <Icon style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: accent ? 'var(--accent)' : 'var(--fg-tertiary)', flexShrink: 0 }} />
      <div className="flex flex-col min-w-0">
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1 }}>
          {label}
        </span>
        <span
          className="tabular-nums"
          style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: accent ? 'var(--accent)' : 'var(--fg-primary)', lineHeight: 'var(--line-tight)' }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="self-center" style={{ width: 'var(--border-width)', height: 'var(--divider-h)', background: 'var(--border-subtle)' }} />;
}

/** Minimal dependency-free SVG sparkline (one value per day). */
function Sparkline({ values }: { values: number[] }) {
  const w = SPARKLINE_W;
  const h = SPARKLINE_H;
  const max = Math.max(1, ...values);
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 4 - (v / max) * (h - 8)).toFixed(1)}`);
  const area = `0,${h} ${pts.join(' ')} ${w},${h}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      role="img"
      aria-label={`Runs per day: ${values.join(', ')}`}
      preserveAspectRatio="none"
    >
      <polygon points={area} fill="var(--accent-subtle)" />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={SPARKLINE_STROKE}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DashboardSkeleton() {
  return (
    <div style={{ padding: 'var(--space-8)' }} role="status" aria-label="Loading dashboard">
      <div className="skeleton" style={{ height: 'var(--skeleton-row-h)', width: 'calc(var(--space-8) * 3 + var(--space-4))', marginBottom: 'var(--space-6)' }} />
      <div className="skeleton" style={{ height: 'var(--skeleton-card-h)', width: '100%', marginBottom: 'var(--space-6)', borderRadius: 'var(--radius-md)' }} />
      <div className="grid gap-6 page-two-col">
        <div className="skeleton" style={{ height: 'var(--skeleton-tile-h)', borderRadius: 'var(--radius-md)' }} />
        <div className="skeleton" style={{ height: 'var(--skeleton-tile-h)', borderRadius: 'var(--radius-md)' }} />
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-6)' }}>
        Dashboard
      </h1>
      <div className="surface-card" style={{ padding: 'var(--space-6) var(--space-8)', textAlign: 'center' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-4)' }}>
          Could not load dashboard: {message}
        </p>
        <button className="btn-secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
