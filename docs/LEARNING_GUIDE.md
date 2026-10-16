# Learning Guide: this codebase as a study project

Frontend Loop is deliberately built with the techniques its answers teach. Use this guide two ways: as a **code tour** (read the file, then the question it illustrates) and as a list of **exercises** that extend the app and double as interview practice.

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
10. **Real backend sync.** Implement the `RemoteDoc` interface on Supabase or Firebase with auth; keep the same merge protocol; add conflict tests. *Practices: `#design-offline-first`, `#auth-token-storage-bff`.*
11. **Observability.** Add `web-vitals` with attribution, an error reporter, and a tiny dashboard of your own study stats. *Practices: `#frontend-observability`, `#core-web-vitals-diagnosis`.*
12. **AI follow-ups.** After you reveal an answer, generate one tough follow-up question with an LLM through a small backend; stream it in; never send secrets from the browser. *Practices: `#streaming-llm-ui`, `#incremental-markdown-rendering`.*

### Principal-level reflection

13. Write an ADR proposing a migration of this app to Next.js with RSC. Argue honestly whether it's worth it (see ADR-001), with metrics you'd use to decide.
14. Write the RFC for turning the content compiler into a shared internal package used by three other teams' docs sites.

## Part 3: How to study with the app

1. Turn on **practice mode**. For each question: say the answer out loud (2–4 minutes), reveal, compare, then tick it only if you could have said the 60-second answer.
2. Write your own version in **notes**, especially for behavioral questions (your real stories with numbers).
3. Do **Review** daily for 10 minutes.
4. In the final week, use search to drill company-specific topics and re-read the Principal callouts.
