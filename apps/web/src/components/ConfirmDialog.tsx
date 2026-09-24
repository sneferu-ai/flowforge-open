import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { dur, ease } from '../lib/motion-tokens';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirmation modal for destructive actions.
 * Focus trap, Esc-to-close, click-outside-to-dismiss, role=dialog.
 * Styled from the closed token layer — no raw hex/px/durations.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /* Focus management: on open, remember the trigger and move focus to the
   * safe (non-destructive) action; on close, return focus to the trigger. */
  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      cancelRef.current?.focus();
      return;
    }
    const trigger = restoreRef.current;
    restoreRef.current = null;
    if (trigger && document.contains(trigger)) {
      trigger.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Tab') {
        const focusables = [cancelRef.current, confirmRef.current].filter(Boolean) as HTMLElement[];
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!panelRef.current?.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const handleBackdropClick = useCallback(() => {
    onCancel();
  }, [onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close dialog"
            className="fixed inset-0 cursor-default"
            style={{
              background: 'var(--overlay-backdrop)',
              backdropFilter: 'blur(var(--backdrop-blur))',
              zIndex: 'var(--z-modal-bg)',
              border: 'none',
              padding: 0,
            }}
            onClick={handleBackdropClick}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
            className="fixed"
            style={{
              /* Horizontal insets keep the panel inside the viewport at 375px;
               * vertical centering uses the CSS `translate` property so Framer
               * Motion's animated `transform` (scale/opacity) never overrides
               * the centering offset. */
              top: '50%',
              left: 'var(--space-4)',
              right: 'var(--space-4)',
              margin: '0 auto',
              translate: '0 -50%',
              background: 'var(--bg-elevated)',
              border: 'var(--border-width) solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              boxShadow: 'var(--shadow-3)',
              zIndex: 'var(--z-modal)',
              width: 'auto',
              maxWidth: 'var(--palette-max)',
              padding: 'var(--space-6)',
            }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: dur('fast'), ease: ease('default') }}
          >
            <h2
              id="confirm-dialog-title"
              style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--fg-primary)',
                fontFamily: 'var(--font-display)',
                marginBottom: 'var(--space-2)',
              }}
            >
              {title}
            </h2>
            <p
              id="confirm-dialog-message"
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--fg-secondary)',
                lineHeight: 'var(--line-normal)',
                marginBottom: 'var(--space-6)',
              }}
            >
              {message}
            </p>
            <div className="flex" style={{ gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button
                ref={cancelRef}
                type="button"
                className="btn-secondary"
                onClick={onCancel}
                aria-label={cancelLabel}
              >
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                type="button"
                className="btn-danger"
                onClick={onConfirm}
                aria-label={confirmLabel}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
