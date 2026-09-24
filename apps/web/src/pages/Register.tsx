import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, setCsrfToken, type LoginResponse } from '../lib/api';
import { completeWorkspaceSelection, nextWithPreservedParams } from '../lib/auth-flow';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

/** Only internal paths may be used as post-registration redirects. */
function safeNext(next: string | null): string | null {
  if (!next) return null;
  if (next.startsWith('/') && !next.startsWith('//') && !next.includes('://')) return next;
  return null;
}

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.post<{ data: LoginResponse }>('/auth/register', {
        name: name.trim(),
        email: email.trim(),
        password,
        workspace_name: workspaceName.trim() || undefined,
      });
      setCsrfToken(res.data.csrf_token);
      if (next) {
        navigate(nextWithPreservedParams(next, params), { replace: true });
        return;
      }
      const path = await completeWorkspaceSelection(res.data);
      navigate(path, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
            Create your account
          </h1>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="reg-name" className="field-label">Name</label>
            <input
              id="reg-name"
              type="text"
              required
              autoComplete="name"
              autoFocus
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Maya Chen"
              disabled={busy}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'register-error' : undefined}
            />
          </div>
          <div>
            <label htmlFor="reg-email" className="field-label">Email</label>
            <input
              id="reg-email"
              type="email"
              required
              autoComplete="email"
              className="input-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@agency.test"
              disabled={busy}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'register-error' : undefined}
            />
          </div>
          <div>
            <label htmlFor="reg-password" className="field-label">Password</label>
            <input
              id="reg-password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
              disabled={busy}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'register-error' : undefined}
            />
          </div>
          <div>
            <label htmlFor="reg-workspace" className="field-label">Workspace name <span style={{ color: 'var(--fg-tertiary)' }}>(optional)</span></label>
            <input
              id="reg-workspace"
              type="text"
              className="input-field"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Acme Agency"
              disabled={busy}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'register-error' : undefined}
            />
          </div>

          {error && (
            <div id="register-error" className="form-error" style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full justify-center"
            disabled={busy}
            aria-label="Create account"
          >
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', textAlign: 'center' }}>
          Already have an account?{' '}
          <Link to="/login" className="link-accent">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
