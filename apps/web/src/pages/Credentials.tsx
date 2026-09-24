import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { EyeOff, KeyRound, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { formatWhen } from '../lib/status';
import ConfirmDialog from '../components/ConfirmDialog';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

interface CredentialRow {
  id: string;
  name: string;
  type: string;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  api_key: 'API key',
  password: 'Password',
  token: 'Token',
  other: 'Other',
};

export default function Credentials() {
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CredentialRow | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('api_key');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CredentialRow | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ data: CredentialRow[] }>('/credentials')
      .then((r) => { setCredentials(r.data); setError(''); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const openAdd = () => {
    setEditing(null);
    setName('');
    setType('api_key');
    setValue('');
    setAdding(true);
  };

  const openEdit = (c: CredentialRow) => {
    // Secrets are write-only — edit re-opens the form pre-filled with name +
    // type and requires a fresh value (re-POST acts as upsert on name).
    setEditing(c);
    setName(c.name);
    setType(c.type);
    setValue('');
    setAdding(true);
  };

  const closeForm = () => {
    setAdding(false);
    setEditing(null);
    setName('');
    setValue('');
    setType('api_key');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        // The vault exposes no in-place update; rotate = delete then re-create.
        // Delete enforces the §19 in-use guard (409 if an enabled workflow
        // still references the name) — a failed delete leaves the old secret.
        try {
          await api.delete(`/credentials/${editing.id}`);
        } catch (delErr) {
          toast(delErr instanceof Error ? delErr.message : String(delErr));
          return;
        }
        try {
          await api.post('/credentials', { name, type, value });
          toast(`Updated '${name}'`);
        } catch (createErr) {
          toast(
            `Removed old '${name}' but re-create failed: ${createErr instanceof Error ? createErr.message : String(createErr)}`,
          );
        }
      } else {
        await api.post('/credentials', { name, type, value });
        toast('Credential stored');
      }
      closeForm();
      load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, credentialName: string) => {
    try {
      await api.delete(`/credentials/${id}`);
      toast(`Deleted '${credentialName}'`);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <div style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-6)' }}>
          Credentials
        </h1>
        <div className="surface-card" style={{ padding: 'var(--space-6) var(--space-8)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-2)' }}>
            Could not load credentials: {error}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-4)' }}>
            Check your connection and try again.
          </p>
          <button className="btn-secondary" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="enter-fade-up"
      initial={{ opacity: 0, y: enterOffset() }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur('base'), ease: ease('default') }}
      style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}
    >
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 'var(--space-6)' }}
      >
        <div>
          <h1
            className="page-title"
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--fg-primary)',
            }}
          >
            Credentials
          </h1>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--fg-tertiary)',
              marginTop: 'var(--space-1)',
            }}
          >
            AES-256-GCM encrypted per workspace, referenced from manifests as{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>secrets.{'{name}'}</code>.
          </p>
        </div>
        <button
          data-testid="add-credential-btn"
          onClick={openAdd}
          className="btn-primary"
        >
          <Plus style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} />
          Add credential
        </button>
      </div>

      {adding && (
        <form
          onSubmit={submit}
          className="surface-card"
          data-testid="credential-form"
          style={{
            padding: 'var(--space-5)',
            marginBottom: 'var(--space-6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{ marginBottom: 'var(--space-1)' }}
          >
            <h2
              className="panel-heading"
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--fg-primary)',
              }}
            >
              {editing ? 'Update credential' : 'New credential'}
            </h2>
            <button type="button" onClick={closeForm} className="btn-ghost" aria-label="Cancel">
              <X style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} />
            </button>
          </div>

          <div className="grid split-half" style={{ gap: 'var(--space-3)' }}>
            <div>
              <label htmlFor="cred-name" className="field-label">Name</label>
              <input
                id="cred-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. STRIPE_KEY"
                required
                disabled={!!editing}
                className="input-field"
                style={editing ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
              />
            </div>
            <div>
              <label htmlFor="cred-type" className="field-label">Type</label>
              <select
                id="cred-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="input-field"
              >
                <option value="api_key">API key</option>
                <option value="password">Password</option>
                <option value="token">Token</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="cred-value" className="field-label">
              {editing ? 'New value (required to update)' : 'Value'}
            </label>
            <input
              id="cred-value"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              className="input-field"
              autoComplete="new-password"
            />
          </div>
          <div className="flex" style={{ gap: 'var(--space-2)' }}>
            <button type="submit" disabled={busy} className="btn-primary" aria-label={editing ? 'Update credential' : 'Store credential'}>
              {busy ? 'Storing…' : editing ? 'Update credential' : 'Store credential'}
            </button>
            <button type="button" onClick={closeForm} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="surface-card" style={{ padding: 'var(--space-5)' }} role="status" aria-label="Loading credentials">
          <div className="skeleton" style={{ height: 'var(--space-5)', width: 'calc(var(--space-8) * 5)', marginBottom: 'var(--space-3)' }} />
          <div className="skeleton" style={{ height: 'var(--space-3)', width: '60%' }} />
        </div>
      ) : credentials.length === 0 ? (
        <div
          className="surface-card"
          data-testid="credentials-empty-state"
          style={{
            padding: 'var(--space-12) var(--space-8)',
            textAlign: 'center',
          }}
        >
          <KeyRound
            style={{
              width: 'var(--icon-xl)',
              height: 'var(--icon-xl)',
              color: 'var(--fg-disabled)',
              margin: '0 auto var(--space-3)',
              display: 'block',
            }}
          />
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-2)' }}>
            No credentials stored.
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', maxWidth: 'calc(var(--space-8) * 10)', margin: '0 auto var(--space-4)', textAlign: 'center' }}>
            Add one, then reference it from your manifests as <code style={{ fontFamily: 'var(--font-mono)' }}>secrets.{'{name}'}</code>.
          </p>
          <button onClick={openAdd} className="btn-primary" data-testid="credentials-empty-add">
            Add credential
          </button>
        </div>
      ) : (
        <div className="surface-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 'calc(var(--icon-md) + var(--space-3))' }}></th>
                <th>Name</th>
                <th>Type</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((c) => (
                <tr key={c.id} data-testid={`credential-row-${c.name}`}>
                  <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    <EyeOff style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)', color: 'var(--fg-tertiary)' }} />
                  </td>
                  <td>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-sm)',
                        color: 'var(--fg-primary)',
                        fontWeight: 'var(--weight-medium)',
                      }}
                    >
                      {c.name}
                    </span>
                  </td>
                  <td>
                    <span className="badge">{TYPE_LABELS[c.type] ?? c.type}</span>
                  </td>
                  <td
                    className="tabular-nums"
                    style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }}
                  >
                    {formatWhen(c.created_at)}
                  </td>
                  <td>
                    <div
                      className="flex items-center"
                      style={{ gap: 'var(--space-1)', justifyContent: 'flex-end' }}
                    >
                      <button
                        onClick={() => openEdit(c)}
                        className="btn-ghost btn-sm"
                        title="Edit credential"
                        aria-label={`Edit ${c.name}`}
                      >
                        <Pencil style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                      </button>
                      <button
                        data-testid={`credential-delete-${c.name}`}
                        onClick={() => setConfirmDelete(c)}
                        className="btn-danger btn-sm"
                        title="Delete credential"
                        aria-label={`Delete ${c.name}`}
                      >
                        <Trash2 style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete credential"
        message={`Delete '${confirmDelete?.name}'? Workflows referencing this secret will need updating.`}
        confirmLabel="Delete"
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete.id, confirmDelete.name); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </motion.div>
  );
}
