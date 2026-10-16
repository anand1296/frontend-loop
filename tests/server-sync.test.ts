/**
 * Server mode: progress sync against a fake Go API (fetch is stubbed), and the
 * TS <-> Go contract for code fence languages.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../src/state/createStore.ts';
import { EMPTY_PROGRESS, mergeProgress, parseProgress, setDone, toDocument, type ProgressState } from '../src/state/progress.ts';
import { httpProgressDoc, syncWithRemote, type SyncStatus } from '../src/state/persistence/cloudSync.ts';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fake /api/me/progress that merges like the server does (backend/progress.Merge). */
function fakeServer(initial: ProgressState) {
  let stored = initial;
  const calls: string[] = [];
  const fetchStub = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${String(url)}`);
    assert.equal((init?.headers as Record<string, string>)['X-Requested-With'], 'frontend-loop', 'CSRF header on every request');
    if (method === 'PUT') {
      const incoming = parseProgress(JSON.parse(String(init?.body)));
      assert.ok(incoming);
      stored = mergeProgress(stored, incoming);
    }
    return new Response(JSON.stringify(toDocument(stored)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchStub, calls, stored: () => stored };
}

describe('server progress sync', () => {
  const realFetch = globalThis.fetch;
  const realDocument = (globalThis as { document?: unknown }).document;
  beforeEach(() => {
    (globalThis as { document?: unknown }).document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    (globalThis as { document?: unknown }).document = realDocument;
  });

  it('pulls the account copy, pushes local changes once, and settles', async () => {
    const server = fakeServer(setDone(EMPTY_PROGRESS, 'from-other-device', true, 50));
    globalThis.fetch = server.fetchStub as typeof fetch;
    const store = createStore<ProgressState>(setDone(EMPTY_PROGRESS, 'local-only', true, 60));
    const statuses: SyncStatus[] = [];
    const stop = syncWithRemote(store, httpProgressDoc(), (s) => statuses.push(s));
    await tick(1600); // initial GET, then one debounced PUT of the merged state

    assert.ok(store.getState().questions['from-other-device']?.done, 'pulled the other device');
    assert.ok(server.stored().questions['local-only']?.done, 'pushed local progress');
    const puts = server.calls.filter((c) => c.startsWith('PUT'));
    assert.equal(puts.length, 1, `exactly one write, got ${server.calls.join(', ')}`);
    assert.equal(statuses.at(-1), 'synced');

    // A later change is written once; the merged echo doesn't trigger another write.
    store.setState((s) => setDone(s, 'next', true, 70));
    await tick(1600);
    assert.equal(server.calls.filter((c) => c.startsWith('PUT')).length, 2);
    stop();
  });
});

describe('code fence languages', () => {
  it('the TypeScript and Go renderers accept the same languages', () => {
    const ts = readFileSync(new URL('../build/content/markdown.ts', import.meta.url), 'utf8');
    const go = readFileSync(new URL('../backend/markdown/highlight.go', import.meta.url), 'utf8');
    const tsTable = ts.slice(ts.indexOf('const LANGUAGES'), ts.indexOf('};', ts.indexOf('const LANGUAGES')));
    const goTable = go.slice(go.indexOf('var Languages'), go.indexOf('\n}', go.indexOf('var Languages')));
    const tsKeys = [...tsTable.matchAll(/^\s+'?([a-z]*)'?: \{/gm)].map((m) => m[1]).sort();
    const goKeys = [...goTable.matchAll(/^\s+"([a-z]*)":/gm)].map((m) => m[1]).sort();
    assert.ok(tsKeys.length > 20);
    assert.deepEqual(goKeys, tsKeys);
  });
});
