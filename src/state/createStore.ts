/**
 * A minimal external store (~20 lines) instead of Redux/Zustand.
 *
 * The app's client state is small (progress, prefs, route). What matters is:
 * - updates are immutable and synchronous,
 * - subscribers are notified only when the state object actually changes,
 * - React reads it through useSyncExternalStore (see useStore.ts), which is
 *   tear-free under concurrent rendering.
 */
export interface Store<T> {
  getState(): T;
  setState(update: (previous: T) => T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(update) {
      const next = update(state);
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
