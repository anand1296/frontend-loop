# Frontend Loop

**Interview prep for senior, lead and principal engineers.** 109 deep, interview-grade questions across 15 "rounds" of a real frontend interview loop, with progress tracking, resume-where-you-left-off, spaced review and a practice mode that makes you answer out loud before you read.

Version 2 adds a **Go + Postgres backend**: GitHub sign-in, synced progress across devices, invite links, roles (owner, admins, learners) and an **admin console** where you can add and edit rounds and questions live (preview, drafts, history, trash), see learners' progress, switch features and post announcements, with no code changes or deploys.

The same frontend still runs **without** a backend: on any static host, as one HTML file, or as a claude.ai Artifact (https://claude.ai/artifact/WXur8AanHGrgRZpkh4Jg9i).

![Overview in light mode](docs/screenshots/overview-light.png)

| Question view (dark) | Mobile |
| --- | --- |
| ![A question opened in dark mode](docs/screenshots/question-dark.png) | ![Mobile overview](docs/screenshots/mobile-dark.png) |

| Admin console: content | Question editor with live preview |
| --- | --- |
| ![Admin console content manager](docs/screenshots/console-content.png) | ![Question editor](docs/screenshots/console-editor.png) |

---

## Contents

- [What it does](#what-it-does)
- [The question bank](#the-question-bank)
- [Quick start](#quick-start)
- [Deploy (Vercel + Neon, free)](#deploy-vercel--neon-free)
- [Scripts](#scripts)
- [Tech stack and why](#tech-stack-and-why)
- [Architecture at a glance](#architecture-at-a-glance)
- [Accounts, progress and privacy](#accounts-progress-and-privacy)
- [Admin: content, people, features](#admin-content-people-features)
- [Project structure](#project-structure)
- [Testing and quality](#testing-and-quality)
- [This repo as a learning project](#this-repo-as-a-learning-project)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Docs index](#docs-index)

## What it does

**For learners**

- **Rounds and accordions.** Each topic is a round; each question is an accordion row showing the question, its level (Senior, Lead/Staff, Principal), study time and tags. Expand it for the full answer.
- **Answers built for the room.** Every answer opens with *the 60-second answer*, then the mental model, correct code with a copy button, trade-offs, edge cases, follow-ups, common mistakes and primary references.
- **Tick it off; pick up where you left off.** Progress saves automatically; the overview reopens the question you were on.
- **Email reminders** (opt-in, daily / every 3 days / weekly): progress, reviews due, the next question with a link, and a motivational nudge.
- **Spaced review** (2, 5, 12, 30, 75 days), **practice mode** (answer out loud first, with a stopwatch), **private notes**, **search** (`/` or Ctrl/⌘ K), filters, deep links (`#oauth-pkce-flow`), light/dark, phone-friendly, keyboard and screen-reader friendly.
- **Sign in with GitHub** (server mode) and your progress follows you to every device. Anything you did before signing in is kept.

**Behind the scenes** (bottom of the sidebar)

- **How it's built:** the app explains itself. Seven walkthroughs (architecture, email reminders, sign-in and sessions, progress sync, content pipeline and CMS, contributions, and the walkthroughs themselves) follow each feature through the code, with the reasoning behind every decision. Code is quoted live from the repository at build time and every link points to the exact line on GitHub at the commit you're running; a stale reference fails CI.
- **Contribute:** members submit questions from their own interviews (preview, credit, status, withdraw); nothing goes live until the owner approves it. Code changes go through pull requests that can't merge without the owner's review.

**For the owner and admins** (server mode)

- **Content manager:** create, edit, reorder, publish/hide and delete rounds and questions in the browser; Markdown editor with a live, server-rendered preview; drafts visible only to admins; revision history; trash; sync with and export to the repository's Markdown.
- **People:** invite links (single-use or group, with expiry), roles, a learner dashboard (progress, rounds finished, reviews due, last active), disable/remove.
- **Features and settings:** switch built-in features on or off, post an announcement, set the app name, headline, who can register and who can read.
- **Submissions:** review community questions (edit, pick the round and id, publish or draft, note), approve or reject; authors are credited and emailed.
- **Activity log** of every change.

## The question bank

| # | Round | Questions | Highlights |
| --- | --- | --- | --- |
| 01 | JavaScript Internals | 8 | Event loop and rendering, memory leaks, ESM vs CJS, Proxy reactivity, WeakRef |
| 02 | TypeScript for Real Codebases | 7 | Narrowing without `as`, generics inference, conditional/mapped types, unsoundness |
| 03 | Async Patterns & JS Machine Coding | 8 | Promise combinators, pool with cancellation, retry + jitter, debounce, SWR cache |
| 04 | React Rendering & Internals | 9 | Render/commit, re-renders, effects, concurrency, React 19, RSC, compiler |
| 05 | Component API Design | 6 | Compound components, headless hooks, controllable state, RHF + zod |
| 06 | Machine Coding | 8 | Typeahead, virtual list, modal, OTP, undo/redo, infinite feed, timer, uploader |
| 07 | Browser & Web Platform | 7 | Rendering pipeline, HTTP caching, CORS, resource hints, service workers, workers |
| 08 | Performance | 7 | LCP/INP/CLS diagnosis, INP deep dive, bundles, images/fonts, budgets |
| 09 | Testing & Quality | 6 | Strategy, Testing Library, MSW, flaky E2E and CI speed, async tests |
| 10 | Accessibility | 6 | Rules of ARIA, focus management, keyboard patterns, live regions, a11y at scale |
| 11 | Frontend Security | 6 | XSS in React, CSP + Trusted Types, token storage/BFF, CSRF, PKCE, supply chain |
| 12 | Frontend System Design | 8 | Framework, news feed, PDP, real-time dashboard, spreadsheet, collab editor, offline |
| 13 | Architecture at Scale | 9 | Micro-frontends, monorepos, migrations, rendering choices, state ownership, observability |
| 14 | AI-Powered Frontends | 6 | Streaming LLM UI, streaming Markdown, generative UI, RAG UX, cost, evals |
| 15 | Leadership & Behavioral | 8 | Story bank, migration story, disagreement, mentoring, tech debt, RFCs, influence |

About 30 hours of study. Code fences already support Go, SQL, Terraform, Python, Dockerfile and Protobuf for the backend and cloud rounds on the roadmap.

## Quick start

Requirements: **Node 22.18+**; for the backend also **Go 1.24+** and **Docker** (or any Postgres).

Frontend only (local-only mode):

```bash
npm install
npm run dev            # http://localhost:5173
```

Full stack:

```bash
cp .env.example .env          # DEV_LOGIN=1, OWNER_GITHUB_LOGIN=anand1296
docker compose up -d db       # Postgres
npm install
npm run dev:api               # Go API on :8080 (migrates and seeds on first start)
npm run dev                   # http://localhost:5173 (proxies /api)
```

Click **Sign in** → *Developer sign-in* → `anand1296` to be the owner. Or run everything in one container: `docker compose up --build` → http://localhost:8080.

## Deploy (Vercel + Neon, free)

The repo is ready for Vercel: the Vite frontend is static and `api/index.go` is a Go serverless function. Step by step in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**; in short:

1. Import the repo in Vercel and deploy. Until the next steps are done the site shows a **setup checklist** (with a *Study offline* option).
2. Vercel → Storage → create a **Neon** Postgres database and connect it (sets `DATABASE_URL`).
3. Create a **GitHub OAuth app** with callback `https://<your-app>.vercel.app/api/auth/github/callback`.
4. Set `OWNER_GITHUB_LOGIN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `APP_URL`; redeploy.
5. Open `/api/health`, then sign in with GitHub: the sidebar shows **Admin · Super admin**.

Every push to `main` redeploys; migrations run automatically.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (proxies `/api` to the Go API on :8080) |
| `npm run dev:api` | Go API (`go run ./cmd/server`), reads `.env` |
| `npm run build` | Validate content → type-check → Vite production build into `dist/` |
| `npm run build:single` | One self-contained HTML file in `dist-single/` (esbuild; never probes for a backend) |
| `npm run build:web-esbuild` | Multi-file web build in `dist-web/` without Vite (backend detection on) |
| `npm run content:check` | Validate every question (`--emit file.json` writes the compiled output for the parity test) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | TypeScript unit tests (`node --test`) |
| `npm run test:go` | Go tests (set `TEST_DATABASE_URL` to a throwaway database to include integration tests) |
| `npm run test:e2e` | Playwright against the static build (desktop + mobile) |
| `npm run test:e2e:server` | Playwright against a running full stack (`E2E_SERVER_URL`) |
| `npm run check` | content check + typecheck + unit tests |

## Tech stack and why

| Choice | Why |
| --- | --- |
| **React 19 + TypeScript (strict)** | Familiar, modern (`use`, Suspense, transitions); strict typing with `noUncheckedIndexedAccess` |
| **Vite** | Fast dev server, simple plugin API for the content pipeline, static output |
| **Go 1.24, standard library HTTP** | Small, explicit, fast; routing with Go 1.22 patterns; no framework to learn first (ADR-012) |
| **Postgres + `database/sql` + plain SQL** | Transactions, row locks, JSONB; free on Neon; visible, reviewable queries; embedded migrations (ADR-013) |
| **GitHub OAuth + server-side sessions** | No passwords or email; instant revocation; HttpOnly cookies (ADR-014) |
| **Markdown rendered at build time (marked) and at save time (goldmark)** | No parser in the browser; one safe output; a CI parity test keeps both renderers identical (ADR-016) |
| **Tiny external stores + `useSyncExternalStore`** | Small state; 30 lines beat a library and show the mechanism |
| **Plain CSS with design tokens** | Exact light/dark theming, zero runtime |
| **`node --test`, `go test`, Playwright** | Fast unit tests, real-database integration tests, real-browser E2E |
| **Vercel + Neon, Docker** | Free hosting; the same handler also runs as a distroless container (ADR-018) |

Every decision, with context and consequences: [docs/DECISIONS.md](docs/DECISIONS.md) (21 ADRs).

## Architecture at a glance

```text
Browser (React)
  boot: GET /api/bootstrap ── server mode ──▶ content, user, flags, settings from the API
                           └─ otherwise ───▶ local-only mode (bundled content, browser storage)
  ├─ Study views: overview · round (accordion) · review · search · settings
  ├─ Account: sign in, invite, account settings
  └─ Admin console: content manager + editor · learners · invites · features & settings · activity

Vercel
  ├─ static: Vite build (dist/)
  └─ Go function api/index.go ──▶ backend/server (routes, middleware: recover · headers · log · CSRF · session)
                                    ├─ backend/store (Postgres, migrations, transactions)
                                    ├─ backend/catalog + backend/markdown (validate, render, import/export)
                                    ├─ backend/progress (merge, summaries)
                                    └─ backend/auth (tokens, GitHub OAuth)
                                  ──▶ Postgres (Neon)
```

The full specification (requirements, data model, API, flows, security, operations, roadmap) is **[docs/SPEC.md](docs/SPEC.md)**. Frontend internals: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Accounts, progress and privacy

- **Always local-first:** progress is saved in the browser instantly (validated on read) and merged across tabs.
- **Signed in (server mode):** progress syncs to your account; the server merges devices per question (last writer wins), so ticking on phone and laptop both count. Signing out clears the device's copy.
- **claude.ai Artifact:** syncs to a private per-user document there.
- **Admins see a summary only** (done per round, reviews due, last active). Notes and review dates stay private. You can delete your account from Settings.
- No analytics or trackers.

## Admin: content, people, features

You (`OWNER_GITHUB_LOGIN=anand1296`) are the **owner**: everything an admin can do, plus roles, admin invites and site settings.

- **Content without deploys:** Admin → Content → *New round* / *New question*, write Markdown with a live preview, save as draft or publish. Edits are versioned; deleted questions go to Trash; *Export all* gives you `content/*.md` to commit.
- **Invite people:** Admin → Invites → create a link (once or for a group, with expiry) → send it. Registration can be invite-only (default) or open.
- **Features:** switch Spaced review, Search, Notes, Filters, Export/import and the Level breakdown on or off for everyone. Brand-new features are code changes: push to `main` and Vercel deploys them (ideally behind a new flag).

Guide: [docs/ADMIN.md](docs/ADMIN.md).

## Project structure

```text
frontend-loop/
├─ content/              question bank (Markdown) + embed.go (bundled into the Go binary)
├─ src/                  React app: app/ features/ platform/ content/ state/ components/ lib/ styles/
├─ build/content/        TypeScript content compiler (marked + highlight.js)
├─ build/walkthroughs/   "How it's built" compiler (repo: links, live code excerpts, validation)
├─ walkthroughs/         the walkthroughs (Markdown)
├─ backend/              Go: server/ store/ (+ migrations/) catalog/ markdown/ progress/ auth/
├─ api/index.go          Vercel serverless entry
├─ cmd/server/           standalone binary (API + static files)
├─ tests/                TypeScript unit tests
├─ e2e/                  Playwright: static mode, Artifact build, mobile, full stack
├─ scripts/              content check, single-file and esbuild builds
├─ docs/                 SPEC, PRD, architecture, ADRs, deployment, admin, content and learning guides
├─ Dockerfile · docker-compose.yml · vercel.json · .env.example
├─ CONTRIBUTING.md · CODE_OF_CONDUCT.md · SECURITY.md
└─ .github/              CI (web · go with Postgres · e2e-server), CODEOWNERS, PR and issue templates
```

## Testing and quality

| Suite | Count | Covers |
| --- | --- | --- |
| Go unit | 15 | Markdown rendering and safety, every code language, content parsing/validation/export round-trip, progress merge properties |
| Go integration (real Postgres) | 16 | Every API rule over HTTP: invites, roles, disabling, expiry, open/members-only, settings, full CMS lifecycle, revisions, trash, ETags, progress merge and privacy, account deletion, CSRF, repository sync, export, GitHub OAuth (fake provider), concurrent invite race, serverless entry, email reminders, community submissions |
| Renderer parity | 109 answers | Go and TypeScript renderers produce the same documents |
| TypeScript unit | 45 | Walkthrough compiler, content compiler, progress model, search, selectors, sync protocols (Artifact and HTTP), language-list parity |
| E2E static | 12 | Study flows, How it's built, Contribute, hosted Artifact build in a sandboxed CSP frame, mobile |
| E2E full stack | 4 | Owner edits content and settings and invites; learner joins, studies, syncs to a second device; owner sees progress; strangers refused; learner submits a question, owner approves, it's credited |

CI runs all of it on every push and PR (Go tests with `-race`), plus `gofmt` and `go vet`.

## This repo as a learning project

The app uses the techniques its answers teach, now on both sides: `useSyncExternalStore` stores, React 19 `use()` + Suspense, accessible combobox, tabs and dialogs, local-first sync with a CRDT-style merge, build-time and save-time XSS-safe rendering; and in Go: standard-library routing and middleware, OAuth and cookie sessions, CSRF defenses, transactions with row and advisory locks, optimistic concurrency, embedded migrations, integration tests against a real database, and one handler deployed serverless and as a container.

Start with **How it's built** inside the app (or [`walkthroughs/`](walkthroughs/)): each walkthrough explains one feature end to end with live code and the reasoning behind it. [docs/LEARNING_GUIDE.md](docs/LEARNING_GUIDE.md) has a frontend and a backend code tour and 25 graded exercises, including the full-stack track (Redis, SSE, sqlc, OpenTelemetry, Terraform on AWS, AI follow-ups, semantic search).

## Roadmap

From frontend prep to full-stack prep (details in [docs/SPEC.md §18](docs/SPEC.md#18-roadmap-from-frontend-prep-to-full-stack-prep)):

1. **Tracks** of rounds: Frontend, Backend & Go, Data (Postgres, Redis), Cloud & AWS, Infrastructure as Code (Terraform), System Design, AI Engineering, Leadership.
2. **Redis**: shared rate limits, caches, leaderboards, pub/sub; **live updates** with Server-Sent Events.
3. **Mock interviews**, confidence ratings, **AI follow-ups and feedback**, semantic search (pgvector).
4. **AWS with Terraform**: ECS Fargate or Lambda, RDS, ElastiCache, S3 + CloudFront, OIDC CI/CD; OpenTelemetry and SLOs.

## Contributing

Two ways, both reviewed by the owner before anything goes live:

- **Share a question from your interviews:** in the app, *Behind the scenes → Contribute* (members), or a [question proposal issue](https://github.com/anand1296/frontend-loop/issues/new?template=question.yml).
- **Improve the code:** fork, branch, `npm run check`, open a pull request. `main` is protected: every PR needs the owner's approval (CODEOWNERS) and green CI.

Read [CONTRIBUTING.md](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md) for reporting vulnerabilities privately.

## Docs index

| Doc | Purpose |
| --- | --- |
| [docs/SPEC.md](docs/SPEC.md) | **The technical specification**: requirements, architecture, data model, API, flows, security, operations, decisions, roadmap |
| [docs/PRD.md](docs/PRD.md) | Problem, personas, user stories, metrics, release plan |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Frontend internals: build pipeline, modules, state, sync, routing, rendering, a11y |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 25 architecture decision records |
| [walkthroughs/](walkthroughs/) | "How it's built": feature walkthroughs with live code (also inside the app) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute questions and code; how review works |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel + Neon + GitHub OAuth, local full stack, Docker, static |
| [docs/ADMIN.md](docs/ADMIN.md) | Roles, invites, content management, features, privacy |
| [docs/CONTENT_GUIDE.md](docs/CONTENT_GUIDE.md) | Writing questions (console or Markdown) |
| [docs/LEARNING_GUIDE.md](docs/LEARNING_GUIDE.md) | Code tours and exercises |
