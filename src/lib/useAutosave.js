import { useEffect, useRef, useState } from 'react';
import { saveSnapshot } from './autosave';

/**
 * Debounced IndexedDB autosave. Saves `data` under `key` `delay` ms after it
 * last changed, while `enabled` is true. Returns { status, savedAt }.
 */
export function useAutosave({ key, data, meta, enabled, delay = 1500 }) {
  const [state, setState] = useState({ status: 'idle', savedAt: null });
  const metaRef = useRef(meta);
  metaRef.current = meta;

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, status: 'saving' }));
      saveSnapshot(key, data, metaRef.current)
        .then((savedAt) => setState({ status: 'saved', savedAt }))
        .catch((err) => {
          console.warn(`Autosave (${key}) failed:`, err);
          setState((s) => ({ ...s, status: 'error' }));
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [key, data, enabled, delay]);

  return state;
}
