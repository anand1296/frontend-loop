# Architecture Decision Records

Short records of the decisions that shaped Whetstone: context, decision, consequences. Format after Michael Nygard's ADRs. New decisions get the next number; superseded ones stay, marked as such.

---

## ADR-001: React + TypeScript + Vite single-page app, not Next.js

**Status:** Accepted (still true in v2: the backend serves an API, not pages)

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
- (−) Content changes require a rebuild/deploy. Fine for a curated bank. *(v2: still true for static builds; server deployments edit content live, see ADR-016.)*

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

**Status:** Accepted for the claude.ai Artifact build. For deployments with the Go backend, accounts, roles and invites are handled by ADR-014 and ADR-021.

**Context.** The owner wants admin control and to invite others. Building our own accounts and invitations would need a backend, email delivery and auth. The host already authenticates viewers, manages sharing (Share menu, access levels) and offers a document store with per-path access rules.

**Decision.** The artifact's owner is the only admin. Invitations go through claude.ai's Share menu (the page cannot and does not add people). Each learner writes a coarse summary to `learners/<uid>` (owner-readable), keeps full progress in their private `data/users/<uid>` document, and everyone reads `config/announcement` (owner-writable). Rules are declared at publish and verified with a lower access level.

**Consequences.**
- (+) No backend, no password handling, real enforcement by the store rather than hidden UI.
- (+) Privacy by design: the owner never sees notes or per-question data.
- (−) Admin only works on the hosted version; self-hosting needs a backend implementing the same three documents.
- (−) Viewers (and outside guests who aren't Editors) can't write, so they don't appear on the dashboard and their progress stays local.

---

## ADR-012: A Go backend on the standard library, no web framework

**Status:** Accepted (v2)

**Context.** The owner wants admin control over content and features, invites and cross-device progress on ordinary hosting, and wants to learn backend development in Go. The API is small (~40 endpoints), JSON only.

**Decision.** Go 1.24 with `net/http`. Routing uses the Go 1.22+ `ServeMux` patterns (`PATCH /api/admin/sections/{id}`); middleware is plain `func(http.Handler) http.Handler`. Dependencies: `lib/pq` (Postgres driver), `goldmark` + `chroma` (Markdown and highlighting). Nothing else.

**Consequences.**
- (+) Everything a request does is readable top to bottom; no framework magic to learn first. The skills transfer to any Go codebase.
- (+) Tiny dependency surface: fast builds, few CVEs, one static binary.
- (−) A little boilerplate for JSON decoding and errors (two helpers cover it).
- (−) No generated OpenAPI spec; the API is documented in docs/SPEC.md §9. Revisit if external clients appear.

---

## ADR-013: Postgres through database/sql and plain SQL; embedded, forward-only migrations

**Status:** Accepted (v2)

**Context.** Data is relational (users, sessions, invites, rounds, questions, revisions) with a few documents (progress, settings). Free hosting exists (Neon, Supabase). We need transactions, row locks and JSON.

**Decision.** Postgres via `database/sql` + `lib/pq`, hand-written SQL in `backend/store`, one transaction per store method. Migrations are numbered `.sql` files embedded in the binary and applied at startup in one transaction under `pg_advisory_xact_lock`, recorded in `schema_migrations`. Migrations are additive and forward-only.

**Consequences.**
- (+) Queries are visible, reviewable and tuned by hand; no ORM abstractions to fight.
- (+) Migrations travel with the code; a fresh database is ready on first request, and concurrent cold starts are serialized by the lock.
- (−) More code than an ORM for CRUD; `sqlc` would generate typed query code if this grows.
- (−) Forward-only means a bad migration is fixed by another migration, not a rollback; keep them small and backward compatible (expand, migrate, contract).

---

## ADR-014: GitHub OAuth and opaque server-side sessions in HttpOnly cookies (not JWTs)

**Status:** Accepted (v2)

**Context.** Users are engineers; we want no passwords, no email delivery and instant revocation (disable a user, demote an admin).

**Decision.** Sign in with GitHub (OAuth web flow, no scopes; the access token is used once to read the profile and discarded). The server issues a random 256-bit session token in a `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie and stores only its SHA-256. Roles are read from the database on every request. A developer sign-in exists for local work and tests, refused in production.

**Consequences.**
- (+) Revocation is a `DELETE`; role changes apply on the next request. Nothing sensitive is readable by JavaScript.
- (+) No password storage, reset flows or email.
- (−) One session lookup per request (indexed primary key; cheap). Redis can cache it later.
- (−) People without GitHub accounts can't sign in. Adding Google or magic links is an additive change behind the same `SignIn` function.

---

## ADR-015: CSRF defense in depth: SameSite=Lax, a custom header, and Origin/Sec-Fetch-Site checks

**Status:** Accepted (v2)

**Context.** Cookie sessions are vulnerable to cross-site request forgery.

**Decision.** All state-changing requests must carry `X-Requested-With: whetstone` (a cross-site page can't set it without a CORS preflight, which the API never approves), must not be `Sec-Fetch-Site: cross-site`, and if an `Origin` header is present it must equal the app origin. Cookies are `SameSite=Lax`.

**Consequences.**
- (+) Three independent layers; any one stops classic CSRF. No token plumbing in forms.
- (−) Non-browser clients must send the header (documented).

---

## ADR-016: Content lives in the database and is rendered at write time; repository Markdown stays the seed and export format

**Status:** Accepted (v2)

**Context.** Admins must add and change questions without a deploy, but the repository's Markdown bank has value: reviewable diffs, the static/Artifact builds, and a backup.

**Decision.** In server mode, Postgres is the source of truth. The repository files are embedded in the binary, seeded once into an empty database, and can be re-imported ("Sync from repository": add missing or overwrite changed, never delete console content). Any round can be exported in the exact file format (zip for everything) to commit back. The Go renderer (goldmark + chroma, with highlight.js class names) renders Markdown to safe HTML when saving; a CI parity test compares its output on every answer with the TypeScript build renderer.

**Consequences.**
- (+) Live editing with drafts, history and preview, and still a git-friendly format both ways.
- (+) Reads are cheap (stored HTML); preview equals published output.
- (−) Two renderers to keep in sync; the parity test and a language-list test make drift a CI failure.
- (−) The database and the repository can diverge; sync shows the differences and the admin decides.

---

## ADR-017: Progress is merged on the server; PUT returns the merged document; polling instead of WebSockets

**Status:** Accepted (v2)

**Context.** The browser already merges replicas with a per-question last-writer-wins rule. Serverless functions can't hold long-lived connections cheaply.

**Decision.** `PUT /api/me/progress` merges the incoming document into the stored one under a row lock (same LWW rule, ported to Go and tested for commutativity and idempotence) and returns the result, which the client treats as a new snapshot. Clients re-read on focus and every 5 minutes while visible. The existing `syncWithRemote` protocol is reused through an HTTP `RemoteDoc` adapter.

**Consequences.**
- (+) One round trip saves and pulls; concurrent devices can't overwrite each other.
- (+) Same client protocol for the Artifact and the Go API.
- (−) Another device's change appears on focus, not instantly. Server-Sent Events (or Redis pub/sub) can push later (SPEC §18).

---

## ADR-018: One handler, two deployments (Vercel function and binary); lazy, retried initialization

**Status:** Accepted (v2)

**Context.** Free hosting favors Vercel (already serving the frontend), but the app should not be locked in, and should run in Docker, on a VPS or on AWS later.

**Decision.** `server.New(...).Handler()` is a plain `http.Handler`. `cmd/server` wraps it with static file serving and graceful shutdown; `api/index.go` (the only file in `api/`, because Vercel turns each file there into a function) wraps it with `server.Vercel`, which initializes on the first request of a cold instance and retries failed starts (Neon may be waking up), and restores the original path from the `__route` rewrite. Packages live under `backend/` rather than `internal/` to avoid import restrictions in Vercel's build wrapper.

**Consequences.**
- (+) Portable: the Docker image is the AWS ECS/Fargate artifact later; Lambda can wrap the same handler.
- (+) A missing database answers `503 not_configured` and the frontend falls back, so a half-configured deploy is still usable.
- (−) Per-instance memory (rate limits, settings cache) is not shared across serverless instances; Redis fixes that (SPEC §18).

---

## ADR-019: Feature flags are a fixed list in code; new features ship as code

**Status:** Accepted (v2)

**Context.** The owner wants to "change a feature or add a new one". A flag only means something if code reads it.

**Decision.** `backend/server/settings.go` defines the flags with labels and defaults (`review`, `search`, `notes`, `filters`, `progressTransfer`, `levelOverview`). Admins toggle them live; the server rejects unknown keys; the frontend reads them through `useFeature()`. Unset flags use their defaults; local-only mode has everything on. A genuinely new feature is a code change: push to `main` and Vercel deploys it in about a minute, ideally behind a new flag defaulting to off.

**Consequences.**
- (+) No dead or mistyped flags; each one is documented where it's defined.
- (+) Clear, honest boundary between configuration and code.
- (−) Adding a flag needs a deploy (by design).

---

## ADR-020: Graceful degradation: a boot probe chooses server or local-only mode

**Status:** Accepted (v2)

**Context.** The same frontend ships to Vercel with the backend, to static hosts without one, as a single HTML file and as a claude.ai Artifact.

**Decision.** Before the first render the Vite build calls `GET /api/bootstrap` (10 s timeout). A JSON body with `mode: "server"` enables server mode. A `503` carrying a `setup` report (the API exists but has no database, or can't reach it) shows a **setup screen** with a configuration checklist and a "Study offline for now" button. Anything else (404, HTML, network error, timeout: no API here) keeps v1 local-only behavior.

*Revised in v2.1:* the first version fell back to local-only on any 503 too. On a freshly deployed but unconfigured Vercel project that meant Settings said "saved in this browser, use export and import" with no hint that a backend existed and needed configuring. A deployed-but-unconfigured backend is now visible instead of silent. The single-file build is compiled with `__BACKEND__ = false` and never probes. Content moved from module constants to a store so it can be swapped at boot and after edits.

**Consequences.**
- (+) One codebase, every hosting mode; a backend outage degrades instead of breaking.
- (−) First paint in the web build waits for one request (a static "Loading…" splash covers it).

---

## ADR-021: CMS safety: optimistic concurrency, revisions, trash and an audit log

**Status:** Accepted (v2)

**Context.** Several admins may edit the same question; mistakes must be recoverable; the owner should see who changed what.

**Decision.** Questions carry a `revision`; saves must send the revision they loaded, or get `409 conflict` with an option to load the newer version. Every update and delete first snapshots the row into `question_revisions` (no foreign key, so history survives deletion); deleted questions appear in Trash and restore as drafts. All content writes run under one advisory lock and bump `content_version`. Every administrative action and sign-up is appended to `audit_log`. Ids are permanent once created (progress is keyed by them).

**Consequences.**
- (+) No silent lost updates; every change is reversible and attributable.
- (−) History grows without bound; prune or archive old revisions if it ever matters.
- (−) No real-time co-editing; conflicts are detected, not merged.

---

## ADR-022: Private by default: members-only and invite-only, with a full-page sign-in screen

**Status:** Accepted (v2.1)

**Context.** v2 shipped with content public by default (sign-in only synced progress). The owner's intent is a private study group: people should start at a sign-in screen, the owner signs in as super admin, and everyone else comes in through invites.

**Decision.** The default site settings are `contentAccess: "members"` and `registration: "invite"`. A signed-out visitor of a members-only site gets a full-page `SignInScreen` (no sidebar or content), which also presents invite links ("@anand1296 invited you to join as a learner") and sign-in errors inline. The owner can open the site up in Features & settings → Site & access. Identity stays with GitHub OAuth: the "super admin credentials" are the GitHub account named in `OWNER_GITHUB_LOGIN`; there are no passwords to store or leak.

**Consequences.**
- (+) Matches the product's use (a curated group) and leaks nothing to anonymous visitors.
- (+) One clear entry point; the invite flow and the owner flow are the same screen.
- (−) Trying the app requires an invite; the owner can switch content access to public for an open demo.
- (−) Existing deployments that saved explicit settings keep them (only the default changed).

---

## ADR-023: Email reminders: opt-in, verified GitHub email, plain SMTP, daily cron with claim-then-send

**Status:** Accepted (v2.2)

**Context.** Learners asked for nudges: a periodic email with their progress, what's due, the next question and some motivation. It must be off by default, cost nothing on free tiers, never email someone who didn't ask, and never double-send.

**Decision.**
- **Opt-in per user** (`reminder_prefs.enabled` defaults to false), frequency daily / every 3 days / weekly; an admin feature flag can switch the whole feature off.
- **Address:** the primary *verified* GitHub email, fetched at sign-in with the read-only `user:email` scope. Users can't type an address, so the app can't be used to send mail to strangers, and there is no verification flow to build.
- **Transport: SMTP** via the standard library (`backend/mail`). One implementation works with Gmail (app password, no domain needed), Resend, Brevo, SES or a local Mailpit. Credentials only over TLS.
- **Scheduling: Vercel Cron** once a day (the Hobby plan allows daily jobs that fire within the hour), authenticated with `CRON_SECRET`. Minimum gaps (20 h / 68 h / 164 h) absorb the jitter.
- **Exactly-once-ish delivery:** claim due rows with `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED) RETURNING previous`, send, then on failure restore the previous `last_sent_at` so the next run retries.
- **Content:** a pure composer (`backend/reminders`) with HTML and text templates; the motivational line depends on the learner's state (not started, finished, away 7+ days, reviews due, nearly done, otherwise a rotating line).
- **Compliance basics:** unsubscribe link with a confirmation page (GET is safe for link scanners) and RFC 8058 one-click headers.

**Alternatives considered.** A provider SDK/HTTP API (simpler auth, but locks the code to one vendor); a queue + worker (overkill for one daily batch; on the roadmap with Redis); per-user send times (needs an hourly scheduler: not available on the free plan).

**Consequences.**
- (+) Free to run, provider-agnostic, safe under overlapping runs, fully tested without a mail server (`mail.Recorder`, fake SMTP server).
- (−) One send time for everyone (~09:00 IST). Moving to an hourly scheduler (Pro plan or an external cron) would allow per-user times.
- (−) Gmail SMTP caps at ~500 recipients/day and sends from your personal address; use a domain + Resend/Brevo when the group grows.
- (−) Existing users must sign in once more to grant the email scope.

---

## ADR-024: "How it's built": walkthroughs quote code by symbol at build time and link to the built commit

**Status:** Accepted (v2.3)

**Context.** The app is a learning project, and the owner wants it to explain itself: for each feature, the architecture, the code (with links to GitHub), the flow of logic and the reasoning behind each decision. Documentation about code usually rots: snippets get pasted and drift, line links point at a moving `main`.

**Decision.**
- Walkthroughs are Markdown files in `walkthroughs/`, compiled by `build/walkthroughs/compile.ts` and rendered with the same Markdown renderer as answers.
- Two extensions: `[text](repo:path#Symbol)` links to the declaration's line on GitHub, and ```` ```lang excerpt=path#Symbol ```` (or `lines=a-b`) inserts the declaration's real source (with the comment above it) plus a source caption. Code is never pasted.
- Links point at the commit being built (`VERCEL_GIT_COMMIT_SHA` → `GITHUB_SHA` → `git rev-parse HEAD` → `main`).
- Every reference is validated (file exists inside the repository, symbol found, range in bounds) in `npm run check`, so CI fails on a stale walkthrough.
- Symbols are found with a small line-based heuristic rather than per-language parsers; blocks end at the matching bracket.
- Shipped as `virtual:walkthroughs` (index, in the main bundle) and `virtual:walkthroughs/content` (lazy chunk), in every build including the single-file one. Placed at the bottom of the sidebar ("Behind the scenes"), behind the `howItsBuilt` flag.

**Alternatives considered.** Fetching files from the GitHub API at runtime (rate limits, network dependency, broken references discovered by readers instead of CI); a docs site (separate deploy, not "inside the app"); per-language AST parsers (heavier and unnecessary for the declarations we quote).

**Consequences.**
- (+) Walkthroughs can't silently drift: renames break the build with a precise message, and quoted code is always current.
- (+) Readers see the code that is actually running; links stay valid forever.
- (−) The heuristic can, in principle, pick the wrong declaration if two share a name in one file; authors can use `lines=a-b` or link a more specific file.
- (−) Prose can still go stale even when code references are valid; reviewing the walkthrough is part of the PR checklist.

---

## ADR-025: Community contributions: a separate submissions table with transactional approval; GitHub enforces code review

**Status:** Accepted (v2.3)

**Context.** The owner wants people to contribute questions from their own interviews and code improvements, with the rule that nothing goes live, and no pull request merges, without the owner's approval.

**Decision.**
- **Questions:** a `submissions` table separate from `questions`. Submissions are validated with the same compiler and quality bar as published questions, rate-limited (5/day, 10 pending per person) and switchable off with the `contribute` flag. Admins review in Admin → Submissions; approval sends the final, possibly edited question and runs in one transaction (content advisory lock, submission row `FOR UPDATE`, must be `pending`, insert question, set `contributed_by` if credit was requested, mark approved, bump content version, audit). Owner and submitter are notified by email, best effort after commit. Without a backend, a GitHub issue form replaces the in-app form.
- **Code:** `CODEOWNERS` (`* @anand1296`), PR and issue templates, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, plus branch protection on `main` configured in GitHub settings (required PR, Code Owner review, dismiss stale approvals, last-push approval, required checks `web`/`go`/`e2e-server`, conversation resolution, no force-push or deletion) and approval before Actions run for outside contributors.

**Alternatives considered.** A `status` column on `questions` (every reader query would need a filter forever; one forgotten `WHERE` leaks unreviewed content); accepting question contributions only as PRs (excludes non-developers and makes review heavier); auto-publishing with after-the-fact moderation (contradicts the requirement).

**Consequences.**
- (+) Unreviewed content is invisible by construction; approval can't half-happen or happen twice.
- (+) Review effort is low: contributions already meet the publishing bar and the reviewer edits in place.
- (−) A suggested new round must be created by the admin before approving into it.
- (−) Branch protection lives in GitHub settings, not in the repository, so it must be set (and re-checked) manually; the owner, as a repository admin, can still bypass it unless "Do not allow bypassing" is enabled.

---

## ADR-026: The full question as a leading `[!PROMPT]` callout, visible before the answer

**Status:** Accepted (v2.4)

**Context.** Question titles are one-liners ("Build a typeahead…"). Real interview prompts carry a scenario, constraints and, for coding rounds, the cases the interviewer will try. Practice mode hides the answer until revealed, so the extra detail has to be visible *before* that.

**Decision.** A new optional callout kind, `> [!PROMPT]` ("The full question"), written as the first block of a question body in both renderers (the TypeScript build-time one and the Go write-time one; the parity test covers it). The reader splits it off the compiled HTML (`splitPrompt`) and always shows it; the "answer it out loud first" gate stands in only for the rest. Coding questions list **Test cases** in it; conceptual ones list what a good answer should cover. All 109 questions have one.

**Alternatives considered.** A new `prompt` column/field (a migration, API, editor and submission changes for what is just more Markdown); putting the detail inside the answer (hidden in practice mode, defeating its purpose); making titles longer (breaks the list's scanability).

**Consequences.**
- (+) No schema or API change: the editor, submissions, export/import and search all work unchanged, and the prompt text is searchable.
- (+) Authors write it in the same Markdown file as the answer.
- (−) The list still shows only the title; the detail appears when a question is opened.
- (−) Existing deployments get the new prompts via Admin → Content → *Sync from repository* → *Overwrite changed…*.

---

## ADR-027: Open a question to the full question; the answer sits behind a Reveal answer button

**Status:** Accepted (v2.5), refines ADR-026

**Context.** With the full question in the same view as the answer, readers saw the answer before they had tried. Practice mode (a setting) already hid it, but most people never turn settings on.

**Decision.** Expanding a question shows its full question and a **Reveal answer** button; the answer appears on click, with a short fade, and focus moves to it (the button disappears, so focus would otherwise be lost). Revealed stays revealed while the page is open. Exceptions: a question already marked done when the page loads opens straight to its answer; in **Review** the gate applies even though everything there is done, because recall is the point. Practice mode keeps its meaning as an add-on: the same step with a stopwatch and an "answer it out loud first" reminder.

**Alternatives considered.** A tab or "Answer" accordion inside the question (more chrome and a second thing to open); remembering reveals across visits (stored state for little value: next time you want to test yourself again); revealing when a question is ticked done (ticking before reading shouldn't open the answer).

**Consequences.**
- (+) Self-testing is the default, with one extra click to see the answer.
- (−) One more click for readers who just want to read; "Expand all" now shows only the full questions.

---

## ADR-028: Rename to Whetstone, everywhere

**Status:** Accepted

**Context.** The app is growing beyond frontend interviews (backend, QE, DevOps, AI/ML, audit certifications such as CISA/DISA), so "Frontend Loop" no longer fits. "Whetstone" says what the app does: it sharpens skills you already have. A registered US trademark (WHETSTONE, class 42, education software for school systems) exists; the owner accepted that risk, to be revisited before any commercial launch.

**Decision.** Rename everything: the product name, Go module path, repository references, `whetstone:*` localStorage keys, the `X-Requested-With: whetstone` CSRF header, database names in dev/CI, download file names. Browsers' locally saved progress under the old keys is abandoned (accepted by the owner; signed-in users re-sync from the server). Later, per-discipline subdomains (frontend., backend., ...) can select a track.

**Alternatives considered.** Keeping technical identifiers (no data loss, but a half-renamed codebase); writing a localStorage migration (more code for a pre-launch app).

**Consequences.**
- (+) One consistent name.
- (−) Local-only progress and in-flight sessions reset once; the repo and the Vercel project must be renamed to match.


---

## ADR-029: Framework variants inside an answer (`:::react|angular|vue`), switched with CSS

**Status:** Accepted

**Context.** Answers were React-only, which excludes Angular and Vue engineers. Most of an answer (the question, the 60-second answer, mental model, trade-offs, edge cases) is framework-neutral; only the code and the API names differ. Readers want to pick a framework once and see it everywhere.

**Decision.** Authors wrap framework-specific material in `:::react`, `:::angular` or `:::vue` containers; everything else is shared. A small pre-pass in both renderers (`build/content/frameworks.ts`, `backend/markdown/frameworks.go`) rewrites the containers to marker comments, and the existing HTML-block handling turns the markers into `<section class="fw" data-fw="…">`. The reader's choice is a device-local preference (`framework`, default React); the answer view sets one data attribute and CSS shows the matching section. The switch only appears on answers that have more than one variant, and a missing variant falls back to React with a visible note. `vue` was added as a code-fence language.

**Alternatives considered.** One file per framework (triples maintenance and drifts); tabs inside each code block (hides the framework-specific prose around the code); callout syntax with `> ` prefixes (unreadable for long code); rendering only the chosen framework on the server (breaks static builds and the single HTML file, and makes switching a round trip).

**Consequences.**
- (+) Switching is instant and works offline in the static build, the single-file build and the server build; the parity test covers the variants too.
- (+) Neutral content is written once.
- (−) The HTML for every framework ships with the answer chunk (answers are loaded per round, and gzip handles the repeated structure well).
- (−) Search indexes all variants, so a search can match text that is hidden for the current framework; the match opens the question, where the switch is one click.
- (−) Authors must keep the variants equivalent as questions evolve; the content guide says what stays shared.
