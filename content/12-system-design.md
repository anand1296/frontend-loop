---
id: frontend-system-design
title: Frontend System Design
description: A framework for the 45-minute design round, then full walkthroughs: news feed, e-commerce product page, real-time dashboard, spreadsheet, collaborative editor, offline-first app and search.
---

## A framework for frontend system design interviews, and how to spend the 45 minutes
<!--
id: system-design-framework
level: senior
tags: system design, interview framework, radio, requirements, architecture
minutes: 12
-->

> [!PROMPT]
> You are given a vague prompt, "design Google Photos", and 45 minutes. Describe the framework you follow so that the interview doesn't turn into a random walk, and how you would split the time.
>
> **Cover**
> - Stages (such as RADIO): requirements, architecture, data model, interface/API, optimizations, with time per stage.
> - The clarifying questions and non-functional requirements you always ask.
> - How you present trade-offs, and signals interviewers look for at senior versus staff level.

> [!TLDR]
> Drive the conversation through five stages (often called RADIO): **R**equirements (functional, non-functional, scope), **A**rchitecture (components, rendering strategy, data flow), **D**ata model (entities, client state vs server state, normalization), **I**nterface (API contracts, component APIs, events), and **O**ptimizations (performance, accessibility, reliability, security, observability, i18n). Spend the most time where the problem is hard, state trade-offs out loud, and keep a running diagram.

### Time plan (45 minutes)

| Minutes | Stage | Output |
| --- | --- | --- |
| 0–6 | Requirements | Bullet list: core features, out of scope, users/devices, scale, NFRs (latency, offline, a11y, SEO) |
| 6–15 | Architecture | Box diagram: client modules, server/BFF, real-time channel, caches, CDN |
| 15–22 | Data model | Entities, normalized store shape, what's server vs client vs URL state |
| 22–30 | Interface | API endpoints/events with payloads, pagination, error shapes; key component APIs |
| 30–42 | Deep dives | The 2–3 hardest parts (real-time consistency, virtualization, offline sync…) |
| 42–45 | Wrap-up | Trade-offs, what you'd do with more time, how you'd measure success |

### Questions that make you look senior

- "What devices and network conditions? Is SEO important? Logged-in only?"
- "What's the read/write ratio and the update frequency?" (drives caching and real-time choices)
- "How fresh must data be? Can two users edit the same thing?" (consistency model)
- "What are the success metrics?" (LCP for landing, INP for editors, conversion, task completion)

### Checklist for the optimization stage

- **Performance**: rendering strategy (SSR/SSG/CSR/RSC), code splitting, caching layers, virtualization, image strategy, prefetching.
- **Reliability**: retries with backoff, partial failure UI, offline behavior, idempotency, optimistic updates and rollback.
- **Accessibility**: keyboard model, focus management, live regions, semantics of custom widgets.
- **Security**: XSS (user content), CSRF/auth model, permissions in UI vs server.
- **Observability**: RUM, error tracking, product analytics, feature flags.
- **i18n**: RTL, pluralization, date/number formatting, text expansion.

### Mistakes interviewers see

- Jumping into component code without requirements.
- Designing the backend in detail (unless asked) instead of client architecture.
- Listing technologies without explaining why ("Redux, GraphQL, Kafka").
- Ignoring failure modes and accessibility.

### References

- [GreatFrontEnd: Front end system design guide](https://www.greatfrontend.com/front-end-system-design-playbook)
- [web.dev: Rendering on the web](https://web.dev/articles/rendering-on-the-web)

## Design a news feed (Twitter/LinkedIn-style): rendering, pagination, real-time inserts and media
<!--
id: design-news-feed
level: lead
tags: system design, news feed, pagination, real-time, virtualization, optimistic ui
minutes: 30
-->

> [!PROMPT]
> Design the frontend of a news feed like Twitter or LinkedIn: infinite scrolling, new-post indicators, likes, comments, images and video, for web and mobile.
>
> **Cover**
> - Rendering (SSR for first page), pagination, a normalized client cache and optimistic updates.
> - Real-time inserts without scroll jumps, virtualization, media loading and autoplay.
> - Performance, accessibility, error handling and metrics; what you'd build first.

> [!TLDR]
> Server-render the first page of the feed for fast LCP, then hydrate and continue with cursor-based infinite loading. Keep posts in a normalized client cache (post, author, media entities) so likes/edits update everywhere. Deliver new posts through SSE/WebSocket or polling as a "N new posts" pill instead of inserting above the reader. Virtualize with variable heights, lazy-load media with reserved aspect ratios, make reactions optimistic with rollback, and measure scroll performance and engagement.

### Requirements

- Functional: view feed, infinite scroll, create post (text + images), like/comment, see new posts, open post detail.
- Non-functional: fast first paint on mobile, smooth scrolling (INP, no jank), works on flaky networks, accessible, scale to millions of users (backend), feed personalized (ranking server-side).

### Architecture

```text
┌──────────────── Browser ────────────────┐       ┌──────── Edge/Server ────────┐
│ FeedPage                                 │       │ SSR/streaming (first page)  │
│  ├─ Composer (optimistic create)         │◀─────▶│ BFF / GraphQL               │
│  ├─ NewPostsPill  ◀── SSE "new_posts"    │       │  /feed?cursor=…             │
│  ├─ VirtualFeed (variable heights)       │       │  /posts (create)            │
│  │    └─ PostCard (memoized)             │       │  /posts/:id/like            │
│  └─ Query cache (normalized entities)    │       │ Media CDN (resized/AVIF)    │
└──────────────────────────────────────────┘       └─────────────────────────────┘
```

### Data model (client)

```ts
interface Post {
  id: string;
  authorId: string;
  createdAt: string;
  text: string;
  media: { id: string; url: string; width: number; height: number; alt: string }[];
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
}

interface FeedPage {
  postIds: string[];
  nextCursor: string | null;
}

// Normalized cache
interface FeedState {
  posts: Record<string, Post>;
  users: Record<string, { id: string; name: string; avatarUrl: string }>;
  feed: { pages: FeedPage[]; pendingNewIds: string[] };
}
```

### API

```http
GET /api/feed?cursor=eyJ0IjoxNz…&limit=20
→ 200 { "posts": [...], "users": [...], "nextCursor": "…" }

POST /api/posts  (Idempotency-Key: <uuid>)
→ 201 { "post": {...} }

POST /api/posts/:id/like     DELETE /api/posts/:id/like
→ 200 { "likeCount": 42, "likedByMe": true }

GET /api/feed/stream  (text/event-stream)
event: new_posts
data: { "count": 3, "newestCursor": "…" }
```

### Deep dives

**New posts without layout jumps.** Never insert above the viewport while the user reads. Accumulate in `pendingNewIds`, show a pill ("3 new posts"); on click, prepend and scroll to top. If the user is already at the top, insert with an animation.

**Virtualization with variable heights.** Posts vary (text length, images). Use estimated heights, measure on render, and anchor scroll when heights change above the viewport. Reserve image space with `aspect-ratio` from known dimensions so measurement is stable.

**Optimistic like with races.**

```ts
function toggleLike(post: Post) {
  const previous = { likeCount: post.likeCount, likedByMe: post.likedByMe };
  updatePost(post.id, { likedByMe: !post.likedByMe, likeCount: post.likeCount + (post.likedByMe ? -1 : 1) });
  const request = post.likedByMe ? api.unlike(post.id) : api.like(post.id);
  request
    .then((server) => updatePost(post.id, server)) // reconcile with the server's truth
    .catch(() => {
      updatePost(post.id, previous);
      toast('Could not update like');
    });
}
```

Rapid double taps can interleave; serialize per post (queue the latest intent) or send the desired state (`PUT /like { liked: true }`) instead of toggles, which is idempotent.

**Media.** CDN-resized images by viewport (`srcset`), AVIF/WebP, lazy below the fold, blur-up placeholders, video posters with `preload="none"`. Upload images directly to storage via presigned URLs, show progress, and post only after upload completes.

### Performance and accessibility

- SSR first page; stream; hydrate selectively.
- Prefetch next page at ~2 screens from the end.
- `role="feed"` with `article` items, `aria-setsize`/`aria-posinset`, keyboard shortcuts (j/k) optional, focus management when new posts are revealed.
- Memory cap: drop far-away pages or virtualize aggressively for long sessions.

### Observability

Track feed load time (server and client), scroll jank (long animation frames), engagement events, error rates on like/post, and SSE connection health.

### References

- [WAI-ARIA APG: Feed pattern](https://www.w3.org/WAI/ARIA/apg/patterns/feed/)
- [TanStack Query: Optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)

## Design an e-commerce product page: SSR/streaming, caching, SEO, personalization and Core Web Vitals
<!--
id: design-ecommerce-pdp
level: lead
tags: system design, e-commerce, ssr, streaming, caching, seo, core web vitals
minutes: 25
-->

> [!PROMPT]
> Design a product detail page for a high-traffic store: SEO-critical, personalized pricing and stock, heavy images, and a strict LCP target.
>
> **Cover**
> - Splitting the page by cacheability: static content, per-user data and real-time stock.
> - Rendering strategy (SSG/ISR/streaming), image pipeline, caching and CDN design.
> - SEO (structured data), personalization without layout shift, A/B testing, and Core Web Vitals budgets.

> [!TLDR]
> Split the page by **cacheability**: product content (title, images, description, specs) is the same for everyone and can be statically generated or cached at the edge with revalidation; price, stock and promotions change often and are fetched fresh or streamed; personalization (recommendations, "you viewed", cart) is per user and loaded client-side or streamed after the shell. Optimize LCP around the hero image, keep the add-to-cart island small and fast, emit structured data for SEO, and make the page resilient: recommendations failing must never break buying.

### Requirements

- Functional: gallery, variants (size/color), price and availability, add to cart, reviews, recommendations, breadcrumbs, shareable variant URLs.
- Non-functional: LCP < 2.5s on mid-range mobile, SEO-indexable, high traffic spikes (sales), A/B testing, multi-region, accessible, localized prices.

### Rendering plan

| Region | Freshness | Strategy |
| --- | --- | --- |
| Product content, images | Hours | SSG/ISR or edge cache with tag-based revalidation |
| Price, stock | Seconds–minutes | Server fetch at request time, streamed; or client fetch with skeleton |
| Add to cart | Interactive | Small client island |
| Reviews | Minutes | Streamed behind Suspense; paginated |
| Recommendations, recently viewed | Per user | Client-side or streamed late; lazy below the fold |

```text
Request → CDN (cached HTML shell + product content, keyed by product+locale)
        → stream price/stock (fast service), then reviews, then recs
        → hydrate only interactive islands (variant picker, add to cart, gallery)
```

### Variant state in the URL

`/p/trail-shoe-123?color=blue&size=42`: shareable, back-button friendly, SEO-canonical (`<link rel="canonical">` to the base product), and drives server rendering of the right image and price.

### SEO

- Server-rendered HTML with real content.
- `Product` structured data (JSON-LD: name, image, offers.price, availability, aggregateRating).
- Clean URLs, canonical tags, `hreflang` for locales, fast and stable pages (CWV is a ranking signal).

### Performance specifics

- Hero image: correct `sizes`, AVIF/WebP, `fetchpriority="high"`, not lazy; preload if it's a CSS background.
- Gallery: load other images lazily; keep thumbnails small.
- Third-party scripts (reviews widget, chat, analytics, A/B testing) deferred; A/B variants decided at the edge to avoid flicker scripts that block render.
- Font subsetting and fallback metrics for no CLS.

### Resilience

Each region has its own error boundary and fallback. If inventory is down, show "Check availability in cart" rather than a broken page; if recommendations fail, render nothing. Cart writes are idempotent with retry.

### Caching and invalidation

Tag cache entries by product id; when the catalog changes a product, purge by tag. Prices with short TTL or no cache; never cache personalized fragments in shared caches (`Cache-Control: private`).

### References

- [web.dev: Rendering on the web](https://web.dev/articles/rendering-on-the-web)
- [Google Search Central: Product structured data](https://developers.google.com/search/docs/appearance/structured-data/product)
- [Next.js: Incremental Static Regeneration](https://nextjs.org/docs/app/guides/incremental-static-regeneration)

## Design a real-time analytics dashboard (Datadog/Grafana-like): data flow, charts and backpressure
<!--
id: design-realtime-dashboard
level: lead
tags: system design, dashboards, real-time, websockets, charts, performance
minutes: 30
-->

> [!PROMPT]
> Design a real-time analytics dashboard (like Datadog): dozens of widgets, each with a time range, auto-refresh and live updates, used on large screens for hours.
>
> **Cover**
> - Data flow: a query layer with deduping, polling versus WebSocket/SSE, and backpressure when data arrives faster than you can render.
> - Chart rendering (SVG versus canvas), downsampling, and memory over long sessions.
> - Time range sync, error and stale-data states, and accessibility of charts.

> [!TLDR]
> A dashboard is a grid of independent widgets, each with a query, a time range and a refresh policy. Centralize data fetching in a query layer that dedupes identical queries, batches requests, and pauses when the tab is hidden. Stream live updates over WebSocket/SSE, but **buffer and coalesce** them: apply at most once per animation frame (or per second), downsample to the pixel width of the chart, and render large series with canvas/WebGL. Isolate widget failures, keep the time range in the URL, and handle clock and timezone correctly.

### Requirements

- Widgets: time series, top-N tables, single stats, heatmaps; 10–40 per dashboard.
- Time ranges (last 15m, custom), auto-refresh, live tail mode, cross-widget hover sync, drill-down.
- Scale: some series have thousands of points per widget; updates every second in live mode.
- NFRs: smooth interaction (no frozen UI while data arrives), works for hours (no leaks), shareable state.

### Architecture

```text
URL state (dashboardId, from, to, vars) ──▶ DashboardStore
                                               │
Widget[] ──(query spec)──▶ QueryScheduler ──▶ /api/query (batched)   live: WebSocket
                              │  dedupe identical specs                 │
                              │  pause when hidden                      ▼
                              │  concurrency limit              StreamBuffer (per series)
                              ▼                                     │ coalesce per frame
                         Result cache (by spec hash + range)        ▼
                              │                                Downsampler (LTTB/min-max per pixel)
                              ▼                                     │
                         Chart renderer (canvas/WebGL, uPlot/ECharts) ◀┘
```

### Key decisions

**Time range as the source of truth.** `?from=now-1h&to=now&tz=UTC` in the URL; "now"-relative ranges are resolved at query time. Every widget shares it (with optional per-widget overrides).

**Backpressure.** If the server pushes faster than you can render, don't render every message:

```ts
class FrameCoalescer<T> {
  #pending: T[] = [];
  #scheduled = false;
  readonly #flush: (batch: T[]) => void;

  constructor(flush: (batch: T[]) => void) {
    this.#flush = flush;
  }

  push(item: T) {
    this.#pending.push(item);
    if (this.#scheduled) return;
    this.#scheduled = true;
    requestAnimationFrame(() => {
      this.#scheduled = false;
      const batch = this.#pending;
      this.#pending = [];
      this.#flush(batch); // one state update per frame, not per message
    });
  }
}
```

When hidden, rAF stops: buffer with a cap (drop oldest or switch to "refetch range on return").

**Downsampling.** A 600px-wide chart can't show 50,000 points. Downsample server-side (preferred) or in a worker with min/max per pixel bucket (preserves spikes) or LTTB.

**Rendering.** SVG is fine for hundreds of points; canvas for tens of thousands; WebGL beyond. Keep chart instances mounted and update data in place instead of re-creating them on each tick.

**Isolation.** Each widget has its own error/loading state, timeout and retry; one slow query doesn't block the others. Cap concurrent queries per dashboard.

**Long sessions.** Ring buffers per series (bounded memory), unsubscribe on unmount, pause polling when hidden (`visibilitychange`), resume with a range refetch.

### Interaction details

- Crosshair sync across charts via a lightweight shared store (not React context re-rendering every widget on mouse move; use a subscription per chart).
- Brushing a chart updates the URL time range; back button returns.
- Accessible: data tables as alternatives to charts, keyboard-reachable tooltips/legends, sufficient color contrast and non-color encodings.

### References

- [uPlot (fast time-series charts)](https://github.com/leeoniya/uPlot)
- [Downsampling with LTTB (Sveinn Steinarsson)](https://skemman.is/bitstream/1946/15343/3/SS_MSthesis.pdf)
- [MDN: WebSockets API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)

## Design a spreadsheet (Google Sheets lite): grid virtualization, formulas and collaboration
<!--
id: design-spreadsheet
level: principal
tags: system design, spreadsheet, virtualization, dependency graph, collaboration, canvas
minutes: 35
-->

> [!PROMPT]
> Design a lightweight spreadsheet (Google Sheets lite) in the browser supporting 1 million rows, formulas with dependencies, copy/paste and shared editing.
>
> **Cover**
> - Data model (sparse cells), a virtualized 2D grid, DOM versus canvas rendering.
> - The formula engine: parsing, a dependency graph, recalculation order, cycle detection.
> - Collaboration and conflict handling, undo/redo, and performance targets.

> [!TLDR]
> Model the sheet as a **sparse** map of cells (`"B7" → { raw, value, format }`), render with a 2D-virtualized grid (DOM for modest sizes, canvas for very large sheets plus an overlay for editing and accessibility), and evaluate formulas with a parser → AST → **dependency graph**; on edit, recompute only dependents in topological order and detect cycles. Keep the UI responsive by running recalculation in a Web Worker for large sheets. Collaboration uses operations on cells (or a CRDT) with server ordering, presence cursors, and per-user undo.

### Requirements

- Grid up to 100k rows × 1k columns (mostly empty), select, edit, copy/paste, fill handle, resize rows/columns, freeze panes.
- Formulas: `=SUM(A1:A10)`, references, ranges, cross-sheet refs; errors (`#REF!`, `#DIV/0!`, `#CYCLE!`).
- Multiple users editing simultaneously; undo/redo per user.

### Data model

```ts
type CellId = string; // "A1"; or numeric row/col keys for speed

interface Cell {
  raw: string;                      // what the user typed: "42", "hello", "=A1*2"
  value: number | string | boolean | CellError | null;
  formula?: FormulaAst;
  format?: { numberFormat?: string; bold?: boolean; align?: 'left' | 'right' | 'center' };
}

interface Sheet {
  cells: Map<CellId, Cell>;          // sparse
  rowHeights: Map<number, number>;   // only overrides
  colWidths: Map<number, number>;
  dependents: Map<CellId, Set<CellId>>; // B1 → {C1, D4}: who depends on me
  precedents: Map<CellId, Set<CellId>>; // C1 → {B1}
}
```

### Recalculation

```ts
function recalc(sheet: Sheet, changed: CellId): void {
  const order = topologicalDependents(sheet, changed); // DFS over dependents; throws on cycle
  for (const id of order) {
    const cell = sheet.cells.get(id);
    if (cell?.formula) cell.value = evaluate(cell.formula, (ref) => sheet.cells.get(ref)?.value ?? null);
  }
}
```

- Parse once on edit; store the AST and its references; update `precedents/dependents` edges.
- Topological order prevents double computation; a visited-in-progress set detects cycles (mark those cells `#CYCLE!`).
- Range references (`A1:A10000`) should be stored as ranges, not 10,000 edges; index ranges with an interval structure.
- Volatile functions (`NOW()`, `RAND()`) recompute on every change/tick.
- For big sheets, run parse/recalc in a worker and send back changed values in batches.

### Rendering

- Two-axis virtualization: compute visible row/col ranges from prefix sums of sizes (most rows default height, so store overrides only).
- Canvas rendering (like Google Sheets) handles huge grids smoothly; overlay a positioned `<textarea>` for editing, and maintain an accessible representation (focused cell announced via live region/`aria-activedescendant` in a `role="grid"` DOM shadow for the visible window).
- Frozen rows/columns as separate panes sharing scroll positions.

### Collaboration

- Operations: `setCell(id, raw)`, `insertRows(at, n)`, `deleteCols(...)`. Structural operations shift references: formulas referencing moved cells must be rewritten (OT-style transformation of references).
- Server assigns a total order; clients apply local ops optimistically and rebase on server order.
- Presence: each user's selection broadcast via WebSocket, rendered as colored borders.
- Undo: per-user stack of inverse operations, transformed against later remote ops.

### Clipboard

Copy as TSV + HTML table for interoperability with Excel; paste parses TSV/HTML; large pastes become one batched operation (and one undo step).

### References

- [WAI-ARIA APG: Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
- [Topological sorting](https://en.wikipedia.org/wiki/Topological_sorting)

## Design a collaborative document editor: OT vs CRDT, presence, offline and undo
<!--
id: design-collaborative-editor
level: principal
tags: system design, collaboration, crdt, operational transformation, yjs, presence, offline
minutes: 30
-->

> [!PROMPT]
> Design the frontend of a collaborative document editor (like Google Docs) with live cursors, offline editing and per-user undo.
>
> **Cover**
> - The editor model (ProseMirror/Lexical/Tiptap versus `contenteditable`) and document schema.
> - Concurrency: OT versus CRDT trade-offs, presence, and syncing over WebSocket with reconnection.
> - Offline edits, history/undo semantics in a collaborative context, and what you'd measure.

> [!TLDR]
> Use a structured editor model (ProseMirror/Lexical/Tiptap), not `contenteditable` HTML. For concurrency, choose **OT** (central server transforms operations; Google Docs) or a **CRDT** (operations commute, merge anywhere, great for offline and peer-to-peer; Yjs/Automerge). For most teams today, Yjs + a sync server + IndexedDB persistence is the pragmatic choice. Presence (cursors, selections) travels on an ephemeral channel. Undo must be **per user** and only revert your own operations. Plan for document size growth (GC/snapshots), permissions, comments anchored to positions, and versions.

### Requirements

- Rich text (headings, lists, links, images), real-time co-editing with <200ms perceived latency, presence cursors, comments, version history, offline edits that merge on reconnect, permissions (view/comment/edit).

### OT vs CRDT

| | OT | CRDT (e.g. Yjs) |
| --- | --- | --- |
| Needs central server ordering | Yes | No (server is just a relay/persistence) |
| Offline/long divergence | Harder | Natural |
| Metadata overhead | Low | Higher (tombstones, ids), mitigated by GC/encoding |
| Implementation complexity | Transform functions per op pair | Use a library; custom types are hard |
| Examples | Google Docs, ShareDB | Figma-like systems, Linear sync ideas, Yjs/Automerge apps |

### Architecture with Yjs

```text
Editor (ProseMirror) ⇄ y-prosemirror binding ⇄ Y.Doc (CRDT state)
                                            ├─ y-indexeddb   (local persistence, offline)
                                            ├─ provider (WebSocket) ⇄ Sync server ⇄ Storage (snapshots + updates)
                                            └─ awareness      (presence: cursor, name, color; ephemeral)
```

```ts
const doc = new Y.Doc();
const persistence = new IndexeddbPersistence(`doc:${docId}`, doc);      // instant load, offline
const provider = new WebsocketProvider(SYNC_URL, docId, doc, { params: { token } });
provider.awareness.setLocalStateField('user', { name: me.name, color: me.color });

const undo = new Y.UndoManager(doc.getXmlFragment('content'), {
  trackedOrigins: new Set([ySyncPluginKey]), // only my local edits are undoable
  captureTimeout: 500,                         // coalesce typing
});
```

### Deep dives

- **Permissions**: the sync server authenticates the WebSocket and enforces read-only by rejecting updates from viewers. Never trust the client.
- **Comments**: anchor to relative positions (`Y.RelativePosition`) so they survive concurrent edits; store comment threads separately.
- **Versions**: periodic snapshots (encoded state) with author/time; restoring creates new operations (doesn't rewrite history).
- **Large docs**: lazy-load sub-documents, compact update logs into snapshots server-side, GC deleted content when safe.
- **Presence at scale**: throttle cursor updates (~20/s), hide idle users, cap rendered cursors.
- **Conflicts users can see**: concurrent formatting/deletes are merged deterministically but may surprise; show who changed what (attribution) and rely on undo.

### Failure modes

Reconnect with backoff and resync state vectors (only missing updates are exchanged); show "Offline, changes saved locally"; warn before closing if local updates aren't persisted anywhere.

### References

- [Yjs documentation](https://docs.yjs.dev/)
- [Ink & Switch: Local-first software](https://www.inkandswitch.com/local-first/)
- [crdt.tech](https://crdt.tech/)
- [Figma: How multiplayer works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)

## Design an offline-first app: local database, sync queue, conflicts and service worker
<!--
id: design-offline-first
level: lead
tags: system design, offline-first, sync, indexeddb, conflicts, service worker, pwa
minutes: 25
-->

> [!PROMPT]
> Design an offline-first field-service app: technicians fill forms and attach photos with no connectivity, then sync when back online, possibly editing the same record as the office.
>
> **Cover**
> - Local database as the source of truth, a write queue and background sync.
> - Conflict detection and resolution policies, idempotent sync, and partial failures.
> - Service worker and storage limits, data migration, and how you show sync state to users.

> [!TLDR]
> Treat the **local database** (IndexedDB, or SQLite in OPFS) as the app's source of truth for the UI; the network becomes a sync channel. Writes go to the local DB and an **outbox** of operations with idempotency keys; a sync engine pushes the outbox when online and pulls server changes since a cursor. Resolve conflicts with a policy chosen per entity (last-writer-wins per field, server wins, merge, or ask the user). A service worker caches the app shell so it launches offline. Communicate sync state clearly.

### Requirements (example: field-inspection app)

- Create/edit inspections with photos while offline for hours; sync later.
- Multiple devices per user; occasionally two people edit the same record.
- Must never lose data; must show what's pending.

### Architecture

```text
UI ⇄ Local DB (IndexedDB/SQLite-OPFS) ── live queries (re-render on change)
        ▲            │
        │            ▼
   Pull changes   Outbox (ops: {opId, entity, id, patch, baseVersion})
        ▲            │  push when online, in order, with retries + backoff
        └──── Sync engine ⇄ /sync API (push ops, pull since cursor)
Service worker: precache app shell + assets; background sync where supported
```

### Operation format

```ts
interface Op {
  opId: string;            // UUID: idempotency key, server dedupes retries
  entity: 'inspection' | 'photo';
  id: string;              // client-generated UUID so offline-created records have stable ids
  kind: 'create' | 'update' | 'delete';
  patch?: Record<string, unknown>;
  baseVersion: number | null; // version the client edited from (for conflict detection)
  at: number;
}
```

### Conflict strategies

| Data | Strategy |
| --- | --- |
| Independent fields (title, notes) | Field-level last-writer-wins (by server receive order or hybrid logical clock) |
| Counters/sets | Merge (CRDT-like: grow-only sets, PN-counters) |
| Critical values (approval status) | Server wins; client shows the conflict |
| Rich text | CRDT (Yjs) |
| Rare true conflicts | Keep both versions, ask the user |

### Sync engine essentials

- Push the outbox **in order** per entity; a failed op blocks later ops for the same entity, not everything.
- Retries with backoff on network/5xx; on 4xx validation errors, move the op to a "needs attention" list and show it.
- Pull with a server cursor (change log), apply in a transaction, then re-apply local pending ops on top (rebase).
- Photos: store blobs in IndexedDB/OPFS, upload in chunks, reference by id; handle quota (`navigator.storage.estimate()`, `persist()`).
- Leader election across tabs (Web Locks) so only one tab syncs.

### UX

Clear states: "All changes synced", "3 changes waiting to sync", "Offline: changes are saved on this device". Never block editing on the network. Show conflicts inline with a resolution choice.

### References

- [Ink & Switch: Local-first software](https://www.inkandswitch.com/local-first/)
- [web.dev: Offline cookbook](https://web.dev/articles/offline-cookbook)
- [MDN: Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)

## Design search with autocomplete at scale (frontend side): caching, ranking display and latency
<!--
id: design-search-autocomplete
level: senior
tags: system design, search, autocomplete, caching, latency, accessibility
minutes: 20
-->

> [!PROMPT]
> Design the frontend of search with autocomplete for a large e-commerce site: suggestions appear as you type, with recent searches, categories and products, on slow mobile networks.
>
> **Cover**
> - Request strategy: debouncing, cancellation, caching by prefix, prefetching, and failure fallbacks.
> - Ranking and display, highlighting, keyboard and screen reader behavior.
> - Analytics, latency budgets and how you'd test relevance and performance.

> [!TLDR]
> The frontend's job is to make suggestions feel instant and correct: debounce lightly (or not at all with fast backends), cancel stale requests, cache by normalized prefix (in memory with LRU, optionally IndexedDB for popular prefixes), prefetch likely next prefixes, render results without layout shift, and implement the combobox pattern accessibly. Keep the search state in the URL for results pages, log queries and clicks for ranking, and degrade gracefully when the suggestion service is slow.

### Requirements

- Suggestions after 1–2 characters, < 100ms perceived latency, keyboard navigation, recent searches, categories (products, people, help articles), highlight matches, mobile friendly.

### Client architecture

```text
Input ── normalize(q) ──▶ SuggestCache (LRU by prefix) ──hit──▶ render
                │                     │ miss
                │                     ▼
                │              Request manager: debounce 0–150ms, abort previous, dedupe in-flight
                │                     ▼
                │              /suggest?q=…&locale=…  (CDN-cacheable for anonymous users)
                ▼
          Recent searches (localStorage, max 10, user can clear)
```

### Latency techniques

- **Prefix reuse**: if results for "reac" are complete (server says `exhaustive: true`), filter them locally for "react" instead of a new request.
- **CDN caching** for anonymous prefix queries with short TTL; personalize by merging client-side.
- **Connection warmup**: `preconnect` to the search origin on page load or input focus.
- **Keep previous results** visible while loading the next; avoid spinner flicker (show only after ~200ms).

### Rendering

- Group by category with headings (`role="group"` within the listbox), highlight matched spans safely (no `innerHTML` from the server).
- Fixed row heights to avoid layout shift while results change.
- Screen reader: announce count after results settle (polite live region), `aria-activedescendant` for the highlighted option.

### Analytics and ranking feedback

Log (sampled, privacy-aware) query, position clicked, time to click, and abandonment. The client should send which suggestion version was shown so ranking experiments are measurable.

### Failure modes

Timeout suggestions (e.g. 800ms) and fall back to recent searches; never block the user from pressing Enter for a full search.

### References

- [WAI-ARIA APG: Combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [Nielsen Norman Group: Site search suggestions](https://www.nngroup.com/articles/site-search-suggestions/)
