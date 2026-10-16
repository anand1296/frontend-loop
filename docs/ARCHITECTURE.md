# Architecture

Frontend Loop is a static, client-rendered React application whose content is **compiled at build time**. There is no application server. Progress lives in the browser and, when the host provides it, in a private per-user document store.

## 1. System context

```text
                     build time                                   run time
┌──────────────────────────────────────────┐      ┌─────────────────────────────────────────────┐
│ content/*.md ──▶ content compiler         │      │ Browser                                     │
│                  (parse, validate,        │      │  React app ──▶ localStorage (progress,prefs)│
│                   highlight, escape)      │      │      │       ◀── storage events (other tabs)│
│                      │                    │      │      └──▶ optional cloud doc                │
│                      ▼                    │      │           (claude.ai Artifact `db`,         │
│  virtual modules ──▶ Vite / esbuild ──────┼─────▶│            data/users/<uid>/progress)       │
│  (index + per-round chunks)               │      └─────────────────────────────────────────────┘
└──────────────────────────────────────────┘
```

## 2. Build-time content pipeline

```text
content/07-browser-platform.md
   │ splitFrontmatter()          front matter → section meta (id, title, description)
   │ splitQuestions()            "## " headings outside code fences → questions
   │ parse <!-- meta -->         id, level, tags, minutes (validated)
   │ marked.lexer()              tokens → TL;DR summary + search text
   │ marked.parser() + renderer  callouts, highlighted code + copy button, safe links,
   │                             escaped raw HTML, scrollable tables
   ▼
CompiledContent { sections: SectionMeta[], answers: Record<sectionId, Record<questionId, html>> }
   │ codegen
   ▼
virtual:content                    export const sections = [...]; export const loaders = { id: () => import('virtual:content/section/id') }
virtual:content/section/<id>       export default { questionId: "<html>" }
```

- **Pure core, thin adapters.** `build/content/compile.ts` has no bundler knowledge. `build/vite-plugin-content.ts` (dev server + production build) and `scripts/build-single-file.ts` (esbuild) are ~40-line adapters around it. `scripts/check-content.ts` uses it for CI validation.
- **Fail the build, not the reader.** Missing TL;DR, unknown level, unsupported code language, duplicate ids, unknown callouts and malformed meta all throw `ContentError` with `file:line "Question"`.
- **Code splitting by round.** The eager index holds only metadata and search text (small); each round's answer HTML is a separate chunk loaded on first visit, and pre-loaded on hover/focus of its navigation entry.

## 3. Runtime modules

```text
src/
  main.tsx                    boot: initPrefs → initProgress → initRouter → render <App/>
  app/App.tsx                 shell: sidebar, mobile drawer, top bar, view switch, global shortcuts
  app/Sidebar.tsx             navigation with per-round progress
  features/overview/          resume card, review card, loop ring, rounds list
  features/section/           SectionPage (filters, open set, scroll/focus), QuestionItem (accordion),
                              Answer (React 19 use() + Suspense), notes, practice gate
  features/review/            due list + upcoming
  features/search/            command-palette search (native <dialog>, ARIA combobox)
  features/settings/          theme, practice mode, export/import/reset, sync status
  components/                 Icon, LoopRing, primitives (Dialog, ErrorBoundary, ProgressBar…)
  content/                    types (shared with the compiler), index (lookups + answer loader cache)
  state/                      createStore, useStore, progress (pure model), progressStore (actions),
                              prefs, route, selectors, persistence/{local, cloudSync}
  lib/                        search, srs (review ladder), format
  styles/                     tokens (light/dark), base, layout, components, prose (+ syntax colors)
```

### Dependency rules

- `state/progress.ts`, `lib/*` and `state/selectors.ts` are framework-free and fully unit-tested.
- Components never construct progress state; they call `progressActions.*`.
- Only `content/index.ts` imports the virtual module.

## 4. State model

| State | Where | Persistence |
| --- | --- | --- |
| Progress (done, review stage/due, notes, last visit) | `progressStore` | localStorage `frontend-loop:progress:v1`, other tabs, optional cloud doc |
| Preferences (theme, practice mode, filters) | `prefsStore` | localStorage `frontend-loop:prefs:v1` (device-only) |
| Route (overview / review / admin / section + focused question) | `routeStore` | URL hash (bare token) |
| Platform role (owner / learner / local) | `platformStore` | resolved from `window.claude` at boot |
| Announcement | `announcementStore` | `config/announcement` (owner writes, everyone reads) |
| Learner summary | derived by `computeSummary` | `learners/<uid>` (owner reads); see docs/ADMIN.md |
| UI (open accordions, reveal state, dialog open) | component state | none |

**Store implementation.** `createStore` is ~20 lines: immutable `setState(updater)`, notify only when the reference changes. Components subscribe with `useSyncExternalStore` via `useStore(store, selector)`, selecting stable slices (primitives or existing objects) so React can bail out.

**Progress document (v1):**

```ts
{
  version: 1,
  questions: {
    "event-loop-rendering-order": { done: true, doneAt: 1760580000000, stage: 1, dueAt: 1761012000000, notes: "…", updatedAt: 1760590000000 }
  },
  lastVisit: { sectionId: "react-internals", questionId: "effects-synchronization", at: 1760590000000 }
}
```

Everything read from storage, imports or the cloud passes through `parseProgress`, which validates field by field and drops invalid entries.

## 5. Persistence and sync protocol

Local-first: the UI only ever reads the in-memory store, which is hydrated from localStorage before first render.

1. **Every change** is written to localStorage synchronously (small document).
2. **Other tabs** receive a `storage` event; they validate and `mergeProgress` it in.
3. **Cloud sync** (only when `window.claude.use('db')` resolves, i.e. when hosted as a claude.ai Artifact):
   - Subscribe to `data/users/<uid>/progress` (private to the viewer by platform rules).
   - Each snapshot is merged into local state (LWW per question by `updatedAt`, newest `lastVisit`).
   - Local changes schedule a debounced (1.2s) full-document write; one write in flight at a time; a write is skipped when the last known remote copy already equals local state, which also prevents echo loops.
   - Pending writes flush when the tab becomes hidden.
   - Terminal errors (revoked, quota, not granted) stop sync and fall back to local-only with a visible status.

**Why last-writer-wins per question:** one person's progress rarely conflicts; when it does (ticked on phone, unticked on laptop), the most recent intent should win. Reset writes "not done" tombstones with a fresh clock rather than deleting entries, so a reset beats older entries from other devices.

## 6. Routing

Hash routing with a single bare token (`#review`, `#react-internals`, `#oauth-pkce-flow`). Section and question ids share one namespace, enforced unique by the compiler. Bare tokens survive sandboxed hosts that only pass `#[A-Za-z0-9._~-]` through. `navigate()` updates the store and `history.pushState` (wrapped in try/catch); `popstate`/`hashchange` re-sync.

## 7. Rendering and React patterns used

| Pattern | Where | Why |
| --- | --- | --- |
| `useSyncExternalStore` | `state/useStore.ts` | Tear-free subscriptions to module stores |
| React 19 `use(promise)` + Suspense | `features/section/Answer.tsx` | Lazy answer chunks with a cached promise per round |
| Error boundary with retry (cache eviction on failure) | `components/primitives.tsx`, `content/index.ts` | Failed chunk loads are recoverable |
| Adjusting state during render | `SectionPage` (focus from navigation), `SearchDialog` (reset highlight) | Avoids effect-driven double renders |
| Effects only for external sync | dialogs (`showModal`), scroll/focus, timers, global keydown | "Effects are synchronization" |
| `memo` on accordion items + stable callbacks | `QuestionItem`, `SectionPage` | Toggling one item doesn't re-render all |
| `useDeferredValue` | Search | Keeps typing responsive |
| `key` to reset per-round state | `App` → `<SectionPage key={id}>` | Clean state when switching rounds |
| Native `<dialog>` | Search, settings, mobile drawer | Focus trap, Escape, inert background for free |

## 8. Performance

- No markdown parser or highlighter in the client bundle (build-time HTML).
- Answer HTML split per round; preloaded on intent.
- Accordion panels mount content only when open.
- CSS is plain, token-based, ~25 KB unminified.
- Fonts: three Google families with `display=swap` and system fallbacks.

## 9. Accessibility

- Accordion: `<h2><button aria-expanded aria-controls>` + `role="region"` panel labelled by the button.
- Done checkbox is a real `<input type="checkbox">` with an accessible name per question.
- Segmented filters are `role="radiogroup"`/`role="radio"`.
- Search follows the ARIA 1.2 combobox pattern with `aria-activedescendant` and a polite results count.
- Skip link, visible `:focus-visible` rings, `prefers-reduced-motion` respected, sufficient contrast in both themes.

## 10. Security

- Answer HTML is generated from repository Markdown at build time; raw HTML is escaped, links restricted to http(s)/relative/`#`, external links get `rel="noopener noreferrer"`. The output is injected with `dangerouslySetInnerHTML` without a runtime sanitizer, by design (see ADR-009).
- All persisted data is validated on read; imports are validated before merge.
- No secrets, no third-party scripts besides Google Fonts CSS.

## 11. Testing

| Layer | Tooling | Covered |
| --- | --- | --- |
| Static | TypeScript strict (+ `noUncheckedIndexedAccess`, `erasableSyntaxOnly`) | Whole codebase |
| Content | `scripts/check-content.ts` | Every question's meta, TL;DR, ids, code languages |
| Unit | `node --test` (zero dependencies) | Compiler, progress model, merge, parsing, search, selectors, cloud sync protocol |
| E2E | Playwright (`e2e/`, desktop + Pixel 7 projects) | Tick/reload/resume, notes, search + deep links, practice mode, import + review + reset, filters, theme, skip link, mobile drawer and no horizontal overflow |

## 12. Trade-offs accepted

- **No server:** no cross-device sync outside hosts that provide a per-user store; export/import covers the rest.
- **Content in the bundle:** ~1 MB of HTML in the single-file build (≈250 KB gzipped). Acceptable for a study app; the Vite build splits it per round.
- **Custom store and router:** less ecosystem tooling (no Redux DevTools), but tiny and fully understood. Swap in TanStack Router/Zustand if the app grows.
