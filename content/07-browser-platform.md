---
id: browser-platform
title: Browser & Web Platform
description: What the browser actually does with your bytes: rendering pipeline, HTTP caching, CORS, loading priorities, service workers, storage and workers.
---

## The critical rendering path: parse, style, layout, paint, composite. What triggers what?
<!--
id: critical-rendering-path
level: senior
tags: rendering, layout, paint, compositing, layout thrashing, css
minutes: 15
-->

> [!TLDR]
> HTML is parsed into the DOM, CSS into the CSSOM; together they produce the render tree. **Style** computes styles, **layout** computes geometry, **paint** records drawing commands into layers, and **composite** assembles layers on the GPU. Changing geometry (width, top, font-size) triggers layout + paint + composite; changing colors triggers paint + composite; changing `transform` and `opacity` on a composited layer can skip to composite only. Reading layout (`offsetHeight`, `getBoundingClientRect`) after writing styles forces synchronous layout, and doing that in a loop is **layout thrashing**.

### Loading: what blocks first paint

- **CSS is render-blocking**: the browser won't paint until CSSOM is ready (avoids flashes of unstyled content).
- **Classic `<script>` is parser-blocking**: parsing stops while it downloads and runs. `defer` (run after parsing, in order) and `async` (run when ready, any order) fix that; `type="module"` is deferred by default.
- **Fonts** can block text rendering (invisible text) depending on `font-display`.
- The preload scanner finds resources in HTML early, which is why resources discovered only by JS (CSS-in-JS, client-rendered `<img>`) load late.

### Layout thrashing

```ts
// Bad: read → write → read → write forces a layout on every iteration.
for (const card of cards) {
  const height = card.offsetHeight;         // read (forces layout if styles are dirty)
  card.style.height = `${height + 10}px`;   // write (dirties layout)
}

// Good: batch all reads, then all writes.
const heights = cards.map((card) => card.offsetHeight);
cards.forEach((card, i) => {
  card.style.height = `${(heights[i] ?? 0) + 10}px`;
});
```

In frameworks, this typically appears in `useLayoutEffect`s that measure then set state across many components. Libraries like FastDOM schedule reads and writes in separate phases.

### Animate the cheap properties

```css
/* Triggers layout every frame */
.panel-slow { transition: left 200ms; }

/* Composite-only (when promoted to its own layer) */
.panel-fast { transition: transform 200ms, opacity 200ms; will-change: transform; }
```

`will-change` promotes an element to its own layer ahead of time; overusing it wastes GPU memory. Promote during the animation, not forever.

### Containment and skipping work

- `contain: layout paint` (or `content`) tells the browser changes inside don't affect outside, limiting layout/paint scope.
- `content-visibility: auto` skips rendering off-screen sections entirely until they approach the viewport (pair with `contain-intrinsic-size` to avoid scroll jumps).

### How to verify

DevTools Performance panel: purple (rendering/layout), green (paint) blocks; "Forced reflow" warnings with stack traces; the Layers panel for compositing; "Paint flashing" in the Rendering tab.

### Follow-ups

- **"Why is `transform` cheaper than `top`?"** `top` changes layout for the element and possibly its neighbors; `transform` changes how an already-painted layer is drawn, which the compositor can do off the main thread.
- **"What is the main thread doing during scroll?"** Ideally nothing: compositor-thread scrolling. Non-passive `wheel`/`touchmove` listeners force scrolling to wait for JS; mark them `{ passive: true }`.

### References

- [web.dev: Rendering performance](https://web.dev/articles/rendering-performance)
- [web.dev: Avoid large, complex layouts and layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing)
- [Paul Irish: What forces layout/reflow](https://gist.github.com/paulirish/5d52fb081b3570c81e3a)

## HTTP caching for SPAs: `Cache-Control`, ETags, immutable assets and the `index.html` problem
<!--
id: http-caching-spa
level: senior
tags: http caching, cache-control, etag, cdn, deployment
minutes: 15
-->

> [!TLDR]
> Fingerprint every build asset (`app.3f9a1c.js`) and serve it with `Cache-Control: public, max-age=31536000, immutable`, so browsers and CDNs never revalidate. Serve the HTML entry point with `Cache-Control: no-cache` (store, but revalidate every time with ETag/Last-Modified), so a deploy is picked up on the next load. APIs choose per endpoint: `private`, short `max-age`, `stale-while-revalidate`, or `no-store` for sensitive data. Most "users still see the old version" bugs come from a cached `index.html` referencing old chunks.

### The directives that matter

| Directive | Meaning |
| --- | --- |
| `max-age=N` | Fresh for N seconds; no request at all while fresh |
| `no-cache` | May store, but must revalidate before every use |
| `no-store` | Never store (sensitive data) |
| `private` / `public` | Only the browser may cache / shared caches (CDN) may too |
| `s-maxage=N` | Freshness for shared caches only |
| `immutable` | Don't revalidate even on reload |
| `stale-while-revalidate=N` | Serve stale for N seconds while refreshing in the background |
| `ETag` + `If-None-Match` | Revalidation; `304 Not Modified` saves the body |

### A deploy-safe setup

```http
# /index.html
Cache-Control: no-cache
ETag: "b7c2-2026-10-16T04"

# /assets/app.3f9a1c.js, /assets/vendor.81d2e0.js, fonts, images with hashes
Cache-Control: public, max-age=31536000, immutable

# /api/catalog (shared, changes rarely)
Cache-Control: public, s-maxage=60, stale-while-revalidate=300

# /api/me
Cache-Control: private, no-store
```

### The stale-chunk problem after deploys

A user has the app open (old `index.html` in memory). You deploy and delete old assets. They navigate to a lazy route → `import('./settings.ab12.js')` → 404 → `ChunkLoadError`.

Mitigations:

- **Keep old assets** for a while (don't wipe the bucket on deploy; expire after N days).
- **Catch chunk load failures** in the lazy-loading wrapper or router error boundary and do a one-time hard reload (guard against reload loops with `sessionStorage`).
- **Version check**: poll `/version.json` or check a header, and show "A new version is available. Reload."
- Service workers make this both better (controlled updates) and worse (an old SW can serve an old shell indefinitely).

### CDN considerations

- Cache keys: avoid varying on cookies or random query strings; normalize.
- Purge strategy: content-hashed assets never need purging; only HTML/API.
- `Vary: Accept-Encoding` is normal; `Vary: Cookie` destroys hit rates.

### Follow-ups

- **"Why not `max-age=0` for HTML?"** `max-age=0, must-revalidate` is roughly `no-cache`; either way the browser revalidates. `no-store` is overkill for HTML and disables bfcache-friendly behaviors in some browsers.
- **"Where does the back/forward cache fit?"** bfcache keeps whole pages in memory for instant back navigation. `Cache-Control: no-store` on the document and `unload` handlers can block it.

### References

- [MDN: HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
- [web.dev: Love your cache](https://web.dev/articles/love-your-cache)
- [Jake Archibald: Caching best practices](https://jakearchibald.com/2016/caching-best-practices/)

## CORS end to end: simple vs preflighted requests, credentials and common misconfigurations
<!--
id: cors-preflight
level: senior
tags: cors, preflight, credentials, security, http
minutes: 12
-->

> [!TLDR]
> CORS is the browser relaxing the **same-origin policy** when a server opts in with response headers. "Simple" requests (GET/HEAD/POST with safelisted headers and content types) are sent directly, and the browser hides the response unless `Access-Control-Allow-Origin` matches. Anything else (JSON `Content-Type`, `Authorization`, PUT/DELETE, custom headers) first sends an `OPTIONS` **preflight**. Credentialed requests require an exact origin (no `*`) plus `Access-Control-Allow-Credentials: true`. CORS protects users' data in browsers; it's not an authentication mechanism and doesn't stop curl.

### The flow

```text
Browser (https://app.acme.com)                 API (https://api.acme.com)
  OPTIONS /orders                       →
  Origin: https://app.acme.com
  Access-Control-Request-Method: PUT
  Access-Control-Request-Headers: content-type, authorization
                                         ←   204
                                             Access-Control-Allow-Origin: https://app.acme.com
                                             Access-Control-Allow-Methods: GET, PUT, DELETE
                                             Access-Control-Allow-Headers: content-type, authorization
                                             Access-Control-Allow-Credentials: true
                                             Access-Control-Max-Age: 600
                                             Vary: Origin
  PUT /orders (real request)             →
                                         ←   200 + Access-Control-Allow-Origin: https://app.acme.com
```

### Misconfigurations to call out

- **Reflecting any `Origin`** with `Allow-Credentials: true`: any website can read your users' data. Use an allowlist.
- **`Access-Control-Allow-Origin: *` with credentials**: browsers reject it, and people "fix" it by reflecting origins (see above).
- **Missing `Vary: Origin`** when the allowed origin is dynamic: a CDN caches the response for one origin and serves it to another.
- **Allowing `null` origin**: sandboxed iframes and `file://` send `Origin: null`; allowing it is effectively allowing attackers.
- **Preflight not handled** by auth middleware ordering (OPTIONS rejected with 401).

### Performance

Preflights add a round trip. Reduce them with `Access-Control-Max-Age`, by keeping requests "simple" where reasonable, or by serving the API from the same origin (reverse proxy `/api` → backend), which removes CORS entirely.

### Follow-ups

- **"Does CORS prevent CSRF?"** No. Simple cross-site POSTs (forms) are sent with cookies regardless of CORS; the attacker just can't read the response. CSRF defenses are SameSite cookies and tokens.
- **"Why does `fetch` show 'TypeError: Failed to fetch' and no details?"** On a CORS failure the browser deliberately hides details from JavaScript; check the console/network panel.

### References

- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Fetch standard: CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol)
- [PortSwigger: CORS vulnerabilities](https://portswigger.net/web-security/cors)

## Preload, preconnect, modulepreload, fetchpriority: how do you load the right thing first?
<!--
id: resource-hints-priority
level: lead
tags: preload, preconnect, fetchpriority, resource hints, lcp
minutes: 12
-->

> [!TLDR]
> The browser assigns priorities by resource type and position; your job is to fix its blind spots. `preconnect` warms up DNS/TCP/TLS to critical third-party origins. `preload` fetches a resource discovered late (fonts, LCP background image, critical data) without executing it. `modulepreload` fetches and parses JS modules ahead of an import chain. `fetchpriority="high"` boosts the LCP image; `"low"` demotes carousels and below-the-fold assets. Every hint competes for bandwidth, so use few and verify with a waterfall.

### The toolkit

```html
<!-- Third-party origin you'll definitely hit early -->
<link rel="preconnect" href="https://images.acme-cdn.com" crossorigin />

<!-- Font discovered only after CSS parses: fetch it now -->
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin />

<!-- LCP hero image: discovered early AND prioritized -->
<img src="/hero-1200.avif" srcset="/hero-800.avif 800w, /hero-1200.avif 1200w" sizes="100vw"
     width="1200" height="600" fetchpriority="high" alt="..." />

<!-- Route chunk the user is likely to need next -->
<link rel="modulepreload" href="/assets/checkout.4e1b.js" />

<!-- Next page they'll probably visit (low priority, idle time) -->
<link rel="prefetch" href="/assets/settings.9a0c.js" />
```

### Common mistakes

- **Preloading too much**: everything high priority means nothing is. Preloads that aren't used within a few seconds trigger console warnings.
- **Missing `crossorigin` on font preloads**: fonts are fetched in CORS mode, so a non-CORS preload is wasted and the font downloads twice.
- **`loading="lazy"` on the LCP image**: delays the most important image. Lazy-load only below-the-fold images.
- **Preconnecting to many origins**: each connection costs CPU and bandwidth; limit to 2–4 critical ones (`dns-prefetch` for the rest).

### Speculative navigation

The Speculation Rules API lets you prefetch or **prerender** likely next pages (Chromium):

```html
<script type="speculationrules">
{ "prerender": [{ "where": { "href_matches": "/products/*" }, "eagerness": "moderate" }] }
</script>
```

In SPAs, the equivalent is prefetching route chunks and data on **intent** (hover/focus/viewport) rather than on load.

### How to verify

WebPageTest or the DevTools network waterfall with the Priority column; Lighthouse's "Preload LCP image" and "Preconnect" audits; field LCP breakdowns (TTFB, resource load delay, load time, render delay) from CrUX/RUM.

### References

- [web.dev: Optimize resource loading with fetchpriority](https://web.dev/articles/fetch-priority)
- [web.dev: Preload critical assets](https://web.dev/articles/preload-critical-assets)
- [Chrome: Speculation Rules API](https://developer.chrome.com/docs/web-platform/prerender-pages)

## Service workers: caching strategies, the update lifecycle, and the bugs they cause
<!--
id: service-worker-strategies
level: lead
tags: service worker, pwa, offline, caching strategies, workbox
minutes: 18
-->

> [!TLDR]
> A service worker is a programmable network proxy that runs separately from your pages. Strategies: **cache-first** for hashed static assets, **network-first** for HTML/API that must be fresh (fall back to cache offline), **stale-while-revalidate** for things that can be slightly old. The lifecycle (install → waiting → activate → controlling) means a new SW **waits** until all tabs using the old one close; that's the root of "users stuck on an old version". Handle updates explicitly with a "Reload to update" prompt, and always ship a kill switch.

### Lifecycle

```text
register('/sw.js') → install (precache) → [waiting if an old SW controls clients]
                   → activate (clean old caches) → controls new navigations
```

- `skipWaiting()` activates immediately, but then old pages are controlled by a new SW that may not have their old chunks: mixed versions.
- `clients.claim()` takes control of already-open pages without a reload.

### A simple, safe setup (Workbox)

```ts
// sw.ts
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST); // hashed build assets
cleanupOutdatedCaches();

// HTML: fresh when online, cached shell when offline.
registerRoute(new NavigationRoute(new NetworkFirst({ cacheName: 'pages', networkTimeoutSeconds: 3 })));

// API reads that may be slightly stale.
registerRoute(({ url }) => url.pathname.startsWith('/api/catalog'), new StaleWhileRevalidate({ cacheName: 'catalog' }));

// Images: cache-first with limits.
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({ cacheName: 'images', plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 86400 })] }),
);

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting(); // only when the user agrees
});
```

```ts
// app: prompt the user when a new version is waiting
const registration = await navigator.serviceWorker.register('/sw.js');
registration.addEventListener('updatefound', () => {
  const next = registration.installing;
  next?.addEventListener('statechange', () => {
    if (next.state === 'installed' && navigator.serviceWorker.controller) {
      showToast('A new version is available', { action: 'Reload', onAction: () => next.postMessage('SKIP_WAITING') });
    }
  });
});
navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
```

### The bugs

- **Stuck old version**: never cache `sw.js` itself (serve with `no-cache`); browsers check for updates on navigation and at most every 24h.
- **Caching API responses with user data** in shared caches or across logouts; clear caches on logout.
- **Opaque responses** (no-CORS) count large against quota and can't be inspected.
- **Broken SW in production**: ship a kill switch: a new `sw.js` that unregisters itself and clears caches, deployable in minutes.
- **Dev confusion**: "Update on reload" in DevTools, or don't register the SW in development.

### References

- [web.dev: The service worker lifecycle](https://web.dev/articles/service-worker-lifecycle)
- [Chrome: Workbox caching strategies](https://developer.chrome.com/docs/workbox/caching-strategies-overview)
- [MDN: Using service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)

## Choosing client storage: cookies, `localStorage`, IndexedDB, OPFS, Cache API, and syncing across tabs
<!--
id: client-storage-options
level: senior
tags: storage, indexeddb, localstorage, cookies, opfs, broadcastchannel
minutes: 12
-->

> [!TLDR]
> Cookies: small, sent with every request, for server sessions (`HttpOnly`, `Secure`, `SameSite`). `localStorage`: tiny synchronous key-value strings, fine for preferences, bad for large or frequent writes. IndexedDB: async, transactional, large structured data and blobs; the backbone of offline apps (use a wrapper like `idb` or Dexie). OPFS: fast file storage, great with SQLite-in-WASM. Cache API: request/response pairs for service workers. Sync tabs with the `storage` event (localStorage) or `BroadcastChannel`; coordinate writers with Web Locks.

### Comparison

| | Size | API | Sent to server | Workers | Use for |
| --- | --- | --- | --- | --- | --- |
| Cookies | ~4KB each | sync string | Yes | No | Session ids, server-read flags |
| `sessionStorage` | ~5MB | sync | No | No | Per-tab draft state |
| `localStorage` | ~5MB | sync | No | No | Preferences, small caches |
| IndexedDB | Large (quota) | async | No | Yes | Offline data, queues, blobs |
| OPFS | Large (quota) | async/sync in workers | No | Yes | SQLite WASM, big files |
| Cache API | Large (quota) | async | No | Yes | HTTP responses for SW |

### Gotchas

- **Synchronous `localStorage`** blocks the main thread; serializing large objects on every keystroke shows up as jank.
- **Quota and eviction**: browsers can evict "best-effort" storage under pressure; request `navigator.storage.persist()` for important offline data, and check `navigator.storage.estimate()`.
- **Safari** caps script-writable storage lifetime for sites without user interaction (ITP, ~7 days) in some contexts.
- **Private mode** and sandboxed iframes may throw on access. Wrap reads/writes in `try/catch` and validate what you read (it may be from an older app version).
- **Never store auth tokens** in `localStorage` if you can avoid it (XSS can read it).

### Cross-tab sync

```ts
const channel = new BroadcastChannel('cart');

export function updateCart(next: Cart) {
  saveCart(next);                           // IndexedDB or localStorage
  channel.postMessage({ type: 'cart:updated', version: next.version });
}

channel.onmessage = (event) => {
  if (event.data?.type === 'cart:updated') void reloadCartFromStorage();
};
```

The `storage` event fires in *other* tabs when `localStorage` changes, which is enough for small state. For one-writer-at-a-time work (refreshing a token, running a sync job), use `navigator.locks.request('token-refresh', async () => { ... })`.

> [!NOTE]
> This app saves your progress in `localStorage`, validates it on read, and merges changes from other tabs through the `storage` event. When hosted where a per-user cloud store is available, it syncs there too.

### References

- [web.dev: Storage for the web](https://web.dev/articles/storage-for-the-web)
- [MDN: IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [MDN: Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [MDN: Broadcast Channel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)

## When and how do you move work off the main thread with Web Workers?
<!--
id: web-workers-offload
level: lead
tags: web workers, comlink, transferables, performance, inp
minutes: 15
-->

> [!TLDR]
> Move CPU-heavy work that doesn't need the DOM to a Worker: parsing/transforming large JSON or CSV, search indexing, diffing, image processing, syntax highlighting, crypto, WASM. The main thread stays free for input and rendering, which directly improves INP. Communicate with `postMessage` (structured clone), avoid copying big buffers by **transferring** them, wrap the protocol with Comlink for RPC ergonomics, and keep messages coarse because each crossing has a cost.

### A typed worker without a library

```ts
// search.worker.ts
import { buildIndex, query, type Index } from './search-core';

let index: Index | null = null;

type Request =
  | { id: number; type: 'build'; docs: { id: string; text: string }[] }
  | { id: number; type: 'query'; q: string };

self.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  if (message.type === 'build') {
    index = buildIndex(message.docs);
    self.postMessage({ id: message.id, ok: true });
  } else {
    self.postMessage({ id: message.id, ok: true, result: index ? query(index, message.q) : [] });
  }
};
```

```ts
// main thread
const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
let nextId = 0;
const pending = new Map<number, (value: unknown) => void>();
worker.onmessage = (event) => {
  pending.get(event.data.id)?.(event.data.result);
  pending.delete(event.data.id);
};

function call(message: Record<string, unknown>): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...message, id });
  });
}
```

With Comlink the same thing is `const api = wrap<SearchApi>(worker); await api.query('foo')`, fully typed.

### Transfer, don't copy

```ts
const bitmap = await createImageBitmap(file);
worker.postMessage({ type: 'resize', bitmap }, [bitmap]); // ownership moves; zero copy

const buffer = new ArrayBuffer(50_000_000);
worker.postMessage(buffer, [buffer]); // buffer.byteLength is 0 here afterwards
```

`OffscreenCanvas` lets a worker render charts/canvas directly; `SharedArrayBuffer` + `Atomics` allow shared memory but require cross-origin isolation (COOP/COEP headers).

### When it's not worth it

- Small tasks: message overhead (serialization, thread hop) can exceed the work.
- Work that needs the DOM or layout.
- Problems better solved by doing less work (virtualization, pagination, server-side aggregation) or by yielding (`scheduler.yield()`) in chunks.

### Follow-ups

- **"Worker vs `requestIdleCallback`?"** Idle callbacks still run on the main thread in idle gaps; good for low-priority small tasks. Workers truly parallelize.
- **"How do you share a worker across tabs?"** `SharedWorker` (not in all browsers on mobile historically) or one leader tab elected with Web Locks broadcasting via `BroadcastChannel`.

### References

- [MDN: Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
- [Comlink](https://github.com/GoogleChromeLabs/comlink)
- [MDN: Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
