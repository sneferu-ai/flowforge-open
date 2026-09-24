import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, MailPlus } from 'lucide-react';
import { api, setCsrfToken, type MeResponse } from '../lib/api';
import { dur, ease, pacing, enterOffset } from '../lib/motion-tokens';

/**
 * Invitation acceptance (§8.2, §10.2 /invite).
 *
 * The server accepts invitations over POST /auth/invite/accept, which requires
 * an existing session (a pre-workspace session is fine). This page therefore:
 *   1. reads the raw token from ?token= (the inviter's one-time link secret),
 *   2. checks GET /auth/me to see whether the visitor is signed in,
 *   3. offers sign-in/register before accepting, preserving the token in the
 *      route so the visitor can return, then
 *   4. accepts and routes to the workspace picker / dashboard.
 */
export default function Invite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const [session, setSession] = useState<'checking' | 'none' | 'pre' | 'scoped'>('checking');
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<{ data: MeResponse }>('/auth/me')
      .then((r) => {
        if (!active) return;
        if (r.data.csrf_token) setCsrfToken(r.data.csrf_token);
        setSession(r.data.workspace ? 'scoped' : 'pre');
      })
      .catch(() => { if (active) setSession('none'); });
    return () => { active = false; };
  }, []);

  const accept = async () => {
    setError('');
    setAccepting(true);
    try {
      const res = await api.post<{
        data: { workspace: { id: string; name: string; slug: string | null }; csrf_token: string };
      }>('/auth/invite/accept', {
        token,
      });
      if (res.data.csrf_token) setCsrfToken(res.data.csrf_token);
      setAccepted(res.data.workspace?.name ?? null);
      // The server has scoped the session; land on the dashboard.
      window.setTimeout(() => navigate('/dashboard', { replace: true }), pacing('dur-redirect'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAccepting(false);
    }
  };

  const loginNext = `/login?next=/invite${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  const registerNext = `/register?next=/invite${token ? `&token=${encodeURIComponent(token)}` : ''}`;

  const missingToken = !token;

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
            Accept invitation
          </h1>
        </div>

        {accepted && (
          <div data-testid="invite-accepted" className="flex flex-col items-center" style={{ gap: 'var(--space-3)' }}>
            <CheckCircle2 style={{ width: 'var(--icon-xl)', height: 'var(--icon-xl)', color: 'var(--status-complete)' }} />
            <p className="text-center" style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
              Invitation accepted
              {accepted ? <> — you are now a member of <strong style={{ color: 'var(--fg-primary)' }}>{accepted}</strong></> : ''}.
            </p>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>Taking you to the dashboard…</p>
          </div>
        )}

        {!accepted && missingToken && (
          <div data-testid="invite-missing-token" className="flex flex-col items-center" style={{ gap: 'var(--space-3)' }}>
            <MailPlus style={{ width: 'var(--icon-xl)', height: 'var(--icon-xl)', color: 'var(--fg-tertiary)' }} />
            <p className="text-center" style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
              This invitation link is missing its token.
            </p>
            <p className="text-center" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-2)' }}>
              Ask the person who invited you to re-send the link from workspace settings.
            </p>
            <Link to="/login" className="btn-secondary w-full justify-center">Sign in</Link>
          </div>
        )}

        {!accepted && !missingToken && session === 'checking' && (
          <div className="flex flex-col gap-2" aria-label="Checking your session">
            <div className="skeleton" style={{ height: 'var(--skeleton-field-h)', borderRadius: 'var(--radius-sm)' }} />
            <div className="skeleton" style={{ height: 'var(--skeleton-field-h)', borderRadius: 'var(--radius-sm)' }} />
          </div>
        )}

        {!accepted && !missingToken && session === 'none' && (
          <div data-testid="invite-sign-in-first" className="flex flex-col items-center" style={{ gap: 'var(--space-3)' }}>
            <p className="text-center" style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
              You've been invited to join a workspace. Sign in or create an account first, then come back to this link to accept.
            </p>
            <Link to={loginNext} className="btn-primary w-full justify-center">Sign in</Link>
            <Link to={registerNext} className="btn-secondary w-full justify-center">Create account</Link>
          </div>
        )}

        {!accepted && !missingToken && (session === 'pre' || session === 'scoped') && (
          <div data-testid="invite-accept-form" className="flex flex-col items-center" style={{ gap: 'var(--space-4)' }}>
            <p className="text-center" style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
              You are signed in. Accept the invitation to join this workspace.
            </p>
            <button
              data-testid="invite-accept-btn"
              className="btn-primary w-full justify-center"
              onClick={() => void accept()}
              disabled={accepting}
              aria-label="Accept invitation"
            >
              {accepting ? 'Accepting…' : 'Accept invitation'}
            </button>
            {session === 'scoped' && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                Accepting adds this workspace to your account alongside the one you're in.
              </p>
            )}
          </div>
        )}

        {error && (
          <div id="invite-error" className="form-error" data-testid="invite-error" style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--status-failed)' }}>
            {error}
          </div>
        )}
      </motion.div>
    </div>
  );
}
