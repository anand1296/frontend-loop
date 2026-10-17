---
id: progress-sync
title: Progress that follows you
summary: Your ticks live in the browser first and replicate to Postgres in the background. A last-writer-wins map, one PUT that both saves and pulls, and a row lock that keeps two devices from overwriting each other.
order: 4
minutes: 11
tags: react, sync, crdt, go, postgres, offline-first
---

> [!TLDR]
> Progress is **local-first**: every click updates an in-memory store and `localStorage` immediately, so the UI never waits for the network. A sync engine replicates that state to the server with a debounced `PUT /api/me/progress`. The server merges the incoming copy into the stored one (per question, the newest `updatedAt` wins) under a row lock and returns the merged document, which the client merges back in. Same merge function on both sides, so every replica converges.

### Why local-first?

Studying happens on trains and in cafés. If marking a question done waited for a server, the app would feel slow on a good network and broken on a bad one. So the browser is the source of truth for the *UI*; the server is the source of truth for *durability and other devices*. And the app had to keep working with no backend at all, which makes local-first the natural default ([ADR-005](repo:docs/DECISIONS.md#ADR-005)).

### The data model

One small JSON document per person:

```ts excerpt=src/state/progress.ts#QuestionProgress
```

Every change goes through pure functions that take `now` as an argument ([progress.ts](repo:src/state/progress.ts)), for example [`setDone`](repo:src/state/progress.ts#setDone). Pure + injected time = trivially testable and deterministic.

### The merge: a last-writer-wins map

```ts excerpt=src/state/progress.ts#mergeProgress
```

This is the simplest useful CRDT: a map of registers where the later timestamp wins. It's **commutative and idempotent**, so it doesn't matter in which order replicas meet or how many times. The Go server runs the identical rule:

```go excerpt=backend/progress/progress.go#Merge
```

> [!PRINCIPAL]
> The known weakness of last-writer-wins is clock skew: a phone whose clock runs ten minutes fast "wins" edits it shouldn't. For one person's study progress the blast radius is a checkbox, so simplicity wins. If two *people* edited shared data, you'd reach for server-assigned versions, vector clocks, or an operation-based CRDT, and you'd say so in the interview.

### Three replicas, one engine

```text
 tab A ◀─ storage event ─▶ tab B          (same browser: localStorage)
   │
   └─ syncWithRemote ── debounced PUT ──▶ Go: MergeProgress (row lock) ──▶ progress table
                     ◀─ merged doc ──────┘
   other device ──────── same thing ────────────┘
```

[`initProgress`](repo:src/state/progressStore.ts#initProgress) wires it up at boot: load from `localStorage`, save on every change, merge writes from other tabs (the `storage` event), and in server mode start the server sync. It also wipes a previous user's local copy when a different person signs in on the same computer.

The engine itself is transport-agnostic. [`syncWithRemote`](repo:src/state/persistence/cloudSync.ts#syncWithRemote) only knows a `RemoteDoc` interface (`set` + `onSnapshot`), originally written for a document store and now also backed by the Go API through [`httpProgressDoc`](repo:src/state/persistence/cloudSync.ts#httpProgressDoc). Its rules:

1. **Debounce** writes (1.2 s), so ticking five questions is one request.
2. **One write in flight**; changes made meanwhile trigger exactly one more.
3. **Skip no-op writes** when the remote copy already equals local state. That also breaks the echo loop where our own write comes back as a snapshot.
4. **Flush when the tab is hidden**, because a debounce timer may never fire after that.
5. **Classify errors**: 401/403 stop syncing (you were signed out or disabled), 400/413 mean "read-only" (the server refuses this document), anything else is retried once with jitter.

### One round trip saves *and* pulls

```go excerpt=backend/server/public.go#putProgress
```

The response is the merged document, which the client feeds back as a snapshot. So every save also brings in whatever your other device did. Without server push, the client re-reads when the tab regains focus and every five minutes while visible ([ADR-017](repo:docs/DECISIONS.md#ADR-017): polling instead of WebSockets, because serverless functions can't hold connections and nobody needs sub-second progress sync).

#### Two devices saving at the same moment

```go excerpt=backend/store/progress.go#MergeProgress
```

`SELECT … FOR UPDATE` serializes concurrent saves for the same user: the second transaction waits, then merges into the *first one's result* instead of overwriting it. `INSERT … ON CONFLICT DO NOTHING` first guarantees the row exists so there's always something to lock.

### Untrusted input

The server never trusts the client's document: [`FromMap`](repo:backend/progress/progress.go#FromMap) re-validates every field (finite numbers, capped notes, a maximum number of questions) and the body size is capped in [`decode`](repo:backend/server/server.go#decode). The endpoint is rate-limited per user.

### How it's tested

- [sync.test.ts](repo:tests/sync.test.ts) and [server-sync.test.ts](repo:tests/server-sync.test.ts) drive `syncWithRemote` against fake documents: debouncing, the echo loop, retries, terminal errors, snapshots that arrive mid-write.
- [progress_test.go](repo:backend/progress/progress_test.go) checks the Go merge matches the TypeScript one.
- [`TestProgressSyncAndSummaries`](repo:backend/server/server_test.go#TestProgressSyncAndSummaries) runs two "devices" against the real API and database.

### If you're asked about this in an interview

- **"Design offline support for a form-heavy app."** Local-first store, an outbox or full-state replication, a merge rule chosen per field, and a clear story for conflicts the rule can't resolve.
- **"Why not just `POST` every click?"** Request volume, ordering problems (two in-flight requests can land out of order) and no offline story. Debounced full-state replication with an idempotent merge avoids all three.
