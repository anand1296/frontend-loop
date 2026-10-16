/**
 * localStorage persistence with defensive reads.
 *
 * localStorage can throw (Safari private mode, blocked storage, sandboxed
 * iframes) or hold anything (older versions, manual edits). Every read is
 * validated and every access is wrapped, so the app always boots.
 */
import { EMPTY_PROGRESS, parseProgress, type ProgressState } from '../progress.ts';

export const PROGRESS_KEY = 'frontend-loop:progress:v1';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readJson(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

export function loadProgress(): ProgressState {
  return parseProgress(readJson(PROGRESS_KEY)) ?? EMPTY_PROGRESS;
}

export function saveProgress(state: ProgressState): boolean {
  return writeJson(PROGRESS_KEY, state);
}

/** Calls back with validated progress whenever another tab writes it. */
export function onOtherTabWrite(callback: (state: ProgressState) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: StorageEvent): void => {
    if (event.key !== PROGRESS_KEY || !event.newValue) return;
    try {
      const parsed = parseProgress(JSON.parse(event.newValue));
      if (parsed) callback(parsed);
    } catch {
      // Ignore malformed writes from other tabs.
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
