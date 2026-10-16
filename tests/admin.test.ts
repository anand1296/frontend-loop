import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SectionMeta } from '../src/content/types.ts';
import { createStore } from '../src/state/createStore.ts';
import { EMPTY_PROGRESS, recordVisit, setDone, setNotes, type ProgressState } from '../src/state/progress.ts';
import { computeSummary, parseSummary, summaryEquals } from '../src/state/summary.ts';
import { syncSummary, syncWithRemote, type RemoteDoc, type SyncStatus } from '../src/state/persistence/cloudSync.ts';
import { parseAnnouncement } from '../src/features/announcement/announcement.ts';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const q = (id: string, sectionId: string) => ({ id, sectionId, title: id, level: 'senior' as const, tags: [], minutes: 1, summary: '', searchText: '' });
const sections: SectionMeta[] = [
  { id: 'a', title: 'A', description: '', questions: [q('a1', 'a'), q('a2', 'a')] },
  { id: 'b', title: 'B', description: '', questions: [q('b1', 'b')] },
];

describe('learner summary', () => {
  it('counts done per round and never includes notes', () => {
    let s = setDone(EMPTY_PROGRESS, 'a1', true, 10);
    s = setNotes(s, 'a1', 'private words', 20);
    s = recordVisit(s, 'b', 'b1', 30);
    const summary = computeSummary(sections, s);
    assert.deepEqual(summary.byRound, { a: 1, b: 0 });
    assert.equal(summary.doneCount, 1);
    assert.equal(summary.total, 3);
    assert.equal(summary.lastActiveAt, 30);
    assert.equal(summary.lastSectionId, 'b');
    assert.ok(!JSON.stringify(summary).includes('private words'));
  });

  it('is stable when nothing changed (no write churn)', () => {
    const s = setDone(EMPTY_PROGRESS, 'a1', true, 10);
    assert.ok(summaryEquals(computeSummary(sections, s), computeSummary(sections, s)));
  });

  it('validates summaries written by other people', () => {
    assert.equal(parseSummary({ version: 1, doneCount: 'x' }), null);
    const parsed = parseSummary({ version: 1, doneCount: 2.7, total: 3, byRound: { a: 2, evil: 'x' }, lastActiveAt: 5, lastSectionId: 7 });
    assert.deepEqual(parsed?.byRound, { a: 2 });
    assert.equal(parsed?.doneCount, 2);
    assert.equal(parsed?.lastSectionId, null);
  });
});

describe('syncSummary', () => {
  it('registers on start, writes on change, skips unchanged and coalesces bursts', async () => {
    const writes: Record<string, unknown>[] = [];
    const store = createStore<ProgressState>(EMPTY_PROGRESS);
    const stop = syncSummary(store, { set: async (d) => void writes.push(d) }, (s) => computeSummary(sections, s));
    await tick(10);
    assert.equal(writes.length, 1, 'registers immediately so the owner sees new learners');
    store.setState((s) => setNotes(s, 'a1', 'notes only', 5)); // notes change progress but not the summary...
    await tick(1300);
    assert.equal(writes.length, 2, '...but lastActiveAt moved, so one write');
    for (const id of ['a1', 'a2', 'b1']) store.setState((s) => setDone(s, id, true, 100));
    await tick(1300);
    assert.equal(writes.length, 3);
    assert.equal(writes[2]?.doneCount, 3);
    stop();
  });
});

describe('read-only viewers', () => {
  it('reports "readonly" when the store refuses writes for this access level', async () => {
    const statuses: SyncStatus[] = [];
    const doc: RemoteDoc = {
      set: () => Promise.reject({ code: 'invalid_argument', message: 'write not allowed' }),
      onSnapshot: (next) => {
        queueMicrotask(() => next({ exists: false, data: () => undefined, metadata: { fromCache: false, hasPendingWrites: false } }));
        return () => {};
      },
    };
    const store = createStore<ProgressState>(setDone(EMPTY_PROGRESS, 'a1', true, 1));
    const stop = syncWithRemote(store, doc, (s) => statuses.push(s));
    await tick(1400);
    assert.equal(statuses.at(-1), 'readonly');
    stop();
  });
});

describe('announcements', () => {
  it('trims, caps and ignores empty or malformed documents', () => {
    assert.equal(parseAnnouncement({ message: '   ', updatedAt: 1 }), null);
    assert.equal(parseAnnouncement({ message: 3, updatedAt: 1 }), null);
    assert.equal(parseAnnouncement({ message: 'x'.repeat(400), updatedAt: 1 })?.message.length, 280);
  });
});
