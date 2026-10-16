/**
 * Optional cloud sync, local-first.
 *
 * localStorage stays the source of truth for the UI (instant, offline). When a
 * remote document store is available (the claude.ai Artifact `db` capability),
 * we replicate to one private document per user:
 *
 *   data/users/<uid>/progress
 *
 * Protocol:
 * 1. Subscribe to the remote doc. Each snapshot is merged into local state
 *    with mergeProgress (last-writer-wins per question).
 * 2. Local changes schedule a debounced write of the full state.
 * 3. One write in flight at a time; changes made meanwhile trigger one more.
 * 4. Writes are skipped when the remote copy already equals local state,
 *    which also breaks the echo loop (our own write comes back as a snapshot).
 *
 * The adapter is deliberately small and depends only on the RemoteDoc
 * interface, so swapping in Firebase/Supabase later means writing a new
 * adapter, not touching the UI.
 */
import type { Store } from '../createStore.ts';
import { createStore } from '../createStore.ts';
import { mergeProgress, parseProgress, progressEquals, toDocument, type ProgressState } from '../progress.ts';
import { summaryDocument, summaryEquals, type LearnerSummary } from '../summary.ts';
import { getPlatform, paths } from '../../platform/runtime.ts';
import { api, ApiError } from '../../platform/api.ts';

/** `readonly`: signed in, but the viewer's access level can't write (e.g. shared as Viewer). */
export type SyncStatus = 'local' | 'connecting' | 'synced' | 'saving' | 'readonly' | 'error';

export const syncStatusStore = createStore<SyncStatus>('local');

export interface WritableDoc {
  set(data: Record<string, unknown>): Promise<void>;
}

export interface RemoteDoc extends WritableDoc {
  onSnapshot(next: (snapshot: ClaudeDocSnapshot) => void, error?: (error: ClaudeDbError) => void): () => void;
}

const WRITE_DEBOUNCE_MS = 1200;
const TERMINAL_CODES = new Set(['invalid_argument', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'quota_exceeded']);

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return 'unavailable';
}

/** Wires a store to a remote document. Returns a stop function. */
export function syncWithRemote(store: Store<ProgressState>, doc: RemoteDoc, setStatus: (s: SyncStatus) => void): () => void {
  let remote: ProgressState | null = null;
  let snapshots = 0;
  let writing = false;
  let again = false;
  let stopped = false;
  let retried = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    if (stopped) return;
    clearTimeout(timer);
    if (writing) {
      again = true;
      return;
    }
    const local = store.getState();
    if (remote && progressEquals(local, remote)) {
      setStatus('synced');
      return;
    }
    writing = true;
    setStatus('saving');
    try {
      const seen = snapshots;
      await doc.set(toDocument(local));
      // A snapshot that arrived during the write (the server's merged copy) is newer than `local`.
      if (snapshots === seen) remote = local;
      retried = false;
      setStatus('synced');
    } catch (error) {
      const code = errorCode(error);
      if (TERMINAL_CODES.has(code)) {
        stopped = true;
        setStatus(code === 'invalid_argument' ? 'readonly' : 'error');
      } else if (!retried) {
        retried = true;
        again = true;
      } else {
        setStatus('error');
      }
    } finally {
      writing = false;
      if (again && !stopped) {
        again = false;
        schedule(400 + Math.random() * 800);
      }
    }
  };

  const schedule = (delay = WRITE_DEBOUNCE_MS): void => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), delay);
  };

  const unsubscribeRemote = doc.onSnapshot(
    (snapshot) => {
      snapshots += 1;
      const incoming = snapshot.exists ? parseProgress(snapshot.data()) : null;
      if (incoming) remote = incoming;
      const local = store.getState();
      const merged = incoming ? mergeProgress(local, incoming) : local;
      if (!progressEquals(merged, local)) store.setState(() => merged);
      if (!incoming || !progressEquals(merged, incoming)) schedule();
      else if (!writing) setStatus('synced');
    },
    () => {
      stopped = true;
      setStatus('error');
    },
  );

  const unsubscribeLocal = store.subscribe(() => schedule());

  // Flush immediately when the tab is hidden: the debounce may never fire after that.
  const hasDocument = typeof document !== 'undefined';
  const flushNow = (): void => {
    if (document.visibilityState === 'hidden') void flush();
  };
  if (hasDocument) document.addEventListener('visibilitychange', flushNow);

  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribeRemote();
    unsubscribeLocal();
    if (hasDocument) document.removeEventListener('visibilitychange', flushNow);
  };
}

/**
 * Keeps the learner's shareable summary up to date: written once on start (so
 * the owner sees everyone who opened the app) and then whenever it changes.
 * One write in flight; unchanged summaries are never rewritten.
 */
export function syncSummary(
  store: Store<ProgressState>,
  doc: WritableDoc,
  compute: (state: ProgressState) => LearnerSummary,
): () => void {
  let lastWritten: LearnerSummary | null = null;
  let writing = false;
  let again = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    if (stopped) return;
    if (writing) {
      again = true;
      return;
    }
    const next = compute(store.getState());
    if (lastWritten && summaryEquals(lastWritten, next)) return;
    writing = true;
    try {
      await doc.set(summaryDocument(next));
      lastWritten = next;
    } catch (error) {
      if (TERMINAL_CODES.has(errorCode(error))) stopped = true;
    } finally {
      writing = false;
      if (again && !stopped) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), WRITE_DEBOUNCE_MS);
  };

  void flush();
  const unsubscribe = store.subscribe(schedule);
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
  };
}

/** Connects to the claude.ai Artifact runtime if present. No-op elsewhere. */
export async function startCloudSync(
  store: Store<ProgressState>,
  summarize: (state: ProgressState) => LearnerSummary,
): Promise<void> {
  if (typeof window === 'undefined' || !window.claude) return;
  const setStatus = (status: SyncStatus): void => syncStatusStore.setState(() => status);
  setStatus('connecting');
  const platform = await getPlatform();
  if (!platform) {
    setStatus('local');
    return;
  }
  syncWithRemote(store, platform.db.doc(paths.progress(platform.uid)), setStatus);
  syncSummary(store, platform.db.doc(paths.learner(platform.uid)), summarize);
}

/* ---------------------------------------------------------------- server mode */

const POLL_MS = 5 * 60_000;

function snapshotOf(data: Record<string, unknown>): ClaudeDocSnapshot {
  return { exists: true, data: () => data, metadata: { fromCache: false, hasPendingWrites: false } };
}

/**
 * The Go backend as a RemoteDoc. PUT /api/me/progress merges on the server
 * (same last-writer-wins rule) and returns the merged document, which we feed
 * back as a snapshot: one round trip both saves and pulls other devices'
 * changes. Without push from the server, we re-read when the tab regains
 * focus and every few minutes while it's visible.
 */
export function httpProgressDoc(): RemoteDoc {
  const listeners = new Set<(snapshot: ClaudeDocSnapshot) => void>();
  const emit = (data: Record<string, unknown>): void => {
    for (const listener of [...listeners]) listener(snapshotOf(data));
  };
  const toDbError = (error: unknown): ClaudeDbError => {
    if (error instanceof ApiError) {
      // 401/403: signed out or disabled. 400/413: the server refuses this document. Both are terminal.
      const code = error.status === 401 || error.status === 403 ? 'revoked' : error.status === 400 || error.status === 413 ? 'invalid_argument' : 'unavailable';
      return { code, message: error.message };
    }
    return { code: 'unavailable', message: String(error) };
  };
  return {
    async set(data) {
      try {
        const merged = await api<Record<string, unknown>>('/me/progress', { method: 'PUT', body: data });
        emit(merged);
      } catch (error) {
        throw toDbError(error);
      }
    },
    onSnapshot(next, onError) {
      listeners.add(next);
      let stopped = false;
      const pull = async (): Promise<void> => {
        try {
          const doc = await api<Record<string, unknown>>('/me/progress');
          if (!stopped) next(snapshotOf(doc));
        } catch (error) {
          const dbError = toDbError(error);
          if (!stopped && dbError.code !== 'unavailable') onError?.(dbError);
        }
      };
      void pull();
      const onVisible = (): void => {
        if (document.visibilityState === 'visible') void pull();
      };
      const timer = setInterval(() => {
        if (document.visibilityState === 'visible') void pull();
      }, POLL_MS);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        stopped = true;
        listeners.delete(next);
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
      };
    },
  };
}

let stopServerSync: (() => void) | null = null;

/** Replicates progress to the signed-in user's account on the Go backend. */
export function startServerSync(store: Store<ProgressState>): void {
  stopServerSync?.();
  const setStatus = (status: SyncStatus): void => syncStatusStore.setState(() => status);
  setStatus('connecting');
  stopServerSync = syncWithRemote(store, httpProgressDoc(), setStatus);
}

/** Push any pending local change now (used right before signing out). */
export async function flushServerSync(store: Store<ProgressState>): Promise<void> {
  try {
    await api('/me/progress', { method: 'PUT', body: toDocument(store.getState()), timeoutMs: 8000 });
  } catch {
    // Best effort: the server already has everything up to the last debounce.
  }
  stopServerSync?.();
  stopServerSync = null;
}
