import { useEffect, useRef } from 'react';

export function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Window-level keyboard shortcuts that switch off while the user is typing in a field.
 * `handlers` maps a key (e.g. ' ', 'ArrowLeft', '1') to a function.
 */
export function useHotkeys(handlers, enabled = true) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (el.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      // Let a focused button/link keep its normal Enter/Space behaviour.
      if ((e.key === 'Enter' || e.key === ' ') && el.closest?.('button, a, summary')) return;
      const fn = ref.current[e.key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
