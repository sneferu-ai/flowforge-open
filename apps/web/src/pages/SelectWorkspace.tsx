import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, setCsrfToken, clearCsrfToken, clearBearerToken, type MeResponse, type SelectWorkspaceResponse, type WorkspaceInfo } from '../lib/api';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

export default function SelectWorkspace() {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[] | null>(null);
  const [error, setError] = useState('');
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<{ data: MeResponse }>('/auth/me')
      .then((r) => {
        if (r.data.csrf_token) setCsrfToken(r.data.csrf_token);
        if (r.data.workspace) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setWorkspaces(r.data.workspaces ?? []);
      })
      .catch(() => navigate('/login', { replace: true }));
  }, [navigate]);

  const pick = async (ws: WorkspaceInfo) => {
    if (!ws.slug) return;
    setError('');
    setBusySlug(ws.slug);
    try {
      const res = await api.post<{ data: SelectWorkspaceResponse }>('/auth/select-workspace', {
        workspace_slug: ws.slug,
      });
      setCsrfToken(res.data.csrf_token);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusySlug(null);
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch { /* non-fatal */ }
    clearCsrfToken();
    clearBearerToken();
    navigate('/login', { replace: true });
  };

  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{ background: 'var(--bg-base)', padding: 'var(--space-4)' }}
    >
      <motion.div
        className="surface-card w-full max-w-sm"
        style={{ padding: 'var(--space-8)' }}
        initial={{ opacity: 0, y: enterOffset() }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: dur('base'), ease: ease('emphasized') }}
      >
        <div className="flex flex-col items-center mb-8">
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 'var(--logo-auth)', height: 'var(--logo-auth)', flexShrink: 0 }} aria-label="FlowForge logo">
            <path d="M12 2L22 7.5V16.5L12 22L2 16.5V7.5L12 2Z" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M12 7L17 9.75V14.25L12 17L7 14.25V9.75L12 7Z" fill="var(--accent)" fillOpacity="0.2" stroke="var(--accent)" strokeWidth="1" strokeLinejoin="round" />
          </svg>
          <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', fontFamily: 'var(--font-display)', marginTop: 'var(--space-3)' }}>
            Choose a workspace
          </h1>
        </div>

        {workspaces === null && (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading workspaces">
            <div className="skeleton" style={{ height: 'var(--skeleton-input-h)', borderRadius: 'var(--radius-sm)' }} />
            <div className="skeleton" style={{ height: 'var(--skeleton-input-h)', borderRadius: 'var(--radius-sm)' }} />
          </div>
        )}

        {workspaces !== null && workspaces.length === 0 && (
          <div
            className="flex flex-col items-center text-center"
            data-testid="no-workspaces"
            style={{ gap: 'var(--space-3)', padding: 'var(--space-4) 0' }}
          >
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
              This account has no workspaces yet.
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-2)' }}>
              Create one to start — it takes a minute and lands you in the onboarding wizard.
            </p>
            <Link to="/onboarding" className="btn-primary">
              Create a workspace
            </Link>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {(workspaces ?? []).map((ws) => (
            <button
              key={ws.slug ?? ws.id}
              data-testid={`workspace-option-${ws.slug}`}
              disabled={busySlug !== null}
              onClick={() => void pick(ws)}
              className="surface-card text-left"
              aria-label={ws.name}
              style={{
                padding: 'var(--space-3) var(--space-4)',
                cursor: busySlug !== null ? 'wait' : 'pointer',
                opacity: busySlug !== null && busySlug !== ws.slug ? 0.5 : 1,
                transition: 'border-color var(--dur-fast) var(--ease-default)',
              }}
            >
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--fg-primary)' }}>
                {busySlug === ws.slug ? 'Opening…' : ws.name}
              </div>
              <div className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {ws.slug} · {ws.role ?? 'member'}
              </div>
            </button>
          ))}
        </div>

        {workspaces !== null && workspaces.length > 0 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Link
              to="/onboarding"
              data-testid="select-workspace-new"
              className="nav-item"
              style={{ margin: 0, justifyContent: 'center' }}
            >
              Create a new workspace
            </Link>
          </div>
        )}

        {error && (
          <p id="select-workspace-error" className="form-error" style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginTop: 'var(--space-3)' }} data-testid="select-workspace-error">
            {error}
          </p>
        )}

        <p style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
          <button onClick={() => void handleLogout()} className="link-accent" style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>
            Sign out
          </button>
        </p>
      </motion.div>
    </div>
  );
}
