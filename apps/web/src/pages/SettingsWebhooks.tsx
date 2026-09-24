import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { formatWhen } from '../lib/status';
import ConfirmDialog from '../components/ConfirmDialog';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

interface WebhookSecretRow {
  id: string;
  name: string;
  created_at: string;
}

/** Webhook HMAC signing secrets (§10.2 /settings/webhooks). Names only —
 *  values are sealed write-only server-side. */
export default function SettingsWebhooks() {
  const [secrets, setSecrets] = useState<WebhookSecretRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WebhookSecretRow | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ data: WebhookSecretRow[] }>('/webhook-secrets')
      .then((r) => {
        setSecrets(r.data);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !value) {
      toast('Name and a non-empty value are required');
      return;
    }
    setBusy(true);
    try {
      await api.post('/webhook-secrets', { name: name.trim(), value });
      toast(`Secret '${name.trim()}' stored`);
      setName('');
      setValue('');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, secretName: string) => {
    try {
      await api.delete(`/webhook-secrets/${id}`);
      toast(`Deleted '${secretName}'`);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
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
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
          Webhook secrets
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
          HMAC signing secrets webhook triggers verify against. Workflows reference them as{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>secrets.{'{name}'}</code>.
        </p>
      </div>

      <div className="surface-panel" style={{ marginBottom: 'var(--space-6)' }}>
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
          <div style={{ flex: 1, minWidth: 'calc(var(--space-8) * 5)' }}>
            <label htmlFor="ws-name" className="field-label">Name</label>
            <input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="stripe"
              className="input-field"
              required
              pattern="[a-zA-Z][a-zA-Z0-9_-]{0,63}"
              title="Letters, numbers, dashes, underscores; starts with a letter"
            />
          </div>
          <div style={{ flex: 1, minWidth: 'calc(var(--space-8) * 5)' }}>
            <label htmlFor="ws-value" className="field-label">Value</label>
            <input
              id="ws-value"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="shown once, stored sealed"
              className="input-field"
              autoComplete="new-password"
            />
          </div>
          <button type="submit" disabled={busy} className="btn-primary" aria-label="Add secret">
            <Plus style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            {busy ? 'Storing…' : 'Add secret'}
          </button>
        </form>

        {loading ? (
          <div style={{ padding: 'var(--space-5)' }} role="status" aria-label="Loading webhook secrets">
            <div className="skeleton" style={{ height: 'var(--space-4)', width: 'calc(var(--space-8) * 6)', marginBottom: 'var(--space-3)' }} />
            <div className="skeleton" style={{ height: 'var(--space-4)', width: '60%' }} />
          </div>
        ) : error ? (
          <div style={{ padding: 'var(--space-5)', textAlign: 'center' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-3)' }}>
              Could not load secrets: {error}
            </p>
            <button className="btn-secondary" onClick={load}>Try again</button>
          </div>
        ) : secrets.length === 0 ? (
          <div className="flex flex-col items-center text-center" data-testid="webhooks-empty" style={{ padding: 'var(--space-12) var(--space-8)' }}>
            <KeyRound style={{ width: 'var(--icon-xl)', height: 'var(--icon-xl)', color: 'var(--fg-disabled)', marginBottom: 'var(--space-3)' }} />
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-2)' }}>
              No webhook secrets stored.
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', maxWidth: 'calc(var(--space-8) * 10)' }}>
              Add one, then reference it from a webhook trigger's auth config to sign and verify payloads.
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Added</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {secrets.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--fg-primary)', fontWeight: 'var(--weight-medium)' }}>
                      {s.name}
                    </span>
                  </td>
                  <td className="tabular-nums" style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }}>
                    {formatWhen(s.created_at)}
                  </td>
                  <td>
                    <div className="flex" style={{ gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => setConfirmDelete(s)}
                        className="btn-danger btn-sm"
                        title="Delete secret"
                        aria-label={`Delete ${s.name}`}
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
        open={!!confirmDelete}
        title="Delete webhook secret"
        message={`Delete '${confirmDelete?.name}'? Triggers verifying against this secret will start failing.`}
        confirmLabel="Delete"
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete.id, confirmDelete.name); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </motion.div>
  );
}
