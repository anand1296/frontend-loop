---
id: async-utilities
title: Async Patterns & JS Machine Coding
description: The utilities interviewers ask you to write from scratch, done properly: promise combinators, pools with cancellation, retries, debounce, caches and emitters.
---

## Implement `Promise.all`, `allSettled`, `any` and `race`, and explain their failure semantics
<!--
id: promise-combinators
level: senior
tags: promises, promise.all, allsettled, any, race, machine coding
minutes: 15
-->

> [!PROMPT]
> Implement `promiseAll`, `promiseAllSettled`, `promiseAny` and `promiseRace` without using the native versions, accepting any iterable of values or thenables.
>
> **Requirements**
> - `all` keeps input order and rejects on the first rejection; `any` rejects with an `AggregateError` only when everything rejects.
> - Plain values are allowed in the input; an empty input must behave like the native one.
>
> **Test cases**
> - `promiseAll([1, Promise.resolve(2), delay(10, 3)])` resolves to `[1, 2, 3]` even if the third settles first elsewhere.
> - `promiseAll([delay(50, 'a'), Promise.reject(new Error('x'))])` rejects with `x` immediately.
> - `promiseAny([Promise.reject(1), Promise.reject(2)])` rejects with an `AggregateError` whose `errors` is `[1, 2]`.
> - `promiseAll([])` resolves `[]`; `promiseRace([])` never settles.

> [!TLDR]
> `all` resolves with every value **in input order** or rejects with the **first** rejection. `allSettled` never rejects; it reports each outcome. `any` resolves with the first fulfillment or rejects with an `AggregateError` if all fail. `race` settles like whichever settles first. Key details: accept any iterable, wrap non-promises with `Promise.resolve`, preserve order by index (not completion), and handle the empty input case (`all([])` resolves immediately, `any([])` rejects, `race([])` stays pending forever).

### Clarify first

- Inputs: any iterable of values or thenables? (Yes, like the spec.)
- Order: results by input position.
- Do we cancel the others when one fails? (The built-ins don't; there's nothing to cancel without `AbortSignal`.)

### Implementations

```ts
export function promiseAll<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]> {
  return new Promise((resolve, reject) => {
    const items = Array.from(values);
    const results: Awaited<T>[] = new Array(items.length);
    let remaining = items.length;
    if (remaining === 0) {
      resolve(results);
      return;
    }
    items.forEach((item, index) => {
      Promise.resolve(item).then((value) => {
        results[index] = value;
        remaining -= 1;
        if (remaining === 0) resolve(results);
      }, reject); // first rejection wins; later calls to reject are no-ops
    });
  });
}

export function promiseAllSettled<T>(values: Iterable<T | PromiseLike<T>>): Promise<PromiseSettledResult<Awaited<T>>[]> {
  return promiseAll(
    Array.from(values, (item) =>
      Promise.resolve(item).then(
        (value): PromiseSettledResult<Awaited<T>> => ({ status: 'fulfilled', value }),
        (reason: unknown): PromiseSettledResult<Awaited<T>> => ({ status: 'rejected', reason }),
      ),
    ),
  );
}

export function promiseAny<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    const items = Array.from(values);
    const errors: unknown[] = new Array(items.length);
    let remaining = items.length;
    if (remaining === 0) {
      reject(new AggregateError([], 'All promises were rejected'));
      return;
    }
    items.forEach((item, index) => {
      Promise.resolve(item).then(resolve, (reason: unknown) => {
        errors[index] = reason;
        remaining -= 1;
        if (remaining === 0) reject(new AggregateError(errors, 'All promises were rejected'));
      });
    });
  });
}

export function promiseRace<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>> {
  return new Promise((resolve, reject) => {
    for (const item of values) Promise.resolve(item).then(resolve, reject);
  });
}
```

Why it works: a promise can only settle once, so calling `resolve`/`reject` repeatedly is harmless; the first call wins. Index-based writes keep order regardless of completion order.

### Edge cases interviewers probe

- **Sync values and thenables** in the input: `Promise.resolve` normalizes both.
- **`results` holes**: use `new Array(n)` and count completions; don't use `results.length` or `push`.
- **Unhandled rejections**: in `all`, after the first rejection, other rejections are still "handled" because we attached `reject` to each.
- **Iterables consumed once**: convert to an array first (generators can't be re-iterated).

### Applied: a typed `all` for an object of promises

```ts
async function allProps<T extends Record<string, unknown>>(record: T): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys = Object.keys(record);
  const values = await Promise.all(keys.map((key) => record[key]));
  return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as { [K in keyof T]: Awaited<T[K]> };
}

const { user, settings } = await allProps({ user: getUser(id), settings: getSettings(id) });
```

> [!NOTE]
> The assertion in `allProps` is the honest kind: `Object.fromEntries` can't express "same keys as T". It's contained in one generic helper with a clear contract.

### Follow-ups

- **"Fetch a dashboard with 6 widgets; one is slow or broken. Which combinator?"** `allSettled` (or independent queries per widget), so one failure renders an error tile instead of blanking the page.
- **"Implement a timeout with `race`."** Race the work against a promise that rejects after N ms, but remember `race` doesn't stop the losing work; pass an `AbortSignal` (e.g. `AbortSignal.timeout(ms)`) to actually cancel `fetch`.

### References

- [MDN: Promise.all](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all)
- [MDN: Promise.allSettled](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)
- [MDN: Promise.any](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/any)

## Build a concurrency-limited task runner with cancellation, and avoid the classic bugs
<!--
id: concurrency-pool-abort
level: lead
tags: concurrency, promise pool, abortsignal, cancellation, machine coding
minutes: 20
-->

> [!PROMPT]
> Write `runPool(tasks, { limit, signal })`: run at most `limit` async tasks at once, return results in the original order, and stop cleanly on the first error or when the `AbortSignal` fires.
>
> **Requirements**
> - No more than `limit` tasks in flight at any moment; tasks that haven't started never start after a failure or abort.
> - Each task receives an `AbortSignal` so in-flight work can be cancelled.
>
> **Test cases**
> - 10 tasks, `limit: 3`: a counter of concurrently running tasks never exceeds 3 and results come back in input order.
> - Task 4 rejects: the pool rejects with that error and tasks 5 to 10 never start.
> - `controller.abort()` mid-run rejects with the abort reason and aborts the tasks' signals.
> - `limit: 0` rejects with a `RangeError`; `tasks: []` resolves `[]`.

> [!TLDR]
> Start N workers that pull the next task index from a shared cursor until tasks run out. Store results by index. For "stop on first error", track failure with a **separate boolean** (because `throw undefined` is legal), stop scheduling new tasks, and **abort** in-flight ones through an `AbortSignal` passed to every task. Also respect an external signal so callers can cancel the whole batch. Already-running work only stops if the task honors the signal.

### Requirements to confirm

- `limit` concurrent tasks at most; preserve result order.
- Mode A: collect all outcomes (like `allSettled`). Mode B: fail fast and cancel the rest.
- Caller cancellation via `AbortSignal`.
- Tasks are functions (not promises), so we control when they start.

### Implementation

```ts
export type Task<T> = (signal: AbortSignal) => Promise<T>;

export interface PoolOptions {
  limit: number;
  signal?: AbortSignal;
}

/** Fail-fast pool: resolves with results in order, or rejects with the first error. */
export function runPool<T>(tasks: readonly Task<T>[], { limit, signal }: PoolOptions): Promise<T[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    return Promise.reject(new RangeError('limit must be a positive integer'));
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) return Promise.reject(signal.reason);
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let failed = false;      // separate flag: the error value itself may be undefined
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (!failed && !controller.signal.aborted && nextIndex < tasks.length) {
      const index = nextIndex++;
      const task = tasks[index];
      if (!task) continue;
      try {
        results[index] = await task(controller.signal);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
          controller.abort(error); // tell in-flight tasks to stop
        }
        return;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());

  return Promise.all(workers)
    .then(() => {
      if (failed) throw firstError;
      if (controller.signal.aborted) throw controller.signal.reason;
      return results;
    })
    .finally(() => signal?.removeEventListener('abort', onExternalAbort));
}
```

### Why each detail matters

- **Shared cursor (`nextIndex++`)** is safe because JavaScript runs one worker's synchronous code at a time; no locks needed.
- **`failed` boolean** fixes a real bug: `if (firstError !== undefined)` misses `throw undefined` or `Promise.reject()`.
- **`return` after an error** ends that worker; others see `failed` and stop *starting* tasks, but tasks already running keep going until they observe `signal.aborted`. Stopping scheduling is not cancellation.
- **Waiting for all workers** before rejecting means we don't leave orphaned work running unobserved, and cleanup (`finally`) is reliable. If you need to reject immediately, reject early but still track the workers for cleanup.
- **External signal** is linked to the internal controller; `AbortSignal.any([signal, internal])` does the same in modern runtimes.

### Usage with cancellable work

```ts
const uploads = files.map((file): Task<string> => async (signal) => {
  const response = await fetch('/upload', { method: 'POST', body: file, signal });
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  const { url } = await response.json();
  return url;
});

const controller = new AbortController();
cancelButton.onclick = () => controller.abort(new DOMException('Cancelled', 'AbortError'));
const urls = await runPool(uploads, { limit: 3, signal: controller.signal });
```

### Settled variant

For "collect everything", don't stop on failure: store `{ status, value | reason }` per index (like `allSettled`) and keep pulling tasks. That's usually right for bulk operations where the UI shows per-item status.

### Complexity

O(n) scheduling overhead; at most `limit` tasks in flight; memory O(n) for results.

### Follow-ups

- **"Add priorities?"** Replace the array cursor with a priority queue (binary heap) and let workers pop from it; new tasks can be pushed while running.
- **"Add per-task timeout?"** Combine signals: `AbortSignal.any([controller.signal, AbortSignal.timeout(ms)])`.
- **"Retry failed tasks?"** Wrap each task with a retry helper that respects the same signal so cancel stops retries too.
- **"Rate limiting vs concurrency limiting?"** Concurrency caps simultaneous requests; rate limiting caps starts per time window (token bucket). APIs that return 429 often need both.

### References

- [MDN: AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [MDN: AbortSignal.any()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static)
- [p-limit](https://github.com/sindresorhus/p-limit)

## Retry with exponential backoff, full jitter, `Retry-After` and error classification
<!--
id: retry-backoff-jitter
level: senior
tags: retry, backoff, jitter, http, resilience
minutes: 15
-->

> [!PROMPT]
> Build `retry(fn, options)` for API calls: exponential backoff with full jitter, a cap, respect for `Retry-After`, and a rule for which errors are worth retrying.
>
> **Requirements**
> - Wait `random(0, min(cap, base * 2^attempt))` between attempts; honor `Retry-After` (seconds or HTTP date) when present.
> - Never retry non-idempotent failures that are the caller's fault (400, 401, 403, 404); do retry network errors, 408, 429 and most 5xx.
> - Cancellable with an `AbortSignal`, including during the wait.
>
> **Test cases** (fake timers)
> - A function failing twice then succeeding resolves on the third call, with two waits.
> - A 404 is thrown immediately without retrying.
> - A 429 with `Retry-After: 2` waits at least 2000 ms before the next attempt.
> - Aborting during a wait rejects with the abort reason and makes no further call.

> [!TLDR]
> Retry only **transient** failures: network errors, timeouts, 408, 429 and most 5xx on **idempotent** requests. Wait `random(0, min(cap, base * 2^attempt))` (full jitter) to avoid synchronized retry storms, honor `Retry-After` when the server sends it, cap attempts and total time, and stop immediately when the caller aborts. Never retry 4xx validation/auth errors or programming errors.

### Classification

```ts
export class HttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  constructor(status: number, retryAfterMs: number | null = null) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function isRetryable(error: unknown): boolean {
  if (isAbort(error)) return false;                                  // caller cancelled
  if (error instanceof HttpError) return RETRYABLE_STATUS.has(error.status);
  return error instanceof TypeError;                                 // fetch network failure
}

export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header); // HTTP-date form
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}
```

> [!WARNING]
> `TypeError` from `fetch` means "network failure", but a `TypeError` thrown by *your* code (e.g. reading a property of undefined in the `task`) looks the same. Keep the retried function narrow (just the request) so bugs don't get retried and hidden.

### The retry loop

```ts
export interface RetryOptions {
  retries?: number;       // additional attempts after the first
  baseMs?: number;
  capMs?: number;
  signal?: AbortSignal;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function retry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseMs = 300, capMs = 10_000, signal, shouldRetry = isRetryable, onRetry } = options;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error, attempt)) throw error;
      const backoff = Math.random() * Math.min(capMs, baseMs * 2 ** attempt); // full jitter
      const serverHint = error instanceof HttpError ? error.retryAfterMs : null;
      const delay = serverHint !== null ? Math.min(Math.max(serverHint, backoff), capMs) : backoff;
      onRetry?.(error, attempt + 1, delay);
      await sleep(delay, signal);
    }
  }
}
```

Usage:

```ts
const data = await retry(
  async () => {
    const response = await fetch('/api/report', { signal: controller.signal });
    if (!response.ok) {
      throw new HttpError(response.status, parseRetryAfter(response.headers.get('Retry-After')));
    }
    return response.json();
  },
  { retries: 4, signal: controller.signal, onRetry: (e, n, ms) => log.warn('retrying', { n, ms }) },
);
```

### Why jitter

Without jitter, 10,000 clients that failed at the same moment retry at the same moments (1s, 2s, 4s...), hitting a recovering server in waves. Full jitter spreads them uniformly and gets the best completion time in AWS's analysis.

### Idempotency

GET/PUT/DELETE are idempotent by spec. POST isn't: retrying "create order" can charge twice. Make it safe with an **idempotency key** header generated once per user intent and reused across retries; the server deduplicates.

### Where retries belong

- Don't stack retries at every layer (UI + client + gateway + service), or one user click becomes 4×4×4 requests. Pick one layer, usually the data client (React Query has `retry`/`retryDelay`).
- Show progress for long retries ("Reconnecting…"), and let users cancel.
- Add a **circuit breaker** or global budget when many requests fail together, to stop hammering a dead dependency.

### References

- [AWS: Exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [MDN: Retry-After](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After)
- [Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests)

## Debounce with `maxWait`, `flush` and `cancel`, plus a React hook that never goes stale
<!--
id: debounce-advanced-hook
level: senior
tags: debounce, throttle, react hooks, timers, machine coding
minutes: 15
-->

> [!PROMPT]
> Implement `debounce(fn, wait, { leading, trailing, maxWait })` with `cancel()`, `flush()` and `pending()`, then a `useDebouncedCallback` React hook that always calls the latest callback and cleans up on unmount.
>
> **Test cases** (fake timers)
> - Three calls 50 ms apart with `wait: 100` → `fn` runs once, 100 ms after the last call, with the last arguments.
> - `leading: true, trailing: false`: the first call runs immediately and later calls in the window are ignored.
> - `maxWait: 300` with a call every 100 ms for a second → `fn` still runs about every 300 ms.
> - `flush()` runs a pending call immediately; `cancel()` drops it.
> - The hook: re-rendering with a new callback uses the new closure, and unmounting cancels a pending call.

> [!TLDR]
> Debounce delays a call until input has been quiet for `wait` ms. Production versions add `leading`/`trailing` edges, `maxWait` (guarantee a call at least every N ms during continuous input, which is how throttle can be built from debounce), `cancel()`, `flush()`, and always call with the **latest** arguments. In React, keep the debounced function stable across renders and read the latest callback from a ref, so the timer isn't reset by re-renders and never calls a stale closure.

### Implementation

```ts
export interface DebounceOptions {
  leading?: boolean;
  trailing?: boolean;
  maxWait?: number;
}

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  flush(): void;
  pending(): boolean;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
  { leading = false, trailing = true, maxWait }: DebounceOptions = {},
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;
  let lastCallTime: number | undefined;
  let lastInvokeTime = 0;

  const invoke = (time: number) => {
    const args = lastArgs;
    lastArgs = undefined;
    lastInvokeTime = time;
    if (args) fn(...args);
  };

  const remainingWait = (time: number) => {
    const sinceCall = time - (lastCallTime ?? 0);
    const waitLeft = wait - sinceCall;
    return maxWait === undefined ? waitLeft : Math.min(waitLeft, maxWait - (time - lastInvokeTime));
  };

  const shouldInvoke = (time: number) => {
    if (lastCallTime === undefined) return true;
    const sinceCall = time - lastCallTime;
    return sinceCall >= wait || sinceCall < 0 || (maxWait !== undefined && time - lastInvokeTime >= maxWait);
  };

  const timerExpired = () => {
    const time = Date.now();
    if (shouldInvoke(time)) {
      timer = undefined;
      if (trailing && lastArgs) invoke(time);
      lastArgs = undefined;
      return;
    }
    timer = setTimeout(timerExpired, remainingWait(time));
  };

  const debounced = (...args: A) => {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);
    lastArgs = args;
    lastCallTime = time;

    if (isInvoking && timer === undefined) {
      lastInvokeTime = time; // start the maxWait window
      timer = setTimeout(timerExpired, wait);
      if (leading) invoke(time);
      return;
    }
    if (isInvoking && maxWait !== undefined) {
      // Continuous input hit maxWait: invoke now and keep waiting for the trailing edge.
      clearTimeout(timer);
      timer = setTimeout(timerExpired, wait);
      invoke(time);
      return;
    }
    if (timer === undefined) timer = setTimeout(timerExpired, wait);
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
    lastCallTime = undefined;
    lastInvokeTime = 0;
  };
  debounced.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    if (lastArgs) invoke(Date.now());
  };
  debounced.pending = () => timer !== undefined;
  return debounced;
}

export const throttle = <A extends unknown[]>(fn: (...args: A) => void, wait: number) =>
  debounce(fn, wait, { leading: true, trailing: true, maxWait: wait });
```

This mirrors lodash's design: one timer that re-arms itself for the remaining time instead of clearing and re-creating a timer on every keystroke.

### React: stable debounced callback with the latest closure

```tsx
import { useEffect, useMemo, useRef } from 'react';

export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  wait: number,
  options?: DebounceOptions,
): Debounced<A> {
  const callbackRef = useRef(callback);
  callbackRef.current = callback; // latest props/state without recreating the debouncer

  const { leading, trailing, maxWait } = options ?? {};
  const debounced = useMemo(
    () => debounce((...args: A) => callbackRef.current(...args), wait, { leading, trailing, maxWait }),
    [wait, leading, trailing, maxWait], // primitives only, so an inline options object doesn't reset it
  );

  useEffect(() => () => debounced.cancel(), [debounced]); // no calls after unmount
  return debounced;
}

function SearchBox({ onSearch }: { onSearch: (q: string) => void }) {
  const search = useDebouncedCallback(onSearch, 300);
  return (
    <input
      type="search"
      onChange={(event) => search(event.target.value)}
      onKeyDown={(event) => event.key === 'Enter' && search.flush()}
    />
  );
}
```

> [!NOTE]
> Assigning `callbackRef.current` during render is a widely used pattern, but it's technically a render-phase side effect. React's `useEffectEvent` is the official answer once available in your version; a layout effect that updates the ref is the conservative alternative.

### Debounce the value or the effect?

For search-as-you-type with React Query, debouncing the **query key** (a `useDebouncedValue(term, 300)`) is often cleaner than debouncing a callback, and React Query handles cancellation and caching. Also consider whether you need debouncing at all: `useDeferredValue` keeps typing responsive for expensive *rendering*, while debounce reduces *network* calls.

### Edge cases

- `flush` on Enter/blur so the last input isn't lost.
- Cancel on unmount (already handled).
- Clock: `Date.now()` can jump (sleep, clock changes); `performance.now()` is monotonic.

### References

- [lodash debounce source](https://github.com/lodash/lodash/blob/main/src/debounce.ts)
- [CSS-Tricks: Debouncing and throttling explained](https://css-tricks.com/debouncing-throttling-explained-examples/)

## Request deduplication plus a cache with TTL, stale-while-revalidate and invalidation races
<!--
id: async-cache-dedupe-swr
level: lead
tags: caching, deduplication, stale-while-revalidate, race conditions, react query
minutes: 18
-->

> [!PROMPT]
> Build `AsyncCache` with `get(key, loader)`, TTL, stale-while-revalidate, `invalidate(key)` and request deduplication. Two components asking for the same user at the same moment must trigger one request.
>
> **Requirements**
> - Fresh entries return immediately; stale entries return immediately and refresh in the background; expired ones wait for the loader.
> - A failed refresh must not poison the cache. An `invalidate` during an in-flight load must not let the old response overwrite newer data.
>
> **Test cases** (fake timers)
> - Two concurrent `get('u1', loader)` calls → the loader runs once and both receive the same value.
> - Inside the TTL a second `get` doesn't call the loader; in the stale window it returns the old value and calls the loader once in the background.
> - `get` → `invalidate` → the first (slow) load resolves late → the cache does not store its value.
> - A loader that rejects is not cached; the next `get` retries.

> [!TLDR]
> Keep one entry per key holding either the in-flight promise or the settled value with a timestamp. Concurrent callers share the in-flight promise (dedupe). Fresh values return immediately; stale values return immediately **and** trigger a background refresh (SWR). Failures aren't cached. The subtle part is invalidation: an `invalidate()` during an in-flight request must stop that request from writing back, which needs a per-key **generation** number checked before every write.

### Implementation

```ts
type Entry<T> =
  | { state: 'pending'; promise: Promise<T>; generation: number }
  | { state: 'fresh'; value: T; fetchedAt: number; generation: number; refreshing?: Promise<T> };

export interface CacheOptions {
  ttlMs: number;          // fresh window
  maxStaleMs?: number;    // after this, don't serve stale; wait for a fetch
}

export class AsyncCache<T> {
  #entries = new Map<string, Entry<T>>();
  #generations = new Map<string, number>();
  readonly #options: CacheOptions;

  constructor(options: CacheOptions) {
    this.#options = options;
  }

  #generation(key: string): number {
    return this.#generations.get(key) ?? 0;
  }

  #fetch(key: string, loader: () => Promise<T>): Promise<T> {
    const generation = this.#generation(key);
    const promise = loader().then(
      (value) => {
        if (this.#generation(key) === generation) {
          this.#entries.set(key, { state: 'fresh', value, fetchedAt: Date.now(), generation });
        }
        return value;
      },
      (error: unknown) => {
        const current = this.#entries.get(key);
        // Drop a failed pending entry so the next call retries; keep serving a stale value if we had one.
        if (current?.state === 'pending' && current.generation === generation) this.#entries.delete(key);
        if (current?.state === 'fresh' && current.generation === generation) this.#entries.set(key, { ...current, refreshing: undefined });
        throw error;
      },
    );
    return promise;
  }

  get(key: string, loader: () => Promise<T>): Promise<T> {
    const entry = this.#entries.get(key);
    const now = Date.now();

    if (entry?.state === 'pending') return entry.promise; // dedupe

    if (entry?.state === 'fresh') {
      const age = now - entry.fetchedAt;
      if (age <= this.#options.ttlMs) return Promise.resolve(entry.value);
      const maxStale = this.#options.maxStaleMs ?? Infinity;
      if (age <= this.#options.ttlMs + maxStale) {
        if (!entry.refreshing) {
          const refreshing = this.#fetch(key, loader);
          refreshing.catch(() => {}); // background refresh failures shouldn't be unhandled
          this.#entries.set(key, { ...entry, refreshing });
        }
        return Promise.resolve(entry.value); // stale-while-revalidate
      }
    }

    const promise = this.#fetch(key, loader);
    this.#entries.set(key, { state: 'pending', promise, generation: this.#generation(key) });
    return promise;
  }

  invalidate(key: string): void {
    this.#generations.set(key, this.#generation(key) + 1); // in-flight writes for the old generation are ignored
    this.#entries.delete(key);
  }

  clear(): void {
    for (const key of this.#entries.keys()) this.#generations.set(key, this.#generation(key) + 1);
    this.#entries.clear();
  }
}
```

### The race this fixes

```text
t0  get('user:1')        → request A starts (generation 0)
t1  user saves profile   → invalidate('user:1')  (generation → 1)
t2  get('user:1')        → request B starts (generation 1)
t3  B resolves (new data) → written
t4  A resolves (OLD data) → generation mismatch → NOT written
```

Without the generation check, A overwrites B and the UI shows pre-save data. Clearing the map alone doesn't help, because A's `.then` still runs.

### Production concerns

- **Memory**: bound the cache (LRU) and garbage-collect unused keys after a while (React Query's `gcTime`).
- **Keys**: derive from all inputs (`['user', id, { include: 'teams' }]`), serialized deterministically.
- **Cancellation**: pass an `AbortSignal` to loaders; abort when no subscribers remain.
- **Errors**: don't cache failures (or cache briefly with backoff to avoid hammering).
- **Subscriptions**: UIs need to *re-render* when a background refresh lands, so a real cache exposes `subscribe(key, listener)`; then you've rebuilt React Query, which is the point to make in the interview.

> [!TIP]
> Saying "I'd use TanStack Query in production, and here's what it does internally" is a strong answer. It shows you know both the tool and the mechanics: deduped queries, `staleTime` vs `gcTime`, background refetch, invalidation, and cancellation.

### References

- [RFC 5861: stale-while-revalidate](https://www.rfc-editor.org/rfc/rfc5861)
- [TanStack Query: Important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [TanStack Query: Query invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)

## Implement a type-safe event emitter (`on`, `off`, `once`, error isolation)
<!--
id: typed-event-emitter
level: senior
tags: event emitter, pub sub, typescript, machine coding
minutes: 12
-->

> [!PROMPT]
> Implement a type-safe `Emitter<Events>` with `on`, `off`, `once` and `emit`. `on` returns an unsubscribe function, and one listener throwing must not stop the others.
>
> **Test cases**
> - `on('saved', fn)` then `emit('saved', { id: 'a' })` calls `fn` with that payload; `emit('saved', 42)` is a compile error.
> - The function returned by `on` removes the listener; calling it twice is harmless.
> - `once` fires exactly once even if `emit` is called twice.
> - A listener added during `emit` doesn't run in that same emit; one removed during `emit` is safe.
> - Three listeners where the first throws → the other two still run and the error is reported (not swallowed silently).

> [!TLDR]
> Map each event name to a `Set` of listeners, typed by an event map interface so `emit('saved', payload)` checks the payload. `on` returns an unsubscribe function. Iterate over a **copy** of the listener set so listeners can unsubscribe during emit. Isolate listener errors so one failing listener doesn't stop the rest, and make `once` removable by the original function reference.

### Implementation

```ts
type Listener<T> = (payload: T) => void;

export class Emitter<Events extends object> {
  #listeners = new Map<keyof Events, Set<Listener<never>>>();
  #onceWrappers = new WeakMap<Listener<never>, Listener<never>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const wrapper: Listener<Events[K]> = (payload) => {
      this.off(event, listener);
      listener(payload);
    };
    this.#onceWrappers.set(listener, wrapper);
    return this.on(event, wrapper);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    const wrapper = this.#onceWrappers.get(listener);
    set.delete(wrapper ?? listener);
    set.delete(listener);
    if (set.size === 0) this.#listeners.delete(event);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        queueMicrotask(() => {
          throw error; // surfaces in error reporting without breaking other listeners
        });
      }
    }
  }
}

interface AppEvents {
  'doc:saved': { id: string; version: number };
  'session:expired': undefined;
}

const bus = new Emitter<AppEvents>();
const stop = bus.on('doc:saved', ({ id, version }) => console.log(id, version));
bus.emit('doc:saved', { id: 'a1', version: 3 });
bus.emit('doc:saved', { id: 'a1' }); // error: property 'version' is missing
stop();
```

> [!NOTE]
> Storing listeners of different payload types in one map forces one cast at the call site of `emit`. The type system can't express "the Set for key K holds listeners of `Events[K]`" in a single `Map`. The cast is private and guarded by the public signatures; callers never see it.

### Design questions to raise

- **Sync or async delivery?** Sync is predictable and easy to test; async (microtask) avoids re-entrancy surprises when a listener emits another event.
- **Memory leaks:** every `on` needs an owner that calls the returned unsubscribe (component cleanup, `AbortSignal`). Consider an `on(event, listener, { signal })` overload.
- **Should a global event bus exist?** In React apps, prefer explicit data flow (state, context, query cache). Buses are useful at the edges: cross-microfrontend messages, analytics, and integration with non-React code. Browsers also give you `EventTarget` + `CustomEvent` for free.

### References

- [MDN: EventTarget](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget)
- [mitt (200-byte emitter)](https://github.com/developit/mitt)

## Deep clone with cycles, `Map`, `Set` and `Date`, and when to just use `structuredClone`
<!--
id: deep-clone-cycles
level: senior
tags: deep clone, structuredclone, recursion, cycles, machine coding
minutes: 12
-->

> [!PROMPT]
> Write `deepClone(value)` that handles nested objects, arrays, `Date`, `Map`, `Set` and circular references. Then say when you would not write it at all.
>
> **Test cases**
> - `const a = { n: 1 }; a.self = a; const b = deepClone(a);` → `b.self === b` and `b !== a`.
> - `deepClone(new Map([[{ k: 1 }, new Set([1])]]))` returns an equal but independent structure.
> - A `Date` clone is a different object with the same time; mutating the original array doesn't affect the copy.
> - Functions, class instances and DOM nodes: say what your version does, and compare with `structuredClone`.

> [!TLDR]
> Use `structuredClone` in production: it handles cycles, `Map`, `Set`, `Date`, `RegExp`, typed arrays, `Blob`s and errors, but not functions, DOM nodes, class prototypes or symbols (it returns plain objects). When asked to implement one, recurse with a `WeakMap` from original to copy (handles cycles and shared references), switch on type for built-ins, and preserve the prototype if required.

### Implementation

```ts
export function deepClone<T>(value: T): T {
  return cloneInner(value, new WeakMap());
}

function cloneInner<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (typeof value !== 'object' || value === null) return value; // primitives & functions by reference

  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;

  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof RegExp) return new RegExp(value.source, value.flags) as T;

  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    value.forEach((v, k) => copy.set(cloneInner(k, seen), cloneInner(v, seen)));
    return copy as T;
  }

  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    value.forEach((v) => copy.add(cloneInner(v, seen)));
    return copy as T;
  }

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    value.forEach((item, i) => (copy[i] = cloneInner(item, seen)));
    return copy as T;
  }

  const copy = Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ('value' in descriptor) descriptor.value = cloneInner(descriptor.value, seen);
    Object.defineProperty(copy, key, descriptor);
  }
  return copy;
}

const a: { name: string; self?: unknown; tags: Set<string> } = { name: 'a', tags: new Set(['x']) };
a.self = a;
const b = deepClone(a);
b.self === b;        // true: cycle preserved
b.tags !== a.tags;   // true
```

> [!NOTE]
> A generic clone function is one of the few places where `as T` is unavoidable: the function changes runtime representation in ways the type system can't follow. The assertions are contained and the public signature stays honest.

### Comparison

| Approach | Cycles | Map/Set/Date | Prototypes | Functions | Speed |
| --- | --- | --- | --- | --- | --- |
| `JSON.parse(JSON.stringify(x))` | Throws | Lost (Date → string) | Lost | Dropped | OK for small plain data |
| `structuredClone(x)` | Yes | Yes | Lost (plain objects) | Throws | Native, good |
| Custom (above) | Yes | Yes | Preserved | Shared by ref | Depends |
| Immer / structural sharing | n/a | Yes | Yes | n/a | Copies only what changed |

### The better question: do you need a deep clone?

In React/Redux code, deep cloning state is usually a smell: it breaks referential equality everywhere (every memoized selector and `React.memo` recomputes). Use **structural sharing**: copy only the path you change (`{ ...state, user: { ...state.user, name } }`) or Immer's `produce`.

### Edge cases

- Deep recursion on very deep structures can overflow the stack; an explicit stack/queue avoids it.
- Getters/setters: copying descriptors keeps accessors that may close over the original object.
- Frozen objects: copies keep non-writable descriptors; decide whether to `Object.freeze` copies too.

### References

- [MDN: structuredClone()](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)
- [MDN: The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [Immer](https://immerjs.github.io/immer/)

## Stale responses: cancel or ignore? Build a "latest wins" helper and know when to use each strategy
<!--
id: latest-wins-requests
level: senior
tags: race conditions, abortcontroller, switchmap, stale responses
minutes: 12
-->

> [!PROMPT]
> A search box and a filter panel both fire requests, and sometimes an old response arrives after a newer one and overwrites the UI. Build a `latest(fn)` helper that makes only the most recent call matter, and explain when you cancel versus when you ignore.
>
> **Test cases**
> - Call 1 (slow, 300 ms) then call 2 (fast, 50 ms) → call 1 resolves as `{ stale: true }`, call 2 as `{ stale: false, value }`.
> - The signal passed to call 1's function is aborted as soon as call 2 starts.
> - An error from a superseded call is reported as stale, not as a failure; a real error from the latest call propagates.
> - Discuss: when cancelling is unsafe (non-idempotent requests) and ignoring is the right choice.

> [!TLDR]
> When requests overlap (typeahead, filters, tab switches), older responses can arrive after newer ones. Two fixes: **ignore** stale results (compare a request id/version before applying) or **cancel** older requests (`AbortController`). Cancel when the work is expensive or has side effects you don't want; ignore when cancellation isn't possible. Combine both: abort the previous request *and* guard the write. This is RxJS's `switchMap` semantics; other strategies are `concatMap` (queue), `exhaustMap` (ignore new while busy) and `mergeMap` (all in parallel).

### A reusable helper

```ts
export function latest<A extends unknown[], R>(fn: (signal: AbortSignal, ...args: A) => Promise<R>) {
  let controller: AbortController | null = null;
  let version = 0;

  return async (...args: A): Promise<{ stale: false; value: R } | { stale: true }> => {
    controller?.abort(new DOMException('Superseded', 'AbortError'));
    const current = new AbortController();
    controller = current;
    const myVersion = ++version;
    try {
      const value = await fn(current.signal, ...args);
      return myVersion === version ? { stale: false, value } : { stale: true };
    } catch (error) {
      if (myVersion !== version) return { stale: true }; // superseded: swallow its abort/error
      throw error;
    }
  };
}

interface UserHit {
  id: string;
  name: string;
}

const searchUsers = latest(async (signal, query: string): Promise<UserHit[]> => {
  const response = await fetch(`/api/users?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error(String(response.status));
  return response.json(); // unchecked `any` from the network: validate here in production
});

input.addEventListener('input', async () => {
  const result = await searchUsers(input.value);
  if (!result.stale) renderResults(result.value);
});
```

### Choosing the strategy

| Situation | Strategy |
| --- | --- |
| Typeahead, filters, route data | switch (latest wins, cancel old) |
| Saving a document's edits in order | concat (queue; never reorder writes) |
| "Submit" button double-click | exhaust (ignore while in flight) or disable |
| Independent uploads | merge (parallel, maybe with a pool limit) |

> [!WARNING]
> Aborting a `fetch` stops the client from waiting; it doesn't undo a server-side mutation that already started. Never use "cancel the previous POST" as a consistency mechanism for writes; queue writes or use versioned updates (ETags, `If-Match`).

### In React

React Query cancels/ignores automatically by key. With plain effects, the cleanup function is your abort point:

```tsx
useEffect(() => {
  const controller = new AbortController();
  fetchUser(id, controller.signal).then(setUser, (error) => {
    if (!controller.signal.aborted) setError(error);
  });
  return () => controller.abort();
}, [id]);
```

### References

- [MDN: AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [RxJS: switchMap](https://rxjs.dev/api/operators/switchMap)
- [React: Fetching data with effects (race conditions)](https://react.dev/learn/synchronizing-with-effects#fetching-data)
