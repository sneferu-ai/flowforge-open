import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, Plus, Trash2, TestTube2 } from 'lucide-react';
import { api, type MeResponse } from '../lib/api';
import { toast } from '../lib/toast';
import { formatWhen } from '../lib/status';
import ConfirmDialog from '../components/ConfirmDialog';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

interface OidcProviderRow {
  id: string;
  name: string;
  issuer_url: string;
  client_id: string;
  created_at: string;
}

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/** OIDC SSO providers (§10.2 /settings/sso) — Studio plan, owner-managed. */
export default function SettingsSso() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [providers, setProviders] = useState<OidcProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<OidcProviderRow | null>(null);

  const isOwner = me?.role === 'owner';
  const planIsStudio = me?.workspace?.plan_id === 'studio';

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ data: OidcProviderRow[] }>('/oidc/providers')
      .then((r) => {
        setProviders(r.data);
        setError('');
        setErrorStatus(null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setErrorStatus(e instanceof Error && 'status' in e ? (e as { status: number }).status : null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api
      .get<{ data: MeResponse }>('/auth/me')
      .then((r) => setMe(r.data))
      .catch(() => setMe(null));
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!NAME_RE.test(n)) {
      toast('Name must start with a letter and use only letters, numbers, dashes, underscores');
      return;
    }
    if (!issuerUrl.trim() || !clientId.trim() || !clientSecret) {
      toast('issuer URL, client ID, and client secret are all required');
      return;
    }
    setBusy(true);
    try {
      await api.post('/oidc/providers', {
        name: n.toLowerCase(),
        issuer_url: issuerUrl.trim(),
        client_id: clientId.trim(),
        client_secret: clientSecret,
      });
      toast(`Provider '${n.toLowerCase()}' added`);
      setName('');
      setIssuerUrl('');
      setClientId('');
      setClientSecret('');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeProvider = async (id: string, providerName: string) => {
    try {
      await api.delete(`/oidc/providers/${id}`);
      toast(`Removed '${providerName}'`);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  const testProvider = (providerName: string) => {
    /* Opens the real OIDC authorization redirect in a new tab (§8.6). */
    window.open(`/api/v1/auth/oidc/${encodeURIComponent(providerName.toLowerCase())}/login`, '_blank', 'noopener');
  };

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
          SSO providers (OIDC)
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
          Studio plan feature. Members sign in via <code style={{ fontFamily: 'var(--font-mono)' }}>/login → Sign in with SSO</code>{' '}
          using the provider name.
        </p>
      </div>

      {!planIsStudio && !loading && (
        <div
          className="surface-card"
          data-testid="sso-plan-gate"
          style={{
            padding: 'var(--space-5)',
            marginBottom: 'var(--space-6)',
            borderColor: 'var(--status-paused-border)',
            background: 'var(--status-paused-subtle)',
          }}
        >
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-primary)' }}>
            OIDC SSO requires the Studio plan.
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginTop: 'var(--space-1)' }}>
            The server refuses provider creation on other plans (§3.3). Switch plans in Plan & billing, then return here.
          </p>
        </div>
      )}

      <div className="surface-panel" style={{ marginBottom: 'var(--space-6)' }}>
        {planIsStudio && (
          <form
            onSubmit={add}
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: 'var(--border-width) solid var(--border-default)',
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ width: 'var(--col-action)' }}>
              <label htmlFor="oidc-name" className="field-label">Name</label>
              <input
                id="oidc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="company-idp"
                className="input-field"
                disabled={!isOwner}
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 'var(--col-when)' }}>
              <label htmlFor="oidc-issuer" className="field-label">Issuer URL</label>
              <input
                id="oidc-issuer"
                type="url"
                value={issuerUrl}
                onChange={(e) => setIssuerUrl(e.target.value)}
                placeholder="https://idp.example.com"
                className="input-field"
                disabled={!isOwner}
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 'calc(var(--space-8) * 5)' }}>
              <label htmlFor="oidc-client-id" className="field-label">Client ID</label>
              <input
                id="oidc-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="input-field"
                disabled={!isOwner}
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 'calc(var(--space-8) * 5)' }}>
              <label htmlFor="oidc-client-secret" className="field-label">Client secret</label>
              <input
                id="oidc-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="input-field"
                autoComplete="new-password"
                disabled={!isOwner}
                required
              />
            </div>
            <button type="submit" disabled={busy || !isOwner} className="btn-primary" aria-label="Add provider">
              <Plus style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
              {busy ? 'Adding…' : 'Add provider'}
            </button>
          </form>
        )}

        {loading ? (
          <div style={{ padding: 'var(--space-5)' }} role="status" aria-label="Loading SSO providers">
            <div className="skeleton" style={{ height: 'var(--space-4)', width: 'calc(var(--space-8) * 6 + var(--space-1))', marginBottom: 'var(--space-3)' }} />
            <div className="skeleton" style={{ height: 'var(--space-4)', width: '60%' }} />
          </div>
        ) : error ? (
          <div data-testid="sso-error" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-2)' }}>
              Could not load providers: {error}
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-4)' }}>
              {errorStatus === 403
                ? 'Your plan does not include OIDC SSO — upgrade to Studio to use this page.'
                : 'Check your connection and try again.'}
            </p>
            <button className="btn-secondary" onClick={load}>Try again</button>
          </div>
        ) : providers.length === 0 ? (
          <div className="flex flex-col items-center text-center" data-testid="sso-empty" style={{ padding: 'var(--space-12) var(--space-8)' }}>
            <Globe style={{ width: 'var(--icon-xl)', height: 'var(--icon-xl)', color: 'var(--fg-disabled)', marginBottom: 'var(--space-3)' }} />
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-2)' }}>
              {planIsStudio ? 'No OIDC providers configured.' : 'OIDC SSO is not enabled on this plan.'}
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', maxWidth: 'var(--empty-max)' }}>
              {planIsStudio
                ? 'Add your identity provider above. For local testing, the bundled mock IdP publishes its discovery document at /mock-idp/.well-known/openid-configuration.'
                : 'See Plan & billing to enable SSO.'}
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Issuer</th>
                <th>Client ID</th>
                <th>Added</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--fg-primary)', fontWeight: 'var(--weight-medium)' }}>
                      {p.name}
                    </span>
                  </td>
                  <td>
                    <span className="font-mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', wordBreak: 'break-all' }}>
                      {p.issuer_url}
                    </span>
                  </td>
                  <td>
                    <span className="font-mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)' }}>
                      {p.client_id}
                    </span>
                  </td>
                  <td className="tabular-nums" style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }}>
                    {formatWhen(p.created_at)}
                  </td>
                  <td>
                    <div className="flex" style={{ gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
                      <button
                        data-testid={`sso-test-${p.name}`}
                        className="btn-ghost btn-sm"
                        title="Test authorization redirect"
                        aria-label={`Test ${p.name}`}
                        onClick={() => testProvider(p.name)}
                      >
                        <TestTube2 style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                      </button>
                      <button
                        className="btn-danger btn-sm"
                        title="Delete provider"
                        aria-label={`Delete ${p.name}`}
                        disabled={!isOwner}
                        onClick={() => setConfirmDelete(p)}
                      >
                        <Trash2 style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Remove SSO provider"
        message={`Remove '${confirmDelete?.name}'? Users who sign in with this provider will lose access.`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDelete) void removeProvider(confirmDelete.id, confirmDelete.name);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </motion.div>
  );
}
