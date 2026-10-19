---
id: accessibility
title: Accessibility
description: Semantics and the rules of ARIA, focus management in SPAs, keyboard patterns, live regions, accessible forms, and making accessibility stick across an organization.
---

## The rules of ARIA: semantic HTML first, roles, states, properties and accessible names
<!--
id: aria-rules-semantics
level: senior
tags: aria, semantic html, accessible name, roles, wcag
minutes: 12
-->

> [!PROMPT]
> A teammate builds a custom dropdown from `div`s with `role="button"` and `aria-label` on everything, and a screen reader announces it badly. Review it using the rules of ARIA.
>
> **Cover**
> - The five rules of ARIA, with "no ARIA is better than bad ARIA" in practice.
> - Roles, states and properties: what each does (and doesn't) change, including accessible name computation.
> - Replacing the custom pieces with native elements, and when ARIA is genuinely needed.

> [!TLDR]
> Use native HTML elements whenever one exists (`<button>`, `<a href>`, `<input>`, `<dialog>`, `<details>`): they come with roles, keyboard behavior and states for free. ARIA only changes what assistive technology is **told**; it adds no behavior. When you do use ARIA, a role is a promise to implement the matching keyboard interaction and states. Every interactive element needs an **accessible name**, computed from content, `aria-labelledby`, `aria-label`, `<label>`, or `alt`/`title` in that rough priority.

### The five rules (W3C "Using ARIA")

1. Prefer native elements/attributes over ARIA.
2. Don't change native semantics unless you must (`<h2 role="button">` is wrong; put a button inside the heading).
3. All interactive ARIA controls must be keyboard operable.
4. Don't use `role="presentation"` or `aria-hidden="true"` on focusable elements.
5. All interactive elements must have an accessible name.

### Before / after

```html
<!-- Before: looks like a button, isn't one -->
<div class="btn" onclick="save()">Save</div>

<!-- After: focusable, Enter/Space activate, announced as "Save, button" -->
<button type="button" onclick="save()">Save</button>

<!-- Icon-only buttons need a name -->
<button type="button" aria-label="Close dialog"><svg aria-hidden="true" focusable="false">…</svg></button>

<!-- Links navigate, buttons act -->
<a href="/settings">Settings</a>
<button type="button" onclick="openSettingsPanel()">Settings</button>
```

### States and properties you'll use most

| Attribute | Use |
| --- | --- |
| `aria-expanded` | Disclosure triggers, menus, comboboxes |
| `aria-controls` | Points to the element it controls |
| `aria-selected` / `aria-checked` / `aria-pressed` | Tabs/options / checkboxes, radios / toggle buttons |
| `aria-current="page"` | Current link in navigation |
| `aria-describedby` | Hints and error messages for fields |
| `aria-invalid` | Field with a validation error |
| `aria-live` / `role="status"` / `role="alert"` | Announcing dynamic changes |
| `aria-hidden="true"` | Decorative content (never on focusable content) |

### Accessible name pitfalls

- `aria-label` overrides visible text; if they differ, voice-control users saying the visible label fail (WCAG 2.5.3 Label in Name).
- `placeholder` is not a label.
- Duplicate names ("Edit", "Edit", "Edit") in a list: add context visually-hidden ("Edit invoice 1042") or via `aria-labelledby` combining ids.

### Follow-ups

- **"`aria-hidden` vs `hidden` vs `display:none`?"** `hidden`/`display:none` remove from everyone; `aria-hidden` removes only from assistive tech (content stays visible); visually-hidden CSS hides only visually.
- **"What does `role="application"` do?"** Turns off screen reader browse-mode shortcuts so all keys go to the page. Almost never appropriate.

### References

- [W3C: Using ARIA](https://www.w3.org/TR/using-aria/)
- [WAI-ARIA APG: Providing accessible names and descriptions](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)
- [MDN: ARIA](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA)

## Focus management in SPAs: route changes, modals, deletions and skip links
<!--
id: focus-management-spa
level: senior
tags: focus management, spa routing, keyboard, screen readers, accessibility
minutes: 12
-->

> [!PROMPT]
> In your SPA, after navigating to a new route keyboard focus stays on the old link, deleting a list item sends focus to the top of the page, and a modal doesn't return focus when closed. Fix focus management across these cases.
>
> **Cover**
> - Route change: moving focus (to heading or main), updating `document.title` and announcing the new page.
> - Deletions, dialogs, and menus: where focus goes and why.
> - Skip links, `focus-visible`, and testing with only a keyboard and a screen reader.

> [!TLDR]
> In a multi-page site the browser resets focus on navigation and screen readers announce the new page; SPAs must do this themselves. On route change: update `document.title`, move focus to the main heading (or main region) with `tabIndex={-1}`, and optionally announce via a live region. For modals: focus inside on open, return focus to the trigger on close. When the focused element disappears (deleted row, closed menu), move focus to a logical neighbor. Provide a skip link to the main content.

:::react
### Route change handling

```tsx
function RouteFocus({ title }: { title: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const location = useLocation();

  useEffect(() => {
    document.title = `${title} · Acme`;
    headingRef.current?.focus({ preventScroll: false });
  }, [location.pathname, title]);

  return (
    <h1 ref={headingRef} tabIndex={-1} className="page-title">
      {title}
    </h1>
  );
}
```

Don't move focus on the very first load (users expect to start at the top), and don't move it for in-page query changes like filtering (announce results instead).
:::

:::angular
### Route change handling (Angular)

Angular's `TitleStrategy` handles `document.title` from route data, and a router event drives focus. Skip the first navigation, and only move focus for real page changes.

```ts
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot); // from `title: 'Orders'` in the route definition
    this.title.setTitle(page ? `${page} · Acme` : 'Acme');
  }
}
// providers: [{ provide: TitleStrategy, useClass: PageTitleStrategy }]
```

```ts
@Component({
  selector: 'app-shell',
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    <main #main id="main" tabindex="-1"><router-outlet /></main>
  `,
})
export class Shell {
  constructor() {
    const router = inject(Router);
    const injector = inject(Injector);
    const main = viewChild.required<ElementRef<HTMLElement>>('main');
    let first = true;
    router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => {
        if (first) {
          first = false; // users expect to start at the top on the first load
          return;
        }
        // After the new view has rendered, focus its heading (falling back to the main region).
        afterNextRender(() => (document.querySelector<HTMLElement>('main h1') ?? main().nativeElement).focus(), { injector });
      });
  }
}
```

Give each page's `<h1>` `tabindex="-1"` so it can receive programmatic focus. Do not move focus for in-page query-param changes such as filtering; announce the results instead (see the live-regions question). Angular's CDK `FocusMonitor` and `LiveAnnouncer` cover the supporting pieces.
:::

:::vue
### Route change handling (Vue)

Use a router hook and wait for the DOM to update before focusing. Skip the first navigation, and only move focus for real page changes.

```ts
// main.ts (or a router plugin)
router.afterEach(async (to, from, failure) => {
  document.title = `${String(to.meta.title ?? 'Home')} · Acme`;
  if (failure || from === START_LOCATION) return; // users expect to start at the top on the first load
  await nextTick(); // the new view has rendered
  const target = document.querySelector<HTMLElement>('main h1') ?? document.getElementById('main');
  target?.focus();
});
```

```vue
<!-- App.vue -->
<template>
  <a class="skip-link" href="#main">Skip to content</a>
  <main id="main" tabindex="-1"><RouterView /></main>
</template>
```

Give each page's `<h1>` `tabindex="-1"` so it can receive programmatic focus. Do not move focus for in-page query-param changes such as filtering; announce the results instead (see the live-regions question). With `<Transition mode="out-in">`, wait for the enter hook (`@after-enter`) rather than `nextTick`, or focus lands on the outgoing page. In Nuxt, the `page:finish` hook (or a plugin using `useRouter().afterEach`) is the equivalent place.
:::

### Deletions

```ts
function focusAfterDelete(list: HTMLElement, deletedIndex: number) {
  const items = list.querySelectorAll<HTMLElement>('[data-row] button[data-primary]');
  const target = items[deletedIndex] ?? items[deletedIndex - 1];
  if (target) target.focus();
  else list.closest('section')?.querySelector<HTMLElement>('h2')?.focus(); // empty list: go to the section heading
}
```

When focus is lost to `<body>`, keyboard users start over from the top of the page.

### Skip link

```html
<a class="skip-link" href="#main">Skip to content</a>
…
<main id="main" tabindex="-1">…</main>
```

Visually hidden until focused. (This app has one; press Tab on load.)

### Visible focus

Never `outline: none` without a replacement. Use `:focus-visible` for keyboard-only rings and ensure 3:1 contrast against adjacent colors (WCAG 2.4.11/2.4.13 in 2.2).

### References

- [WAI-ARIA APG: Developing a keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [Gatsby: What we learned from user testing accessible client-side routing](https://www.gatsbyjs.com/blog/2019-07-11-user-testing-accessible-client-routing/)
- [MDN: :focus-visible](https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible)

## Keyboard interaction patterns: roving tabindex vs `aria-activedescendant`
<!--
id: keyboard-roving-activedescendant
level: lead
tags: keyboard navigation, roving tabindex, aria-activedescendant, composite widgets
minutes: 15
-->

> [!PROMPT]
> Implement keyboard behavior for a toolbar of 6 buttons and for a listbox with 100 options. Choose between roving `tabindex` and `aria-activedescendant` for each, and justify it.
>
> **Cover**
> - One Tab stop per composite widget, arrow keys inside, Home/End, wrapping behavior.
> - How each technique moves focus and what screen readers announce; the trade-offs for virtualization and for text inputs.
> - Behavior checks: Tab leaves the widget, Shift+Tab returns to the last active item.

> [!TLDR]
> Composite widgets (tabs, menus, toolbars, listboxes, grids, trees) should be **one Tab stop**, with arrow keys moving within them. Two techniques: **roving tabindex** (the active item has `tabIndex=0`, the rest `-1`, and DOM focus moves between items) and **`aria-activedescendant`** (DOM focus stays on a container or input, which points at the active item by id). Use roving tabindex for most widgets; use activedescendant when focus must stay in an input (combobox) or items are virtualized.

:::react
### Roving tabindex hook

```tsx
export function useRovingFocus<T extends HTMLElement>(count: number, { orientation = 'horizontal', loop = true } = {}) {
  const [active, setActive] = useState(0);
  const refs = useRef<(T | null)[]>([]);

  const move = (next: number) => {
    const clamped = loop ? (next + count) % count : Math.max(0, Math.min(count - 1, next));
    setActive(clamped);
    refs.current[clamped]?.focus();
  };

  const getItemProps = (index: number) => ({
    ref: (el: T | null) => {
      refs.current[index] = el;
    },
    tabIndex: index === active ? 0 : -1,
    onFocus: () => setActive(index),
    onKeyDown: (event: React.KeyboardEvent) => {
      const prev = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
      const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
      if (event.key === next) move(index + 1);
      else if (event.key === prev) move(index - 1);
      else if (event.key === 'Home') move(0);
      else if (event.key === 'End') move(count - 1);
      else return;
      event.preventDefault();
    },
  });

  return { active, getItemProps };
}

function Toolbar() {
  const { getItemProps } = useRovingFocus<HTMLButtonElement>(3);
  return (
    <div role="toolbar" aria-label="Formatting">
      <button {...getItemProps(0)} aria-pressed={false}>Bold</button>
      <button {...getItemProps(1)} aria-pressed={false}>Italic</button>
      <button {...getItemProps(2)} aria-pressed={false}>Underline</button>
    </div>
  );
}
```
:::

:::angular
### Roving tabindex directive (Angular)

Angular models this as a container directive that finds its items with content queries; items declare themselves with a second directive. The CDK's `FocusKeyManager` (and `ListKeyManager`) already implements both techniques, so in production you use it; the version below shows what it does.

```ts
@Directive({
  selector: '[appRovingItem]',
  host: {
    '[attr.tabindex]': 'active() ? 0 : -1',
    '(focus)': 'onFocus()',
  },
})
export class RovingItem {
  protected readonly group = inject(RovingGroup);
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly active = computed(() => this.group.active() === this);

  protected onFocus(): void {
    this.group.activate(this);
  }
}

@Directive({
  selector: '[appRovingGroup]',
  host: { '(keydown)': 'onKeyDown($event)' },
})
export class RovingGroup {
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
  readonly loop = input(true);
  private readonly items = contentChildren(RovingItem, { descendants: true });
  readonly active = signal<RovingItem | null>(null);

  activate(item: RovingItem): void {
    this.active.set(item);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    const items = this.items();
    const index = items.findIndex((item) => item === (this.active() ?? items[0]));
    const horizontal = this.orientation() === 'horizontal';
    const [prev, next] = horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    let target: number;
    if (event.key === next) target = index + 1;
    else if (event.key === prev) target = index - 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = items.length - 1;
    else return;
    event.preventDefault();
    const clamped = this.loop() ? (target + items.length) % items.length : Math.max(0, Math.min(items.length - 1, target));
    items[clamped]?.element.focus();
  }
}
```

```html
<div role="toolbar" aria-label="Formatting" appRovingGroup>
  <button appRovingItem aria-pressed="false">Bold</button>
  <button appRovingItem aria-pressed="false">Italic</button>
  <button appRovingItem aria-pressed="false">Underline</button>
</div>
```

One subtlety: until the first focus, no item is "active", so the first item should carry `tabindex="0"`. In the CDK, `FocusKeyManager.withWrap().withHomeAndEnd()` and `ActiveDescendantKeyManager` (for `aria-activedescendant`) give you the two techniques with tested edge cases.
:::

:::vue
### Roving tabindex composable (Vue)

```ts
// useRovingFocus.ts
import { ref, type ComponentPublicInstance } from 'vue';

export function useRovingFocus(count: () => number, { orientation = 'horizontal', loop = true } = {}) {
  const active = ref(0);
  const items: (HTMLElement | null)[] = [];

  function move(next: number) {
    const total = count();
    const clamped = loop ? (next + total) % total : Math.max(0, Math.min(total - 1, next));
    active.value = clamped;
    items[clamped]?.focus();
  }

  function itemProps(index: number) {
    return {
      ref: (el: Element | ComponentPublicInstance | null) => {
        items[index] = el as HTMLElement | null;
      },
      tabindex: index === active.value ? 0 : -1,
      onFocus: () => (active.value = index),
      onKeydown: (event: KeyboardEvent) => {
        const prev = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
        const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
        if (event.key === next) move(index + 1);
        else if (event.key === prev) move(index - 1);
        else if (event.key === 'Home') move(0);
        else if (event.key === 'End') move(count() - 1);
        else return;
        event.preventDefault();
      },
    };
  }

  return { active, itemProps };
}
```

```vue
<script setup lang="ts">
import { useRovingFocus } from './useRovingFocus';

const { itemProps } = useRovingFocus(() => 3);
</script>

<template>
  <div role="toolbar" aria-label="Formatting">
    <button v-bind="itemProps(0)" aria-pressed="false">Bold</button>
    <button v-bind="itemProps(1)" aria-pressed="false">Italic</button>
    <button v-bind="itemProps(2)" aria-pressed="false">Underline</button>
  </div>
</template>
```

`v-bind` with an object merges the handlers and `ref` with anything you add in the template, and the keyboard handler stays in one place. For virtualized or input-anchored widgets, the `aria-activedescendant` variant is the same state (`active`) rendered as an `id` reference on the container instead of moving DOM focus. Libraries such as Reka UI (`RovingFocusGroup`) or VueUse's `useFocus` and `useActiveElement` cover the common cases.
:::

### Which keys for which widget (APG)

| Widget | Keys |
| --- | --- |
| Tabs | ←/→ (or ↑/↓ vertical), Home/End; Enter/Space if manual activation |
| Menu | ↑/↓, Home/End, Enter/Space activate, Escape closes and returns focus, type-ahead |
| Listbox | ↑/↓, Home/End, type-ahead, Shift+arrows for multi-select |
| Grid | Arrow keys between cells, Ctrl+Home/End, Page Up/Down |
| Tree | ↑/↓ move, → expand/enter child, ← collapse/go to parent |

### Trade-offs

| | Roving tabindex | `aria-activedescendant` |
| --- | --- | --- |
| DOM focus | Moves to items | Stays on container/input |
| Scroll into view | Automatic (focus scrolls) | You must scroll the active item |
| Virtualized lists | Hard (item may not exist) | Works (item rendered when active) |
| Screen reader support | Excellent | Good; some quirks historically |

### References

- [WAI-ARIA APG: Keyboard navigation inside components](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_general_within)
- [WAI-ARIA APG: Patterns](https://www.w3.org/WAI/ARIA/apg/patterns/)

## Announcing dynamic changes: live regions, status messages and accessible toasts
<!--
id: live-regions-announcements
level: senior
tags: aria-live, status messages, toasts, screen readers, accessibility
minutes: 10
-->

> [!PROMPT]
> Your app shows toasts, form errors, a "3 results found" count after filtering and a chat feed. Screen reader users miss most of them, and one region announces everything twice.
>
> **Cover**
> - `aria-live` polite versus assertive, `role="status"`, `role="alert"`, and why the region must exist before its content changes.
> - Designing accessible toasts (duration, focus, dismissal) and result counts.
> - Common failures (re-rendering the region, too many announcements) and how to test with a screen reader.

> [!TLDR]
> Screen readers don't notice DOM changes unless told. A **live region** (`aria-live="polite"`, `role="status"`, or `role="alert"` for urgent messages) announces content inserted into it. The region must **already exist** in the DOM before the content changes; inject text into it rather than mounting a new region with text. Keep messages short, don't announce on every keystroke, and don't put interactive content (Undo buttons) only in a toast that disappears.

:::react
### A global announcer

```tsx
const AnnouncerContext = createContext<(message: string, urgency?: 'polite' | 'assertive') => void>(() => {});

export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  const announce = useCallback((message: string, urgency: 'polite' | 'assertive' = 'polite') => {
    const set = urgency === 'polite' ? setPolite : setAssertive;
    set(''); // clear first so repeating the same message is announced again
    requestAnimationFrame(() => set(message));
  }, []);

  return (
    <AnnouncerContext value={announce}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{assertive}</div>
    </AnnouncerContext>
  );
}

export const useAnnounce = () => useContext(AnnouncerContext);

// usage
const announce = useAnnounce();
announce(`${results.length} results for "${query}"`);
```
:::

:::angular
### A global announcer (Angular)

The CDK ships this as `LiveAnnouncer`: it creates one visually hidden live region at the end of `<body>` when first used and writes into it. Inject it wherever you need to announce.

```ts
import { LiveAnnouncer } from '@angular/cdk/a11y';

@Component({ /* ... */ })
export class SearchResults {
  private readonly announcer = inject(LiveAnnouncer);

  constructor() {
    // Announce after the results settle, not on every keystroke.
    toObservable(this.results).pipe(debounceTime(400), takeUntilDestroyed()).subscribe((results) => {
      this.announcer.announce(`${results.length} results for "${this.query()}"`, 'polite');
    });
  }

  protected failed(message: string): void {
    this.announcer.announce(message, 'assertive');
  }
}
```

If you want the same thing without the CDK, a root service owning two always-present regions is the same idea:

```ts
@Injectable({ providedIn: 'root' })
export class Announcer {
  readonly polite = signal('');
  readonly assertive = signal('');

  announce(message: string, urgency: 'polite' | 'assertive' = 'polite'): void {
    const target = urgency === 'polite' ? this.polite : this.assertive;
    target.set(''); // clear first so repeating the same message is announced again
    requestAnimationFrame(() => target.set(message));
  }
}

@Component({
  selector: 'app-announcer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcer.polite() }}</div>
    <div class="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{{ announcer.assertive() }}</div>
  `,
})
export class AnnouncerComponent {
  protected readonly announcer = inject(Announcer);
}
```

Render `<app-announcer />` once in the root template, so the regions exist before any message is written. Angular Material's `MatSnackBar` announces its text through `LiveAnnouncer`; the toast guidance below still applies.
:::

:::vue
### A global announcer (Vue)

A module-level composable keeps the messages in shared refs, and one component rendered at the app root owns the two live regions, which therefore exist before any message is written.

```ts
// useAnnounce.ts
import { ref } from 'vue';

const polite = ref('');
const assertive = ref('');

export function useAnnounce() {
  function announce(message: string, urgency: 'polite' | 'assertive' = 'polite') {
    const target = urgency === 'polite' ? polite : assertive;
    target.value = ''; // clear first so repeating the same message is announced again
    requestAnimationFrame(() => (target.value = message));
  }
  return { announce };
}

export { polite as politeMessage, assertive as assertiveMessage };
```

```vue
<!-- Announcer.vue: render once in App.vue -->
<script setup lang="ts">
import { assertiveMessage, politeMessage } from './useAnnounce';
</script>

<template>
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ politeMessage }}</div>
  <div class="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{{ assertiveMessage }}</div>
</template>
```

```ts
// usage: announce after the results settle, not on every keystroke
const { announce } = useAnnounce();
watchDebounced(results, (list) => announce(`${list.length} results for "${query.value}"`), { debounce: 400 }); // VueUse
```

Module-level refs are shared across requests in SSR; in Nuxt, hold them in `useState` instead so one visitor's message is never rendered for another.
:::

### Toasts done right

- Visually show the toast; announce its text via the polite region.
- Errors that block the user: `role="alert"` or, better, inline error text near the cause.
- Toasts with actions (Undo): keep them long enough (or until dismissed), reachable by keyboard (a shortcut like F6 to toast region, or put Undo somewhere persistent too), and pause timers on hover/focus.
- WCAG 2.2.1 (Timing Adjustable): users must be able to extend or turn off time limits for content they need to act on.

### When not to announce

Typing-driven updates (announce after debounce), decorative changes, or content the user just moved focus to (focus already announces it).

### References

- [MDN: ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions)
- [W3C: WCAG 4.1.3 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- [Sara Soueidan: Accessible notifications with ARIA live regions](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/)

## Accessible forms: labels, descriptions, error summaries and validation timing
<!--
id: accessible-forms
level: senior
tags: forms, labels, validation, errors, accessibility, wcag
minutes: 12
-->

> [!PROMPT]
> Audit and fix a checkout form: placeholders used as labels, errors shown only in red below the field, an error summary missing, and the form validates on every keystroke.
>
> **Cover**
> - Labels, descriptions and errors tied to fields (`label`, `aria-describedby`, `aria-invalid`), grouping with `fieldset`.
> - Validation timing and the error summary pattern with focus management.
> - `autocomplete` tokens, input types, required indicators, and a quick manual test plan.

> [!TLDR]
> Every field needs a visible `<label>` associated by `for`/`id`; hints and errors are linked with `aria-describedby`; invalid fields get `aria-invalid="true"`. Group related controls with `<fieldset>`/`<legend>`. Validate on blur or submit (not on every keystroke from the first character), and on submit with errors either focus the first invalid field or show an **error summary** at the top with links to each field. Never rely on color alone, and keep the user's input.

### Markup

```html
<form novalidate>
  <div class="field">
    <label for="email">Work email</label>
    <p id="email-hint" class="hint">We'll send the invite here.</p>
    <input id="email" name="email" type="email" autocomplete="email"
           aria-describedby="email-hint email-error" aria-invalid="true" required />
    <p id="email-error" class="error">Enter an email address like name@company.com</p>
  </div>

  <fieldset>
    <legend>Notification preference</legend>
    <label><input type="radio" name="notify" value="email" /> Email</label>
    <label><input type="radio" name="notify" value="sms" /> SMS</label>
  </fieldset>
</form>
```

:::react
### Error summary pattern

```tsx
function ErrorSummary({ errors }: { errors: { field: string; message: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus(); // after a failed submit
  }, [errors]);
  if (errors.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" aria-labelledby="error-summary-title" className="error-summary">
      <h2 id="error-summary-title">There is a problem</h2>
      <ul>
        {errors.map((e) => (
          <li key={e.field}><a href={`#${e.field}`}>{e.message}</a></li>
        ))}
      </ul>
    </div>
  );
}
```
:::

:::angular
### Error summary pattern (Angular)

```ts
@Component({
  selector: 'app-error-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (errors().length > 0) {
      <div #summary tabindex="-1" role="alert" aria-labelledby="error-summary-title" class="error-summary">
        <h2 id="error-summary-title">There is a problem</h2>
        <ul>
          @for (error of errors(); track error.field) {
            <li><a [href]="'#' + error.field" (click)="focusField($event, error.field)">{{ error.message }}</a></li>
          }
        </ul>
      </div>
    }
  `,
})
export class ErrorSummaryComponent {
  readonly errors = input.required<{ field: string; message: string }[]>();
  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');
  private readonly injector = inject(Injector);

  constructor() {
    // Focus the summary after a failed submit, i.e. whenever a new error list arrives.
    effect(() => {
      this.errors();
      afterNextRender(() => this.summary()?.nativeElement.focus(), { injector: this.injector });
    });
  }

  protected focusField(event: Event, field: string): void {
    event.preventDefault(); // the router would otherwise treat the hash as navigation
    document.getElementById(field)?.focus();
  }
}
```

With Reactive Forms, build the list in the submit handler from the controls: `Object.entries(form.controls).filter(([, c]) => c.invalid).map(([field, c]) => ({ field, message: messageFor(c) }))`. Link each input to its hint and error with `[attr.aria-describedby]`, and set `[attr.aria-invalid]` from the control state, as in the markup above.
:::

:::vue
### Error summary pattern (Vue)

```vue
<!-- ErrorSummary.vue -->
<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue';

const props = defineProps<{ errors: { field: string; message: string }[] }>();
const summary = useTemplateRef<HTMLElement>('summary');

// Focus the summary after a failed submit, i.e. whenever a new error list arrives.
watch(
  () => props.errors,
  async (errors) => {
    if (errors.length === 0) return;
    await nextTick();
    summary.value?.focus();
  },
);

function focusField(event: Event, field: string) {
  event.preventDefault(); // the router would otherwise treat the hash as navigation
  document.getElementById(field)?.focus();
}
</script>

<template>
  <div v-if="errors.length > 0" ref="summary" tabindex="-1" role="alert" aria-labelledby="error-summary-title" class="error-summary">
    <h2 id="error-summary-title">There is a problem</h2>
    <ul>
      <li v-for="error in errors" :key="error.field">
        <a :href="`#${error.field}`" @click="focusField($event, error.field)">{{ error.message }}</a>
      </li>
    </ul>
  </div>
</template>
```

With vee-validate, build the list from `errors` (a record of field to message) in the invalid-submit callback, and wire each input's `aria-describedby` and `aria-invalid` from the field's `errorMessage`, as in the markup above.
:::

### Error message quality

- Say what's wrong **and** how to fix it: "Enter a date in the future" beats "Invalid date".
- Use the same words as the label.
- For formats, show an example in the hint before the user fails.

### Other details

- `autocomplete` attributes (`email`, `given-name`, `one-time-code`, `new-password`) help everyone, especially users with motor or cognitive disabilities (WCAG 1.3.5).
- Don't disable paste in password/confirm fields.
- Required fields: mark visually and programmatically (`required` or `aria-required`), explain the convention once.
- Don't auto-advance focus between fields (except well-known patterns like OTP with care).

### References

- [W3C WAI: Forms tutorial](https://www.w3.org/WAI/tutorials/forms/)
- [GOV.UK Design System: Error summary](https://design-system.service.gov.uk/components/error-summary/)
- [W3C: WCAG 3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)

## Make accessibility stick across 50 engineers: design system, linting, CI and audits
<!--
id: accessibility-at-scale
level: principal
tags: accessibility program, design systems, governance, wcag, ci
minutes: 12
-->

> [!PROMPT]
> You are the principal engineer for a product with 50 engineers and recurring accessibility regressions. Leadership asks for a plan to make accessibility stick, not another one-off audit.
>
> **Cover**
> - Prevention: accessible design-system primitives, lint rules, and code review checklists.
> - Detection: CI checks, manual audit cadence, assistive-technology testing, and metrics that matter.
> - People and process: training, ownership, how issues are triaged against the roadmap.

> [!TLDR]
> Accessibility at scale is a **system**, not heroics. Bake it into the design system (accessible primitives so product teams can't easily get it wrong), automate the detectable 30–50% (lint, axe in component/E2E tests, Storybook checks), make manual testing a routine part of definition-of-done for new patterns, track issues like any other quality metric with owners and SLAs, and train designers and PMs, not just engineers. Set a clear target (WCAG 2.2 AA) and report progress.

### The layers

1. **Policy**: target standard (WCAG 2.2 AA), which products/flows are in scope first (sign-up, checkout, core workflows), and legal drivers (ADA, EAA in the EU from June 2025, Section 508).
2. **Design**: accessible color tokens (contrast checked), focus styles, motion guidelines, annotation kits in Figma for headings, landmarks, focus order and names.
3. **Components**: the design system owns keyboard behavior, ARIA and focus management for complex widgets (dialog, combobox, menu, tabs, date picker), ideally built on React Aria/Radix. Each component has an accessibility section in its docs.
4. **Automation**: `eslint-plugin-jsx-a11y`, axe in unit and E2E tests, Storybook a11y addon, CI fails on new violations (ratchet existing ones down).
5. **Manual verification**: checklist per PR for new UI (keyboard, zoom, screen reader smoke), periodic expert audits, and testing with disabled users for key flows.
6. **Operations**: a11y bugs triaged with severity, SLAs by severity, dashboards per team, a champions network.

### Metrics worth tracking

- Open a11y issues by severity and age, per team.
- Axe violations trend in CI (should only go down).
- Percentage of design system components with a passing manual audit.
- Coverage of key journeys by keyboard/screen reader test scripts.

### How to answer "how do you get buy-in?"

Tie it to risk (legal), reach (users with disabilities, situational impairments, older users), and quality (accessible components are better-built components). Start with the design system for leverage, show quick wins, and make the right thing the easy thing.

### References

- [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [European Accessibility Act overview](https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/union-equality-strategy-rights-persons-disabilities-2021-2030/european-accessibility-act_en)
- [GOV.UK Service Manual: Making your service accessible](https://www.gov.uk/service-manual/helping-people-to-use-your-service/making-your-service-accessible-an-introduction)
