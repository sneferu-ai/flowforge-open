import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { onToasts, type Toast as ToastItem } from '../lib/toast';
import { dur, ease } from '../lib/motion-tokens';

export default function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => onToasts(setItems), []);

  return (
    <div
      className="fixed bottom-0 right-0 flex flex-col pointer-events-none"
      style={{ gap: 'var(--space-2)', padding: 'var(--space-6)', zIndex: 'var(--z-toast)' }}
    >
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            className="toast demo-banner pointer-events-auto"
            data-testid="toast"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ duration: dur('base'), ease: ease('default') }}
            role="status"
            aria-live="polite"
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
