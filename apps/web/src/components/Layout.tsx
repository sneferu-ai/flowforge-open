import { useEffect, useState, useCallback, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Workflow, PlayCircle, KeyRound, ScrollText, Layers,
  ChevronLeft, LogOut, Bell, Menu, X, Settings as SettingsIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  api, clearCsrfToken, setCsrfToken, clearBearerToken,
  type MeResponse,
} from '../lib/api';
import { tryBootstrapAuth } from '../lib/bootstrap';
import { pacing } from '../lib/motion-tokens';
import { StatusPill } from '../lib/status';
import CommandPalette from './CommandPalette';
import Toasts from './Toasts';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/templates', label: 'Templates', icon: Layers },
  { to: '/runs', label: 'Runs', icon: PlayCircle },
  { to: '/credentials', label: 'Credentials', icon: KeyRound },
  { to: '/audit', label: 'Audit', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

interface UsageInfo {
  used: number;
  overage: number;
  active: number;
  limit: number | null;
  projected: number | null;
  reset_at: string;
  plan: { id: string; name: string };
}

export default function Layout() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [usageBannerDismissed, setUsageBannerDismissed] = useState(false);
  const paletteTriggerRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  /* Auth bootstrap: try Sneferu preview bootstrap first, then normal /auth/me */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const boot = await tryBootstrapAuth();
      if (cancelled) return;
      if (boot) {
        setMe(boot.me);
        if (boot.path !== '/dashboard' && location.pathname !== boot.path) {
          navigate(boot.path, { replace: true });
        }
        setAuthChecked(true);
        return;
      }
      /* Normal flow */
      try {
        const r = await api.get<{ data: MeResponse }>('/auth/me');
        if (cancelled) return;
        if (!r.data.workspace) {
          navigate('/select-workspace', { replace: true });
          return;
        }
        if (r.data.csrf_token) setCsrfToken(r.data.csrf_token);
        setMe(r.data);
      } catch {
        if (cancelled) return;
        navigate('/login', { replace: true });
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, location.pathname]);

  /* Viewport size — mobile navigation switches the sidebar to an overlay.
   * Breakpoint mirrors --bp-mobile in tokens.css (media queries cannot
   * resolve custom properties, so the literal is repeated here). */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* Close the mobile nav whenever the route changes. */
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  /* When the mobile sidebar is off-canvas, take its links out of the tab
   * order (inert) so keyboard users don't land on invisible nav items. */
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    const hidden = isMobile && !mobileNavOpen;
    if (hidden) {
      aside.setAttribute('inert', '');
      aside.setAttribute('aria-hidden', 'true');
    } else {
      aside.removeAttribute('inert');
      aside.removeAttribute('aria-hidden');
    }
  }, [isMobile, mobileNavOpen]);

  /* Poll unread notifications — the inbox feed rows carry is_read (§8.7);
   * unread = rows not yet read, counted client-side. */
  useEffect(() => {
    if (!me) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await api.get<{ data: Array<{ id: string; is_read: boolean }> }>('/notifications');
        if (active) setUnread(r.data.filter((n) => !n.is_read).length);
      } catch { /* non-fatal */ }
    };
    poll();
    const id = setInterval(poll, pacing('dur-poll-notifications'));
    return () => { active = false; clearInterval(id); };
  }, [me]);

  /* Load run usage once per workspace session — drives the §3.3 80% banner. */
  useEffect(() => {
    if (!me) return;
    let active = true;
    api
      .get<{ data: UsageInfo }>('/usage')
      .then((r) => { if (active) setUsage(r.data); })
      .catch(() => { if (active) setUsage(null); });
    return () => { active = false; };
  }, [me?.workspace?.id]);

  /* ⌘K opens command palette */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      /* Chromium reports the letter as 'K' when a modifier is held — compare
       * case-insensitively so ⌘K/Ctrl+K open the palette on every engine. */
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((p) => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    /* Focus restore is owned by CommandPalette's unmount cleanup
     * (WAI-ARIA dialog pattern — DESIGN.md §7b). */
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch { /* non-fatal */ }
    clearCsrfToken();
    clearBearerToken();
    navigate('/login', { replace: true });
  }, [navigate]);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg-base)' }} role="status" aria-label="Checking your session">
        <div className="skeleton h-6 w-32" aria-hidden="true" />
      </div>
    );
  }

  if (!me) return null;

  const usagePct =
    usage && usage.limit
      ? Math.min(100, Math.round(((usage.used + (usage.active ?? 0)) / usage.limit) * 100))
      : null;
  const showUsageBanner = usagePct !== null && usagePct >= 80 && !usageBannerDismissed;

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Mobile nav backdrop */}
      {isMobile && mobileNavOpen && (
        <div
          className="sidebar-backdrop fixed inset-0"
          style={{
            background: 'var(--overlay-backdrop)',
            zIndex: 'var(--z-modal-bg)',
          }}
          onClick={() => setMobileNavOpen(false)}
          role="presentation"
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        ref={asideRef}
        className={cn('app-sidebar fixed inset-y-0 left-0 flex flex-col border-r', mobileNavOpen && 'sidebar-open')}
        style={{
          width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)',
          zIndex: isMobile ? 'var(--z-modal)' : 'var(--z-sidebar)',
          background: 'var(--bg-base)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        {/* Brand */}
        <div
          className="flex items-center border-b shrink-0"
          style={{ gap: 'var(--space-2)', height: 'var(--topbar-height)', padding: collapsed ? '0 var(--space-4)' : '0 var(--space-5)', borderColor: 'var(--border-subtle)' }}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ width: 'var(--icon-lg)', height: 'var(--icon-lg)' }}>
            <path
              d="M12 2L22 7.5V16.5L12 22L2 16.5V7.5L12 2Z"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M12 7L17 9.75V14.25L12 17L7 14.25V9.75L12 7Z" fill="var(--accent)" fillOpacity="0.2" stroke="var(--accent)" strokeWidth="1" strokeLinejoin="round" />
          </svg>
          {!collapsed && (
            <span
              className="sidebar-brand font-semibold tracking-tight"
              style={{ fontSize: 'var(--text-base)', color: 'var(--fg-primary)', fontFamily: 'var(--font-display)' }}
            >
              FlowForge
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 flex flex-col gap-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn('nav-item', isActive && 'nav-item-active')}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
            >
              <item.icon style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', flexShrink: 0 }} />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer: workspace, collapse, logout */}
        <div className="border-t shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
          {!collapsed && me.workspace && (
            <div className="px-4" style={{ paddingTop: 'var(--space-3)', paddingBottom: 'var(--space-3)' }}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Workspace
              </p>
              <p className="truncate tabular-nums" style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', fontWeight: 'var(--weight-medium)' }}>
                {me.workspace.name}
              </p>
            </div>
          )}
          <div className="flex items-center gap-1 px-2 pb-2">
            {!collapsed && (
              <button
                className="btn-ghost btn-sm flex-1 justify-center"
                style={{ fontSize: 'var(--text-xs)' }}
                onClick={() => navigate('/settings')}
                aria-label="Settings"
              >
                <SettingsIcon style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                Settings
              </button>
            )}
            {collapsed && (
              <button
                className="btn-ghost btn-sm w-full justify-center"
                onClick={() => navigate('/settings')}
                aria-label="Settings"
              >
                <SettingsIcon style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} />
              </button>
            )}
            <button
              data-testid="logout-btn"
              className="btn-ghost btn-sm justify-center"
              style={{ padding: '0 var(--space-3)' }}
              onClick={logout}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut style={{ width: collapsed ? 'var(--icon-md)' : 'var(--icon-sm)', height: collapsed ? 'var(--icon-md)' : 'var(--icon-sm)' }} />
            </button>
          </div>
          <button
            className="sidebar-toggle w-full border-t"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--fg-tertiary)' }}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft
              style={{
                width: 'var(--icon-md)',
                height: 'var(--icon-md)',
                transform: collapsed ? 'rotate(180deg)' : 'none',
                transition: 'transform var(--dur-fast) var(--ease-default)',
              }}
            />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div
        className="flex-1 flex flex-col min-w-0"
        style={{ marginLeft: isMobile ? 0 : (collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)') }}
      >
        {/* Top bar */}
        <header
          className="flex items-center justify-between border-b shrink-0 sticky top-0"
          style={{
            height: 'var(--topbar-height)',
            padding: '0 var(--space-6)',
            background: 'var(--bg-base)',
            borderColor: 'var(--border-subtle)',
            zIndex: 'var(--z-sticky)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            {isMobile && (
              <button
                data-testid="mobile-menu-btn"
                className="btn-ghost btn-sm"
                style={{ padding: '0 var(--space-2)', flexShrink: 0 }}
                onClick={() => setMobileNavOpen((o) => !o)}
                aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
                aria-expanded={mobileNavOpen}
              >
                {mobileNavOpen ? <X style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} /> : <Menu style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} />}
              </button>
            )}
            <button
              ref={paletteTriggerRef}
              className="flex items-center gap-2 text-fg-tertiary hover:text-fg-secondary min-w-0"
              style={{ fontSize: 'var(--text-xs)', transition: 'color var(--dur-fast)' }}
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
            >
              <span className="opacity-60 truncate">Search…</span>
              <kbd
                className="badge"
                style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-hairline) var(--space-2)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}
              >
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              className="relative flex items-center justify-center"
              style={{ width: 'var(--btn-touch-min)', height: 'var(--btn-touch-min)', color: 'var(--fg-secondary)' }}
              onClick={() => navigate('/runs')}
              aria-label={`Notifications${unread > 0 ? ` — ${unread} unread` : ''}`}
              title={unread > 0 ? `${unread} unread notifications — they summarize run activity; open Runs to verify` : 'No unread notifications'}
            >
              <Bell style={{ width: 'var(--icon-md)', height: 'var(--icon-md)' }} />
              {unread > 0 && (
                <span
                  className="absolute tabular-nums"
                  style={{
                    top: 'var(--space-1)',
                    right: 'var(--space-1)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--accent-contrast)',
                    background: 'var(--accent)',
                    borderRadius: 'var(--radius-pill)',
                    padding: '0 var(--space-1)',
                    minWidth: 'var(--icon-sm)',
                    textAlign: 'center',
                    lineHeight: 'var(--icon-sm)',
                  }}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* §3.3 — 80%-of-allowance banner for capped plans */}
        {showUsageBanner && usage && (
          <div
            data-testid="usage-banner"
            className="flex items-center gap-3 flex-wrap"
            style={{
              padding: 'var(--space-2) var(--space-6)',
              background: 'var(--status-paused-subtle)',
              borderBottom: 'var(--border-width) solid var(--status-paused-border)',
              fontSize: 'var(--text-sm)',
            }}
          >
            <span style={{ color: 'var(--fg-primary)' }}>
              <strong className="tabular-nums" style={{ fontWeight: 'var(--weight-semibold)' }}>
                {usagePct}%
              </strong>{' '}
              of this period's {usage.limit} runs used{usage.active ? ` (${usage.active} active)` : ''}.
              {usage.overage > 0 && ` ${usage.overage} overage runs billed.`}
            </span>
            <Link to="/settings/plan" className="link-accent">
              Review plan & billing
            </Link>
            <button
              className="btn-ghost btn-sm"
              style={{ marginLeft: 'auto', padding: '0 var(--space-2)', fontSize: 'var(--text-xs)' }}
              onClick={() => setUsageBannerDismissed(true)}
              aria-label="Dismiss usage notice"
            >
              <X style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            </button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* Command palette */}
      <AnimatePresence>
        {paletteOpen && <CommandPalette onClose={closePalette} />}
      </AnimatePresence>

      {/* Toasts */}
      <Toasts />
    </div>
  );
}
