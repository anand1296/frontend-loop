# Architecture Decision Records

Short records of the decisions that shaped Frontend Loop: context, decision, consequences. Format after Michael Nygard's ADRs. New decisions get the next number; superseded ones stay, marked as such.

---

## ADR-001: React + TypeScript + Vite single-page app, not Next.js

**Status:** Accepted

**Context.** The app is a study tool used mostly behind no login, with static content and per-user state in the browser. SEO matters little (people find it by link), and hosting should be free and simple. The owner works daily with React, TypeScript and Vite.

**Decision.** Build a client-rendered SPA with Vite and React 19. Content is compiled into the bundle at build time.

**Consequences.**
- (+) Deploys as static files anywhere (Vercel, Netlify, GitHub Pages, a single HTML file).
- (+) Familiar stack, fast dev server, tiny config.
- (−) First paint waits for JS. Mitigated by a small framework footprint and no network round trips for content. If SEO ever matters, pre-render round pages at build time (the content compiler already produces HTML).

---

## ADR-002: Questions are Markdown files compiled at build time

**Status:** Accepted

**Context.** ~110 long answers with code, tables and callouts need to be easy to write, review in PRs, and validate. Rendering Markdown and highlighting code in the browser would add ~100 KB of JS and per-open work.

**Decision.** One Markdown file per round under `content/`, with front matter and an HTML-comment meta block per question. A pure compiler (`build/content/compile.ts`) validates and converts them to HTML at build time; bundler adapters expose them as virtual modules (index + one chunk per round).

**Consequences.**
- (+) No parser or highlighter in the client; answers render instantly.
- (+) Content errors fail CI with `file:line` messages.
- (+) Files are readable on GitHub as plain Markdown (meta comments are invisible).
- (−) Content changes require a rebuild/deploy. Fine for a curated bank.

---

## ADR-003: Hash routing with a single bare token

**Status:** Accepted

**Context.** Three views (overview, review, round) plus deep links to questions. Some hosts (sandboxed iframes) only pass a plain `#token` through, not paths or query strings.

**Decision.** A ~40-line router: `#review`, `#<round-id>`, `#<question-id>`. Round and question ids share a namespace, enforced unique by the compiler.

**Consequences.**
- (+) Works on any static host with no rewrite rules, and inside sandboxed hosts.
- (+) Every question has a shareable URL.
- (−) No nested routes or loaders. If the app grows, migrate to TanStack Router with hash history.

---

## ADR-004: A tiny external store instead of Redux or Zustand

**Status:** Accepted

**Context.** Client state is small: progress, preferences, route. Server state doesn't exist.

**Decision.** `createStore` (immutable updates, notify on reference change) + `useStore(store, selector)` built on `useSyncExternalStore`. Domain logic lives in pure functions (`state/progress.ts`) called by an actions object.

**Consequences.**
- (+) ~30 lines, no dependency, tear-free with concurrent React, trivially testable.
- (+) Demonstrates the mechanism that state libraries use internally (a teaching goal).
- (−) No devtools/time travel. Selectors must return stable references (documented in `useStore.ts`).

---

## ADR-005: Local-first persistence with last-writer-wins merge and optional cloud sync

**Status:** Accepted

**Context.** Progress must survive reloads and should follow the learner across tabs and devices, without accounts or a backend we'd have to operate.

**Decision.** localStorage is the durable local copy, hydrated before first render and validated on read. Tabs merge each other's writes via `storage` events. When the hosting platform offers a private per-user document (the claude.ai Artifact `db` capability), a sync adapter replicates the whole progress document with a per-question last-writer-wins merge, debounced writes, single in-flight write, and echo suppression. Export/import JSON covers every other case.

**Consequences.**
- (+) Instant, offline-capable, no backend.
- (+) The sync adapter depends on a small `RemoteDoc` interface, so Firebase/Supabase can be added later without touching the UI.
- (−) LWW can drop one of two truly concurrent edits to the same question (acceptable for a single user's checkmarks).
- (−) Notes are capped at 2,000 characters so the synced document stays well under storage limits.

---

## ADR-006: Plain CSS with design tokens, no CSS framework

**Status:** Accepted

**Context.** The UI is small and needs precise light/dark theming, including host-forced themes via `data-theme`.

**Decision.** CSS custom properties for every color and type token (light on `:root`, dark under `prefers-color-scheme` and `[data-theme="dark"]`), plus five small stylesheets by concern.

**Consequences.**
- (+) Zero runtime cost, no build plugin, full control of both themes.
- (+) Tokens map 1:1 to a future design-system package.
- (−) No utility classes; styling discipline relies on naming and review.

---

## ADR-007: Zero-dependency unit tests with `node --test`; Playwright for E2E

**Status:** Accepted

**Context.** The logic worth unit-testing (compiler, progress model, merge, search, selectors, sync protocol) is framework-free. Node 22 runs TypeScript directly via type stripping.

**Decision.** Unit tests use `node:test` + `node:assert` on `.ts` files with no transpiler. End-to-end behavior is covered by Playwright against the production build.

**Consequences.**
- (+) Tests run in ~1s with no install beyond Node.
- (+) Source must use erasable TypeScript only (no enums/parameter properties), enforced by `erasableSyntaxOnly`.
- (−) Component-level tests (Testing Library) aren't set up yet; see the Roadmap.

---

## ADR-008: A second build that produces one self-contained HTML file

**Status:** Accepted

**Context.** Some hosts (and offline use) want a single file: no asset folder, no server config.

**Decision.** `scripts/build-single-file.ts` bundles with esbuild using the same content compiler, inlines CSS and JS into `index.html`, and also emits a body-only variant for hosts that provide their own document shell.

**Consequences.**
- (+) Open from disk, email it, host it anywhere.
- (−) No code splitting in that build (≈1.2 MB, ≈250 KB gzipped). The Vite build remains the default for web hosting.
- Lesson learned (v1.0.2): the bundle must be inserted by concatenation, never as a `String.replace` replacement string, because `$&`, `$'` and `$$` in minified code are replacement patterns. That bug truncated the hosted page to a blank screen. The build now asserts the bundle survives byte-for-byte, and `e2e/hosted-artifact.spec.ts` renders the exact hosted file in a sandboxed, CSP-restricted frame.

---

## ADR-009: No runtime HTML sanitizer for answers

**Status:** Accepted

**Context.** Answers are injected with `dangerouslySetInnerHTML`. A runtime sanitizer (DOMPurify) would add weight and work on every open.

**Decision.** Treat Markdown as untrusted at build time instead: the renderer escapes all raw HTML, restricts link schemes to http(s)/relative/`#`, renders images as text, and emits highlighted code as escaped spans. Tests assert `<script>` is escaped and `javascript:` links are dropped.

**Consequences.**
- (+) Safe by construction for the only HTML source the app has.
- (−) If user-generated content is ever added, it must go through a runtime sanitizer and CSP; this ADR would not apply to it.

---

## ADR-010: A fixed spaced-review ladder (2, 5, 12, 30, 75 days)

**Status:** Accepted

**Context.** Learners forget answers they ticked weeks ago. Full spaced-repetition algorithms (SM-2, FSRS) need per-review grades and tuning.

**Decision.** Ticking schedules a review in 2 days. "Still solid" moves to the next interval; "Needs another pass" un-ticks the question.

**Consequences.**
- (+) Easy to explain and trust; fits a weeks-long interview prep horizon.
- (−) Not adaptive per question difficulty. A confidence rating could feed FSRS later.

---

## ADR-011: Owner is super admin; sharing stays with claude.ai; learners share a summary only

**Status:** Accepted

**Context.** The owner wants admin control and to invite others. Building our own accounts and invitations would need a backend, email delivery and auth. The host already authenticates viewers, manages sharing (Share menu, access levels) and offers a document store with per-path access rules.

**Decision.** The artifact's owner is the only admin. Invitations go through claude.ai's Share menu (the page cannot and does not add people). Each learner writes a coarse summary to `learners/<uid>` (owner-readable), keeps full progress in their private `data/users/<uid>` document, and everyone reads `config/announcement` (owner-writable). Rules are declared at publish and verified with a lower access level.

**Consequences.**
- (+) No backend, no password handling, real enforcement by the store rather than hidden UI.
- (+) Privacy by design: the owner never sees notes or per-question data.
- (−) Admin only works on the hosted version; self-hosting needs a backend implementing the same three documents.
- (−) Viewers (and outside guests who aren't Editors) can't write, so they don't appear on the dashboard and their progress stays local.
