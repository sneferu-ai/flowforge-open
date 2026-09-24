import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Building2,
  Copy,
  Globe,
  KeyRound,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api, type MeResponse } from '../lib/api';
import { toast } from '../lib/toast';
import { formatWhen } from '../lib/status';
import ConfirmDialog from '../components/ConfirmDialog';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

interface AllowlistEntry {
  id: string;
  scheme: string;
  host: string;
  port: number | null;
  created_at: string;
}

interface ApiTokenRow {
  id: string;
  name: string;
  /** jsonb on the server ('{}' seeded) — never rendered, kept loose. */
  scopes: unknown;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

interface MintedToken {
  id: string;
  name: string;
  token: string;
}

interface InviteResult {
  id: string;
  token: string;
  email: string;
  role: string;
  expires_at: string;
}

const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
type Role = (typeof ROLES)[number];

export default function Settings() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [tokens, setTokens] = useState<ApiTokenRow[]>([]);
  const [error, setError] = useState('');
  /* Per-section load failures — a failed list fetch must never render as
   * "none yet" (that would be a lie Maya acts on). */
  const [membersError, setMembersError] = useState('');
  const [allowlistError, setAllowlistError] = useState('');
  const [tokensError, setTokensError] = useState('');

  // allowlist add form
  const [alScheme, setAlScheme] = useState<'http' | 'https'>('https');
  const [alHost, setAlHost] = useState('');
  const [alPort, setAlPort] = useState('');
  const [alBusy, setAlBusy] = useState(false);

  // api token mint form
  const [tokenName, setTokenName] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [minted, setMinted] = useState<MintedToken | null>(null);

  // invite form
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState<Role>('member');
  const [invBusy, setInvBusy] = useState(false);
  const [invite, setInvite] = useState<InviteResult | null>(null);

  const [confirmAllowlistRemove, setConfirmAllowlistRemove] = useState<AllowlistEntry | null>(null);
  const [confirmTokenRevoke, setConfirmTokenRevoke] = useState<ApiTokenRow | null>(null);
  const [confirmMemberRemove, setConfirmMemberRemove] = useState<MemberRow | null>(null);

  const loadMembers = useCallback(() => {
    setMembersError('');
    api
      .get<{ data: MemberRow[] }>('/members')
      .then((r) => setMembers(r.data))
      .catch((e) => {
        setMembers([]);
        setMembersError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  const loadAllowlist = useCallback(() => {
    setAllowlistError('');
    api
      .get<{ data: AllowlistEntry[] }>('/allowlist')
      .then((r) => setAllowlist(r.data))
      .catch((e) => {
        setAllowlist([]);
        setAllowlistError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  const loadTokens = useCallback(() => {
    setTokensError('');
    api
      .get<{ data: ApiTokenRow[] }>('/api-tokens')
      .then((r) => setTokens(r.data))
      .catch((e) => {
        setTokens([]);
        setTokensError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get<{ data: MeResponse }>('/auth/me')
      .then((r) => { if (active) setMe(r.data); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    loadMembers();
    loadAllowlist();
    loadTokens();
    return () => { active = false; };
  }, [loadMembers, loadAllowlist, loadTokens]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch {
      toast('Copy failed — select and copy manually');
    }
  };

  const addAllowlistEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const host = alHost.trim().toLowerCase();
    if (!host) { toast('Host is required'); return; }
    let port: number | undefined;
    if (alPort.trim() !== '') {
      const n = Number(alPort);
      if (!Number.isInteger(n) || n < 1 || n > 65535) { toast('Port must be an integer 1–65535'); return; }
      port = n;
    }
    setAlBusy(true);
    try {
      await api.post('/allowlist', { scheme: alScheme, host, port: port ?? null });
      toast('Allowlist entry added');
      setAlHost('');
      setAlPort('');
      loadAllowlist();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setAlBusy(false);
    }
  };

  const removeAllowlistEntry = async (id: string, host: string) => {
    try {
      await api.delete(`/allowlist/${id}`);
      toast(`Removed '${host}'`);
      loadAllowlist();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  const mintToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenName.trim()) { toast('Token name is required'); return; }
    setTokenBusy(true);
    try {
      const r = await api.post<{ data: MintedToken }>('/api-tokens', { name: tokenName.trim() });
      setMinted(r.data);
      setTokenName('');
      loadTokens();
      toast('API token created — copy it now, it won’t be shown again');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setTokenBusy(false);
    }
  };

  const revokeToken = async (id: string, name: string) => {
    try {
      await api.delete(`/api-tokens/${id}`);
      toast(`Revoked '${name}'`);
      loadTokens();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  const inviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invEmail.trim()) { toast('Email is required'); return; }
    setInvBusy(true);
    try {
      const r = await api.post<{ data: InviteResult }>('/invitations', {
        email: invEmail.trim(),
        role: invRole,
      });
      setInvite(r.data);
      setInvEmail('');
      toast('Invitation created — copy the link, it won’t be shown again');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setInvBusy(false);
    }
  };

  const changeRole = async (userId: string, role: Role) => {
    try {
      await api.patch(`/members/${userId}/role`, { role });
      toast('Role updated');
      loadMembers();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  const removeMember = async (userId: string, name: string) => {
    try {
      await api.delete(`/members/${userId}`);
      toast(`Removed ${name}`);
      loadMembers();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <p style={{ color: 'var(--status-failed)', fontSize: 'var(--text-sm)' }}>
          Error: {error}
        </p>
      </div>
    );
  }
  if (!me) {
    return (
      <div style={{ padding: 'var(--space-8)' }} role="status" aria-label="Loading workspace settings">
        <div className="skeleton" style={{ height: 'var(--space-6)', width: 'calc(var(--space-8) * 5 + var(--space-3))', marginBottom: 'var(--space-6)' }} />
        <div className="skeleton" style={{ height: 'calc(var(--space-8) * 3)', width: '100%', marginBottom: 'var(--space-4)' }} />
        <div className="skeleton" style={{ height: 'calc(var(--space-8) * 3)', width: '100%' }} />
      </div>
    );
  }
  // The Layout guard routes pre-workspace sessions to the picker first.
  if (!me.workspace) {
    return (
      <div style={{ padding: 'var(--space-8)', color: 'var(--fg-tertiary)', fontSize: 'var(--text-sm)' }}>
        Select a workspace first.
      </div>
    );
  }

  const ws = me.workspace;
  // UI affordance only — the backend enforces RBAC authoritatively (§3.3).
  const canManageAllowlist = me.role === 'owner' || me.role === 'admin';
  const canManageMembers = me.role === 'owner' || me.role === 'admin';
  const canChangeRoles = me.role === 'owner';
  const canManageTokens = me.role === 'owner' || me.role === 'admin' || me.role === 'member';

  return (
    <motion.div
      className="enter-fade-up"
      initial={{ opacity: 0, y: enterOffset() }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur('base'), ease: ease('default') }}
      style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}
    >
      <h1
        className="page-title"
        style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--fg-primary)',
          marginBottom: 'var(--space-6)',
        }}
      >
        Workspace settings
      </h1>

      {/* Settings sections — quick navigation across the §10.2 surfaces */}
      <nav
        className="flex flex-wrap items-center"
        style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-8)' }}
        aria-label="Settings sections"
      >
        <NavPill to="/settings/approvals" label="Approvals" />
        <NavPill to="/settings/webhooks" label="Webhook secrets" />
        <NavPill to="/settings/plan" label="Plan & billing" />
        <NavPill to="/settings/sso" label="SSO (OIDC)" />
        <NavPill to="/credentials" label="Credential vault" />
        <NavPill to="/audit" label="Audit log" />
      </nav>

      {/* Workspace + Account summary */}
      <div className="grid split-half" style={{ gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
        <div className="surface-card" data-testid="settings-workspace-card" style={{ padding: 'var(--space-5)' }}>
          <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <Building2 style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--accent)' }} />
            <h2
              className="panel-heading"
              style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}
            >
              Workspace
            </h2>
          </div>
          <p style={{ color: 'var(--fg-primary)', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-medium)' }}>
            {ws.name}
          </p>
          <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
              Slug:{' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-secondary)' }}>
                {ws.slug ?? '—'}
              </span>
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
              Plan:{' '}
              <span style={{ color: 'var(--fg-secondary)' }}>{ws.plan_id}</span>
            </p>
          </div>
        </div>
        <div className="surface-card" data-testid="settings-account-card" style={{ padding: 'var(--space-5)' }}>
          <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <ShieldCheck style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--accent)' }} />
            <h2
              className="panel-heading"
              style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}
            >
              Account
            </h2>
          </div>
          <p style={{ color: 'var(--fg-primary)', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-medium)' }}>
            {me.user.name}
          </p>
          <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>{me.user.email}</p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
              Role:{' '}
              <span className="badge badge-accent" style={{ marginLeft: 'var(--space-1)' }}>
                {me.role ?? '—'}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Egress allowlist */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <SectionHeading icon={Globe} title="Egress allowlist" hint="Outbound hosts the workflow runtime may call (§8.8)." />
        <div className="surface-panel">
          <form
            onSubmit={addAllowlistEntry}
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: 'var(--border-width) solid var(--border-default)',
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <label htmlFor="al-scheme" className="field-label">Scheme</label>
              <select
                id="al-scheme"
                value={alScheme}
                onChange={(e) => setAlScheme(e.target.value as 'http' | 'https')}
                disabled={!canManageAllowlist}
                className="input-field"
                style={{ width: 'calc(var(--space-8) * 3)' }}
              >
                <option value="https">https</option>
                <option value="http">http</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 'calc(var(--space-8) * 5 + var(--space-3))' }}>
              <label htmlFor="al-host" className="field-label">Host</label>
              <input
                id="al-host"
                value={alHost}
                onChange={(e) => setAlHost(e.target.value)}
                placeholder="api.example.com"
                disabled={!canManageAllowlist}
                className="input-field"
                required
              />
            </div>
            <div style={{ width: 'calc(var(--space-8) * 3)' }}>
              <label htmlFor="al-port" className="field-label">Port</label>
              <input
                id="al-port"
                value={alPort}
                onChange={(e) => setAlPort(e.target.value)}
                placeholder="default"
                inputMode="numeric"
                disabled={!canManageAllowlist}
                className="input-field"
              />
            </div>
            <button type="submit" disabled={alBusy || !canManageAllowlist} className="btn-primary" aria-label="Add allowlist entry">
              {alBusy ? 'Adding…' : 'Add'}
            </button>
          </form>
          {allowlistError ? (
            <SectionLoadError what="allowlist entries" detail={allowlistError} onRetry={loadAllowlist} />
          ) : allowlist.length === 0 ? (
            <p style={{ padding: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
              No workspace allowlist entries. The app's own services (§8.8 environment entries) still resolve;
              other outbound calls from workflows will be refused.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Added</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {allowlist.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--fg-primary)' }}>
                        {e.scheme}://{e.host}{e.port ? `:${e.port}` : ''}
                      </span>
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }}>
                      {formatWhen(e.created_at)}
                    </td>
                    <td>
                      <div className="flex" style={{ gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => setConfirmAllowlistRemove(e)}
                          disabled={!canManageAllowlist}
                          className="btn-danger btn-sm"
                          title="Remove entry"
                          aria-label={`Remove ${e.host}`}
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
      </section>

      {/* API keys */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <SectionHeading icon={KeyRound} title="API keys" hint="Workspace-scoped bearer tokens (§8.4). Shown once at creation." />
        <div className="surface-panel">
          <form
            onSubmit={mintToken}
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: 'var(--border-width) solid var(--border-default)',
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 'calc(var(--space-8) * 6 + var(--space-1))' }}>
              <label htmlFor="token-name" className="field-label">Name</label>
              <input
                id="token-name"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="e.g. ci-deploy"
                disabled={!canManageTokens}
                className="input-field"
                required
              />
            </div>
            <button type="submit" disabled={tokenBusy || !canManageTokens} className="btn-primary" aria-label="Mint token">
              <KeyRound style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
              {tokenBusy ? 'Minting…' : 'Mint token'}
            </button>
          </form>

          {minted && (
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--accent-subtle)',
                borderBottom: 'var(--border-width) solid var(--border-default)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
              }}
            >
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', fontWeight: 'var(--weight-medium)' }}>
                Copy this token now — it cannot be retrieved later.
              </p>
              <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                <code
                  style={{
                    flex: 1,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--fg-primary)',
                    background: 'var(--bg-base)',
                    border: 'var(--border-width) solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2) var(--space-3)',
                    wordBreak: 'break-all',
                  }}
                >
                  {minted.token}
                </code>
                <button onClick={() => void copyToClipboard(minted.token)} className="btn-secondary" aria-label="Copy token">
                  <Copy style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                </button>
                <button onClick={() => setMinted(null)} className="btn-ghost" aria-label="Dismiss">
                  <X style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                </button>
              </div>
            </div>
          )}

          {tokensError ? (
            <SectionLoadError what="API tokens" detail={tokensError} onRetry={loadTokens} />
          ) : tokens.length === 0 ? (
            <p style={{ padding: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
              No API tokens minted.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span style={{ color: 'var(--fg-primary)', fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)' }}>
                        {t.name}
                      </span>
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }}>
                      {formatWhen(t.created_at)}
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }}>
                      {t.last_used_at ? formatWhen(t.last_used_at) : 'never'}
                    </td>
                    <td>
                      {t.revoked_at ? (
                        <span className="badge" style={{ color: 'var(--status-failed)', borderColor: 'var(--status-failed-border)' }}>
                          revoked
                        </span>
                      ) : (
                        <span className="badge badge-success">active</span>
                      )}
                    </td>
                    <td>
                      <div className="flex" style={{ gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => setConfirmTokenRevoke(t)}
                          disabled={!!t.revoked_at || !canManageTokens}
                          className="btn-danger btn-sm"
                          title="Revoke token"
                          aria-label={`Revoke ${t.name}`}
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
      </section>

      {/* Members */}
      <section>
        <SectionHeading icon={Users} title="Members" hint="Invite, change roles, or remove workspace members." />
        <div className="surface-panel">
          <form
            onSubmit={inviteMember}
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: 'var(--border-width) solid var(--border-default)',
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 'calc(var(--space-8) * 6 + var(--space-1))' }}>
              <label htmlFor="inv-email" className="field-label">Email</label>
              <input
                id="inv-email"
                type="email"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
                placeholder="teammate@example.com"
                disabled={!canManageMembers}
                className="input-field"
                required
              />
            </div>
            <div style={{ width: 'calc(var(--space-8) * 4 + var(--space-1))' }}>
              <label htmlFor="inv-role" className="field-label">Role</label>
              <select
                id="inv-role"
                value={invRole}
                onChange={(e) => setInvRole(e.target.value as Role)}
                disabled={!canManageMembers}
                className="input-field"
              >
                {ROLES.filter((r) => r !== 'owner').map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={invBusy || !canManageMembers} className="btn-primary" aria-label="Invite member">
              <UserPlus style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
              {invBusy ? 'Inviting…' : 'Invite'}
            </button>
          </form>

          {invite && (
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--accent-subtle)',
                borderBottom: 'var(--border-width) solid var(--border-default)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
              }}
            >
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', fontWeight: 'var(--weight-medium)' }}>
                Invitation link for {invite.email} — copy it now, it won't be shown again. Valid until {new Date(invite.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
              </p>
              <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                <code
                  style={{
                    flex: 1,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--fg-primary)',
                    background: 'var(--bg-base)',
                    border: 'var(--border-width) solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2) var(--space-3)',
                    wordBreak: 'break-all',
                  }}
                >
                  {inviteLink(invite.token)}
                </code>
                <button onClick={() => void copyToClipboard(inviteLink(invite.token))} className="btn-secondary" aria-label="Copy invite link">
                  <Copy style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                </button>
                <button onClick={() => setInvite(null)} className="btn-ghost" aria-label="Dismiss">
                  <X style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                </button>
              </div>
            </div>
          )}

          {membersError ? (
            <SectionLoadError what="members" detail={membersError} onRetry={loadMembers} />
          ) : members.length === 0 ? (
            <p style={{ padding: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
              No members listed.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span style={{ color: 'var(--fg-primary)', fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)' }}>
                        {m.name || m.email}
                      </span>
                    </td>
                    <td style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }}>{m.email}</td>
                    <td>
                      <select
                        value={m.role}
                        onChange={(e) => void changeRole(m.id, e.target.value as Role)}
                        disabled={!canChangeRoles}
                        className="input-field input-compact"
                        style={{ width: 'calc(var(--space-8) * 3 + var(--space-3))' }}
                        aria-label={`Role for ${m.name || m.email}`}
                        title={!canChangeRoles ? 'Only the workspace owner can change roles' : undefined}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }}>
                      {formatWhen(m.created_at)}
                    </td>
                    <td>
                      <div className="flex" style={{ gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => setConfirmMemberRemove(m)}
                          disabled={!canManageMembers}
                          className="btn-danger btn-sm"
                          title="Remove member"
                          aria-label={`Remove ${m.name || m.email}`}
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
      </section>

      <ConfirmDialog
        open={!!confirmAllowlistRemove}
        title="Remove allowlist entry"
        message={`Remove '${confirmAllowlistRemove?.host}'? Outbound calls to this host will be refused.`}
        confirmLabel="Remove"
        onConfirm={() => { if (confirmAllowlistRemove) void removeAllowlistEntry(confirmAllowlistRemove.id, confirmAllowlistRemove.host); setConfirmAllowlistRemove(null); }}
        onCancel={() => setConfirmAllowlistRemove(null)}
      />
      <ConfirmDialog
        open={!!confirmTokenRevoke}
        title="Revoke API token"
        message={`Revoke '${confirmTokenRevoke?.name}'? Anything using this token will stop authenticating immediately.`}
        confirmLabel="Revoke"
        onConfirm={() => { if (confirmTokenRevoke) void revokeToken(confirmTokenRevoke.id, confirmTokenRevoke.name); setConfirmTokenRevoke(null); }}
        onCancel={() => setConfirmTokenRevoke(null)}
      />
      <ConfirmDialog
        open={!!confirmMemberRemove}
        title="Remove member"
        message={`Remove '${confirmMemberRemove?.name || confirmMemberRemove?.email}'? They will lose workspace access.`}
        confirmLabel="Remove"
        onConfirm={() => { if (confirmMemberRemove) void removeMember(confirmMemberRemove.id, confirmMemberRemove.name || confirmMemberRemove.email); setConfirmMemberRemove(null); }}
        onCancel={() => setConfirmMemberRemove(null)}
      />
    </motion.div>
  );
}

function SectionHeading({ icon: Icon, title, hint }: { icon: React.ElementType; title: string; hint: string }) {
  return (
    <div
      className="flex items-center"
      style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}
    >
      <Icon style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--accent)' }} />
      <div className="flex flex-col">
        <h2
          className="panel-heading"
          style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}
        >
          {title}
        </h2>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>{hint}</span>
      </div>
    </div>
  );
}

function NavPill({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="badge"
      style={{
        textDecoration: 'none',
        textTransform: 'none',
        letterSpacing: 0,
        padding: 'var(--space-2) var(--space-3)',
        transition: 'border-color var(--dur-fast) var(--ease-default), color var(--dur-fast) var(--ease-default)',
      }}
    >
      {label}
    </Link>
  );
}

/** The invitation link the inviter copies once — raw token rides /invite (§8.2). */
function inviteLink(token: string): string {
  return `${window.location.origin}/invite?token=${encodeURIComponent(token)}`;
}

/** Honest section-level load failure — names what failed and the recovery,
 *  never masquerades as an empty list. */
function SectionLoadError({ what, detail, onRetry }: { what: string; detail: string; onRetry: () => void }) {
  return (
    <div
      data-testid={`settings-load-error-${what.replace(/\s+/g, '-')}`}
      style={{ padding: 'var(--space-5)', textAlign: 'center' }}
    >
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-2)' }}>
        Could not load {what}: {detail}
      </p>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-4)' }}>
        Check your connection and try again.
      </p>
      <button className="btn-secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
