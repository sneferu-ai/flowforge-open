import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { dur, ease } from '../lib/motion-tokens';

interface CommandItem {
  label: string;
  path: string;
  hint: string;
}

const items: CommandItem[] = [
  { label: 'Go to Dashboard', path: '/dashboard', hint: 'Overview' },
  { label: 'Go to Workflows', path: '/workflows', hint: 'List' },
  { label: 'Create new workflow', path: '/workflows/new', hint: 'Action' },
  { label: 'Browse Templates', path: '/templates', hint: 'Gallery' },
  { label: 'Go to Runs', path: '/runs', hint: 'History' },
  { label: 'Review Approvals', path: '/settings/approvals', hint: 'Gate' },
  { label: 'Go to Credentials', path: '/credentials', hint: 'Vault' },
  { label: 'Go to Audit Log', path: '/audit', hint: 'Trail' },
  { label: 'Webhook secrets', path: '/settings/webhooks', hint: 'HMAC' },
  { label: 'Plan & billing', path: '/settings/plan', hint: 'Usage' },
  { label: 'SSO providers', path: '/settings/sso', hint: 'OIDC' },
  { label: 'Go to Settings', path: '/settings', hint: 'Config' },
];

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();

  const filtered = items.filter((i) =>
    i.label.toLowerCase().includes(query.toLowerCase()),
  );

  /* Focus management: capture the element that had focus before the palette
   * opened, auto-focus the search input on mount, and restore focus to the
   * captured element on unmount (WAI-ARIA dialog pattern — DESIGN.md §7b). */
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  /* Focus trap: Tab/Shift+Tab cycle within the dialog. */
  useEffect(() => {
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>('input, button:not([disabled])'),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap, true);
    return () => document.removeEventListener('keydown', trap, true);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selected];
        if (item) {
          navigate(item.path);
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filtered, selected, onClose, navigate]);

  const select = (item: CommandItem) => {
    navigate(item.path);
    onClose();
  };

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close command palette"
        className="fixed inset-0 cursor-default"
        style={{ background: 'var(--overlay-backdrop)', backdropFilter: 'blur(var(--backdrop-blur))', zIndex: 'var(--z-modal-bg)', border: 'none', padding: 0 }}
        onClick={onClose}
      />
      <motion.div
        data-testid="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-title"
        className="fixed left-1/2 top-24 -translate-x-1/2 w-full"
        style={{ zIndex: 'var(--z-cmd)', maxWidth: 'var(--palette-max)', padding: '0 var(--space-4)' }}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: dur('base'), ease: ease('emphasized') }}
      >
        <div
          ref={panelRef}
          className="surface-panel"
          style={{ background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-3)' }}
        >
          <div id="palette-title" className="sr-only">Command palette</div>
          <div
            className="flex items-center border-b"
            style={{ gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}
          >
            <Search style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--fg-tertiary)' }} />
            <input
              ref={inputRef}
              data-testid="command-palette-input"
              type="text"
              placeholder="Search commands…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
              className="palette-input flex-1 bg-transparent"
              style={{ color: 'var(--fg-primary)', fontFamily: 'var(--font-body)' }}
              aria-label="Search commands"
            />
            <kbd
              className="badge"
              style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-hairline) var(--space-2)', fontFamily: 'var(--font-mono)' }}
            >
              esc
            </kbd>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                No matching commands.
              </p>
            ) : (
              filtered.map((item, i) => (
                <button
                  key={item.path}
                  aria-label={item.label}
                  className="palette-item w-full text-left flex items-center gap-3"
                  style={{
                    padding: 'var(--space-2) var(--space-4)',
                    fontSize: 'var(--text-sm)',
                    color: i === selected ? 'var(--fg-primary)' : 'var(--fg-secondary)',
                    /* Unselected rows leave background unset so the CSS
                       :hover rule applies (no !important needed). */
                    background: i === selected ? 'var(--bg-elevated)' : undefined,
                    fontFamily: 'var(--font-body)',
                    transition: 'background var(--dur-instant)',
                  }}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => select(item)}
                >
                  <Search style={{ width: 'var(--icon-xs)', height: 'var(--icon-xs)', color: 'var(--fg-tertiary)' }} />
                  <span className="flex-1">{item.label}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>{item.hint}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}
