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
