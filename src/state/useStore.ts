import { useSyncExternalStore } from 'react';
import type { Store } from './createStore.ts';

/**
 * Subscribe a component to a slice of a store.
 *
 * The selector must return a value that is referentially stable while the
 * underlying data is unchanged (a primitive, or an existing object from the
 * state). Returning a freshly built object/array on every call makes
 * useSyncExternalStore think the state changed forever and React will warn
 * about an infinite loop. Derive new arrays with useMemo in the component.
 */
export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S {
  const getSnapshot = (): S => selector(store.getState());
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
