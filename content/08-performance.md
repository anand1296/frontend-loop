---
id: performance
title: Performance
description: Core Web Vitals in depth, INP fixes, bundle strategy, images and fonts, a profiling workflow, budgets in CI, and perceived performance.
---

## Diagnose and fix LCP, INP and CLS on a real page
<!--
id: core-web-vitals-diagnosis
level: senior
tags: core web vitals, lcp, inp, cls, field data, performance
minutes: 20
-->

> [!PROMPT]
> A product page has LCP 4.8 s, INP 420 ms and CLS 0.31 on mobile field data. You have one week. Describe how you diagnose each metric and what you change first.
>
> **Cover**
> - For each metric: the tools you open, the breakdown you look for (LCP subparts, long tasks and input delay, layout shift sources).
> - The likely fixes in order of payoff, and how you avoid regressions.
> - How you verify with both lab and field data, and what targets you'd set.

> [!TLDR]
> **LCP** (largest contentful paint, good ≤ 2.5s) is about getting the main content's bytes early and rendering it immediately. **INP** (interaction to next paint, good ≤ 200ms) is about short main-thread work around interactions. **CLS** (cumulative layout shift, good ≤ 0.1) is about reserving space. Start from **field data** at the 75th percentile (CrUX, RUM), break each metric into its sub-parts to find the bottleneck, fix the biggest part, and verify in the field.

### LCP: break it into four parts

```text
LCP = TTFB + resource load delay + resource load time + element render delay
        │           │                     │                     │
   server/CDN   discovered late?     big/slow image?     blocked by JS/CSS/fonts?
```

| Sub-part too large | Typical fixes |
| --- | --- |
| TTFB | CDN/edge caching, SSR caching, fewer redirects, faster backend |
| Load delay | Put the LCP image in HTML (not JS), `fetchpriority="high"`, no `loading="lazy"`, preload background images |
| Load time | Right-size and compress (AVIF/WebP, `srcset`/`sizes`), CDN image transforms |
| Render delay | Less render-blocking CSS/JS, SSR/SSG instead of client-rendered hero, inline critical CSS, avoid hiding content behind A/B test scripts |

### INP: what happens between click and paint

```text
input delay (main thread busy) → processing (your handlers) → presentation delay (render + paint)
```

Fixes: break long tasks and yield (`scheduler.yield()`), do the visible update first and defer the rest, avoid huge React re-renders on input (state colocation, transitions, virtualization), debounce expensive work, move CPU work to workers, and remove heavy third-party scripts from the critical path. (Covered in depth in the INP question.)

### CLS: reserve space and avoid late insertions

- Always set `width`/`height` (or `aspect-ratio`) on images, video, iframes, and ad slots.
- Don't insert banners/toasts above existing content; overlay them or reserve space.
- Fonts: use `font-display: optional` or matched fallback metrics (`size-adjust`, `ascent-override`) to avoid reflow when the web font swaps in.
- Skeletons should match final dimensions.
- Animate with `transform`, not properties that change layout.

### Measuring

```ts
import { onCLS, onINP, onLCP } from 'web-vitals/attribution';

function send(metric: { name: string; value: number; rating: string; attribution: unknown; id: string }) {
  navigator.sendBeacon('/rum', JSON.stringify({ ...metric, route: location.pathname, release: __RELEASE__ }));
}

onLCP(send);
onINP(send);
onCLS(send);
```

The attribution build tells you **which element** was LCP, **which interaction** and script caused slow INP, and **which nodes** shifted, so dashboards point at code instead of just numbers. Segment by route, device class and connection; look at p75 and the distribution, not the mean.

### Field vs lab

Lighthouse is a synthetic single load on an emulated device; it can't measure INP (no real interactions) and can disagree with users. Use lab for debugging and regression gates, field data for truth.

### Follow-ups

- **"LCP is fine in Lighthouse but poor in CrUX. Why?"** Real users have slower devices/networks, cold caches, logged-in states with heavier content, geographic distance from the origin, or A/B tools that hide content.
- **"Does SSR always improve LCP?"** It usually improves render delay, but can worsen TTFB if the server is slow; streaming and caching keep TTFB low.

### References

- [web.dev: Web Vitals](https://web.dev/articles/vitals)
- [web.dev: Optimize LCP](https://web.dev/articles/optimize-lcp)
- [web.dev: Optimize CLS](https://web.dev/articles/optimize-cls)
- [web-vitals library](https://github.com/GoogleChrome/web-vitals)

## INP deep dive: long tasks, input delay, yielding, and React-specific fixes
<!--
id: inp-deep-dive
level: lead
tags: inp, long tasks, scheduler.yield, loaf, react, performance
minutes: 18
-->

> [!PROMPT]
> Users report that clicking "Add to cart" feels sticky: INP is 380 ms at the 75th percentile. The click handler updates React state, which re-renders a large list and runs analytics.
>
> **Cover**
> - The three parts of an interaction (input delay, processing, presentation delay) and how to see each in a trace.
> - Fixes: yielding to the main thread, `startTransition`, deferring analytics, reducing renders, and avoiding layout thrash.
> - How you measure in the field (`web-vitals` attribution) and what threshold you commit to.

> [!TLDR]
> INP reports (roughly) the worst interaction latency of a page visit: input delay + processing time + presentation delay until the next frame paints. Find slow interactions with RUM attribution and the Long Animation Frames API, then fix the dominant part: reduce **input delay** by breaking up long tasks that happen to be running, reduce **processing** by doing less in handlers and yielding after the urgent UI update, and reduce **presentation delay** by rendering less DOM (smaller React updates, virtualization, `content-visibility`).

### Pattern: urgent update first, then yield

```ts
async function onFilterChange(next: Filter) {
  setFilterChip(next);       // cheap visual feedback for this frame
  await scheduler.yield();   // let the browser paint the feedback
  applyFilterToGrid(next);   // expensive work after the paint
  await scheduler.yield();
  sendAnalytics('filter', next); // non-urgent work last
}
```

`scheduler.yield()` continues ahead of other queued tasks (unlike `setTimeout(0)`, which goes to the back of the queue); polyfill with `setTimeout` where unsupported.

### React-specific fixes

- **Transitions** for non-urgent state: typing updates the input immediately; the expensive list re-render happens in an interruptible transition.
- **Smaller update scope**: a global store update that re-renders 3,000 components is the classic INP killer. Colocate state, subscribe to slices, memoize rows, virtualize lists.
- **Avoid synchronous layout reads** in many `useLayoutEffect`s after an interaction.
- **Event handlers** shouldn't do synchronous `JSON.stringify` of big state, sync localStorage writes, or analytics that serialize payloads; defer them.
- **Hydration**: interactions during hydration are slow; selective hydration (Suspense boundaries) and less client JS (RSC, islands) help.

### Finding the culprit

```ts
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.duration < 100) continue;
    // Long Animation Frame entries attribute time to scripts (source URL, function, invoker).
    console.table(entry.toJSON().scripts);
  }
}).observe({ type: 'long-animation-frame', buffered: true });
```

In the lab: DevTools Performance panel with CPU throttling (4–6×), record the interaction, look at the "Interactions" track and the long task underneath it. Test on a real mid-range Android device; developer laptops hide INP problems.

### Third parties

Tag managers, chat widgets, A/B testing and session replay often dominate main-thread time. Load them after interaction-critical code, use `async`/`defer`, facades (load the chat widget on click), or move some to workers (Partytown), and hold vendors to a budget.

### References

- [web.dev: Interaction to Next Paint](https://web.dev/articles/inp)
- [web.dev: Optimize INP](https://web.dev/articles/optimize-inp)
- [Chrome: Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames)
- [MDN: Scheduler.yield()](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield)

## Bundle strategy: code-splitting boundaries, vendor chunks, tree-shaking failures and budgets
<!--
id: bundle-strategy
level: lead
tags: bundling, code splitting, tree shaking, vite, webpack, performance budgets
minutes: 15
-->

> [!PROMPT]
> The main bundle is 1.4 MB gzip and keeps growing. Design a bundle strategy for a large React app: where to split, how to share vendor code, and how to stop regressions.
>
> **Cover**
> - Route-level and interaction-level code splitting; prefetching on intent.
> - Diagnosing the bundle (visualizer, duplicate packages), tree-shaking failures (side effects, barrel files, CJS) and polyfills.
> - Budgets in CI and ownership, so the number doesn't creep back up.

> [!TLDR]
> Split by **route** first (each page loads only its code), then by **interaction** (heavy features loaded on demand: editors, charts, PDF export), and keep a stable **vendor/framework** chunk so it stays cached across deploys. Measure with a bundle analyzer, hunt tree-shaking failures (CommonJS deps, side-effectful barrels, whole-library imports), set per-entry size budgets in CI, and prefetch the next likely chunk on intent so splitting doesn't make navigation slower.

### Splitting points in React

```tsx
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const ChartEditor = lazy(() => import('./features/chart-editor/ChartEditor'));

function ReportActions() {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <button
        onPointerEnter={() => void import('./features/chart-editor/ChartEditor')} // warm on intent
        onClick={() => setEditing(true)}
      >
        Edit chart
      </button>
      {editing ? (
        <Suspense fallback={<EditorSkeleton />}>
          <ChartEditor />
        </Suspense>
      ) : null}
    </>
  );
}
```

### Where bytes hide

| Problem | Example | Fix |
| --- | --- | --- |
| Whole-library import | `import _ from 'lodash'` | `lodash-es` per-function imports or native code |
| Heavy date/i18n data | moment + all locales | `date-fns`/Temporal/`Intl`, load locale on demand |
| Icons | importing the full icon set | per-icon imports or SVG sprites |
| Duplicate packages | two versions of a dependency | dedupe (`npm dedupe`, resolutions), align ranges |
| Polyfills for old browsers | core-js for everything | target modern browsers, differential loading only if needed |
| Server-only code in client | markdown/highlighting libs | render on the server/build time |

### Vendor chunking

Too many tiny chunks hurt (request overhead, worse compression); one giant vendor chunk invalidates on any dependency bump. A practical middle: framework chunk (react, react-dom, router), a shared "app core" chunk, then route chunks. With HTTP/2/3, a few dozen chunks is fine.

### Budgets in CI

```json
[
  { "path": "dist/assets/index-*.js", "limit": "120 kB", "gzip": true },
  { "path": "dist/assets/vendor-react-*.js", "limit": "60 kB", "gzip": true }
]
```

`size-limit` (or bundlewatch, or a Lighthouse CI budget) comments the delta on each PR and fails when a budget is exceeded, so regressions are caught by the author, not found months later.

> [!PRINCIPAL]
> In a large org, bundle size is a shared commons: every team's "only 20KB" adds up. Make cost visible (per-route budget dashboards, PR comments with attribution to the package that grew), give teams ownership of their routes' budgets, and require an explicit exception with a payback plan to exceed one.

### References

- [Vite: Building for production](https://vite.dev/guide/build)
- [web.dev: Reduce JavaScript payloads with code splitting](https://web.dev/articles/reduce-javascript-payloads-with-code-splitting)
- [size-limit](https://github.com/ai/size-limit)

## Images and fonts: responsive images, formats, lazy loading, `font-display` and layout shift
<!--
id: images-fonts-performance
level: senior
tags: images, fonts, avif, srcset, lazy loading, font-display, cls
minutes: 12
-->

> [!PROMPT]
> A marketing page loads 6 MB of images, shifts layout when fonts load, and its hero image is the LCP element. Fix images and fonts.
>
> **Cover**
> - Formats (AVIF/WebP), `srcset` and `sizes`, explicit dimensions, lazy loading and `fetchpriority`.
> - Font loading: subsetting, `font-display`, preload, and metric-compatible fallbacks to avoid layout shift.
> - A checklist you'd enforce in review or CI.

> [!TLDR]
> Images: serve modern formats (AVIF/WebP) at the size actually displayed (`srcset` + `sizes`), always declare dimensions, lazy-load below the fold, and prioritize the LCP image. Fonts: self-host WOFF2, subset, preload only the one or two critical faces, choose `font-display` deliberately (`swap` for brand text with metric-matched fallbacks, `optional` when layout stability matters most), and limit the number of weights (variable fonts help).

### Responsive images

```html
<picture>
  <source type="image/avif" srcset="/p/shoe-400.avif 400w, /p/shoe-800.avif 800w, /p/shoe-1200.avif 1200w" />
  <source type="image/webp" srcset="/p/shoe-400.webp 400w, /p/shoe-800.webp 800w, /p/shoe-1200.webp 1200w" />
  <img
    src="/p/shoe-800.jpg"
    srcset="/p/shoe-400.jpg 400w, /p/shoe-800.jpg 800w, /p/shoe-1200.jpg 1200w"
    sizes="(min-width: 1024px) 50vw, 100vw"
    width="1200" height="1200"
    alt="Trail running shoe in blue, side view"
    loading="lazy" decoding="async"
  />
</picture>
```

`sizes` tells the browser the rendered width before layout, so it can pick the right candidate. Without it, it assumes `100vw` and often downloads oversized images. An image CDN (Cloudinary, imgix, Next.js Image) automates formats and resizing.

### Fonts without layout shift

```css
@font-face {
  font-family: 'Brand';
  src: url('/fonts/brand-var.woff2') format('woff2');
  font-weight: 300 800;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153; /* Latin subset */
}

/* Fallback tuned to Brand's metrics so the swap doesn't reflow text */
@font-face {
  font-family: 'Brand Fallback';
  src: local('Arial');
  size-adjust: 104%;
  ascent-override: 92%;
  descent-override: 24%;
}

body { font-family: 'Brand', 'Brand Fallback', system-ui, sans-serif; }
```

Tools like `fontaine` or Next.js `next/font` generate the override values automatically.

### Checklist

- Don't lazy-load above-the-fold images; do lazy-load everything else (native `loading="lazy"`).
- Use CSS `aspect-ratio` for responsive containers to reserve space.
- Avoid base64-inlining large images in CSS/JS (blocks parsing, bypasses image caching).
- For icons, inline SVG or a sprite, not icon fonts (accessibility and rendering issues).
- Video: `preload="none"` or `metadata` and a poster image; don't autoplay large videos on mobile.

### References

- [MDN: Responsive images](https://developer.mozilla.org/en-US/docs/Web/HTML/Responsive_images)
- [web.dev: Best practices for fonts](https://web.dev/articles/font-best-practices)
- [web.dev: Browser-level image lazy loading](https://web.dev/articles/browser-level-image-lazy-loading)

## A repeatable React profiling workflow
<!--
id: react-profiling-workflow
level: senior
tags: profiling, react devtools, performance panel, rerenders, debugging
minutes: 15
-->

> [!PROMPT]
> Your team says "the app is slow" and wants to wrap everything in `memo`. Describe a repeatable workflow for finding and fixing a React performance problem.
>
> **Cover**
> - Reproducing reliably (CPU throttling, a specific interaction) and deciding whether it is scripting, rendering or layout.
> - Using the React Profiler and the browser Performance panel; reading flame charts and "why did this render".
> - Fixing the biggest cost first, proving the improvement and keeping a regression test or budget.

> [!TLDR]
> Reproduce the slow interaction on a throttled CPU, record it in the browser Performance panel to see whether time goes to scripting, rendering or layout, then use the React DevTools Profiler to find **which components** rendered, **why**, and how long they took. Fix the top offender, re-measure the same scenario, and lock the improvement in with a benchmark or interaction test. Never optimize from a hunch.

### The loop

1. **Define the scenario**: "Typing in the filter box with 5,000 rows feels laggy" (input → paint latency).
2. **Measure baseline** in a production build (dev builds are much slower and misleading), CPU throttled 4×.
3. **Performance panel**: find the long task for the interaction. Is it React render (lots of `performWorkUntilDeadline`/component frames), layout (purple), or your own code (JSON parsing, sorting)?
4. **React Profiler**: enable "Record why each component rendered". Look at the commit for the interaction: flamegraph (wide = slow subtree), ranked view (self time), and the reasons (props changed: which prop? context changed? parent rendered?).
5. **Fix** the dominant cause (see the re-renders question): colocate state, stabilize props, split context, memoize the row, virtualize.
6. **Re-measure** the same scenario. Keep before/after numbers for the PR description.
7. **Guard**: an interaction benchmark in CI (Playwright + `performance.measure`) or React's `<Profiler onRender>` logging in a test environment.

### `<Profiler>` in code

```tsx
function onRender(id: string, phase: 'mount' | 'update' | 'nested-update', actualDuration: number) {
  if (actualDuration > 16) {
    performance.mark(`slow-render:${id}`);
    console.warn(`${id} ${phase} took ${actualDuration.toFixed(1)}ms`);
  }
}

<Profiler id="OrdersGrid" onRender={onRender}>
  <OrdersGrid />
</Profiler>;
```

Profiling builds (`react-dom/profiling`) can ship to a small percentage of production traffic for field data, with care.

### Common findings

- A context provider high in the tree whose value changes on every keystroke.
- Selectors returning new arrays/objects (`useSelector(s => s.items.filter(...))`).
- Rows not memoized, or memoized but receiving inline callbacks.
- Expensive derived data recomputed in render without memoization.
- Layout thrashing from many components measuring themselves.

### References

- [React: Profiler](https://react.dev/reference/react/Profiler)
- [React DevTools](https://react.dev/learn/react-developer-tools)
- [Chrome: Analyze runtime performance](https://developer.chrome.com/docs/devtools/performance)

## Lab vs field data, RUM, and enforcing performance budgets in CI
<!--
id: perf-budgets-rum-ci
level: lead
tags: rum, lighthouse ci, performance budgets, observability, regression
minutes: 12
-->

> [!PROMPT]
> Leadership wants "no performance regressions" after a redesign. Lighthouse in CI is flaky and field data shows different numbers than the lab. Design the measurement and enforcement setup.
>
> **Cover**
> - Lab versus field data, and why they disagree; RUM with the `web-vitals` library and segmentation.
> - Budgets that can gate a pull request without flakiness (bundle size, lab metrics on stable runners), and alerts for field data.
> - Ownership: who is paged, how regressions are triaged, how budgets change.

> [!TLDR]
> Field data (RUM, CrUX) tells you what users experience; lab data (Lighthouse, WebPageTest, Playwright traces) gives reproducible numbers to debug and to gate PRs. A mature setup has both: per-PR lab budgets on bundle size and key metrics (with tolerance for noise), RUM dashboards segmented by route/device/release with alerting on p75 regressions, and a release annotation so a regression maps to a deploy.

### Lab gates per PR

```yaml
# .github/workflows/perf.yml (sketch)
- run: npm run build && npx size-limit           # deterministic, low noise: gate hard
- run: npx @lhci/cli autorun --upload.target=temporary-public-storage
  # lighthouserc.json asserts e.g. LCP < 2500 on mobile preset, TBT < 300, CLS < 0.1
  # Run 3–5 times and use the median: single Lighthouse runs are noisy.
```

Gate hard on deterministic signals (bytes, request counts), softly on noisy ones (timings: warn, require a second look).

### RUM pipeline

- Collect Web Vitals with attribution, plus custom marks for product moments ("time to first search result", "editor ready").
- Tag every event with route, release/version, device memory/cores, connection type, and logged-in vs anonymous.
- Sample if traffic is huge, but keep enough data per route for stable p75s.
- Alert on sustained p75 regressions per route after a release, not on single spikes.

### The organizational part

- Budgets need owners (the team owning the route).
- Make the cost visible in PRs (size delta, which dependency).
- Celebrate wins with numbers; tie perf to business metrics where possible (conversion vs LCP buckets) to justify investment.

### References

- [web.dev: Why lab and field data can be different](https://web.dev/articles/lab-and-field-data-differences)
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
- [web.dev: Performance budgets 101](https://web.dev/articles/performance-budgets-101)

## Perceived performance: skeletons, optimistic UI, prefetching on intent and view transitions
<!--
id: perceived-performance
level: senior
tags: perceived performance, skeletons, optimistic ui, prefetch, view transitions
minutes: 12
-->

> [!PROMPT]
> A dashboard takes 1.2 s to load data, and users say it feels slow while a competitor with similar timings feels instant. Improve perceived performance without changing the backend.
>
> **Cover**
> - Immediate feedback, skeletons versus spinners, optimistic updates and their rollback rules.
> - Prefetching on intent (hover, viewport), view transitions and keeping content stable.
> - How you measure perception (INP, time to useful content, user research) and when these tricks backfire.

> [!TLDR]
> Users judge speed by **feedback and continuity**, not just milliseconds. Respond to every interaction within ~100ms (pressed states, optimistic updates), show layout-stable skeletons instead of spinners for content, keep old content visible during transitions instead of blanking the page, prefetch data and code when users show intent (hover, focus, viewport), and use view transitions to make navigations feel connected. None of this replaces real speed; it makes good speed feel great and slow moments tolerable.

### Techniques and when to use them

| Technique | Good for | Watch out |
| --- | --- | --- |
| Optimistic update | Likes, toggles, reordering, adding comments | Rollback UX on failure; conflicting concurrent edits |
| Skeleton | Content areas with known shape | Must match final layout (CLS) |
| Keep previous data | Filters, pagination, tab switches | Indicate staleness (dimmed, inline spinner) |
| Prefetch on intent | Links, menu items, next step in a flow | Wasted bandwidth on mobile; respect Save-Data |
| Progressive rendering | Streaming SSR, Suspense boundaries | Avoid popcorn layouts |
| View transitions | Page/route changes, list → detail | Reduced-motion; don't block on long animations |

### Prefetch on intent

```tsx
function ProductLink({ id, children }: { id: string; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const prefetch = () => {
    void queryClient.prefetchQuery({ queryKey: ['product', id], queryFn: () => fetchProduct(id), staleTime: 60_000 });
    void import('./pages/ProductPage'); // code too
  };
  return (
    <Link to={`/products/${id}`} onPointerEnter={prefetch} onFocus={prefetch}>
      {children}
    </Link>
  );
}
```

### View transitions

```ts
function navigateWithTransition(update: () => void) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update)); // DOM must be updated synchronously inside the callback
}
```

```css
.product-image { view-transition-name: product-hero; } /* morphs between list thumbnail and detail hero */
```

Cross-document view transitions (`@view-transition { navigation: auto; }`) work for MPAs in supporting browsers.

### Timing thresholds worth quoting

- < 100ms feels instant; respond to input visually within that.
- ~1s keeps flow; beyond that, show progress.
- > 10s: show progress with an estimate, let users do something else, and notify on completion.

### References

- [web.dev: View Transitions](https://developer.chrome.com/docs/web-platform/view-transitions)
- [Nielsen Norman Group: Response time limits](https://www.nngroup.com/articles/response-times-3-important-limits/)
- [TanStack Query: Prefetching](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
