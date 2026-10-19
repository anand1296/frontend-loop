---
id: react-internals
title: React Rendering & Internals
description: How React turns state into pixels, when components re-render, effects as synchronization, concurrent rendering, React 19, Server Components and the compiler.
---

## What exactly happens between `setState` and pixels on screen?
<!--
id: react-render-commit-pipeline
level: senior
tags: react, reconciliation, fiber, render phase, commit phase, batching
minutes: 15
-->

> [!PROMPT]
> A product manager asks: "When I call `setState`, how long until the user sees the change, and what does React do in between?" You are asked to explain it with a concrete component whose child uses `useLayoutEffect` and `useEffect`.
>
> **Cover**
> - Trigger, render, reconcile, commit, and where the browser paints.
> - When each effect type runs, and what batching and lanes change in React 18/19.
> - Why render must be pure, and what Strict Mode's double render is checking.

> [!TLDR]
> `setState` enqueues an update on the component's fiber and schedules work at a priority (lane). React then **renders**: calls your components to get new element trees and **reconciles** them against the current fiber tree (same type + same key → update, otherwise replace). Render is pure and interruptible in concurrent mode. Then it **commits** synchronously: applies DOM mutations, attaches refs, runs layout effects, and lets the browser paint; passive effects (`useEffect`) run after paint. Updates in the same event are **batched** into one render.

### The pipeline

```text
setState(x)
  └─ enqueue update on fiber, mark lanes up to the root, schedule root
render phase (pure, can be paused/restarted/discarded)
  ├─ beginWork: call components, diff children (reconciliation)
  └─ completeWork: create/prepare DOM nodes off-screen, collect effects
commit phase (synchronous, never interrupted)
  ├─ before mutation: getSnapshotBeforeUpdate
  ├─ mutation: insert/update/remove DOM nodes, ref detach
  ├─ layout: ref attach, useLayoutEffect, componentDidMount/Update
  └─ (browser paints)
passive effects: useEffect cleanups then setups (after paint, usually)
```

### Reconciliation rules that explain real bugs

- **Different element type at the same position** (`<div>` → `<section>`, or `<A>` → `<B>`) unmounts the whole subtree, losing state.
- **Same type, same position** reuses the instance and its state.
- **Keys** give identity in lists. Index keys break when items are reordered/inserted: state "moves" to the wrong row.
- **Changing a `key` on purpose** resets a component (e.g. `<ProfileForm key={userId} />` to discard draft state when switching users).

```tsx
// Bug: defining a component inside another gives it a NEW type each render → remount every render.
function Parent() {
  const Row = ({ label }: { label: string }) => <input defaultValue={label} />; // new function each render
  return <Row label="name" />; // input loses focus/state on every parent render
}
```

### Batching

Since React 18, all updates inside the same tick are batched automatically: event handlers, promises, timeouts, native listeners. `flushSync` opts out when you must read the DOM right after an update (rare, e.g. scroll to a newly added item).

### Fiber and lanes, briefly

Each component instance has a fiber node with pointers (child, sibling, return) so React can walk the tree iteratively and **pause** between units of work. Lanes are a bitmask of priorities: discrete input (click, keypress) is high priority, transitions are lower, so a transition render can be interrupted by typing and restarted with fresh state.

### Why render must be pure

Because a render may be called twice (StrictMode in dev), interrupted, or thrown away (a higher-priority update arrived), side effects in render (subscriptions, mutations, network calls) can run multiple times or for UI that never commits. Put them in event handlers or effects.

### Follow-ups

- **"Is the virtual DOM why React is fast?"** No; it's a convenient programming model. Diffing has a cost. React is fast enough because work is bounded (keys, memoization, avoiding unnecessary renders) and scheduled (concurrent rendering).
- **"`useLayoutEffect` vs `useEffect`?"** Layout effects run after DOM mutation but before paint, blocking it; use them to measure and synchronously adjust layout (tooltips, scroll). Everything else goes in `useEffect`.
- **"What does `useInsertionEffect` do?"** Runs before layout effects, for CSS-in-JS libraries to inject styles before anything reads layout.

### References

- [React: Render and commit](https://react.dev/learn/render-and-commit)
- [React: Preserving and resetting state](https://react.dev/learn/preserving-and-resetting-state)
- [React 18: Automatic batching](https://react.dev/blog/2022/03/29/react-v18#new-feature-automatic-batching)

## When does a component re-render, and which optimizations actually help?
<!--
id: react-rerenders-optimizations
level: senior
tags: react, rerenders, memo, context, performance, usememo
minutes: 15
-->

> [!PROMPT]
> A table of 2,000 rows re-renders on every keystroke in a search box above it, and the page feels slow. You are asked to explain what triggers renders and fix it without sprinkling `useMemo` everywhere.
>
> **Cover**
> - Exactly what causes a component to re-render (state, parent, context) and what doesn't.
> - Optimizations that work in order: move state down, split components, pass children, `memo` with stable props, virtualization.
> - How you prove the fix with the React Profiler, and where the React Compiler changes the advice.

> [!TLDR]
> A component re-renders when its state changes, its parent re-renders (props don't matter unless it's memoized), or a context it reads changes. Re-rendering isn't a bug; **expensive or excessive** re-rendering is. The best fixes are structural: move state down (colocation), lift content up (`children` as props), split contexts by update frequency, and subscribe to slices of external stores. `React.memo`/`useMemo`/`useCallback` are targeted tools after profiling, and the React Compiler automates most of them.

### The three triggers

```tsx
function Parent() {
  const [count, setCount] = useState(0);
  return (
    <>
      <button onClick={() => setCount((c) => c + 1)}>{count}</button>
      <ExpensiveTree /> {/* re-renders on every click, even with no props */}
    </>
  );
}
```

### Structural fixes (no memo needed)

**1. Move state down** into the component that uses it:

```tsx
function Parent() {
  return (
    <>
      <Counter />       {/* owns its own state now */}
      <ExpensiveTree /> {/* no longer re-renders */}
    </>
  );
}
```

**2. Lift content up**: pass the expensive part as `children`. Elements created by the grandparent don't change when the wrapper's state changes.

```tsx
function ScrollTracker({ children }: { children: React.ReactNode }) {
  const [y, setY] = useState(0);
  useWindowEvent('scroll', () => setY(window.scrollY));
  return <div data-scrolled={y > 0}>{children}</div>; // children keep the same element identity
}

<ScrollTracker>
  <ExpensiveTree />
</ScrollTracker>;
```

**3. Split context** so fast-changing values don't re-render everything:

```tsx
// One context with { user, theme, cursorPosition } re-renders all consumers on mouse move.
// Split by volatility, and pass stable dispatchers separately.
const ThemeContext = createContext<Theme>('light');
const CursorContext = createContext<{ x: number; y: number }>({ x: 0, y: 0 });
```

**4. Subscribe to slices** with selectors (Redux `useSelector`, Zustand `useStore(s => s.x)`, `useSyncExternalStore`): only components whose selected value changed re-render.

### Targeted memoization

```tsx
const Row = memo(function Row({ item, onSelect }: { item: Item; onSelect: (id: string) => void }) {
  return <li onClick={() => onSelect(item.id)}>{item.label}</li>;
});

function List({ items }: { items: Item[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const onSelect = useCallback((id: string) => setSelected(id), []); // stable → memo works
  const visible = useMemo(() => items.filter((i) => !i.archived), [items]);
  return <ul>{visible.map((item) => <Row key={item.id} item={item} onSelect={onSelect} />)}</ul>;
}
```

`memo` only helps if **every** prop is referentially stable. One inline object (`style={{}}`) or arrow function silently defeats it.

### Measure first

Use the React DevTools Profiler ("Highlight updates", flamegraph, "Why did this render?") and the browser Performance panel. Optimize the components that are both **frequently** rendered and **slow** to render. A 0.1ms component re-rendering is fine.

> [!WARNING]
> `useMemo` everywhere isn't free: it costs memory, comparison work and readability, and it doesn't stop child re-renders unless the child is memoized. With the React Compiler enabled, manual memoization is mostly redundant.

### Follow-ups

- **"Why does my context consumer re-render even though the value didn't change?"** The provider's `value={{ user, setUser }}` is a new object every render. Memoize the value or split state and dispatch into separate contexts.
- **"Does a component re-render if `setState` is called with the same value?"** React bails out (`Object.is`) and usually skips rendering children; it may render the component itself once before bailing.

### References

- [React: memo](https://react.dev/reference/react/memo)
- [Dan Abramov: Before you memo()](https://overreacted.io/before-you-memo/)
- [React: Scaling up with reducer and context](https://react.dev/learn/scaling-up-with-reducer-and-context)

## Effects are synchronization, not lifecycle: when don't you need `useEffect`?
<!--
id: effects-synchronization
level: senior
tags: useeffect, derived state, events, react
minutes: 15
-->

> [!PROMPT]
> Review this component: it fetches data in `useEffect`, mirrors props into state with another effect, resets a form when an id changes using an effect, and subscribes to a store manually. Which of these effects shouldn't exist?
>
> **Cover**
> - The mental model: effects synchronize with external systems; events and derived data don't need them.
> - For each smell, the replacement (compute during render, `key` to reset state, event handlers, `useSyncExternalStore`, a data library).
> - The remaining legitimate effect and how to write its cleanup correctly, including Strict Mode double-invocation.

> [!TLDR]
> `useEffect` exists to **synchronize with something outside React** (DOM APIs, subscriptions, network, timers, third-party widgets). If the code reacts to a **user action**, it belongs in the event handler. If it **computes** a value from props/state, compute it during render (memoize if expensive). If it **resets** state when a prop changes, use a `key` or adjust state during render. Most bugs in effect-heavy code (extra renders, loops, races) disappear when unnecessary effects are removed.

### Anti-pattern → fix table

| You wrote | Instead |
| --- | --- |
| `useEffect(() => setFullName(first + ' ' + last), [first, last])` | `const fullName = first + ' ' + last` |
| `useEffect(() => setVisible(filter(items)), [items])` | `const visible = useMemo(() => filter(items), [items])` |
| `useEffect(() => { if (submitted) post(form) }, [submitted])` | Call `post(form)` in the submit handler |
| `useEffect(() => setSelection(null), [items])` | `key` the component, or store `selectedId` and derive selection |
| `useEffect(() => onChange(value), [value])` (notify parent) | Call `onChange` in the handler that changed `value` |
| Chains of effects setting state that trigger effects | One event handler that computes the next state |

### Adjusting state when a prop changes (without an effect)

```tsx
function ItemList({ items }: { items: Item[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Derive instead of syncing: if the selected item disappeared, treat it as no selection.
  const selected = items.find((item) => item.id === selectedId) ?? null;
  // ...
}
```

When you truly need to reset state on a prop change, compare with the previous value during render:

```tsx
const [prevItems, setPrevItems] = useState(items);
if (items !== prevItems) {
  setPrevItems(items);
  setSelectedId(null); // React re-renders immediately, before children see stale state
}
```

### Legitimate effects

```tsx
// Subscribing to a browser API, with cleanup.
useEffect(() => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const update = () => setReduced(media.matches);
  update();
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}, []);
```

For this exact case, `useSyncExternalStore` is even better: no extra render, no tearing.

### Fetching in effects

Fetching in `useEffect` works but you must handle races, caching, deduping and cancellation yourself. Prefer a data library (TanStack Query, SWR, RTK Query), a framework loader, or React 19's `use` with a cached promise.

### StrictMode double effects

In development, React mounts → unmounts → mounts each component to verify effects clean up correctly. If an effect breaks under that (double requests that matter, duplicated subscriptions), the effect is missing a cleanup or isn't idempotent.

### Follow-ups

- **"How do you read the latest props in an effect without re-running it?"** `useEffectEvent` (stable in recent React) for event-like logic inside effects; a ref updated in a layout effect as the older pattern.
- **"Why does the linter insist on all dependencies?"** Missing deps mean the effect closes over stale values. If adding a dependency causes loops, the effect is doing too much; restructure instead of disabling the rule.

### References

- [React: You might not need an effect](https://react.dev/learn/you-might-not-need-an-effect)
- [React: Synchronizing with effects](https://react.dev/learn/synchronizing-with-effects)
- [React: Separating events from effects](https://react.dev/learn/separating-events-from-effects)

## Transitions, `useDeferredValue` and Suspense: what does concurrency mean in React?
<!--
id: react-concurrent-features
level: lead
tags: concurrent rendering, usetransition, usedeferredvalue, suspense
minutes: 18
-->

> [!PROMPT]
> A search page filters 20,000 items on every keystroke and typing lags. Someone says "just wrap it in `startTransition`". Explain what that does, what `useDeferredValue` does differently, and what Suspense adds.
>
> **Cover**
> - Urgent versus transition updates, interruptible rendering and what is discarded.
> - When `useDeferredValue` is the better fit (you don't own the state update).
> - What concurrency does not fix (expensive renders that never yield, effects) and how to verify an improvement.

> [!TLDR]
> Concurrent rendering lets React prepare a new UI **in the background** and interrupt that work for more urgent updates. `startTransition` marks an update as non-urgent, so typing stays responsive while a heavy list re-renders, and already-visible content isn't replaced by a spinner. `useDeferredValue` gives you a lagging copy of a value to render the expensive part with. Suspense declares loading boundaries; inside a transition, React keeps showing the old UI instead of falling back.

### The problem it solves

```tsx
function Search() {
  const [query, setQuery] = useState('');
  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <Results query={query} /> {/* renders 5,000 rows: every keystroke janks */}
    </>
  );
}
```

### Fix 1: `useDeferredValue`

```tsx
function Search() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;
  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ opacity: isStale ? 0.6 : 1 }}>
        <Results query={deferredQuery} /> {/* must be memoized to benefit */}
      </div>
    </>
  );
}

const Results = memo(function Results({ query }: { query: string }) {
  /* expensive render */
});
```

The input updates with urgent priority; the results re-render with the deferred value in an interruptible background render. If the user keeps typing, stale background work is thrown away.

### Fix 2: `useTransition` when you own the state update

```tsx
function Tabs() {
  const [tab, setTab] = useState<'posts' | 'stats'>('posts');
  const [isPending, startTransition] = useTransition();
  return (
    <>
      <TabButton
        selected={tab === 'stats'}
        onClick={() => startTransition(() => setTab('stats'))}
        pending={isPending}
      />
      <Suspense fallback={<Spinner />}>{tab === 'posts' ? <Posts /> : <Stats />}</Suspense>
    </>
  );
}
```

Without the transition, switching to a tab that suspends replaces the current tab with the spinner. With it, React keeps the old tab visible (with `isPending` for a subtle indicator) until `Stats` is ready.

### What it doesn't do

- It doesn't make slow code faster; it keeps the UI **responsive** while slow rendering happens.
- It doesn't help with long tasks **outside** React rendering (a 300ms JSON parse in a handler still blocks).
- Controlled inputs must not be updated inside a transition (the input would lag).

### Suspense boundaries

Suspense catches components that "suspend" (throw a promise / use `use(promise)` / lazy components / Suspense-enabled data libraries) and shows the nearest fallback. Place boundaries to match **visual regions** that can load independently, not around every component. Nested boundaries reveal content progressively; on the server, they enable streaming HTML.

### Follow-ups

- **"Debounce vs `useDeferredValue`?"** Debounce delays work by a fixed time (good for network calls). Deferred values don't delay; they render as soon as possible but interruptibly (good for CPU-bound rendering). They solve different problems and combine well.
- **"How does React interrupt rendering?"** The work loop checks `shouldYield()` between fibers (≈5ms slices), yielding to the browser via a `MessageChannel` task; on the next slice it continues, or restarts if higher-priority updates arrived.

### References

- [React: useTransition](https://react.dev/reference/react/useTransition)
- [React: useDeferredValue](https://react.dev/reference/react/useDeferredValue)
- [React: Suspense](https://react.dev/reference/react/Suspense)

## React 19: Actions, `useActionState`, `useOptimistic`, `use` and form handling
<!--
id: react-19-actions
level: senior
tags: react 19, actions, useactionstate, useoptimistic, use, forms
minutes: 15
-->

> [!PROMPT]
> You are building a "rename project" form that should feel instant: show the new name immediately, disable the button while saving, roll back on error and show the server's validation message. Do it with React 19 features instead of manual `isLoading` state.
>
> **Cover**
> - Actions, `useActionState`, `useFormStatus` and `useOptimistic`: what each owns.
> - Behavior on error and on overlapping submissions.
> - Where `use()` fits for reading promises, and what still needs a library (caching, retries).

> [!TLDR]
> React 19 makes async state transitions first-class. An **Action** is an async function run in a transition; React tracks its pending state, errors and ordering. `useActionState` wraps an action and gives you `[state, dispatch, isPending]`. `<form action={fn}>` submits through an action (and works with Server Functions for progressive enhancement). `useOptimistic` shows a temporary value while the action runs and reverts automatically. `use(promise)` reads a promise inside render with Suspense. `ref` is now a normal prop.

### A form with `useActionState`

```tsx
type SaveState = { status: 'idle' } | { status: 'error'; message: string } | { status: 'saved'; at: number };

async function saveProfile(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { status: 'error', message: 'Name must be at least 2 characters.' };
  const response = await fetch('/api/profile', { method: 'PUT', body: JSON.stringify({ name }) });
  if (!response.ok) return { status: 'error', message: 'Could not save. Try again.' };
  return { status: 'saved', at: Date.now() };
}

function ProfileForm({ defaultName }: { defaultName: string }) {
  const [state, formAction, isPending] = useActionState(saveProfile, { status: 'idle' });
  return (
    <form action={formAction}>
      <label htmlFor="name">Name</label>
      <input id="name" name="name" defaultValue={defaultName} aria-describedby="name-msg" />
      <SubmitButton />
      <p id="name-msg" role="status">
        {state.status === 'error' ? state.message : state.status === 'saved' ? 'Saved.' : ''}
      </p>
      {isPending ? <span className="sr-only">Saving…</span> : null}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus(); // reads the parent <form>'s status, no prop drilling
  return <button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>;
}
```

Note: by default React **resets uncontrolled form fields** after a successful action submission, which is great for "add comment" forms and surprising for edit forms (use `defaultValue` from returned state, or controlled inputs).

### Optimistic updates

```tsx
function Likes({ postId, likes }: { postId: string; likes: number }) {
  const [optimisticLikes, addOptimistic] = useOptimistic(likes, (current, delta: number) => current + delta);
  async function like() {
    addOptimistic(1);              // shown immediately
    await api.like(postId);        // when the action finishes, React re-renders from real `likes`
  }
  return (
    <form action={like}>
      <button>♥ {optimisticLikes}</button>
    </form>
  );
}
```

If the request fails, the optimistic value disappears when the transition ends; you still need to show an error (an error boundary catches thrown action errors, or return error state).

### `use`

```tsx
function Comments({ commentsPromise }: { commentsPromise: Promise<Comment[]> }) {
  const comments = use(commentsPromise); // suspends until resolved; can be called conditionally
  return <ul>{comments.map((c) => <li key={c.id}>{c.text}</li>)}</ul>;
}
```

The promise must be **stable** (created outside render, cached, or passed from a Server Component); creating it inside the component re-creates it every render and suspends forever.

### Other changes worth knowing

- `ref` as a prop for function components; ref callbacks can return a cleanup.
- `<Context>` can be rendered directly as a provider.
- Document metadata (`<title>`, `<meta>`, `<link>`) can be rendered anywhere and hoisted to `<head>`.
- Resource preloading APIs: `preload`, `preinit`, `preconnect`.
- Better hydration error messages, and support for third-party scripts/extensions that mutate the DOM.

### Follow-ups

- **"How do Actions differ from just calling an async function in onClick?"** Actions run in transitions: React tracks pending state, keeps UI responsive, sequences multiple submissions, integrates with Suspense/error boundaries and with server functions. A plain async handler gives you none of that unless you build it.
- **"Would you still use react-hook-form?"** For complex client-side validation, field arrays and dirty tracking, yes; it can submit through an action. For simple forms, `useActionState` + native validation is enough.

### References

- [React 19 release post](https://react.dev/blog/2024/12/05/react-19)
- [React: useActionState](https://react.dev/reference/react/useActionState)
- [React: useOptimistic](https://react.dev/reference/react/useOptimistic)
- [React: use](https://react.dev/reference/react/use)

## React Server Components: the mental model, the boundaries and the costs
<!--
id: react-server-components
level: lead
tags: rsc, server components, next.js, streaming, use client
minutes: 20
-->

> [!PROMPT]
> Your team is deciding whether to adopt React Server Components for a dashboard with mostly read-only data and a few interactive widgets. Explain the model so the team can decide.
>
> **Cover**
> - What runs where, the `"use client"` boundary and what can cross it (serializable props only).
> - Benefits (bundle size, data access near the source) and costs (mental model, caching, waterfalls, testing, hosting).
> - A boundary design for the dashboard, and the mistakes you've seen (client component at the root, passing functions).

> [!TLDR]
> Server Components run **only on the server** (at build or request time). They can read data directly (DB, internal services), and their code never ships to the browser; they send a serialized UI description (the RSC payload). Client Components (`'use client'`) are ordinary React components that hydrate and handle interactivity. The boundary is a module boundary: props crossing it must be serializable. Benefits: less JS, no client waterfalls for data, secrets stay on the server. Costs: a new mental model, framework coupling, caching complexity and a network round trip for server-driven updates.

### The model

```text
Request → server renders Server Components (async, can await data)
        → output: RSC payload (tree with placeholders for Client Components + their props)
        → streamed to the browser alongside HTML (SSR of the same tree)
Browser → renders HTML immediately, loads JS only for Client Components, hydrates them
Navigation → fetches a new RSC payload, React merges it, client state is preserved
```

### Composition rules

```tsx
// app/products/[id]/page.tsx (Server Component by default)
import { AddToCart } from './add-to-cart'; // client component

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await db.product.findUnique({ where: { id } }); // direct data access, no API hop
  if (!product) notFound();
  return (
    <article>
      <h1>{product.name}</h1>
      <Price amount={product.price} />                 {/* server-only, zero JS */}
      <AddToCart productId={product.id} />             {/* ships JS, hydrates */}
      <Suspense fallback={<ReviewsSkeleton />}>
        <Reviews productId={product.id} />             {/* streams in when ready */}
      </Suspense>
    </article>
  );
}
```

```tsx
// add-to-cart.tsx
'use client';
export function AddToCart({ productId }: { productId: string }) {
  const [pending, startTransition] = useTransition();
  return <button disabled={pending} onClick={() => startTransition(() => addToCart(productId))}>Add</button>;
}
```

- Server Components can render Client Components and pass **serializable props** (no functions, except Server Functions).
- Client Components **cannot import** Server Components, but can receive them as `children`/props from a Server parent. That's how you keep big server-rendered trees inside a client layout.
- `'use client'` marks an **entry point**: everything that module imports becomes client code. Put the directive as low in the tree as possible.

### What you gain

- **Bundle size**: markdown renderers, date libraries, syntax highlighters used only for rendering stay on the server.
- **Data fetching close to the source**, in parallel, without client → API → DB waterfalls.
- **Security**: tokens and queries never reach the client (still validate everything in Server Functions; they're public endpoints).

### What it costs

- Two kinds of components and a boundary to reason about; mistakes leak server code or bloat the client.
- **Caching semantics** (framework-specific: per-request memoization, data cache, full route cache) are a common source of "why is this stale?" bugs.
- Interactions that need server data require a round trip (Server Function or refetch), which is slower than a local state update.
- Tight coupling to a framework/bundler (Next.js App Router, React Router/Waku/Parcel integrations).

> [!PRINCIPAL]
> Adopt RSC where content dominates and interactivity is islands (e-commerce, docs, marketing, dashboards with read-heavy views). For highly interactive apps (editors, design tools, complex consoles), the win is smaller; a SPA with good code splitting and a solid data layer may be simpler. Decide per product surface, and measure: JS bytes, LCP, INP, and server cost.

### Follow-ups

- **"Server Components vs SSR?"** SSR renders client components to HTML for the first paint, then hydrates *all* of them. RSC changes which components exist on the client at all. They complement each other.
- **"Can a Server Component use state or effects?"** No: no hooks that depend on client lifecycle, no browser APIs, no event handlers.
- **"How do mutations work?"** Server Functions (`'use server'`) called from forms/actions; then revalidate the affected data/route so the server tree re-renders.

### References

- [React: Server Components](https://react.dev/reference/rsc/server-components)
- [React: 'use client'](https://react.dev/reference/rsc/use-client)
- [Next.js: Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)

## `useSyncExternalStore`, tearing, and how state libraries integrate with concurrent React
<!--
id: external-stores-tearing
level: lead
tags: usesyncexternalstore, tearing, zustand, redux, concurrent rendering
minutes: 12
-->

> [!PROMPT]
> A homegrown store works fine in React 17 but shows inconsistent numbers in two parts of the screen under React 18 transitions. Explain the bug and how `useSyncExternalStore` fixes it.
>
> **Cover**
> - What tearing is and why interruptible rendering makes it possible.
> - The `subscribe` and `getSnapshot` contract (stable snapshots, no new object per call) and the infinite-loop trap.
> - How Redux, Zustand or Jotai integrate, and when you'd skip an external store entirely.

> [!TLDR]
> **Tearing** is when one render shows inconsistent values from an external store because the store changed mid-render (possible once rendering is interruptible). `useSyncExternalStore(subscribe, getSnapshot)` fixes it: React reads a snapshot, and if it changed during a concurrent render, re-renders synchronously so the whole UI shows one version. Rules: `subscribe` must be stable, `getSnapshot` must return the **same reference** when nothing changed, and selectors must not create new objects each call.

### Minimal store + hook

```ts
type Listener = () => void;

export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    setState(update: (prev: T) => T) {
      const next = update(state);
      if (Object.is(next, state)) return;
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T, S>(store: ReturnType<typeof createStore<T>>, selector: (state: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()), // server snapshot for SSR
  );
}
```

> [!NOTE]
> This app (the one you're reading this in) uses exactly this pattern for progress, preferences and routing. Its source is in `src/state/createStore.ts` and `useStore.ts`.

### The infinite-loop trap

```ts
const todos = useStore(store, (s) => s.todos.filter((t) => !t.done)); // new array every call → loops
```

`getSnapshot` returning a new reference each time tells React the store changed every time it checks. Fix by selecting a stable slice and deriving with `useMemo`, or by memoizing the selector on its input (what `reselect` and Zustand's `useShallow` help with).

### Why not `useState` + `useEffect` subscription?

The old pattern subscribes after paint (missing updates in between), causes an extra render, and can tear under concurrent rendering. `useSyncExternalStore` is what Redux, Zustand, Jotai and React Query use internally now.

### Trade-off

Updates from external stores are always **synchronous** (they de-opt transitions): you can't make a store update non-blocking with `startTransition`. If you need that, keep the state in React (`useState`/`useReducer`) or in a library designed around transitions.

### References

- [React: useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)
- [React 18 working group: what is tearing?](https://github.com/reactwg/react-18/discussions/69)

## What does the React Compiler change about `useMemo`, `useCallback` and how you write components?
<!--
id: react-compiler-memoization
level: lead
tags: react compiler, memoization, usememo, usecallback, rules of react
minutes: 10
-->

> [!PROMPT]
> Your codebase has hundreds of `useMemo` and `useCallback` calls, some wrong. The team is considering turning on the React Compiler. What changes, and what do you do on day one?
>
> **Cover**
> - What the compiler memoizes, and what it refuses to compile (rules of React violations).
> - How you adopt it incrementally (directives, ESLint plugin, measuring) and what you stop writing.
> - Where manual memoization remains justified, and how to confirm the compiler actually helped.

> [!TLDR]
> The React Compiler is a build-time plugin that analyzes components and hooks and inserts fine-grained memoization automatically: values, callbacks and JSX are cached per their actual dependencies. It makes most manual `useMemo`/`useCallback`/`memo` unnecessary, but only for code that follows the **Rules of React** (pure render, no mutation of props/state, hooks rules). Code it can't prove safe is skipped, so adoption starts with fixing lint violations.

### What it does

```tsx
// You write:
function TodoList({ todos, filter }: { todos: Todo[]; filter: Filter }) {
  const visible = todos.filter((t) => matches(t, filter));
  const onToggle = (id: string) => toggle(id);
  return <List items={visible} onToggle={onToggle} />;
}
// The compiler emits roughly: cache `visible` keyed on [todos, filter], cache `onToggle`,
// and cache the <List> element itself so List doesn't re-render when nothing it uses changed.
```

It memoizes at a finer granularity than you would by hand (including JSX elements), and it doesn't forget a dependency.

### What still matters

- **Purity**: mutating objects during render, reading refs during render, or side effects in render make the compiler bail out (or worse, produce wrong UI if the code was already buggy).
- **Effects** remain your responsibility: the compiler doesn't remove unnecessary effects or fix dependency logic.
- **Architecture** (state colocation, splitting contexts, virtualization) still dominates performance.
- **Escape hatches**: `'use no memo'` directive to opt a component out while debugging.

### Adoption plan for a large codebase

1. Enable `eslint-plugin-react-hooks` compiler-related rules everywhere; fix violations.
2. Turn the compiler on for one directory/package (`sources` filter or annotation mode).
3. Compare React DevTools profiles and E2E tests; watch for behavior changes in code that relied on re-rendering.
4. Expand gradually; delete manual memoization only when the compiler covers that code.

### Follow-ups

- **"Should I remove all `useMemo` calls?"** Not blindly. They're harmless with the compiler; remove them opportunistically. Keep memoization that exists for **semantic** reasons (stable identity for an effect dependency or an external API), and document it.
- **"Does it replace `React.memo`?"** Effectively, for compiled components: children receive stable props and cached elements, so they skip re-rendering.

### References

- [React: React Compiler](https://react.dev/learn/react-compiler)
- [React: Rules of React](https://react.dev/reference/rules)

## Stale closures in hooks: how do you diagnose and fix them?
<!--
id: stale-closures-hooks
level: senior
tags: closures, hooks, useref, functional updates, useeffectevent
minutes: 12
-->

> [!PROMPT]
> A counter shows the right number but a `setInterval` callback inside `useEffect` always logs `0`, and a "Save" button sometimes saves the previous form values. Diagnose both and give the fixes.
>
> **Cover**
> - Why every render closes over its own props and state.
> - Fixes: functional updates, correct dependency arrays, refs for the latest value, effect events (`useEffectEvent`), or restructuring.
> - How to spot these bugs in review, and what the exhaustive-deps lint rule can and cannot tell you.

> [!TLDR]
> Every render creates new functions that close over **that render's** props and state. A callback created in an earlier render and called later (by a timer, subscription, or memoized handler) sees old values. Fix it by putting the value in the dependency list (re-creating the callback), using **functional updates** (`setCount(c => c + 1)`) so you don't need the value at all, reading from a **ref** that always holds the latest value, or using `useEffectEvent` for effect logic that must see fresh values without re-subscribing.

### The bug

```tsx
function Timer() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount(count + 1), 1000); // `count` is always 0 here
    return () => clearInterval(id);
  }, []); // lint warning ignored
  return <p>{count}</p>; // shows 1 forever
}
```

### Fixes, from best to most situational

```tsx
// 1. Functional update: the callback doesn't need `count` at all.
useEffect(() => {
  const id = setInterval(() => setCount((c) => c + 1), 1000);
  return () => clearInterval(id);
}, []);

// 2. Include the dependency: correct but re-creates the interval every tick.
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);
  return () => clearInterval(id);
}, [count]);

// 3. Effect event: read latest props/state inside an effect without making them dependencies.
function ChatRoom({ roomId, theme }: { roomId: string; theme: Theme }) {
  const onConnected = useEffectEvent(() => showToast('Connected', theme)); // always latest theme
  useEffect(() => {
    const connection = connect(roomId);
    connection.on('connected', onConnected);
    return () => connection.disconnect();
  }, [roomId]); // reconnect only when the room changes, not when the theme does
}

// 4. Latest-value ref (pre-useEffectEvent pattern).
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
```

### How to spot them

- A value "freezes" at its initial value inside a timer, socket handler or `addEventListener` callback.
- `useCallback(fn, [])` that reads state.
- An `// eslint-disable-next-line react-hooks/exhaustive-deps` comment nearby. Treat that comment as a bug report.

### Follow-ups

- **"Why not just use refs for everything?"** Refs don't trigger renders and bypass React's data flow; overusing them recreates the mutable-state bugs hooks were designed to avoid. Use them for values read in callbacks, not for values rendered.
- **"Is this a React problem?"** It's a JavaScript closure property. Class components had the inverse problem: `this.props` was always latest, even when you wanted the values from the render where the event happened.

### References

- [React: useEffectEvent](https://react.dev/reference/react/useEffectEvent)
- [React: Removing effect dependencies](https://react.dev/learn/removing-effect-dependencies)
- [Dan Abramov: Making setInterval declarative with React hooks](https://overreacted.io/making-setinterval-declarative-with-react-hooks/)
