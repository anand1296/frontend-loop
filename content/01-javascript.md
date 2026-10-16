---
id: javascript-internals
title: JavaScript Internals
description: The runtime model under every framework: event loop, closures and memory, this, prototypes, modules, and the meta-programming APIs.
---

## Walk through the event loop: tasks, microtasks, and where rendering fits
<!--
id: event-loop-rendering-order
level: senior
tags: event loop, microtasks, rendering, requestAnimationFrame, long tasks
minutes: 15
-->

> [!TLDR]
> The browser runs one **task** at a time (a script, a click handler, a timer callback). After each task it drains the **microtask queue** completely (promise reactions, `queueMicrotask`, `MutationObserver`). Then, roughly every frame, it may **render**: run `requestAnimationFrame` callbacks, recalculate style, layout, paint. Rendering can only happen *between* tasks, so a long task or an endless microtask chain blocks paint and input.

### What the interviewer is testing

Not the trivia of print order. They want to know whether you can explain *why* the UI freezes, why a spinner doesn't show, or why `setTimeout(fn, 0)` "fixes" a bug. Lead with the model, then use the puzzle to prove it.

### The model

```text
┌──────────── one turn of the event loop ─────────────┐
│ 1. pick ONE task (oldest from a chosen task queue)   │
│ 2. run it to completion (call stack empties)         │
│ 3. drain ALL microtasks (including ones they queue)  │
│ 4. if it's time for a frame (≈16.7ms @60Hz):         │
│      rAF callbacks → style → layout → paint          │
│      (+ ResizeObserver, IntersectionObserver)        │
│ 5. idle time? requestIdleCallback                    │
└──────────────────────────────────────────────────────┘
```

Key consequences:

- **Microtasks run before rendering.** Ten thousand chained `.then()`s run back-to-back with no paint in between.
- **Tasks yield to rendering.** `setTimeout(fn, 0)` gives the browser a chance to paint before `fn` runs (not guaranteed, but possible).
- **`requestAnimationFrame` runs right before paint**, so it is where you read the frame's final layout and write animated styles.
- There are multiple task queues (user input, timers, network). Browsers may prioritize input, which is why `setTimeout` order relative to clicks is not something to rely on.

### The classic puzzle

```js
console.log('1 sync');
setTimeout(() => console.log('2 timeout'), 0);
Promise.resolve().then(() => console.log('3 microtask'));
queueMicrotask(() => console.log('4 microtask'));
requestAnimationFrame(() => console.log('5 rAF'));
(async () => {
  console.log('6 async fn body (sync part)');
  await null;
  console.log('7 after await (microtask)');
})();
console.log('8 sync');
```

Output: `1, 6, 8, 3, 4, 7, 2, 5` in most runs, but **2 and 5 can swap**. The timer is a task; rAF is part of the rendering step, and whether a frame is due before the timer task gets picked depends on timing. Saying "it depends, and here's why" is the senior answer.

### Why the spinner doesn't show

```ts
function onSubmit() {
  setLoading(true);            // React schedules a render
  const result = heavySyncWork(); // 400ms on the main thread
  setLoading(false);
}
```

No frame can be painted until the handler returns, so the user never sees `loading === true`. Fixes, in order of preference: move the work off the main thread (Web Worker), split it into chunks and **yield** between them, or at minimum defer the heavy part so a frame can paint first.

```ts
// Yield to the browser so input and paint can happen between chunks.
function yieldToMain(): Promise<void> {
  if ('scheduler' in globalThis && 'yield' in scheduler) {
    return scheduler.yield(); // continuation keeps priority over other tasks
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function processInChunks<T>(items: T[], work: (item: T) => void, budgetMs = 8) {
  let deadline = performance.now() + budgetMs;
  for (const item of items) {
    work(item);
    if (performance.now() >= deadline) {
      await yieldToMain();
      deadline = performance.now() + budgetMs;
    }
  }
}
```

> [!WARNING]
> Yielding with `await Promise.resolve()` does **not** yield to the browser. It queues a microtask, and microtasks are drained before rendering. You need a task boundary (`setTimeout`, `MessageChannel`, `scheduler.yield()`).

### Edge cases worth naming

- **Microtask starvation:** a recursive `queueMicrotask` loop freezes the page as hard as `while (true)`.
- **Timers are clamped:** nested timers get a minimum of ~4ms, and background tabs are throttled to 1s or more. Never build clocks on `setTimeout` accuracy.
- **`await` always defers**, even when awaiting a non-promise. Code after `await` runs in a microtask.
- **Node.js differs**: `process.nextTick` runs before promise microtasks, and phases (timers, poll, check) replace the rendering step.

### Follow-ups

- **"How does React fit in?"** React's scheduler uses `MessageChannel` tasks to time-slice concurrent renders and yields every ~5ms, so input can be handled between slices. Synchronous updates (e.g. discrete events like clicks in some paths) flush without yielding.
- **"What's a long task?"** Any task over 50ms. The Long Animation Frames API (LoAF) attributes slow frames to scripts, which is what you use to debug INP.
- **"Where do `IntersectionObserver` callbacks run?"** During the rendering steps, after layout, so they're batched per frame rather than per scroll event.

### References

- [Jake Archibald: Tasks, microtasks, queues and schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/)
- [HTML spec: event loops](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops)
- [web.dev: Optimize long tasks](https://web.dev/articles/optimize-long-tasks)
- [MDN: Microtask guide](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide)

## How do closures cause memory leaks in a long-lived SPA, and how do you find them?
<!--
id: closures-memory-leaks
level: senior
tags: closures, memory, garbage collection, devtools, heap snapshot
minutes: 15
-->

> [!TLDR]
> A closure keeps its whole scope reachable for as long as the function itself is reachable. Leaks happen when something long-lived (a global listener, a timer, a module-level cache, a subscription) holds a function that captured something large, often a detached DOM tree or an old component's state. Find them with heap snapshots (compare before/after a repeated action, look for "Detached" nodes and growing retainers) and fix them by giving every subscription an owner and a cleanup.

### Mental model

The garbage collector frees objects that are unreachable from roots (globals, the stack, active handles). A function object references its **lexical environment**. So:

```text
window ──listeners──▶ onResize (function) ──scope──▶ { bigTable, rowsCache, chartInstance }
```

As long as `window` holds `onResize`, everything in its scope is alive, even if the component that created it unmounted an hour ago.

> [!NOTE]
> Engines share one context object per scope among all closures created in it. If two inner functions are created in the same scope and only one uses `hugeArray`, the long-lived one may still keep `hugeArray` alive. Keep long-lived callbacks in small scopes.

### The usual suspects in SPAs

| Leak | Why it leaks | Fix |
| --- | --- | --- |
| `addEventListener` on `window`/`document` without removal | Target outlives component | Remove in cleanup, or pass `{ signal }` and abort |
| `setInterval` / recursive `setTimeout` | Timer handle is a root | `clearInterval` in cleanup |
| Subscriptions (stores, sockets, observers) | Emitter holds the callback | Call unsubscribe / `disconnect()` |
| Module-level caches (`Map` keyed by object) | Map holds keys strongly | `WeakMap`, or bounded LRU |
| Detached DOM kept in variables/closures | JS reference keeps the tree | Null out refs, don't cache nodes globally |
| Closures stored on long-lived objects (`window.__debug = () => state`) | Global root | Don't, or gate to dev |
| Unresolved promises chained to big data | Pending reaction keeps scope | Abort and settle requests |

### A cleanup pattern that scales: `AbortController` as an owner

```ts
function useWindowEvent<K extends keyof WindowEventMap>(
  type: K,
  handler: (event: WindowEventMap[K]) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler; // always call the latest without re-subscribing

  useEffect(() => {
    const controller = new AbortController();
    window.addEventListener(type, (event) => handlerRef.current(event), { signal: controller.signal });
    return () => controller.abort(); // one call removes every listener tied to this signal
  }, [type]);
}
```

One signal can own many listeners, fetches and custom subscriptions, so "tear down everything this feature created" becomes a single `abort()`.

### How to find a leak (a workflow you can describe)

1. **Reproduce with a loop.** Pick an action that should be memory-neutral: open and close a modal, navigate A → B → A. Do it 10 times.
2. **Heap snapshot before and after** (DevTools → Memory). Force GC first (the trash-can button).
3. **Compare view**: sort by "# Delta" or "Size Delta". Things growing by exactly 10 are your suspects.
4. **Search "Detached"** to find DOM trees no longer in the document but still referenced.
5. **Read the Retainers panel** bottom-up: it shows the chain from a GC root to the object, e.g. `Window → listeners → closure → context → table`.
6. Confirm the fix with the same loop and a flat memory line in the **Performance monitor** or the allocation timeline.

In production, watch `performance.measureUserAgentSpecificMemory()` (cross-origin isolated pages only) or RUM metrics like JS heap size trends per session length.

> [!WARNING]
> React's StrictMode double-invocation catches missing cleanups early. Turning StrictMode off to "fix" double subscriptions hides exactly these leaks.

### Follow-ups

- **"Does React leak if I forget to clean up?"** React drops its references to unmounted fibers, but it cannot remove a listener *you* attached to `window`. That listener keeps the closure, and the closure keeps the state and DOM refs it captured.
- **"WeakMap vs WeakRef here?"** `WeakMap` for associating data with objects you don't own (no leak through the key). `WeakRef` rarely: caches where you can tolerate the value disappearing at any time.
- **"How would you catch regressions?"** A Playwright/Puppeteer test that repeats a flow and asserts `JSHeapUsedSize` (via CDP `Performance.getMetrics`) stays within a band; tools like `memlab` automate the detached-node analysis.

### References

- [Chrome DevTools: Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems)
- [MDN: Memory management](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Memory_management)
- [memlab (Meta)](https://facebook.github.io/memlab/)

## Explain `this` binding precisely, including arrow functions and class fields
<!--
id: this-binding-rules
level: senior
tags: this, arrow functions, classes, bind
minutes: 10
-->

> [!TLDR]
> `this` is decided by **how a function is called**, not where it is defined, except for arrow functions, which have no `this` of their own and use the enclosing scope's. The precedence is: `new` > explicit (`call`/`apply`/`bind`) > method call (`obj.fn()`) > default (`undefined` in strict mode/modules, `globalThis` in sloppy scripts). Class field arrow functions capture the instance at construction time.

### The four call-site rules

```js
'use strict';
function who() { return this; }

who();                       // undefined          (default binding)
const obj = { who };
obj.who();                   // obj                (implicit / method call)
who.call({ id: 1 });         // { id: 1 }          (explicit)
const bound = who.bind({ id: 2 });
bound.call({ id: 3 });       // { id: 2 }          (bind wins over call)
new who();                   // fresh object       (new wins over bind's this)
```

### Losing `this`: the bug you will see in reviews

```ts
class Counter {
  count = 0;
  increment() {
    this.count++;
  }
}
const c = new Counter();
button.addEventListener('click', c.increment); // `this` is the button (DOM calls it as a method of the target)
setTimeout(c.increment, 10);                   // `this` is undefined in strict code → TypeError
```

Three fixes and their trade-offs:

```ts
class Counter {
  count = 0;

  // 1. Arrow class field: bound per instance. Easy, but one function per instance,
  //    not on the prototype (can't be overridden via super, slightly more memory).
  incrementField = () => {
    this.count++;
  };

  // 2. Prototype method, bind at the call site when passing it around.
  increment() {
    this.count++;
  }
}

const c = new Counter();
setTimeout(() => c.increment(), 10); // 3. Wrap in an arrow at the call site (most explicit)
```

### Arrow functions

- No own `this`, `arguments`, `super` or `new.target`; all resolved lexically.
- `call`/`bind` cannot change an arrow's `this`.
- Don't use arrows as object methods that need the object: `{ name: 'a', greet: () => this.name }` reads the outer `this`.

### Edge cases

- **Callbacks with a `thisArg`**: `arr.map(fn, thisArg)` sets `this` for non-arrow `fn`.
- **Getters/setters** get the receiver (`obj` in `obj.prop`), which matters with prototype chains and `Proxy`/`Reflect.get(target, key, receiver)`.
- **Modules and classes are strict**, so default binding gives `undefined`, not `window`.
- **DOM `on*` attributes** (`onclick="..."`) bind `this` to the element.

### Follow-ups

- **"Why did React class components need `this.handleClick = this.handleClick.bind(this)`?"** JSX passes the method as a plain function reference, so the call site loses the instance. Function components and hooks removed the problem by not using `this` at all.
- **"Implement `bind`."** Return a function that calls the original with the fixed `this` and pre-filled arguments. Variadic tuple types let TypeScript infer the remaining parameters. A spec-complete polyfill also handles `new` (when `new.target` is set, construct instead of calling), which you can mention rather than write.

```ts
function myBind<T, A extends unknown[], B extends unknown[], R>(
  fn: (this: T, ...args: [...A, ...B]) => R,
  thisArg: T,
  ...bound: A
): (...rest: B) => R {
  return (...rest) => fn.apply(thisArg, [...bound, ...rest]);
}

function greet(this: { name: string }, greeting: string, punctuation: string) {
  return `${greeting}, ${this.name}${punctuation}`;
}
const hello = myBind(greet, { name: 'Ada' }, 'Hello'); // (punctuation: string) => string
hello('!'); // "Hello, Ada!"
```

### References

- [MDN: this](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this)
- [MDN: Arrow functions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions)

## How do prototypes, classes and private fields actually work under the hood?
<!--
id: prototypes-classes-private
level: senior
tags: prototypes, classes, private fields, inheritance
minutes: 12
-->

> [!TLDR]
> Every object has an internal `[[Prototype]]` link; property lookups walk that chain. `class` is mostly syntax over constructor functions and `prototype` objects, with real differences: classes are strict, must be called with `new`, have `super`/`[[HomeObject]]` semantics, and `#private` fields are stored per-instance in a way that is truly inaccessible from outside (not just by convention) and checked by a "brand" (`#x in obj`).

### The lookup chain

```js
class Animal {
  constructor(name) { this.name = name; }
  speak() { return `${this.name} makes a sound`; }
}
class Dog extends Animal {
  speak() { return `${super.speak()} (woof)`; }
}
const rex = new Dog('Rex');

Object.getPrototypeOf(rex) === Dog.prototype;                // true
Object.getPrototypeOf(Dog.prototype) === Animal.prototype;   // true
Object.getPrototypeOf(Dog) === Animal;                       // true: static inheritance too
rex.hasOwnProperty('name');                                  // true  (own)
rex.hasOwnProperty('speak');                                 // false (on Dog.prototype)
```

`rex.speak()` finds `speak` on `Dog.prototype`, calls it with `this = rex`. `super.speak()` looks up `speak` starting from the **home object's** prototype (`Animal.prototype`), not from `this`, which is why `super` works even when methods are borrowed.

### What `new` does

1. Create an object whose `[[Prototype]]` is `Constructor.prototype`.
2. Run the constructor with `this` bound to it. (In derived classes, `this` doesn't exist until `super()` returns; the base constructor creates it.)
3. Initialize class fields (base fields after base constructor starts, derived fields right after `super()` returns).
4. Return the object, unless the constructor explicitly returns another object.

### Private fields are not properties

```ts
class Account {
  #balance = 0;
  static isAccount(value: unknown): boolean {
    return typeof value === 'object' && value !== null && #balance in value;
  }
  deposit(amount: number) {
    this.#balance += amount;
  }
}
```

- `#balance` isn't on the prototype or visible via `Object.keys`, `JSON.stringify`, `Reflect.ownKeys` or a `Proxy`.
- Accessing `#balance` on an object without it throws a `TypeError` (brand check). `#balance in obj` tests safely.
- A `Proxy` around an instance breaks private access: the method runs with `this = proxy`, which lacks the brand. This is a real gotcha for reactivity libraries.
- TypeScript's `private` keyword is compile-time only; at runtime it's an ordinary property.

### Composition over deep inheritance

In UI code, deep class hierarchies age badly: changing a base class ripples through every subclass. Prefer small objects composed together, or plain functions plus data. Inheritance is fine for one level (e.g. `class ApiError extends Error`).

```ts
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ApiError';
  }
}
```

> [!WARNING]
> The constructor shorthand `readonly status: number` (a parameter property) is TypeScript-only emit. Projects using `erasableSyntaxOnly` or Node's type stripping forbid it. Assign fields explicitly in those codebases.

### Follow-ups

- **"Why is `instanceof` unreliable across iframes or duplicated packages?"** It checks the prototype chain against one specific `Constructor.prototype`. Two copies of a library mean two different prototypes. Use brand checks, `Symbol.for` tags, or `Array.isArray`-style helpers.
- **"`Object.create(null)` — why?"** A dictionary with no prototype, so keys like `__proto__` or `constructor` can't collide or pollute. `Map` is usually better.
- **"What is prototype pollution?"** Writing to `Object.prototype` through unsafe deep merges (`merge(target, JSON.parse('{"__proto__":{"isAdmin":true}}'))`). Guard merges against `__proto__`, `constructor`, `prototype` keys.

### References

- [MDN: Inheritance and the prototype chain](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Inheritance_and_the_prototype_chain)
- [MDN: Private properties](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_properties)

## ESM vs CommonJS: live bindings, cycles, tree shaking and interop
<!--
id: esm-vs-commonjs
level: lead
tags: modules, esm, commonjs, tree shaking, bundlers
minutes: 15
-->

> [!TLDR]
> ES modules are **static** (imports/exports known before execution), **asynchronous to load**, and export **live bindings**. CommonJS is dynamic: `require` runs the module synchronously and returns a snapshot of `module.exports`. Static structure is what makes tree shaking, top-level `await` and reliable cycle handling possible. Interop pain (default vs named exports, dual packages) comes from mapping one model onto the other.

### Side-by-side

| | ESM | CommonJS |
| --- | --- | --- |
| Syntax | `import`/`export` | `require`/`module.exports` |
| Resolution | Static, before running | At runtime, can be conditional |
| Exports | Live bindings (read-only views) | Values copied at `require` time |
| Loading | Async graph (fetch, link, evaluate) | Sync, in order |
| Top-level `await` | Yes | No |
| `this` at top level | `undefined` | `module.exports` |
| Tree shaking | Reliable | Heuristic at best |

### Live bindings in one example

```js
// counter.mjs
export let count = 0;
export function increment() { count++; }

// main.mjs
import { count, increment } from './counter.mjs';
increment();
console.log(count); // 1  (live view of the exporter's variable)
count = 5;          // TypeError: assignment to constant variable (imports are read-only)
```

With CommonJS, `const { count } = require('./counter')` copies `0` and never sees updates.

### Cycles

ESM links the whole graph first, so in a cycle a module can reference an import that exists but **hasn't been initialized yet** (TDZ error for `let`/`const`/`class`; `function` declarations are hoisted and work). CommonJS returns the *partially filled* `module.exports` of the module still executing, often giving you `undefined` fields.

Practical rule for app code: cycles are a design smell. Lint them (`import/no-cycle`, or madge/dependency-cruiser) and break them by extracting shared types/constants into a leaf module.

### Why tree shaking needs ESM

The bundler can see that `import { debounce } from 'lodash-es'` only uses `debounce` without running anything. It fails when:

- the package ships CommonJS (`lodash` vs `lodash-es`),
- modules have **side effects** at import time (polyfills, CSS imports, registering globals) and the package doesn't declare `"sideEffects": false` in `package.json`,
- you import a namespace and use it dynamically (`utils[name]()`),
- barrel files re-export everything and some module in the chain has side effects, forcing the bundler to keep it.

```json
{
  "name": "@acme/ui",
  "type": "module",
  "sideEffects": ["**/*.css"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./button": { "types": "./dist/button.d.ts", "import": "./dist/button.js" }
  }
}
```

### Interop gotchas

- `import x from 'cjs-pkg'` gives you `module.exports`; named imports work only if the bundler/Node can statically detect them.
- The `__esModule` flag hack: transpiled ESM-as-CJS marks itself so default imports map to `exports.default`. Mixed toolchains disagree about it, causing `x.default.default`.
- **Dual package hazard:** a package shipping both CJS and ESM can be loaded twice (once per format), giving two copies of singletons (two React contexts, two stores).
- Node ≥ 22 can `require()` synchronous ESM graphs, which removes some friction but not the semantic differences.

> [!PRINCIPAL]
> For an internal design system: ship ESM only, one entry per component via `exports`, mark `sideEffects`, keep CSS imports explicit, and build a size check in CI (`size-limit`) per entry point. That makes "importing one Button pulls in the whole library" a failing test, not a surprise in production.

### Follow-ups

- **"Why are barrel files bad?"** They're not inherently bad, but they force bundlers and test runners to parse and evaluate many modules to find one export, slow down dev servers (more modules per request) and defeat tree shaking when anything has side effects.
- **"How does `import()` change things?"** It's an async split point: the bundler emits a separate chunk, the runtime fetches it on demand. Pair it with preloading on intent.

### References

- [MDN: JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [Node.js: Modules: ECMAScript modules](https://nodejs.org/api/esm.html)
- [webpack: Tree shaking](https://webpack.js.org/guides/tree-shaking/)

## Iterators, generators and async iterators: when do they earn their place in UI code?
<!--
id: iterators-generators-async
level: senior
tags: iterators, generators, async iterators, pagination, streams
minutes: 12
-->

> [!TLDR]
> An iterator is any object with `next()` returning `{ value, done }`; the iterable protocol (`[Symbol.iterator]`) lets `for...of`, spread and destructuring consume it. Generators are the easiest way to write iterators: they pause at `yield` and resume on demand, so they're **lazy**. Async iterators (`for await`) are the clean model for paginated APIs and streams. Use them when data is naturally sequential and possibly infinite; avoid them for ordinary arrays.

### Lazy pipelines

```ts
function* take<T>(source: Iterable<T>, n: number): Generator<T> {
  if (n <= 0) return;
  let i = 0;
  for (const item of source) {
    yield item;
    if (++i >= n) return; // return() closes the upstream iterator too
  }
}

function* filter<T>(source: Iterable<T>, predicate: (item: T) => boolean): Generator<T> {
  for (const item of source) if (predicate(item)) yield item;
}

function* naturals(): Generator<number> {
  let n = 0;
  while (true) yield n++;
}

const firstEvenSquares = [...take(filter(naturals(), (n) => n % 2 === 0), 3)]; // [0, 2, 4]
```

Modern engines also ship **iterator helpers** (`naturals().filter(...).take(3).toArray()`), which make this idiomatic without custom functions.

### Async iteration over a paginated API

```ts
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

async function* paginate<T>(
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>,
  signal: AbortSignal,
): AsyncGenerator<T> {
  let cursor: string | null = null;
  do {
    const page = await fetchPage(cursor, signal);
    yield* page.items;
    cursor = page.nextCursor;
  } while (cursor !== null && !signal.aborted);
}

// Consumer: export all rows without loading every page into memory at once.
for await (const row of paginate(fetchInvoices, controller.signal)) {
  writer.write(toCsvLine(row));
}
```

`break` inside `for await` calls the generator's `return()`, so cleanup in `finally` blocks runs. That's the property that makes iterators safe for resources.

### Streams are async iterables

```ts
const response = await fetch('/api/export');
if (!response.body) throw new Error('No body');
const decoder = new TextDecoder();
for await (const chunk of response.body) {
  appendText(decoder.decode(chunk, { stream: true }));
}
```

`ReadableStream` is async-iterable in modern browsers and Node; Safari added it later, so check support or use `getReader()` in a loop.

### When they don't earn their place

- A finite array you'll render anyway: use array methods. Generators add indirection and are harder to debug.
- State machines in React components: a reducer is clearer and serializable.
- Hot loops: iterator protocol overhead is real in tight numeric code.

### Follow-ups

- **"What happens if you call `next()` on a generator after it's done?"** You get `{ value: undefined, done: true }` forever.
- **"Generators and Redux-Saga?"** Sagas used generators to describe effects as data (testable without running them). Most teams have moved to RTK Query/React Query and thunks/listeners because the indirection cost outweighed the benefit.

### References

- [MDN: Iterators and generators](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Iterators_and_generators)
- [MDN: for await...of](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of)
- [MDN: Iterator helpers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator)

## WeakMap, WeakRef and FinalizationRegistry: what problems do they solve, and what are the traps?
<!--
id: weakmap-weakref-finalization
level: lead
tags: weakmap, weakref, garbage collection, caching
minutes: 10
-->

> [!TLDR]
> `WeakMap`/`WeakSet` hold keys weakly: attaching data to an object doesn't keep the object alive, and entries vanish with their keys. That's the right tool for metadata on objects you don't own. `WeakRef` lets you hold an object *without* keeping it alive, and `FinalizationRegistry` tells you (eventually, maybe) when it was collected. Those two are for rare caching/interop cases; GC timing is non-deterministic, so never put correctness on them.

### WeakMap: the everyday tool

```ts
// Memoize per object identity without leaking the object.
const layoutCache = new WeakMap<Element, DOMRect>();

function measure(element: Element): DOMRect {
  const cached = layoutCache.get(element);
  if (cached) return cached;
  const rect = element.getBoundingClientRect();
  layoutCache.set(element, rect);
  return rect;
}
```

When the element is removed and unreferenced, the cache entry goes too. With a `Map`, every element ever measured stays in memory forever.

Constraints: keys must be objects (or non-registered symbols), and WeakMaps are **not iterable** and have no `size`, by design: enumeration would expose GC timing.

### WeakRef + FinalizationRegistry: a cache that lets go

```ts
class WeakValueCache<K, V extends object> {
  #refs = new Map<K, WeakRef<V>>();
  #registry = new FinalizationRegistry<K>((key) => {
    const ref = this.#refs.get(key);
    // Only delete if the entry wasn't replaced by a newer, still-alive value.
    if (ref && ref.deref() === undefined) this.#refs.delete(key);
  });

  get(key: K): V | undefined {
    return this.#refs.get(key)?.deref();
  }

  set(key: K, value: V): void {
    this.#refs.set(key, new WeakRef(value));
    this.#registry.register(value, key);
  }
}
```

Use case: decoded images or parsed documents that are expensive to recreate, where you'd like to reuse them if they're still around but must not keep them alive.

### The traps

- **No timing guarantees.** Finalizers may run late, in batches, or never (e.g. on page unload). Don't release external resources (sockets, file handles) with them; use explicit `close()`/`dispose()`.
- **`deref()` can return the object within the same task and `undefined` in the next.** Engines keep targets alive until the end of the current job once deref'd, but code must still handle disappearance.
- **Accidental strong references** (closures, the registry's held value being the target itself) silently defeat the weakness.
- Explicit resource management (`using` / `Symbol.dispose`) is the deterministic alternative for cleanup, and is landing across runtimes and TypeScript.

### Follow-ups

- **"How do frameworks use WeakMap?"** Vue's reactivity keeps a `WeakMap<target, Map<key, Set<effect>>>` dependency map; libraries store per-element state for DOM nodes they don't own.
- **"Why can't I iterate a WeakMap to debug it?"** Because the set of live entries depends on GC, and exposing it would make programs non-deterministic.

### References

- [MDN: WeakMap](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap)
- [MDN: WeakRef](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef)
- [MDN: FinalizationRegistry](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry)

## Build a tiny reactive store with `Proxy`. What are the limits?
<!--
id: proxy-reactivity
level: lead
tags: proxy, reflect, reactivity, signals
minutes: 15
-->

> [!TLDR]
> A `Proxy` intercepts operations (`get`, `set`, `has`, `deleteProperty`...) on a target. Reactivity systems (Vue 3, MobX, Valtio) use the `get` trap to record which effect read which key, and the `set` trap to re-run those effects. It works well but has sharp edges: identity (`proxy !== target`), private fields, built-ins like `Map` and `Date` with internal slots, and performance on hot paths. Signals are the same idea with explicit getters instead of proxies.

### Implementation

```ts
type Effect = () => void;

const deps = new WeakMap<object, Map<PropertyKey, Set<Effect>>>();
const proxies = new WeakMap<object, object>();
let activeEffect: Effect | null = null;

function track(target: object, key: PropertyKey) {
  if (!activeEffect) return;
  let byKey = deps.get(target);
  if (!byKey) deps.set(target, (byKey = new Map()));
  let effects = byKey.get(key);
  if (!effects) byKey.set(key, (effects = new Set()));
  effects.add(activeEffect);
}

function trigger(target: object, key: PropertyKey) {
  const effects = deps.get(target)?.get(key);
  if (!effects) return;
  for (const effect of [...effects]) effect(); // copy: effects may re-subscribe while running
}

export function reactive<T extends object>(target: T): T {
  const existing = proxies.get(target);
  if (existing) return existing as T; // identity cache; see note below

  const proxy = new Proxy(target, {
    get(obj, key, receiver) {
      track(obj, key);
      const value = Reflect.get(obj, key, receiver);
      return typeof value === 'object' && value !== null ? reactive(value) : value; // lazy deep reactivity
    },
    set(obj, key, value, receiver) {
      const old = Reflect.get(obj, key, receiver);
      const ok = Reflect.set(obj, key, value, receiver);
      if (ok && !Object.is(old, value)) trigger(obj, key);
      return ok;
    },
    deleteProperty(obj, key) {
      const had = Reflect.has(obj, key);
      const ok = Reflect.deleteProperty(obj, key);
      if (ok && had) trigger(obj, key);
      return ok;
    },
  });
  proxies.set(target, proxy);
  return proxy;
}

export function effect(fn: Effect) {
  const run: Effect = () => {
    const previous = activeEffect;
    activeEffect = run;
    try {
      fn();
    } finally {
      activeEffect = previous;
    }
  };
  run();
}

// Usage
const state = reactive({ user: { name: 'Ada' }, todos: [] as string[] });
effect(() => console.log('name is', state.user.name));
state.user.name = 'Grace'; // logs "name is Grace"
```

> [!NOTE]
> The one `as T` above exists because a `WeakMap<object, object>` can't remember per-entry types. Hiding it inside a tiny, well-tested module is the acceptable place for an assertion; it shouldn't leak into callers.

### Why `Reflect`

`Reflect.get(obj, key, receiver)` forwards the **receiver**, so getters defined on the target run with `this = proxy`, and their reads get tracked too. `obj[key]` would run getters against the raw target and miss dependencies.

### Limits to discuss

- **Stale dependencies**: this toy never removes an effect from keys it no longer reads (e.g. after a conditional branch flips). Real systems clear an effect's deps before each run.
- **Arrays**: `push` touches `length` and indices; you need to track `length` and avoid infinite loops when an effect both reads and writes the array.
- **Built-ins with internal slots** (`Map`, `Set`, `Date`, typed arrays) throw when their methods run with `this = proxy`. Libraries wrap their methods ("collection handlers").
- **Private `#fields`** break: methods called on the proxy fail the brand check.
- **Identity**: `reactive(obj) !== obj`. Comparing raw and proxied objects, or passing proxies to third-party code, causes subtle bugs.
- **Batching**: setting three fields runs effects three times. Real systems schedule effects in a microtask and dedupe.
- **Performance**: every property read goes through a trap. Fine for app state; costly for large data tables processed in loops (mark them raw).

### Follow-ups

- **"Proxy reactivity vs signals vs React's model?"** React re-renders components and diffs output (coarse, predictable, no tracking). Proxy/signal systems track fine-grained reads and update exactly the dependents (fast, but "magic" and with identity caveats). Signals make the tracking explicit (`count()`), avoiding proxy edge cases.
- **"How would you integrate this with React?"** Expose `subscribe`/`getSnapshot` and use `useSyncExternalStore`, returning immutable snapshots so React can compare by reference (this is what Valtio's `useSnapshot` does).

### References

- [MDN: Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
- [MDN: Reflect](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Reflect)
- [Vue: Reactivity in depth](https://vuejs.org/guide/extras/reactivity-in-depth.html)
