import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, ReceiptText } from 'lucide-react';
import { api, type MeResponse } from '../lib/api';
import { toast } from '../lib/toast';
import { formatDateTime } from '../lib/status';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

interface UsageInfo {
  used: number;
  overage: number;
  active: number;
  limit: number | null;
  projected: number | null;
  reset_at: string;
  plan: { id: string; name: string; price_cents?: number };
}

interface SubscriptionInfo {
  plan_id: string;
  status: string;
  plan_name?: string;
  price_cents?: number;
  run_limit?: number | null;
  seat_limit?: number | null;
  overage_rate_cents?: number | null;
  run_history_days?: number | null;
  audit_retention_days?: number | null;
  workflow_timeout_hours?: number | null;
  rate_limit_per_min?: number | null;
  concurrency_limit?: number | null;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  plan?: {
    id: string;
    name: string;
    price_cents?: number;
    run_limit?: number | null;
    overage_rate_cents?: number | null;
  } | null;
}

interface InvoiceRow {
  id: string;
  period_start: string;
  period_end: string;
  plan_base_cents: number;
  overage_runs: number;
  overage_cents: number;
  total_cents: number;
  status: string;
  created_at: string;
}

const UPGRADES = [
  { id: 'free', name: 'Hosted Free', price: 0, note: '500 runs / month, 1 seat, 7-day history' },
  { id: 'pro', name: 'Pro', price: 29, note: '10,000 runs, 5 seats, 90-day history + audit' },
  { id: 'studio', name: 'Studio', price: 99, note: '50,000 runs, unlimited seats, OIDC SSO' },
];

export function cents(n?: number | null): string {
  if (n === null || n === undefined) return '—';
  return `$${(n / 100).toFixed(2)}`;
}

/** Plan & billing (§10.2 /settings/plan) — usage meter, plan switch, invoices. */
export default function SettingsPlan() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [invoicesDenied, setInvoicesDenied] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get<{ data: MeResponse }>('/auth/me')
      .then((r) => setMe(r.data))
      .catch(() => setMe(null));
    api
      .get<{ data: UsageInfo }>('/usage')
      .then((r) => setUsage(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    api
      .get<{ data: SubscriptionInfo }>('/subscription')
      .then((r) => setSubscription(r.data))
      .catch(() => setSubscription(null));
    api
      .get<{ data: InvoiceRow[] }>('/invoices')
      .then((r) => { setInvoices(r.data); setInvoicesDenied(false); })
      .catch(() => { setInvoices(null); setInvoicesDenied(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isOwner = me?.role === 'owner';

  const switchPlan = async (planId: string) => {
    setSwitching(planId);
    try {
      await api.post('/subscription', { plan_id: planId });
      toast(`Plan switched to ${planId}`);
      load();
    } catch (err) {
      toast(`Plan switch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSwitching(null);
    }
  };

  const pct = usage && usage.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : null;
  const resetLabel = usage ? formatDateTime(usage.reset_at) : '';

  return (
    <motion.div
      className="enter-fade-up"
      initial={{ opacity: 0, y: enterOffset() }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur('base'), ease: ease('default') }}
      style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}
    >
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
          Plan & billing
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
          One billable unit per run that reached a terminal state with at least one executed step (§D7).
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col" style={{ gap: 'var(--space-3)' }} role="status" aria-label="Loading plan and billing">
          <div className="skeleton" style={{ height: 'var(--skeleton-section-sm)', borderRadius: 'var(--radius-md)' }} />
          <div className="skeleton" style={{ height: 'var(--skeleton-section-md)', borderRadius: 'var(--radius-md)' }} />
        </div>
      ) : (
        <>
          {error && (
            <div className="surface-card" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-4)', textAlign: 'center' }}>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-2)' }}>
                Could not load usage: {error}
              </p>
              <button className="btn-secondary" onClick={load}>Try again</button>
            </div>
          )}

          {/* Usage meter */}
          {usage && (
            <div className="surface-panel" style={{ marginBottom: 'var(--space-6)' }}>
              <div className="flex items-center justify-between border-b" style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}>
                <span className="flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                  <CreditCard style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)', color: 'var(--accent)' }} />
                  Current period usage
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                  resets {resetLabel}
                </span>
              </div>
              <div style={{ padding: 'var(--space-4)' }}>
                <div className="flex items-baseline tabular-nums" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                    {usage.used}
                  </span>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                    of {usage.limit === null ? 'unlimited' : usage.limit} runs used
                    {usage.active > 0 ? ` · ${usage.active} active` : ''}
                  </span>
                  {usage.overage > 0 && (
                    <span className="badge" style={{ color: 'var(--status-paused)', borderColor: 'var(--status-paused-border)' }}>
                      +{usage.overage} overage
                    </span>
                  )}
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={usage.used}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(usage.used, usage.limit ?? 0)}
                  aria-label="Runs used this period"
                  style={{ height: 'var(--progress-bar-plan-h)', background: 'var(--bg-base)', borderRadius: 'var(--radius-pill)', overflow: 'hidden', border: 'var(--border-width) solid var(--border-subtle)' }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: usage.limit ? `${Math.min(100, pct ?? 0)}%` : '100%',
                      background: (pct ?? 0) >= 80 ? 'var(--status-paused)' : 'var(--accent)',
                      borderRadius: 'var(--radius-pill)',
                      transition: 'width var(--dur-base) var(--ease-default)',
                    }}
                  />
                </div>
                {usage.limit !== null && (pct ?? 0) >= 100 && (
                  <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--status-failed)' }}>
                    Hard cap reached — new runs are refused until the period resets or you upgrade.
                  </p>
                )}
                {usage.limit !== null && (pct ?? 0) >= 80 && (pct ?? 0) < 100 && (
                  <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--status-paused)' }}>
                    Over 80% of this period's allowance used. New runs still start, but you may hit the cap before reset.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Plan rows */}
          <div className="surface-panel" style={{ marginBottom: 'var(--space-6)' }}>
            <div className="border-b" style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                Plan — current: {subscription?.plan_name ?? usage?.plan?.name ?? subscription?.plan_id ?? 'unknown'}
              </span>
            </div>
            <div style={{ padding: 'var(--space-4)' }}>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(var(--col-plan-min), 1fr))', gap: 'var(--space-3)' }}>
                {UPGRADES.map((p) => {
                  const currentPlanId = subscription?.plan_id ?? usage?.plan?.id;
                  const isCurrent = currentPlanId === p.id;
                  return (
                    <div
                      key={p.id}
                      className="surface-card flex flex-col"
                      style={{
                        padding: 'var(--space-4)',
                        borderColor: isCurrent ? 'var(--accent)' : 'var(--border-default)',
                        background: isCurrent ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                      }}
                    >
                      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-1)' }}>
                        <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                          {p.name}
                        </span>
                        {isCurrent && <span className="badge badge-accent">current</span>}
                      </div>
                      <p className="tabular-nums" style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-1)' }}>
                        {p.price === 0 ? '$0' : `$${p.price}`}
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}> /mo</span>
                      </p>
                      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', flex: 1, marginBottom: 'var(--space-3)' }}>{p.note}</p>
                      <button
                        data-testid={`plan-select-${p.id}`}
                        className={(isCurrent ? 'btn-secondary' : 'btn-primary') + ' btn-sm'}
                        disabled={!isOwner || isCurrent || switching !== null}
                        onClick={() => void switchPlan(p.id)}
                        title={!isOwner ? 'Only the workspace owner can change the plan' : undefined}
                        style={{ fontSize: 'var(--text-sm)' }}
                      >
                        {switching === p.id ? 'Switching…' : isCurrent ? 'Current plan' : 'Switch to this plan'}
                      </button>
                    </div>
                  );
                })}
              </div>
              {!isOwner && (
                <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                  Plan changes are owner-only (§3.3 RBAC).
                </p>
              )}
            </div>
          </div>

          {/* Invoices */}
          <div className="surface-panel">
            <div className="flex items-center justify-between border-b" style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}>
              <span className="flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                <ReceiptText style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)', color: 'var(--accent)' }} />
                Invoices
              </span>
              {invoicesDenied && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>visible to workspace owners</span>
              )}
            </div>
            {invoices === null ? (
              <p style={{ padding: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                {invoicesDenied
                  ? 'Invoice history is owner-only (§3.3 RBAC).'
                  : 'Loading invoices…'}
              </p>
            ) : invoices.length === 0 ? (
              <p style={{ padding: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                No invoices yet — the first one appears when a billing period closes.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Base</th>
                    <th>Overage</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="tabular-nums" style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-xs)' }}>
                        {formatDateTime(inv.period_start).split(',')[0]} → {formatDateTime(inv.period_end).split(',')[0]}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--fg-secondary)' }}>{cents(inv.plan_base_cents)}</td>
                      <td className="tabular-nums" style={{ color: 'var(--fg-secondary)' }}>
                        {inv.overage_runs > 0 ? `${inv.overage_runs} runs · ${cents(inv.overage_cents)}` : '—'}
                      </td>
                      <td className="tabular-nums" style={{ color: 'var(--fg-primary)', fontWeight: 'var(--weight-medium)' }}>{cents(inv.total_cents)}</td>
                      <td><span className="badge badge-success">{inv.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
