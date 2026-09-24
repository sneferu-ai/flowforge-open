/** Tiny toast bus — Layout renders the sink; pages call toast(). */

export interface Toast {
  id: number;
  text: string;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
let listener: Listener | null = null;

export function onToasts(fn: Listener): () => void {
  listener = fn;
  fn(toasts);
  return () => {
    if (listener === fn) listener = null;
  };
}

export function toast(text: string, ttlMs = 5000): void {
  const t: Toast = { id: nextId++, text };
  toasts = [...toasts, t];
  listener?.(toasts);
  window.setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listener?.(toasts);
  }, ttlMs);
}
