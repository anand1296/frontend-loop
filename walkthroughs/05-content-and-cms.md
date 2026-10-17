---
id: content-and-cms
title: Questions, from Markdown to the admin editor
summary: The same question bank is compiled at build time in TypeScript and at write time in Go, and a parity test proves both produce identical HTML. Then the admin CMS on top: live preview, optimistic concurrency, revisions and an audit trail.
order: 5
minutes: 15
tags: build tooling, markdown, go, react, cms, postgres
---

> [!TLDR]
> Questions start as Markdown files in [content/](repo:content/). At build time a small compiler validates them and turns them into HTML inside **virtual modules**, so the browser never ships a Markdown parser. In server mode the same files seed Postgres, and admins edit questions in a console; the Go backend renders Markdown **when a question is saved**, with a renderer that a CI test keeps byte-for-byte identical to the build-time one. Saves are guarded by a revision number (optimistic concurrency), every change keeps the previous version, and every action lands in an audit log.

### The source format

One file per round, front matter for the round, and one `##` heading per question with a small meta comment:

```text
---
id: react-internals
title: React internals
description: …
---

## How does React decide what to re-render?
<!--
id: react-rerender-rules
level: senior
tags: react, rendering
minutes: 12
-->

> [!TLDR]
> The 60-second answer…
```

The format is described in [CONTENT_GUIDE.md](repo:docs/CONTENT_GUIDE.md). Why Markdown in git rather than a database from day one? Reviewable diffs, no backend needed for the static build, and it's the format contributors already know ([ADR-002](repo:docs/DECISIONS.md#ADR-002)).

### Build time: compile, validate, split

[`compileQuestion`](repo:build/content/compile.ts#compileQuestion) is strict on purpose. A missing TL;DR, a bad level, a duplicate id or an unknown code language **fails the build with `file:line`**, instead of shipping a broken answer:

```ts excerpt=build/content/compile.ts#compileQuestion
```

The Markdown renderer ([markdown.ts](repo:build/content/markdown.ts)) turns `> [!TLDR]` blockquotes into callouts, highlights code with highlight.js **at build time**, escapes all raw HTML and only allows `http(s)`, relative and `#` links. Because the output is safe by construction, the app can inject it with `dangerouslySetInnerHTML` without a runtime sanitizer ([ADR-009](repo:docs/DECISIONS.md#ADR-009)).

#### Virtual modules and code splitting

The compiled content is served to the bundler as modules that don't exist on disk:

```ts excerpt=build/content/codegen.ts#indexModuleCode
```

`virtual:content` holds the outline (titles, tags, TL;DRs: small, loaded eagerly). Each round's answer HTML is its own lazy chunk, loaded the first time you open that round, or when you hover it in the sidebar ([`preloadSection`](repo:src/content/index.ts#preloadSection)). [`loadAnswers`](repo:src/content/index.ts#loadAnswers) caches one promise per round so React 19's `use()` sees a stable promise and suspends exactly once.

The same compiler is plugged into two bundlers: Vite ([vite-plugin-content.ts](repo:build/vite-plugin-content.ts)) and esbuild for the single-file build ([build-single-file.ts](repo:scripts/build-single-file.ts)). Bundler adapters are thin; the logic lives in plain functions with unit tests ([compile.test.ts](repo:tests/compile.test.ts)).

### Write time: the Go renderer, and proving it matches

When the backend starts on an empty database, [`Prepare`](repo:backend/server/server.go#Prepare) parses the same files (embedded into the binary with `go:embed`) and seeds Postgres. From then on admins edit content in the browser, so the server needs its own renderer: [backend/markdown](repo:backend/markdown/markdown.go#New) on goldmark, with a custom AST transformer for callouts and Chroma for highlighting (mapped to highlight.js class names so the same CSS works).

Two renderers for one format will drift, unless something forces them not to. CI compiles everything with the TypeScript compiler, writes the result to a JSON fixture, and the Go test renders every question again and compares:

```go excerpt=backend/catalog/catalog_test.go#TestParityWithStaticBuild lines=149-190
```

> [!PRINCIPAL]
> "Two implementations of one spec" is a classic source of subtle bugs (think client- and server-side validation, or two SDKs). The fix is not "be careful": it's a **conformance test fed by real data** that fails CI on the first differing byte, with an excerpt of where it differs. See the `go` job in [ci.yml](repo:.github/workflows/ci.yml).

Rendering at **write** time, not read time, keeps reads cheap: the database stores the HTML, the TL;DR and the search text next to the Markdown ([ADR-016](repo:docs/DECISIONS.md#ADR-016)). Readers get a round's answers in one query, revalidated with an ETag that changes whenever any reader-visible content changes ([`sectionAnswers`](repo:backend/server/public.go#sectionAnswers)).

### The admin editor

[QuestionEditor.tsx](repo:src/features/console/QuestionEditor.tsx#QuestionEditor) is a form plus a Markdown textarea with a live preview. The preview is **rendered by the server** (debounced, stale requests aborted), so what you preview is exactly what learners will see, rules included.

#### Two admins, one question

Every question has a `revision`. The editor sends the revision it loaded; the store refuses the save if someone saved in between:

```go excerpt=backend/store/content.go#UpdateQuestion
```

- The **advisory lock** serializes content writes, so ordering and the content version stay consistent.
- `current != expectedRevision` → `409 Conflict`; the editor then offers to load the other person's version instead of silently overwriting it.
- Before updating, the old row is **snapshotted** into `question_revisions`, which powers the editor's History panel and "restore". Deletes go to a trash the same way.
- [`bumpVersion`](repo:backend/store/content.go#bumpVersion) changes the content version (the ETag readers revalidate against), and [`audit`](repo:backend/store/settings.go#audit) records who did what in the same transaction ([ADR-021](repo:docs/DECISIONS.md#ADR-021)).

#### Round-tripping back to git

Content edited in the console can be exported back to the exact repository format (per round or as a zip), and the console can show what differs between the repository files and the database before syncing them ([`TestRepositorySyncAndExport`](repo:backend/server/server_test.go#TestRepositorySyncAndExport)). Git stays the long-term home; the database is where day-to-day edits happen.

### If you're asked about this in an interview

- **"Where should Markdown be rendered?"** Build time for static content (zero runtime cost, errors fail CI), write time for user-edited content (cheap reads), read time only when the output depends on the reader.
- **"How do you stop two editors overwriting each other?"** Optimistic concurrency with a version column and a 409 the UI knows how to resolve; pessimistic locks only for long, exclusive edits.
- **"How do you trust HTML you inject?"** Produce it from a renderer that escapes by construction, test that guarantee ([`TestCompiledHTMLIsSafe`](repo:backend/catalog/catalog_test.go#TestCompiledHTMLIsSafe)), and add a CSP as a second layer ([vercel.json](repo:vercel.json#headers)).
