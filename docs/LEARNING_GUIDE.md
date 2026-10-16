# Learning Guide: this codebase as a study project

Frontend Loop is deliberately built with the techniques its answers teach, in the React frontend and (since v2) in the Go backend. Use this guide two ways: as a **code tour** (read the file, then the question it illustrates) and as a list of **exercises** that extend the app and double as interview practice.

> **Start inside the app.** *Behind the scenes → How it's built* has seven walkthroughs (also in [`walkthroughs/`](../walkthroughs/)) that follow one feature at a time through the code: architecture, email reminders, sign-in and sessions, progress sync, the content pipeline and CMS, community contributions, and the walkthrough system itself. Their code excerpts are quoted live from the repository, so they always match what you're reading below.

## Part 1: Code tour

| Read this | It demonstrates | Related question in the app |
| --- | --- | --- |
| `src/state/createStore.ts`, `useStore.ts` | External store + `useSyncExternalStore`, stable selectors | `#external-stores-tearing` |
| `src/state/progress.ts` | Pure immutable domain model, `now` injected for determinism, validation of untrusted input without `as` | `#narrowing-without-assertions` |
| `src/state/progress.ts` → `mergeProgress` | Last-writer-wins map (a simple CRDT), tombstones on reset | `#design-offline-first` |
| `src/state/persistence/cloudSync.ts` | Debounced writes, single in-flight write, echo suppression, terminal vs transient errors | `#retry-backoff-jitter`, `#async-cache-dedupe-swr` |
| `src/state/persistence/local.ts` | Defensive storage access, cross-tab `storage` events | `#client-storage-options` |
| `src/content/index.ts` + `features/section/Answer.tsx` | Cached promise per chunk, React 19 `use()` with Suspense, evict-on-failure for retry | `#react-19-actions`, `#error-suspense-boundaries` |
| `features/section/SectionPage.tsx` | Adjusting state during render (no effect), effects only for DOM sync (scroll/focus), `key` to reset per-round state | `#effects-synchronization` |
| `features/section/QuestionItem.tsx` | Accessible accordion (button + region), memoized items with stable callbacks, latest-value refs for debounced notes | `#react-rerenders-optimizations` |
| `features/search/SearchDialog.tsx` | ARIA combobox with `aria-activedescendant`, `useDeferredValue`, native `<dialog>` | `#typeahead-combobox`, `#keyboard-roving-activedescendant` |
| `components/primitives.tsx` → `Dialog` | Syncing React state to an imperative API (`showModal`) | `#modal-dialog` |
| `components/primitives.tsx` → `ErrorBoundary` | Class error boundary with reset | `#error-suspense-boundaries` |
| `lib/search.ts` | Weighted AND search, tokenization, complexity at this scale | `#design-search-autocomplete` |
| `lib/srs.ts` | A spaced-review ladder | — |
| `build/content/*` | Pure compiler + bundler adapters (ports and adapters), build-time safety | `#xss-react`, `#bundle-strategy` |
| `build/vite-plugin-content.ts` | Writing a Vite plugin with virtual modules and dev-server invalidation | `#esm-vs-commonjs` |
| `scripts/build-single-file.ts` | esbuild API, plugins, inlining assets safely (`</script` escaping) | `#xss-react` |
| `src/styles/tokens.css` | Token-based theming for system/light/dark | `#design-system-governance` |
| `tests/*.test.ts` | Table-style unit tests, deterministic time, fake remote for a sync protocol | `#testing-hooks-async` |
| `e2e/*.spec.ts` | Role-based locators, web-first assertions, isolated storage per test | `#flaky-e2e-ci-speed`, `#testing-library-principles` |

Suggested order: store → progress model → section page → answer loading → search → build pipeline → tests.

### Backend tour (Go)

Read in this order; each file is small and does one thing.

| Read this | It demonstrates | Interview topic |
| --- | --- | --- |
| `cmd/server/main.go` | Composition root, config from env, `http.Server` timeouts, graceful shutdown with `signal.NotifyContext`, static file serving with cache headers and CSP | Running Go services in production |
| `backend/server/server.go` | Go 1.22 `ServeMux` method/wildcard routing, middleware as `func(http.Handler) http.Handler`, panic recovery, one JSON error shape, mapping domain errors to status codes | HTTP API design, error handling |
| `backend/server/session.go` | OAuth web flow with state cookie, opaque sessions, `__Host-` cookies, `context.WithValue` for the current user, authorization wrappers, open-redirect prevention | Auth: sessions vs JWT, CSRF, OAuth |
| `backend/server/settings.go` | Typed settings with validation, a small TTL cache guarded by a mutex, fixed-window rate limiting, trusting proxies correctly | Caching, rate limiting, feature flags |
| `backend/server/lazy.go` | Lazy initialization with retry (why `sync.Once` is wrong here), serverless entry, path rewriting | Serverless cold starts |
| `backend/store/store.go` | `database/sql` pool sizing, transactions helper, migrations under an advisory lock | Connection pooling, schema migrations |
| `backend/store/users.go` | One transaction for a business rule (sign-in + invite), `SELECT … FOR UPDATE`, hashing tokens at rest | Concurrency control, security |
| `backend/store/content.go` | Optimistic concurrency (`revision`), snapshots before writes, `unnest … WITH ORDINALITY` for reordering, `REPEATABLE READ` read-only snapshot, version counter for cache invalidation | Isolation levels, consistency, caching |
| `backend/store/progress.go` + `backend/progress/` | Server-side CRDT-style merge under a row lock; property tests (commutative, idempotent) | Offline-first sync, conflict resolution |
| `backend/markdown/` | goldmark AST transformer (callouts), custom node renderers, sanitizing by construction, mapping chroma tokens to another highlighter's classes | Parsing, XSS prevention |
| `backend/catalog/` | Domain model and validation shared by import, editor and export; round-trip testing | Domain modeling |
| `backend/mail/` | SMTP from the standard library: implicit TLS vs STARTTLS, MIME multipart, header-injection defense, a fake SMTP server in tests | Email delivery, protocols |
| `backend/reminders/` + `store/reminders.go` + `server/reminders.go` | Pure composer vs I/O shell; scheduled job with claim-then-send (`FOR UPDATE SKIP LOCKED`), retry on failure, cron authentication, RFC 8058 one-click unsubscribe | Background jobs, idempotency |
| `backend/server/server_test.go` | Integration tests with `httptest` and a real Postgres, cookie jars per user, a fake OAuth provider, a concurrency race test | Testing strategy for services |
| `api/index.go`, `vercel.json`, `Dockerfile` | Same handler on Vercel and in a distroless container | Deployment, containers |

## Part 2: Exercises (increasing difficulty)

Each exercise lists what it practices. Do them as timed machine-coding sessions, then compare with the related answer.

### Warm-ups (30–60 minutes)

1. **Keyboard shortcuts for questions.** `j`/`k` move focus between question headers, `x` toggles done, `o` opens. Respect inputs/textarea focus. *Practices: global key handling, focus management.*
2. **Search highlighting.** Highlight matched tokens in result titles without `innerHTML`. *Practices: safe rendering, string handling.*
3. **"Random question" button** that picks a not-done question, weighted toward your target level. *Practices: selectors, URL navigation.*

### Core (2–4 hours)

4. **Component tests with Testing Library + Vitest.** Add Vitest with jsdom, test `QuestionItem` (toggle, mark done, notes) and `SearchDialog` (keyboard navigation). *Practices: `#testing-library-principles`.*
5. **Confidence rating.** After revealing an answer in practice mode, rate 1–4; store per question; show "weakest topics" on the overview. *Practices: data modeling, migrations (bump to `version: 2` with a migration from v1).*
6. **Mock interview mode.** Pick N random questions across rounds, a total timer, one question at a time, and a summary at the end. *Practices: state machines (`#exhaustive-state-machines`), timers (`#accurate-countdown-timer`).*
7. **Virtualize long rounds.** Pretend a round has 2,000 questions; keep scrolling and expand/collapse smooth. *Practices: `#virtual-list-from-scratch`.*

### Advanced (a weekend each)

8. **Offline PWA.** Add a service worker (Workbox) with precached assets and an update prompt. *Practices: `#service-worker-strategies`.*
9. **Search in a Web Worker** with a prebuilt inverted index generated at build time. *Practices: `#web-workers-offload`.*
10. **Real backend sync.** *(Done in v2 with the Go API: see `httpProgressDoc` in `src/state/persistence/cloudSync.ts`.)* Extend it: push changes with Server-Sent Events instead of polling on focus. *Practices: `#design-offline-first`, `#auth-token-storage-bff`.*
11. **Observability.** Add `web-vitals` with attribution, an error reporter, and a tiny dashboard of your own study stats. *Practices: `#frontend-observability`, `#core-web-vitals-diagnosis`.*
12. **AI follow-ups.** After you reveal an answer, generate one tough follow-up question with an LLM through a small backend; stream it in; never send secrets from the browser. *Practices: `#streaming-llm-ui`, `#incremental-markdown-rendering`.*

### Full-stack track (backend, Go, data, cloud, AI)

These follow the roadmap in docs/SPEC.md §18; each one is also a set of interview questions to add to the bank.

15. **Tracks.** Implement `002_tracks.sql`, `track:` in front matter, `/admin/tracks` and a track switcher (SPEC §18.1). *Practices: additive migrations, backward-compatible formats.*
16. **Redis rate limiting.** Replace the in-memory limiter with a Redis token bucket (Lua script, atomic). Load-test it with `hey` or `k6` across two instances. *Practices: distributed rate limiting, Redis data structures.*
17. **Redis cache.** Cache the content outline and answers keyed by `content_version`; measure p95 before and after. *Practices: cache-aside, invalidation by versioned keys.*
18. **Live updates with SSE.** `GET /api/events` streams content changes and announcements; use Redis pub/sub so it works across instances. *Practices: SSE vs WebSockets, fan-out.*
19. **sqlc.** Generate typed query code from the SQL in `backend/store`; compare the diff in safety and readability. *Practices: code generation, type-safe data access.*
20. **OpenTelemetry.** Trace a request from the browser through the API into SQL; export to a free tier (Grafana Cloud, Honeycomb). Define two SLOs. *Practices: observability, SLOs.*
21. **Terraform on AWS.** `infra/` modules for VPC, ECS Fargate (the existing Docker image) behind an ALB, RDS Postgres, ElastiCache Redis, S3 + CloudFront for the frontend, Secrets Manager, ACM; GitHub Actions with OIDC running plan on PRs and apply on main. *Practices: IaC, least-privilege IAM, CI/CD.*
22. **AI follow-ups.** After a learner reveals an answer, stream a tough follow-up question from an LLM through the Go API (keys server-side, per-user quota in Redis, prompt and response logged for evals). *Practices: streaming, cost control, safety.*
23. **Semantic search.** Embed every answer (pgvector), hybrid ranking with the existing keyword search, an eval set of 30 queries. *Practices: RAG, evaluation.*
24. **Per-user send times.** Replace the daily cron with an hourly one (or a queue) and send each reminder at the learner's chosen local time; store an IANA time zone per user. *Practices: scheduling, time zones, queues.*

25. **Write a walkthrough.** Pick a feature without one (search, spaced review, the single-file build, the admin console tabs) and write `walkthroughs/08-….md` using `repo:` links and `excerpt=` fences. Rename a function it quotes and watch `npm run check` fail. *Practices: technical writing, docs-as-code.*
26. **Submission moderation at scale.** Add duplicate detection for submissions (trigram similarity in Postgres, later embeddings), and a "request changes" status that lets the author edit and resubmit. *Practices: state machines, fuzzy search, moderation UX.*

### Principal-level reflection

13. Write an ADR proposing a migration of this app to Next.js with RSC. Argue honestly whether it's worth it (see ADR-001), with metrics you'd use to decide.
14. Write the RFC for turning the content compiler into a shared internal package used by three other teams' docs sites.
25. Write the ADR for moving from Vercel + Neon to AWS: cost at 100, 10k and 1M monthly users, operational load, lock-in, and what you'd measure before deciding.
26. Design multi-tenancy (many organizations, each with its own content and admins) and write the migration plan from today's single-tenant schema.

## Part 3: How to study with the app

1. Turn on **practice mode**. For each question: say the answer out loud (2–4 minutes), reveal, compare, then tick it only if you could have said the 60-second answer.
2. Write your own version in **notes**, especially for behavioral questions (your real stories with numbers).
3. Do **Review** daily for 10 minutes.
4. In the final week, use search to drill company-specific topics and re-read the Principal callouts.
