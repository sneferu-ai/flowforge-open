import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, fetchDemoCredentials, setCsrfToken, type LoginResponse } from '../lib/api';
import { completeWorkspaceSelection, nextWithPreservedParams } from '../lib/auth-flow';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

/** Only internal paths may be used as post-auth redirects. */
function safeNext(next: string | null): string | null {
  if (!next) return null;
  if (next.startsWith('/') && !next.startsWith('//') && !next.includes('://')) return next;
  return null;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoCredentials, setDemoCredentials] = useState<{ email: string; password: string } | null>(null);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  // §10.4 — when the server seeds the demo workspace, show the configured
  // credentials so a human can sign in immediately. Any null/error answer
  // renders nothing and the page is unchanged from the non-demo build.
  useEffect(() => {
    let active = true;
    fetchDemoCredentials().then((credentials) => {
      if (active && credentials) setDemoCredentials(credentials);
    });
    return () => {
      active = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.post<{ data: LoginResponse }>('/auth/login', { email, password });
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
      style={{ background: 'var(--bg-base)' }}
    >
      <motion.div
        data-testid="login-card"
        className="surface-card w-full max-w-sm"
        style={{ padding: 'var(--space-8)' }}
        initial={{ opacity: 0, y: enterOffset() }}
        animate={{ opacity: 1, y:0 }}
        transition={{ duration: dur('base'), ease: ease('emphasized') }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 'var(--logo-auth)', height: 'var(--logo-auth)', flexShrink: 0 }} className="auth-logo" aria-label="FlowForge logo">
            <path d="M12 2L22 7.5V16.5L12 22L2 16.5V7.5L12 2Z" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M12 7L17 9.75V14.25L12 17L7 14.25V9.75L12 7Z" fill="var(--accent)" fillOpacity="0.2" stroke="var(--accent)" strokeWidth="1" strokeLinejoin="round" />
          </svg>
          <h1
            className="brand-title"
            style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', fontFamily: 'var(--font-display)', marginTop: 'var(--space-3)' }}
          >
            FlowForge Open
          </h1>
        </div>

        {/* Demo credentials panel — display-only, plain text nodes (React
            escapes them). No interactive elements inside this subtree: the
            smoke journey reads the printed values and types them itself. */}
        {demoCredentials && (
          <div
            data-testid="demo-credentials"
            style={{
              marginBottom: 'var(--space-5)',
              padding: 'var(--space-4)',
              border: 'var(--border-width) solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-elevated)',
            }}
          >
            <p className="field-label" style={{ marginBottom: 'var(--space-2)' }}>
              Demo account
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-1)' }}>
              Email: <code data-testid="demo-credentials-email" style={{ fontFamily: 'var(--font-mono)' }}>{demoCredentials.email}</code>
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
              Password: <code data-testid="demo-credentials-password" style={{ fontFamily: 'var(--font-mono)' }}>{demoCredentials.password}</code>
            </p>
          </div>
        )}

        <form data-testid="login-form" onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="login-email" className="field-label">Email</label>
            <input
              id="login-email"
              data-testid="login-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              className="input-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@agency.test"
              disabled={busy}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
          <div>
            <label htmlFor="login-password" className="field-label">Password</label>
            <input
              id="login-password"
              data-testid="login-password"
              type="password"
              required
              autoComplete="current-password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={busy}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>

          {error && (
            <div id="login-error" data-testid="login-error" className="form-error" style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            data-testid="login-submit"
            className="btn-primary w-full justify-center"
            disabled={busy}
            aria-label="Sign in"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', textAlign: 'center' }}>
          No account?{' '}
          <Link to="/register" className="link-accent">
            Register
          </Link>
        </p>
        <SsoSection />
      </motion.div>
    </div>
  );
}

/**
 * OIDC SSO sign-in (§8.6). Rendered only when the public instance manifest
 * declares `features.oidc` — providers are named per workspace, so the user
 * enters the provider name their owner configured in Settings → SSO.
 */
function SsoSection() {
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/v1/manifest')
      .then((r) => r.json())
      .then((b: { data?: { features?: { oidc?: boolean } } }) => {
        if (active) setEnabled(b.data?.features?.oidc === true);
      })
      .catch(() => { /* flag stays false — no fake SSO button */ });
    return () => { active = false; };
  }, []);

  if (!enabled) return null;

  const submitProvider = (e: React.FormEvent) => {
    e.preventDefault();
    const name = provider.trim().toLowerCase();
    if (!name) {
      setError('Enter the SSO provider name your workspace owner configured');
      return;
    }
    setError('');
    window.location.href = `/api/v1/auth/oidc/${encodeURIComponent(name)}/login`;
  };

  return (
    <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-5)', borderTop: 'var(--border-width) solid var(--border-subtle)' }}>
      {!open ? (
        <button
          type="button"
          data-testid="sso-login-btn"
          className="btn-secondary w-full justify-center"
          onClick={() => setOpen(true)}
        >
          Sign in with SSO
        </button>
      ) : (
        <form onSubmit={submitProvider} className="flex flex-col gap-3">
          <label htmlFor="sso-provider" className="field-label">
            SSO provider name
          </label>
          <input
            id="sso-provider"
            className="input-field"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="your companys idp name"
            autoComplete="off"
          />
          {error && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--status-failed)' }}>{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1 justify-center">
              Continue to provider
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setOpen(false); setError(''); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
