---
id: testing-quality
title: Testing & Quality
description: A testing strategy you can defend, Testing Library done right, network mocking with MSW, flaky E2E and CI speed, visual and accessibility testing, and testing async hooks.
---

## Design a frontend testing strategy for a large product
<!--
id: frontend-testing-strategy
level: lead
tags: testing strategy, testing trophy, unit tests, integration tests, e2e
minutes: 15
-->

> [!TLDR]
> Optimize for **confidence per minute of CI and per hour of maintenance**. Static checks (TypeScript, ESLint) catch a whole class of bugs for free. Most behavior tests should be **integration-level component tests** (render a feature with real children, mock only the network) because they test what users do and survive refactors. Keep unit tests for pure logic with many edge cases. Keep a **thin** layer of E2E tests for critical journeys against a real deployed stack. Add visual and accessibility checks where regressions are likely, and measure flakiness as a first-class metric.

### The shape

```text
          ▲  E2E (Playwright/Cypress)  ~5–10% : login, checkout, core CRUD journeys, smoke on deploy
          │  Integration/component     ~50–60%: features with real children, MSW for network
          │  Unit                      ~20–30%: reducers, parsers, formatters, utils, hooks with logic
          │  Static                    always : TS strict, ESLint (incl. jsx-a11y, hooks), type tests
```

This is the "testing trophy": the widest band is integration, because it gives the most confidence per test.

### What to test where

| Concern | Best layer |
| --- | --- |
| Date/currency formatting edge cases | Unit (table-driven) |
| Form validation and error messages | Component/integration |
| "Saving shows a toast and updates the list" | Integration with MSW |
| Auth redirect, payments, cross-page flows | E2E |
| Design system component visuals | Visual regression (Storybook + Chromatic/Playwright screenshots) |
| a11y violations | axe in component tests + Storybook + E2E on key pages |
| Contract with backend | Typed client from schema + contract tests (Pact) or schema validation in tests |

### Principles you can state

- Test **behavior**, not implementation: no assertions on internal state or which hook was called.
- Each test should fail for one reason, with a message that points at the cause.
- Mock at the **network boundary**, not module internals, so refactors don't break tests.
- **Flaky tests are bugs**: quarantine automatically, track, fix or delete within a time limit.
- Coverage is a smell detector, not a goal; 100% coverage of trivial code buys nothing.

> [!PRINCIPAL]
> At org scale, the strategy is also about economics: parallelize and shard, run only tests affected by a change (Nx/Turborepo affected graphs), cache results, keep E2E against ephemeral preview environments, and publish CI duration and flake rate per team. Platform teams own the harness; product teams own their tests.

### References

- [Kent C. Dodds: The testing trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)
- [Martin Fowler: The practical test pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)
- [Google Testing Blog: Just say no to more end-to-end tests](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)

## Testing Library principles: queries, `user-event`, async utilities, and what not to test
<!--
id: testing-library-principles
level: senior
tags: testing library, user-event, queries, async, jest, vitest
minutes: 15
-->

> [!TLDR]
> Query the DOM the way users and assistive tech do: `getByRole` with an accessible name first, then label/text, and `getByTestId` only as a last resort. Interact with `userEvent` (realistic event sequences) rather than `fireEvent`. Wait for async UI with `findBy*` or `waitFor` (never arbitrary sleeps). Assert visible outcomes. If a component is hard to query by role, that's often an accessibility bug.

### A good test

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';

test('adds a todo and shows it in the list', async () => {
  const user = userEvent.setup();
  server.use(http.post('/api/todos', () => HttpResponse.json({ id: '1', text: 'Write tests', done: false }, { status: 201 })));

  render(<TodoApp />, { wrapper: AppProviders });

  await user.type(screen.getByRole('textbox', { name: /new todo/i }), 'Write tests');
  await user.click(screen.getByRole('button', { name: /add/i }));

  expect(await screen.findByRole('listitem', { name: /write tests/i })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /new todo/i })).toHaveValue('');
});
```

### Query priority

1. `getByRole(role, { name })`: buttons, links, headings, textboxes, checkboxes, dialogs...
2. `getByLabelText`: form fields.
3. `getByPlaceholderText`, `getByText`, `getByDisplayValue`.
4. `getByAltText`, `getByTitle`.
5. `getByTestId`: escape hatch for non-semantic things (canvas, charts).

`getBy*` throws if missing (use for "should exist"), `queryBy*` returns null (use for "should not exist"), `findBy*` waits (use for async appearance).

### Async rules

- `await user.click(...)`: user-event APIs are async.
- `await screen.findByText('Saved')` instead of `waitFor(() => expect(getByText('Saved')))` when waiting for appearance.
- `waitFor` for assertions that become true later; keep side effects out of the callback (it runs many times).
- "Not wrapped in act(...)" warnings mean a state update happened after your test stopped waiting: await the UI change that causes it.

### What not to test

- Implementation details: state variable names, internal function calls, CSS classes (unless it's the visible contract).
- Third-party library internals.
- Snapshot tests of large component trees (they get rubber-stamped). Small, intentional inline snapshots of serialized data are fine.

### References

- [Testing Library: Which query should I use?](https://testing-library.com/docs/queries/about/#priority)
- [Testing Library: user-event](https://testing-library.com/docs/user-event/intro)
- [Kent C. Dodds: Common mistakes with React Testing Library](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

## Mock the network, not the fetch function: MSW across unit tests, Storybook and development
<!--
id: msw-network-mocking
level: senior
tags: msw, mocking, network, storybook, testing
minutes: 12
-->

> [!TLDR]
> Mock Service Worker intercepts requests at the network layer (a service worker in the browser, request interception in Node), so your app code runs unchanged: the real fetch client, headers, retries and error handling all execute. Define handlers once and reuse them in tests, Storybook and local development. Override per test for error and edge cases (500, 422, slow responses, empty lists).

### Setup

```ts
// test/handlers.ts
import { http, HttpResponse, delay } from 'msw';

export const handlers = [
  http.get('/api/projects', () => HttpResponse.json([{ id: 'p1', name: 'Atlas' }])),
  http.post('/api/projects', async ({ request }) => {
    const body = await request.json();
    if (typeof body !== 'object' || body === null || !('name' in body)) {
      return HttpResponse.json({ fieldErrors: { name: 'Required' } }, { status: 422 });
    }
    await delay(150);
    return HttpResponse.json({ id: 'p2', name: String(body.name) }, { status: 201 });
  }),
];

// test/server.ts
import { setupServer } from 'msw/node';
export const server = setupServer(...handlers);

// test/setup.ts
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); // unknown requests fail the test
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### Per-test overrides

```ts
test('shows a retry button when projects fail to load', async () => {
  server.use(http.get('/api/projects', () => new HttpResponse(null, { status: 500 })));
  render(<Projects />, { wrapper: AppProviders });
  expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
});
```

### Why not `jest.mock('../api')`?

Module mocks couple tests to file structure and skip real code (serialization, error mapping, React Query behavior). They also let tests pass while the real request is wrong. Network-level mocks test the integration you actually ship.

### Keep mocks honest

Generate handlers or fixtures from the API schema (OpenAPI → MSW via tools like `msw-auto-mock`/Orval), or validate fixtures against the same zod schemas used in the app, so mocks don't drift from reality.

### References

- [MSW documentation](https://mswjs.io/docs/)
- [Storybook: MSW addon](https://github.com/mswjs/msw-storybook-addon)

## Eliminate flaky E2E tests and cut CI time (a war story you can tell)
<!--
id: flaky-e2e-ci-speed
level: lead
tags: e2e, cypress, playwright, flaky tests, ci, parallelization
minutes: 18
-->

> [!TLDR]
> Flakiness comes from **timing assumptions** (fixed waits, racing the UI), **shared state** (tests depending on data from other tests or environments), **non-determinism** (time, randomness, animations, third parties), and **infrastructure** (slow/oversubscribed CI). Fix with web-first assertions that retry, per-test isolated data via API seeding, network control for third parties, deterministic clocks, and disabled animations. Cut CI time with parallel sharding balanced by historical duration, running only affected specs, caching installs/builds, and moving coverage down to faster integration tests.

### A story structure (adapt to your own numbers)

> "Our Cypress suite took ~60 minutes and failed intermittently about one run in five, so engineers re-ran it and stopped trusting it. I measured per-spec duration and failure rates from CI artifacts, which showed that a handful of specs caused most flakes and most time. We replaced fixed `cy.wait(5000)`s with assertions on UI state and intercepted network calls, seeded data per test through the API instead of the UI, stubbed third-party widgets, and disabled animations in test builds. Then we split the suite across parallel machines balanced by historical timing and moved form-validation coverage into component tests. CI went from ~60 to ~20 minutes, flake re-runs dropped sharply, and merge throughput went up."

Name the measurement, the root causes, the fixes, the result, and what you'd do next. That's a STAR answer with engineering depth.

### Fixes by cause

| Cause | Fix |
| --- | --- |
| `sleep`/fixed waits | Web-first assertions (`expect(locator).toBeVisible()`), wait on network aliases/responses |
| Test order dependence | Each test creates its own data (API/DB seed) and cleans up; random order locally to catch it |
| Shared environments | Ephemeral preview environments or unique tenants/users per run |
| Third-party scripts | Block or stub (`page.route`, `cy.intercept`) |
| Animations/transitions | Disable via CSS in test mode; `prefers-reduced-motion` emulation |
| Time | Fixed clock (`page.clock`, `cy.clock`) |
| Selectors breaking | Role/label-based locators; `data-testid` for the rest |
| Retries hiding bugs | Allow 1 retry but **report** retried passes as flaky and track them |

### Speed levers

1. **Parallelize**: shard across N runners; balance by recorded durations, not file count.
2. **Run less**: affected-only on PRs (by changed packages/routes), full suite on main/nightly.
3. **Faster setup**: log in once via API and reuse storage state; seed via API not UI.
4. **Push coverage down**: validation, empty states and edge cases belong in component tests.
5. **Cache**: dependency install, build artifacts, browser binaries.
6. **Fail fast**: run smoke specs first; cancel superseded CI runs on new pushes.

### Playwright examples

```ts
test.use({ storageState: 'playwright/.auth/admin.json' }); // reuse login

test('archives a project', async ({ page, request }) => {
  const project = await (await request.post('/api/test/projects', { data: { name: `e2e-${test.info().testId}` } })).json();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive project' }).click();
  await expect(page.getByRole('status')).toHaveText(/archived/i); // auto-retrying assertion
});
```

### References

- [Playwright: Best practices](https://playwright.dev/docs/best-practices)
- [Cypress: Best practices](https://docs.cypress.io/app/core-concepts/best-practices)
- [Google: Flaky tests at Google and how we mitigate them](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)

## Visual regression and automated accessibility tests: what do they catch and miss?
<!--
id: visual-a11y-testing
level: senior
tags: visual regression, chromatic, axe, accessibility testing, storybook
minutes: 10
-->

> [!TLDR]
> Visual regression tests screenshot components or pages and diff them against approved baselines; they catch CSS and layout regressions no assertion would, but need stable rendering (fonts, animations, data) and a human review workflow. Automated accessibility checks (axe-core) catch a meaningful share of issues (estimates range from about a third of WCAG success criteria to over half of real-world issues by volume): missing names, contrast, invalid ARIA, landmarks. They can't judge whether focus order makes sense, alt text is meaningful, or a flow is usable with a screen reader; that still needs manual and assistive-tech testing.

### Visual regression in practice

- Test at the **component** level in Storybook (Chromatic, Playwright screenshots, Loki): fast, isolated, one story per state (default, hover, error, long text, RTL, dark mode).
- A few **page-level** snapshots for layout integration.
- Make rendering deterministic: bundled fonts, frozen time, mocked data, disabled animations, fixed viewport and device scale factor.
- Review diffs in the PR; baseline updates must be deliberate.

### Accessibility automation

```ts
// Component test (vitest + jest-axe)
import { axe } from 'jest-axe';

test('dialog has no detectable a11y violations', async () => {
  const { container } = render(<ConfirmDialog open title="Delete project?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(await axe(container)).toHaveNoViolations();
});

// E2E (Playwright)
import AxeBuilder from '@axe-core/playwright';
test('settings page passes axe', async ({ page }) => {
  await page.goto('/settings');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
```

Plus `eslint-plugin-jsx-a11y` for static checks, and Storybook's a11y addon so designers and developers see issues while building.

### What still needs humans

- Keyboard-only walkthroughs of key flows (focus order, visible focus, traps).
- Screen reader passes (VoiceOver + Safari, NVDA + Firefox/Chrome) for complex widgets.
- Zoom to 200–400% and reflow, reduced motion, high contrast/forced colors.
- Content quality: meaningful link text, alt text, error messages.

### References

- [axe-core](https://github.com/dequelabs/axe-core)
- [Storybook: Visual tests](https://storybook.js.org/docs/writing-tests/visual-testing)
- [Deque: Automated testing coverage study](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/)

## Test custom hooks and async UI: fake timers, races and `act()` warnings
<!--
id: testing-hooks-async
level: senior
tags: testing, hooks, fake timers, async, act, race conditions
minutes: 12
-->

> [!TLDR]
> Test hooks through a component when possible; use `renderHook` for hooks with real logic. For timers (debounce, polling, countdowns), use fake timers and advance them explicitly, and tell `user-event` about them (`advanceTimers`). For races, control promise resolution order with deferred promises or MSW delays, and assert that the stale response doesn't win. `act()` warnings mean an update happened outside what the test awaited: await the visible result instead of silencing the warning.

### Debounced search with fake timers

```ts
import { renderHook, act } from '@testing-library/react';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('only the last call fires after the wait', () => {
  const spy = vi.fn();
  const { result } = renderHook(() => useDebouncedCallback(spy, 300));
  act(() => {
    result.current('a');
    result.current('ab');
    result.current('abc');
  });
  act(() => vi.advanceTimersByTime(299));
  expect(spy).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(spy).toHaveBeenCalledExactlyOnceWith('abc');
});
```

With user-event and fake timers: `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.

### Testing a race deterministically

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test('a slow earlier response does not overwrite a newer one', async () => {
  const first = deferred<string[]>();
  const second = deferred<string[]>();
  const search = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

  const { result, rerender } = renderHook(({ q }) => useSearchResults(q, search), { initialProps: { q: 'r' } });
  rerender({ q: 're' });

  await act(async () => second.resolve(['react']));
  await act(async () => first.resolve(['ruby', 'rust'])); // arrives late

  expect(result.current.results).toEqual(['react']);
});
```

(The `let resolve!:` definite-assignment assertion is the standard deferred idiom: the Promise constructor runs synchronously, so it's always assigned.)

### Tips

- Prefer testing the hook via the component that uses it when the hook is just glue.
- Wrap providers (QueryClient with `retry: false`, router, theme) in a reusable `wrapper`.
- A fresh `QueryClient` per test prevents cache bleed between tests.
- Avoid asserting intermediate loading states unless they're part of the requirement; they make tests timing-sensitive.

### References

- [Testing Library: renderHook](https://testing-library.com/docs/react-testing-library/api/#renderhook)
- [Vitest: Fake timers](https://vitest.dev/guide/mocking.html#timers)
- [Kent C. Dodds: Fix the "not wrapped in act(...)" warning](https://kentcdodds.com/blog/fix-the-not-wrapped-in-act-warning)
