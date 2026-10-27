import { useCallback, useEffect, useRef, useState } from 'react';

const HISTORY_LIMIT = 60;
const DEBOUNCE_MS = 400;

/**
 * Debounced undo/redo over a snapshot value (same approach as the Studio page).
 * `isEqual(a, b)` decides whether two snapshots differ enough to record;
 * `apply(snapshot)` writes a snapshot back into state.
 */
export function useUndoHistory(snapshot, apply, isEqual = Object.is) {
  const ref = useRef({ past: [], future: [], last: null, skip: false });
  const [, setTick] = useState(0);

  useEffect(() => {
    const h = ref.current;
    if (h.last === null) { h.last = snapshot; return undefined; }
    if (h.skip) { h.skip = false; h.last = snapshot; return undefined; }
    const timer = setTimeout(() => {
      if (!isEqual(h.last, snapshot)) {
        h.past = [...h.past, h.last].slice(-HISTORY_LIMIT);
        h.future = [];
        setTick((t) => t + 1);
      }
      h.last = snapshot;
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [snapshot, isEqual]);

  const undo = useCallback(() => {
    const h = ref.current;
    if (!h.past.length) return;
    const prev = h.past[h.past.length - 1];
    h.past = h.past.slice(0, -1);
    h.future = [h.last, ...h.future];
    h.last = prev;
    h.skip = true;
    apply(prev);
    setTick((t) => t + 1);
  }, [apply]);

  const redo = useCallback(() => {
    const h = ref.current;
    if (!h.future.length) return;
    const next = h.future[0];
    h.future = h.future.slice(1);
    h.past = [...h.past, h.last];
    h.last = next;
    h.skip = true;
    apply(next);
    setTick((t) => t + 1);
  }, [apply]);

  /** Forget history (e.g. after loading a different project). */
  const reset = useCallback(() => {
    ref.current = { past: [], future: [], last: null, skip: false };
    setTick((t) => t + 1);
  }, []);

  return { undo, redo, reset, canUndo: ref.current.past.length > 0, canRedo: ref.current.future.length > 0 };
}
