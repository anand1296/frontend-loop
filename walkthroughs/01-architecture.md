---
id: architecture
title: The big picture
summary: One React app that runs with or without a backend, one Go handler that runs as a Vercel function or a binary, and Postgres. How a page load becomes either "server mode" or "local-only mode", and why it was built that way.
order: 1
minutes: 12
tags: architecture, react, go, vercel, postgres
---

> [!TLDR]
> The frontend is a Vite + React SPA whose questions are compiled into the bundle at build time, so it works on any static host. On boot it makes **one** request, `GET /api/bootstrap`. If a Go backend answers, content, progress and the signed-in user come from Postgres through it ("server mode"); if nothing answers, the same app keeps progress in the browser ("local-only mode"). The backend is one `http.Handler` deployed as a single Vercel Go function (or a normal binary), built on the standard library.

### The map

```text
                         Browser
  ┌──────────────────────────────────────────────────────────┐
  │ React 19 SPA (Vite)                                       │
  │  • questions compiled from content/*.md at build time     │
  │  • tiny external stores + useSyncExternalStore            │
  │  • hash routes: #review, #<round>, #<question>, #admin …  │
  └───────────────┬──────────────────────────────────────────┘
                  │ same origin, cookies, JSON
                  ▼
  Vercel ── static files (dist/) ── CDN
        └─ /api/* ──rewrite──▶ api/index.go (one Go function)
                                   │
                         server.Lazy → server.Server
                         (routes, sessions, CSRF, CMS)
                                   │ database/sql + lib/pq
                                   ▼
                          Postgres (Neon)      SMTP (Gmail)   GitHub OAuth
```

### Booting: one request decides the mode

Everything starts in [main.tsx](repo:src/main.tsx#boot). Before React renders anything, the app asks whether a backend exists:

```tsx excerpt=src/main.tsx#boot
```

[`connectBackend`](repo:src/platform/backend.ts#connectBackend) turns the answer into one of three modes:

```ts excerpt=src/platform/backend.ts#connectBackend
```

- **server**: the API answered `200 {mode: "server"}`. Content, feature flags and the user come from it.
- **setup**: the API exists but answered `503` with a configuration checklist (booleans only, never secret values). The app shows that checklist instead of pretending to sync.
- **none**: no API at all (a static host, the single-file build, a network error). The app runs exactly as it did before there was a backend.

> [!PRINCIPAL]
> This is **graceful degradation as an architecture**, not an error path. The static build is a first-class product (it's also what the single-file HTML build ships), so "no backend" can never be a crash. The trade-off is that two modes must be kept working; CI runs end-to-end tests for both ([ci.yml](repo:.github/workflows/ci.yml)). Read [ADR-020](repo:docs/DECISIONS.md#ADR-020).

The `__BACKEND__` constant is replaced at build time, so the single-file build doesn't even contain the probe. Then [`App`](repo:src/app/App.tsx#App) applies the gates: setup screen, the sign-in screen for members-only sites, or the app itself.

### State without a state library

The app's state is a handful of small external stores ([createStore.ts](repo:src/state/createStore.ts)) read with React's `useSyncExternalStore` ([useStore.ts](repo:src/state/useStore.ts)). Progress, preferences, the route, server state and content each have one. Why not Redux or Zustand? The whole store is ~30 lines, has no provider to forget, and works outside React too (the router and the sync engine write to stores directly). See [ADR-004](repo:docs/DECISIONS.md#ADR-004).

Routing is a single hash token ([route.ts](repo:src/state/route.ts#parseHash)): `#review`, `#react-internals`, `#event-loop-rendering-order`, `#how-its-built/architecture`. Hash URLs survive any host (including sandboxed ones where only `#anchors` work) and every question has a shareable link. See [ADR-003](repo:docs/DECISIONS.md#ADR-003).

### The backend: one handler, two ways to run it

Vercel turns every `.go` file in `api/` into a function, so there is exactly one, [api/index.go](repo:api/index.go). All of `/api/*` is rewritten to it ([vercel.json](repo:vercel.json#rewrites)) and the original path is restored before routing:

```go excerpt=backend/server/lazy.go#rewrite
```

On a cold start nothing is connected yet. [`Lazy`](repo:backend/server/lazy.go#Lazy) builds the real server on the first request and, unlike `sync.Once`, **retries** a failed start (a database that was briefly unreachable shouldn't brick the instance until the next deploy):

```go excerpt=backend/server/lazy.go#get
```

Locally the same [`Build`](repo:backend/server/lazy.go#Build) runs inside a normal binary, [cmd/server/main.go](repo:cmd/server/main.go#main), which can also serve the built frontend. One code path, two deployment shapes ([ADR-018](repo:docs/DECISIONS.md#ADR-018)).

#### Middleware, outermost last

```go excerpt=backend/server/server.go#Handler
```

Reading from the inside out: routes, then the session (who are you?), then CSRF (did your browser mean to send this?), access logging, security headers, and a panic guard around everything. Routes use Go 1.22's pattern syntax (`"GET /api/admin/questions/{id}"`), so there is no router dependency ([ADR-012](repo:docs/DECISIONS.md#ADR-012)).

### Data: Postgres with plain SQL

[store.go](repo:backend/store/store.go) opens a `database/sql` pool and runs embedded, forward-only migrations at start-up, guarded by an advisory lock so two cold starts can't migrate at once:

```go excerpt=backend/store/store.go#Migrate
```

No ORM: every query is visible SQL in [backend/store/](repo:backend/store/), which keeps things like `FOR UPDATE SKIP LOCKED` (see the email reminders walkthrough) a one-line decision rather than a fight with an abstraction ([ADR-013](repo:docs/DECISIONS.md#ADR-013)).

### Where to go next

- How content gets from Markdown into the app: **The content pipeline**.
- Who you are and how you got in: **Sign-in, sessions and invites**.
- Your ticks on two devices: **Progress sync**.
- The full specification and every decision: [SPEC.md](repo:docs/SPEC.md) and [DECISIONS.md](repo:docs/DECISIONS.md).

### If you're asked about this in an interview

- **"SPA or SSR?"** For an authenticated study tool with no SEO needs and content that changes rarely, a static SPA with build-time content is cheaper, faster after first load, and deploys anywhere. Say what would change your mind (public, SEO-relevant pages; slow devices on slow networks).
- **"Why one serverless function instead of one per route?"** Shared cold-start cost, shared connection pool, one router, and the same handler runs locally. The cost is a bigger function; at this scale that's irrelevant.
