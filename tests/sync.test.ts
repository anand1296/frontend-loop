import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state/createStore.ts';
import { EMPTY_PROGRESS, setDone, toDocument, type ProgressState } from '../src/state/progress.ts';
import { syncWithRemote, type RemoteDoc, type SyncStatus } from '../src/state/persistence/cloudSync.ts';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An in-memory stand-in for the claude.ai `db` document, with snapshot echo like the real thing. */
function fakeDoc(initial: Record<string, unknown> | null) {
  let data = initial;
  let listener: ((snap: ClaudeDocSnapshot) => void) | null = null;
  const writes: Record<string, unknown>[] = [];
  const snapshot = (): ClaudeDocSnapshot => ({
    exists: data !== null,
    data: () => data ?? undefined,
    metadata: { fromCache: false, hasPendingWrites: false },
  });
  const doc: RemoteDoc = {
    async set(next) {
      writes.push(next);
      data = JSON.parse(JSON.stringify(next));
      queueMicrotask(() => listener?.(snapshot()));
    },
    onSnapshot(next) {
      listener = next;
      queueMicrotask(() => next(snapshot()));
      return () => {
        listener = null;
      };
    },
  };
  return {
    doc,
    writes,
    remoteWrite(next: ProgressState) {
      data = JSON.parse(JSON.stringify(toDocument(next)));
      listener?.(snapshot());
    },
  };
}

describe('syncWithRemote', () => {
  it('pulls remote progress into an empty local store without writing back', async () => {
    const remote = setDone(EMPTY_PROGRESS, 'q1', true, 100);
    const fake = fakeDoc(toDocument(remote));
    const store = createStore<ProgressState>(EMPTY_PROGRESS);
    const statuses: SyncStatus[] = [];
    const stop = syncWithRemote(store, fake.doc, (s) => statuses.push(s));
    await tick(10);
    assert.equal(store.getState().questions.q1?.done, true);
    await tick(1500);
    assert.equal(fake.writes.length, 0, 'no echo write when local equals remote after merge');
    assert.equal(statuses.at(-1), 'synced');
    stop();
  });

  it('pushes local-only progress after the debounce and merges concurrent remote changes', async () => {
    const fake = fakeDoc(toDocument(setDone(EMPTY_PROGRESS, 'remote-q', true, 50)));
    const store = createStore<ProgressState>(setDone(EMPTY_PROGRESS, 'local-q', true, 60));
    const stop = syncWithRemote(store, fake.doc, () => {});
    await tick(10);
    const merged = store.getState();
    assert.equal(merged.questions['remote-q']?.done, true);
    assert.equal(merged.questions['local-q']?.done, true);
    await tick(1400);
    assert.equal(fake.writes.length, 1);
    const written = fake.writes[0]?.questions;
    assert.ok(written && typeof written === 'object' && 'local-q' in written && 'remote-q' in written);

    // A later edit on another device arrives live.
    fake.remoteWrite(setDone(store.getState(), 'other-device', true, 999));
    assert.equal(store.getState().questions['other-device']?.done, true);
    stop();
  });

  it('coalesces bursts of local changes into one write', async () => {
    const fake = fakeDoc(null);
    const store = createStore<ProgressState>(EMPTY_PROGRESS);
    const stop = syncWithRemote(store, fake.doc, () => {});
    await tick(10);
    for (let i = 0; i < 5; i++) store.setState((s) => setDone(s, `q${i}`, true, 200 + i));
    await tick(1400);
    assert.equal(fake.writes.length, 1);
    stop();
  });
});
