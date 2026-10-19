---
id: component-api-design
title: Component API Design
description: Designing components other engineers will love using: compound components, headless hooks, controlled/uncontrolled APIs, forms, boundaries and API reviews.
---

## Design a compound component API (Tabs, Select) with context, and know when not to
<!--
id: compound-components
level: senior
tags: compound components, context, component api, design systems
minutes: 15
-->

> [!PROMPT]
> Design the API for a `Tabs` component used across the company: `Tabs`, `Tabs.List`, `Tabs.Trigger`, `Tabs.Panel`. It must work controlled and uncontrolled, be accessible, and not break when consumers wrap parts in their own components.
>
> **Test cases** (behavior)
> - Clicking a trigger shows its panel and hides the others; the matching `aria-selected` and `aria-controls` are set.
> - Arrow keys move focus between triggers (roving tabindex); Home/End jump to first/last.
> - Rendering a `Trigger` outside `Tabs` throws a helpful error.
> - Discuss when a compound API is the wrong choice (simple props or a `items` array is better).

> [!TLDR]
> Compound components split one widget into cooperating parts (`<Tabs>`, `<Tabs.List>`, `<Tabs.Trigger>`, `<Tabs.Panel>`) that share state through a private context. Consumers get control over **structure and markup** (put a badge in a trigger, wrap the list in a toolbar) without a prop for every variation. Costs: implicit coupling through context, harder static validation, and more API surface. Use it for widgets with flexible layout; use a plain props API for simple, rigid components.

:::react
### Usage first (design from the call site)

```tsx
<Tabs defaultValue="overview" onValueChange={track}>
  <Tabs.List aria-label="Project">
    <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
    <Tabs.Trigger value="activity">
      Activity <Badge>3</Badge>
    </Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="overview"><Overview /></Tabs.Panel>
  <Tabs.Panel value="activity"><Activity /></Tabs.Panel>
</Tabs>
```

### Implementation

```tsx
import { createContext, useContext, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) throw new Error(`<${component}> must be used inside <Tabs>`);
  return context;
}

interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}

function TabsRoot({ value, defaultValue = '', onValueChange, children }: TabsProps) {
  const [current, setCurrent] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const baseId = useId();
  return <TabsContext value={{ value: current, setValue: setCurrent, baseId }}>{children}</TabsContext>;
}

function TabsList({ children, ...rest }: { children: ReactNode; 'aria-label': string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? []);
    const index = tabs.findIndex((tab) => tab === document.activeElement);
    if (index === -1) return;
    const next =
      event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
      : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
      : event.key === 'Home' ? tabs[0]
      : event.key === 'End' ? tabs[tabs.length - 1]
      : undefined;
    if (next) {
      event.preventDefault();
      next.focus();
      next.click(); // automatic activation; use manual activation if panels are expensive
    }
  };
  return (
    <div ref={listRef} role="tablist" onKeyDown={onKeyDown} {...rest}>
      {children}
    </div>
  );
}

function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  const tabs = useTabsContext('Tabs.Trigger');
  const selected = tabs.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${tabs.baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${tabs.baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1} // roving tabindex: one tab stop for the whole list
      onClick={() => tabs.setValue(value)}
    >
      {children}
    </button>
  );
}

function TabsPanel({ value, children }: { value: string; children: ReactNode }) {
  const tabs = useTabsContext('Tabs.Panel');
  if (tabs.value !== value) return null; // or keep mounted with `hidden` to preserve state
  return (
    <div role="tabpanel" id={`${tabs.baseId}-panel-${value}`} aria-labelledby={`${tabs.baseId}-tab-${value}`} tabIndex={0}>
      {children}
    </div>
  );
}

export const Tabs = Object.assign(TabsRoot, { List: TabsList, Trigger: TabsTrigger, Panel: TabsPanel });
```

(`useControllableState` is covered in its own question; React 19 lets you render `<TabsContext value=...>` directly.)

### Design decisions to talk through

- **Context value stability**: the provider value is a new object each render; that's fine here because every consumer needs `value` anyway. For heavier trees, memoize it.
- **Mount strategy**: unmounting inactive panels saves work but loses state; `hidden` keeps state but costs memory. Make it a prop (`keepMounted`).
- **Registration**: some libraries have triggers register themselves (for indexes, typeahead). DOM queries (as above) are simpler and robust to conditional rendering.
- **Errors**: a clear error when parts are used outside the root.
:::

:::angular
### Usage first (Angular)

Angular's compound components are cooperating directives and components that find the root through dependency injection. `model()` gives the root controlled (`[value]` plus `(valueChange)`), two-way (`[(value)]`) and uncontrolled (nothing bound) use from one declaration.

```html
<div appTabs [(value)]="tab" (valueChange)="track($event)">
  <div appTabList aria-label="Project">
    <button appTabTrigger="overview">Overview</button>
    <button appTabTrigger="activity">Activity <app-badge>3</app-badge></button>
  </div>
  <app-tab-panel value="overview"><app-overview /></app-tab-panel>
  <app-tab-panel value="activity"><app-activity /></app-tab-panel>
</div>
```

### Implementation (Angular)

```ts
import { Directive, Component, ChangeDetectionStrategy, computed, inject, input, model } from '@angular/core';

let nextId = 0;

@Directive({ selector: '[appTabs]' })
export class TabsRoot {
  readonly value = model('');
  readonly baseId = `tabs-${nextId++}`;
}

/** The "must be used inside <Tabs>" guard: `inject` throws a clear error instead of returning null. */
function injectTabs(part: string): TabsRoot {
  const root = inject(TabsRoot, { optional: true });
  if (!root) throw new Error(`${part} must be used inside [appTabs]`);
  return root;
}

@Directive({
  selector: '[appTabList]',
  host: { role: 'tablist', '(keydown)': 'onKeyDown($event)' },
})
export class TabList {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected onKeyDown(event: KeyboardEvent): void {
    const tabs = Array.from(this.host.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    const index = tabs.findIndex((tab) => tab === document.activeElement);
    if (index === -1) return;
    const next =
      event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
      : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
      : event.key === 'Home' ? tabs[0]
      : event.key === 'End' ? tabs[tabs.length - 1]
      : undefined;
    if (next) {
      event.preventDefault();
      next.focus();
      next.click(); // automatic activation; use manual activation if panels are expensive
    }
  }
}

@Directive({
  selector: '[appTabTrigger]',
  host: {
    type: 'button',
    role: 'tab',
    '[id]': 'baseId() + "-tab-" + value()',
    '[attr.aria-selected]': 'selected()',
    '[attr.aria-controls]': 'baseId() + "-panel-" + value()',
    '[tabindex]': 'selected() ? 0 : -1', // roving tabindex: one tab stop for the whole list
    '(click)': 'root.value.set(value())',
  },
})
export class TabTrigger {
  protected readonly root = injectTabs('appTabTrigger');
  readonly value = input.required<string>({ alias: 'appTabTrigger' });
  protected readonly baseId = () => this.root.baseId;
  protected readonly selected = computed(() => this.root.value() === this.value());
}

@Component({
  selector: 'app-tab-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (selected()) {
      <div role="tabpanel" tabindex="0" [id]="root.baseId + '-panel-' + value()" [attr.aria-labelledby]="root.baseId + '-tab-' + value()">
        <ng-content />
      </div>
    }
  `,
})
export class TabPanel {
  protected readonly root = injectTabs('app-tab-panel');
  readonly value = input.required<string>();
  protected readonly selected = computed(() => this.root.value() === this.value());
}
```

Package the four as one array (`export const TABS = [TabsRoot, TabList, TabTrigger, TabPanel] as const;`) so consumers write `imports: [TABS]` and never forget a part. Standalone directives keep this tree-shakable.

### Design decisions to talk through (Angular)

- **Projected content is created eagerly.** `@if` inside the panel only controls the wrapper; the projected children are instantiated anyway. For truly lazy panels, let consumers pass an `<ng-template appTabContent>` and render it with `ngTemplateOutlet` when selected. This is the main difference from the React version, where returning `null` skips the work.
- **Mount strategy**: make it an input (`keepMounted`), as with any tab library.
- **Controlled vs uncontrolled**: `model()` covers both. Binding only `[value]` seeds the state but internal clicks still change it; if you need strict control, expose an `input` plus an `output` and keep the parent as the single writer.
- **Do not rebuild this in production**: the Angular CDK and Angular Aria already ship tested tab, listbox and menu behavior; you wrap them in your design system.
:::

:::vue
### Usage first (Vue)

In Vue the cooperating parts are components that share state through `provide`/`inject`. `defineModel` makes the root support `v-model` (controlled), or no binding at all (uncontrolled), with one declaration. A namespace import gives the `Tabs.List` call-site shape.

```vue
<script setup lang="ts">
import * as Tabs from './tabs';
const tab = ref('overview');
</script>

<template>
  <Tabs.Root v-model="tab" @update:model-value="track">
    <Tabs.List aria-label="Project">
      <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
      <Tabs.Trigger value="activity">Activity <Badge>3</Badge></Tabs.Trigger>
    </Tabs.List>
    <Tabs.Panel value="overview"><Overview /></Tabs.Panel>
    <Tabs.Panel value="activity"><Activity /></Tabs.Panel>
  </Tabs.Root>
</template>
```

### Implementation (Vue)

```ts
// tabs/context.ts
import { inject, type InjectionKey, type Ref } from 'vue';

export interface TabsContext {
  value: Ref<string>;
  baseId: string;
}

export const tabsKey: InjectionKey<TabsContext> = Symbol('tabs');

export function useTabsContext(part: string): TabsContext {
  const context = inject(tabsKey, null);
  if (!context) throw new Error(`<${part}> must be used inside <Tabs.Root>`);
  return context;
}
```

```vue
<!-- tabs/TabsRoot.vue -->
<script setup lang="ts">
import { provide, useId } from 'vue';
import { tabsKey } from './context';

const value = defineModel<string>({ default: '' });
provide(tabsKey, { value, baseId: useId() });
</script>

<template><slot /></template>
```

```vue
<!-- tabs/TabsList.vue -->
<script setup lang="ts">
import { useTemplateRef } from 'vue';

const list = useTemplateRef<HTMLElement>('list');

function onKeyDown(event: KeyboardEvent) {
  const tabs = Array.from(list.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? []);
  const index = tabs.findIndex((tab) => tab === document.activeElement);
  if (index === -1) return;
  const next =
    event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
    : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
    : event.key === 'Home' ? tabs[0]
    : event.key === 'End' ? tabs[tabs.length - 1]
    : undefined;
  if (next) {
    event.preventDefault();
    next.focus();
    next.click(); // automatic activation; use manual activation if panels are expensive
  }
}
</script>

<template>
  <div ref="list" role="tablist" @keydown="onKeyDown"><slot /></div>
</template>
```

`aria-label` needs no declaration: Vue passes undeclared attributes (`aria-*`, `class`, `data-*`) to the single root element automatically (attribute fallthrough), which is the "native props pass through" rule for free.

```vue
<!-- tabs/TabsTrigger.vue -->
<script setup lang="ts">
import { computed } from 'vue';
import { useTabsContext } from './context';

const props = defineProps<{ value: string }>();
const tabs = useTabsContext('Tabs.Trigger');
const selected = computed(() => tabs.value.value === props.value);
</script>

<template>
  <button
    type="button"
    role="tab"
    :id="`${tabs.baseId}-tab-${value}`"
    :aria-selected="selected"
    :aria-controls="`${tabs.baseId}-panel-${value}`"
    :tabindex="selected ? 0 : -1"
    @click="tabs.value.value = value"
  >
    <slot />
  </button>
</template>
```

```vue
<!-- tabs/TabsPanel.vue -->
<script setup lang="ts">
import { computed } from 'vue';
import { useTabsContext } from './context';

const props = defineProps<{ value: string }>();
const tabs = useTabsContext('Tabs.Panel');
const selected = computed(() => tabs.value.value === props.value);
</script>

<template>
  <!-- v-if unmounts inactive panels; swap for v-show to keep their state -->
  <div
    v-if="selected"
    role="tabpanel"
    tabindex="0"
    :id="`${tabs.baseId}-panel-${value}`"
    :aria-labelledby="`${tabs.baseId}-tab-${value}`"
  >
    <slot />
  </div>
</template>
```

```ts
// tabs/index.ts
export { default as Root } from './TabsRoot.vue';
export { default as List } from './TabsList.vue';
export { default as Trigger } from './TabsTrigger.vue';
export { default as Panel } from './TabsPanel.vue';
```

### Design decisions to talk through (Vue)

- **Reactive context**: provide the `Ref` itself (or a `readonly` view), not its `.value`, or consumers will never update. Provide a writer function if you do not want children to assign to it directly.
- **Mount strategy**: `v-if` unmounts and loses state; `v-show` keeps state; `<KeepAlive>` keeps state and caches the component. Make it a prop.
- **Controlled vs uncontrolled**: `defineModel` falls back to local state when the parent does not bind `v-model`, so both modes come from one line.
- **Errors**: `inject` with a `null` default plus a thrown error is the "used outside the root" guard.
:::

### When not to use it

- The component has one fixed layout (`<Avatar name size />`).
- Consumers would always write the same children. Then offer a convenience wrapper on top of the compound API (`<SimpleTabs items={[...]} />`).

### References

- [WAI-ARIA APG: Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- [Radix UI Tabs](https://www.radix-ui.com/primitives/docs/components/tabs)
- [Kent C. Dodds: Compound components](https://kentcdodds.com/blog/compound-components-with-react-hooks)

## Headless components and hooks: separating behavior from rendering
<!--
id: headless-components
level: lead
tags: headless ui, hooks, prop getters, design systems, accessibility
minutes: 15
-->

> [!PROMPT]
> Your company has three design systems and a lot of duplicated dropdown logic. You propose headless components. Explain the idea and design `useCombobox` so any team can render it their own way.
>
> **Cover**
> - What behavior and accessibility the hook owns (state, keyboard, ARIA, focus) and what it leaves to the consumer.
> - The API shape: prop getters (`getInputProps`, `getItemProps`) versus render props versus compound parts.
> - Testing the behavior once, and the downsides (API surface, upgrade friction, leaky abstractions).

> [!TLDR]
> A headless component owns **behavior and accessibility** (state, keyboard handling, ARIA wiring, focus management) and gives rendering entirely to the consumer, usually through a hook that returns state plus **prop getters** (`getToggleProps()`, `getItemProps(item)`). It lets a design system support many visual styles with one correct implementation. The trade-off is more work for consumers, so most teams ship a headless layer **and** a styled layer built on it.

:::react
### Prop getters

```tsx
interface UseDisclosureOptions {
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function useDisclosure({ defaultOpen = false, onOpenChange }: UseDisclosureOptions = {}) {
  const [open, setOpen] = useControllableState({ defaultValue: defaultOpen, onChange: onOpenChange });
  const id = useId();
  const panelId = `${id}-panel`;

  return {
    open,
    setOpen,
    getTriggerProps: (props: React.ComponentProps<'button'> = {}) => ({
      ...props,
      type: 'button' as const,
      'aria-expanded': open,
      'aria-controls': panelId,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        props.onClick?.(event);              // call the consumer's handler first
        if (!event.defaultPrevented) setOpen(!open); // let them opt out
      },
    }),
    getPanelProps: (props: React.ComponentProps<'div'> = {}) => ({
      ...props,
      id: panelId,
      hidden: !open,
    }),
  };
}

function Faq({ question, answer }: { question: string; answer: string }) {
  const { getTriggerProps, getPanelProps } = useDisclosure();
  return (
    <div className="faq">
      <button {...getTriggerProps({ className: 'faq-q' })}>{question}</button>
      <div {...getPanelProps({ className: 'faq-a' })}>{answer}</div>
    </div>
  );
}
```

Why prop getters instead of returning props objects: they **compose** consumer props (merging `onClick`, `className`, refs) instead of clobbering them, which is the most common bug in naive headless APIs.
:::

:::angular
### Behavior as directives (Angular)

Angular's headless primitive is the directive: it adds state, ARIA wiring and keyboard handling to whatever element the consumer renders, so there are no prop getters to forget to spread. Host bindings are merged with the consumer's own attributes, listeners and classes by the framework.

```ts
import { Directive, computed, inject, input, model } from '@angular/core';

let nextId = 0;

@Directive({ selector: '[appDisclosure]', exportAs: 'appDisclosure' })
export class Disclosure {
  readonly open = model(false);
  readonly panelId = `disclosure-${nextId++}-panel`;
  toggle(): void {
    this.open.update((value) => !value);
  }
}

@Directive({
  selector: '[appDisclosureTrigger]',
  host: {
    type: 'button',
    '[attr.aria-expanded]': 'disclosure.open()',
    '[attr.aria-controls]': 'disclosure.panelId',
    '(click)': 'disclosure.toggle()',
  },
})
export class DisclosureTrigger {
  protected readonly disclosure = inject(Disclosure);
}

@Directive({
  selector: '[appDisclosurePanel]',
  host: { '[id]': 'disclosure.panelId', '[hidden]': '!disclosure.open()' },
})
export class DisclosurePanel {
  protected readonly disclosure = inject(Disclosure);
}
```

```html
<div class="faq" appDisclosure>
  <button class="faq-q" appDisclosureTrigger (click)="track()">{{ question() }}</button>
  <div class="faq-a" appDisclosurePanel>{{ answer() }}</div>
</div>
```

The consumer's `(click)="track()"` and the directive's `(click)` both run, and `class` merges. The "call the consumer's handler first and let them opt out" nuance from the React version needs `event.defaultPrevented` checked inside `toggle`, which is an explicit design decision either way.

`hostDirectives` lets a styled component reuse behavior without exposing it: `@Component({ hostDirectives: [{ directive: Disclosure, inputs: ['open'], outputs: ['openChange'] }] })` forwards only the inputs and outputs you choose.
:::

:::vue
### Prop getters as composables (Vue)

The Vue version of a prop getter is a computed object you `v-bind` onto the element. Vue merges a bound object with the template's own `class`, `style` and `@event` listeners (both click handlers run), which removes the most common naive-headless bug without any helper.

```ts
// useDisclosure.ts
import { computed, ref, useId } from 'vue';

export function useDisclosure({ defaultOpen = false, onOpenChange }: { defaultOpen?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const open = ref(defaultOpen);
  const id = useId();
  const panelId = `${id}-panel`;

  function setOpen(next: boolean) {
    open.value = next;
    onOpenChange?.(next);
  }

  const triggerProps = computed(() => ({
    type: 'button' as const,
    'aria-expanded': open.value,
    'aria-controls': panelId,
    onClick: () => setOpen(!open.value),
  }));
  const panelProps = computed(() => ({ id: panelId, hidden: !open.value }));

  return { open, setOpen, triggerProps, panelProps };
}
```

```vue
<script setup lang="ts">
import { useDisclosure } from './useDisclosure';

defineProps<{ question: string; answer: string }>();
const { triggerProps, panelProps } = useDisclosure();
</script>

<template>
  <div class="faq">
    <button v-bind="triggerProps" class="faq-q" @click="track">{{ question }}</button>
    <div v-bind="panelProps" class="faq-a">{{ answer }}</div>
  </div>
</template>
```

For behavior that needs structure (focus scopes, portals, roving focus across children), a renderless component with a scoped slot is the equivalent of a render prop: `<Disclosure v-slot="{ open, triggerProps, panelProps }">`. Existing headless libraries for Vue include Reka UI (the Radix port, formerly Radix Vue), Headless UI for Vue and Ark UI.
:::

### Layers in a design system

```text
@acme/behaviors    useCombobox, useDisclosure, useRovingFocus, FocusScope (headless, a11y-tested)
@acme/ui           <Combobox>, <Accordion> styled with tokens, built on behaviors
product code       uses @acme/ui; drops to behaviors only for genuinely custom UI
```

Off-the-shelf headless libraries (React Aria, Radix Primitives, Ark UI, Downshift, TanStack Table) encode years of accessibility edge cases. Building your own combobox from scratch is rarely a good use of a platform team; wrapping one is.

### Trade-offs

- More flexible, but easier to misuse (forgetting to spread props breaks a11y). Mitigate with dev-time warnings and tests.
- Hooks can't control DOM structure; components that need specific structure (portals, focus scopes) work better as compound components.

### References

- [React Aria hooks](https://react-spectrum.adobe.com/react-aria/hooks.html)
- [Kent C. Dodds: Inversion of control](https://kentcdodds.com/blog/inversion-of-control)
- [TanStack Table (headless)](https://tanstack.com/table/latest)

## Support controlled and uncontrolled usage with one `useControllableState` hook
<!--
id: controllable-state-hook
level: senior
tags: controlled components, uncontrolled, hooks, component api
minutes: 12
-->

> [!PROMPT]
> Write `useControllableState({ value, defaultValue, onChange })` so one component supports both controlled and uncontrolled use, like a native input.
>
> **Test cases**
> - Uncontrolled: starts at `defaultValue`, updates itself and calls `onChange`.
> - Controlled: ignores internal updates, only changes when `value` changes, and still calls `onChange` with the requested value.
> - Switching from uncontrolled to controlled (or back) logs a development warning.
> - A functional updater `setValue((v) => v + 1)` works in both modes and doesn't use a stale value.

> [!TLDR]
> Reusable inputs should work both ways: **uncontrolled** (`defaultValue`, component owns state) for simple use, and **controlled** (`value` + `onChange`, parent owns state) when the parent needs to read, validate or reset it. A `useControllableState` hook picks the mode from whether `value` is `undefined`, always calls `onChange`, only updates internal state when uncontrolled, and warns when a component switches modes during its lifetime.

:::react
### Implementation

```tsx
import { useCallback, useRef, useState } from 'react';

interface ControllableOptions<T> {
  value?: T;
  defaultValue: T;
  onChange?: (value: T) => void;
}

export function useControllableState<T>({ value, defaultValue, onChange }: ControllableOptions<T>) {
  const [internal, setInternal] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  // Warn once if a component flips between controlled and uncontrolled.
  const wasControlled = useRef(isControlled);
  if (process.env.NODE_ENV !== 'production' && wasControlled.current !== isControlled) {
    console.warn('A component changed from %s to %s.', wasControlled.current ? 'controlled' : 'uncontrolled', isControlled ? 'controlled' : 'uncontrolled');
    wasControlled.current = isControlled;
  }

  // Keep the latest onChange without re-creating setValue each render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const currentRef = useRef(current);
  currentRef.current = current;

  const setValue = useCallback(
    (next: T) => {
      if (Object.is(next, currentRef.current)) return;
      if (!isControlled) setInternal(next);
      onChangeRef.current?.(next);
    },
    [isControlled],
  );

  return [current, setValue] as const;
}
```

### Behavior table

| `value` passed? | Source of truth | `setValue(x)` does |
| --- | --- | --- |
| No | Internal state (seeded by `defaultValue`) | Updates internal state, calls `onChange` |
| Yes | Parent | Only calls `onChange`; UI changes when parent re-renders with new `value` |

### Gotchas

- **`null` vs `undefined`**: `value={null}` should mean "controlled, empty" (like React's inputs warn about). Using `undefined` as the "uncontrolled" signal keeps that possible.
- **Functional updates**: if you support `setValue(prev => next)`, resolve against `currentRef.current`, not the possibly stale render value.
- **Resetting an uncontrolled component**: change its `key`; don't add a `reset` prop.
- **Forms**: uncontrolled inputs plus `FormData`/react-hook-form scale better for big forms (fewer re-renders); controlled is better for live formatting/validation as you type.
:::

:::angular
### Implementation (Angular)

For most components Angular already has the answer: `model()` is a signal that works uncontrolled (the component owns it), one-way (`[value]`) and two-way (`[(value)]`), and emits `valueChange` on every write. Use it unless you need the stricter React semantics below.

```ts
import { Signal, computed, effect, isDevMode, signal, untracked } from '@angular/core';

interface ControllableOptions<T> {
  value: Signal<T | undefined>;
  defaultValue: T;
  onChange?: (value: T) => void;
}

/** Call in an injection context (a constructor or field initializer). */
export function controllableState<T>({ value, defaultValue, onChange }: ControllableOptions<T>) {
  const internal = signal(defaultValue);
  const isControlled = computed(() => value() !== undefined);
  const current = computed(() => {
    const controlled = value();
    return controlled !== undefined ? controlled : internal();
  });

  if (isDevMode()) {
    let was = untracked(isControlled);
    effect(() => {
      const now = isControlled();
      if (now !== was) {
        console.warn('A component changed from %s to %s.', was ? 'controlled' : 'uncontrolled', now ? 'controlled' : 'uncontrolled');
        was = now;
      }
    });
  }

  const set = (next: T): void => {
    if (Object.is(next, untracked(current))) return;
    if (!untracked(isControlled)) internal.set(next);
    onChange?.(next);
  };
  const update = (fn: (prev: T) => T): void => set(fn(untracked(current))); // always reads the latest value

  return { value: current, set, update };
}
```

```ts
export class Stepper {
  readonly value = input<number>();
  readonly defaultValue = input(0);
  readonly valueChange = output<number>();
  protected readonly count = controllableState({
    value: this.value,
    defaultValue: this.defaultValue(),
    onChange: (next) => this.valueChange.emit(next),
  });
}
```

### Behavior table

| `value` bound? | Source of truth | `set(x)` does |
| --- | --- | --- |
| No | Internal signal (seeded by `defaultValue`) | Updates the signal, calls `onChange` |
| Yes | Parent | Only calls `onChange`; the UI changes when the parent passes a new `value` |

### Gotchas

- **Signals have no stale closures.** A functional `update` reads the current value at call time, so there is no `currentRef` workaround.
- **`undefined` is the "uncontrolled" signal**, so `null` can still mean "controlled, empty".
- **Resetting an uncontrolled component**: recreate it (change the `@if` or `track` identity) or have the owner call `set(defaultValue)`; do not add a reset input.
- **Forms**: for form controls, implement `ControlValueAccessor` rather than inventing a value/onChange API; `FormControl` is already the controlled owner.
:::

:::vue
### Implementation (Vue)

For most components `defineModel` already does this: with `v-model` bound the parent owns the value, without it the component keeps local state and still emits `update:modelValue`. Reach for a hand-written composable only for the stricter semantics below (a `defaultValue`, and "always call `onChange`").

```ts
// useControllableState.ts
import { computed, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue';

interface ControllableOptions<T> {
  value: MaybeRefOrGetter<T | undefined>;
  defaultValue: T;
  onChange?: (value: T) => void;
}

export function useControllableState<T>({ value, defaultValue, onChange }: ControllableOptions<T>) {
  const internal = shallowRef(defaultValue);
  const isControlled = computed(() => toValue(value) !== undefined);
  const current = computed(() => {
    const controlled = toValue(value);
    return controlled !== undefined ? controlled : internal.value;
  });

  if (import.meta.env.DEV) {
    // Warn if a component flips between controlled and uncontrolled.
    watch(isControlled, (now, was) => {
      console.warn('A component changed from %s to %s.', was ? 'controlled' : 'uncontrolled', now ? 'controlled' : 'uncontrolled');
    });
  }

  function setValue(next: T) {
    if (Object.is(next, current.value)) return;
    if (!isControlled.value) internal.value = next;
    onChange?.(next);
  }

  return [current, setValue] as const;
}
```

```vue
<script setup lang="ts">
import { useControllableState } from './useControllableState';

const props = withDefaults(defineProps<{ modelValue?: number; defaultValue?: number }>(), {
  modelValue: undefined, // see the Boolean-casting gotcha below
  defaultValue: 0,
});
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

const [count, setCount] = useControllableState({
  value: () => props.modelValue,
  defaultValue: props.defaultValue,
  onChange: (next) => emit('update:modelValue', next),
});
</script>

<template>
  <button type="button" @click="setCount(count + 1)">{{ count }}</button>
</template>
```

### Behavior table

| `modelValue` passed? | Source of truth | `setCount(x)` does |
| --- | --- | --- |
| No | Internal ref (seeded by `defaultValue`) | Updates the ref, emits the change |
| Yes | Parent | Only emits; the UI changes when the parent passes a new `modelValue` |

### Gotchas

- **Boolean props are cast.** An absent `Boolean` prop becomes `false`, not `undefined`, which silently makes every boolean component look controlled. Declare `value: undefined` as the default (as above) or use a string union.
- **`undefined` is the "uncontrolled" signal**, so `null` can still mean "controlled, empty".
- **Functional updates**: read `current.value` inside the setter; refs are always current, so there is no stale-closure trap.
- **Resetting an uncontrolled component**: change its `key` (Vue honors `key` on components too) rather than adding a `reset` prop.
- **Forms**: `v-model` on native inputs is already a controlled binding; `useVModel` from VueUse is a ready-made version of this composable.
:::

### References

- [React: Controlled and uncontrolled components](https://react.dev/learn/sharing-state-between-components#controlled-and-uncontrolled-components)
- [Radix: useControllableState](https://github.com/radix-ui/primitives/tree/main/packages/react/use-controllable-state)

## Production forms with react-hook-form and zod: validation, async checks, server errors and field arrays
<!--
id: forms-react-hook-form-zod
level: senior
tags: forms, react-hook-form, zod, validation, accessibility
minutes: 18
-->

> [!PROMPT]
> Build a signup form with email, password, a repeatable "team members" list, an async "username available" check and server-side errors that must land on the right fields.
>
> **Requirements**
> - One zod schema as the source of truth for types and validation (client and server).
> - Validation timing that doesn't shout while typing; accessible error messages.
>
> **Test cases**
> - Submitting empty shows errors and focuses the first invalid field.
> - A taken username (async check) marks only that field invalid and blocks submit.
> - A 422 response with `{ email: 'already used' }` is shown on the email field.
> - Adding and removing team members keeps values and errors aligned.

> [!TLDR]
> react-hook-form keeps fields **uncontrolled** and stores values in refs, so typing doesn't re-render the whole form. A zod schema (via `zodResolver`) gives one source of truth for types and validation, shared with the server. Handle the three error sources separately: **field validation** (schema), **async checks** (debounced, cancellable), and **server errors** (mapped back with `setError`). Make it accessible: labels, `aria-invalid`, `aria-describedby` for messages, focus the first error on submit.

:::react
### The schema and form

```tsx
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const InviteSchema = z.object({
  teamName: z.string().trim().min(2, 'Team name must be at least 2 characters'),
  members: z
    .array(z.object({ email: z.string().email('Enter a valid email'), role: z.enum(['admin', 'member']) }))
    .min(1, 'Add at least one member')
    .refine((list) => new Set(list.map((m) => m.email.toLowerCase())).size === list.length, 'Emails must be unique'),
});
type InviteForm = z.infer<typeof InviteSchema>;

export function InviteTeam() {
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InviteForm>({
    resolver: zodResolver(InviteSchema),
    defaultValues: { teamName: '', members: [{ email: '', role: 'member' }] },
    mode: 'onTouched', // validate after first blur, then on change: less noisy than onChange
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'members' });

  const onSubmit = handleSubmit(async (data) => {
    const response = await fetch('/api/teams', { method: 'POST', body: JSON.stringify(data) });
    if (response.status === 422) {
      const body: { fieldErrors: Record<string, string> } = await response.json();
      for (const [name, message] of Object.entries(body.fieldErrors)) {
        if (name === 'teamName') setError('teamName', { message }, { shouldFocus: true });
      }
      return;
    }
    if (!response.ok) {
      setError('root.server', { message: 'Something went wrong. Your changes were not saved.' });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="teamName">Team name</label>
      <input
        id="teamName"
        {...register('teamName')}
        aria-invalid={errors.teamName ? true : undefined}
        aria-describedby={errors.teamName ? 'teamName-error' : undefined}
      />
      {errors.teamName && <p id="teamName-error">{errors.teamName.message}</p>}

      <fieldset>
        <legend>Members</legend>
        {fields.map((field, index) => (
          <div key={field.id /* RHF's stable id, never the index */}>
            <label htmlFor={`m-${field.id}`}>Email</label>
            <input id={`m-${field.id}`} type="email" {...register(`members.${index}.email`)} />
            <select aria-label="Role" {...register(`members.${index}.role`)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button type="button" onClick={() => remove(index)} disabled={fields.length === 1}>
              Remove
            </button>
            {errors.members?.[index]?.email && <p>{errors.members[index]?.email?.message}</p>}
          </div>
        ))}
        <button type="button" onClick={() => append({ email: '', role: 'member' })}>Add member</button>
        {errors.members?.root && <p>{errors.members.root.message}</p>}
      </fieldset>

      {errors.root?.server && <p role="alert">{errors.root.server.message}</p>}
      <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Inviting…' : 'Invite'}</button>
    </form>
  );
}
```

### Async validation (e.g. "is this team name taken?")

Don't put a network call in the schema that runs on every keystroke. Options:

- Validate on **blur** with a dedicated check, debounced and cancelled (`AbortController`), and only show "Checking…" after ~300ms.
- Or validate on submit and map the server's 409/422 back with `setError`. The server must check anyway (race between check and submit).
:::

:::angular
### The schema and form (Angular)

Angular's built-in answer is Reactive Forms: typed controls, `FormArray` for the repeatable list, and validators that are plain functions. The zod schema stays the shared source of truth with the server; a small adapter turns a field schema into a validator. (Angular's newer signal-based forms are worth mentioning in an interview; check their current status before recommending them.)

```ts
import { z } from 'zod';

const MemberSchema = z.object({ email: z.string().email('Enter a valid email'), role: z.enum(['admin', 'member']) });
const InviteSchema = z.object({
  teamName: z.string().trim().min(2, 'Team name must be at least 2 characters'),
  members: z
    .array(MemberSchema)
    .min(1, 'Add at least one member')
    .refine((list) => new Set(list.map((m) => m.email.toLowerCase())).size === list.length, 'Emails must be unique'),
});
export type InviteForm = z.infer<typeof InviteSchema>; // also used by the server

/** Adapts a zod field schema to an Angular validator; the message becomes the error value. */
export function zodField(schema: z.ZodType): ValidatorFn {
  return (control) => {
    const result = schema.safeParse(control.value);
    return result.success ? null : { zod: result.error.issues[0]?.message ?? 'Invalid value' };
  };
}

const uniqueEmails: ValidatorFn = (control) => {
  const emails = (control.value as { email: string }[]).map((m) => m.email.toLowerCase());
  return new Set(emails).size === emails.length ? null : { zod: 'Emails must be unique' };
};
```

```ts
@Component({
  selector: 'app-invite-team',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <label for="teamName">Team name</label>
      <input
        id="teamName"
        formControlName="teamName"
        [attr.aria-invalid]="showError(form.controls.teamName) ? true : null"
        [attr.aria-describedby]="showError(form.controls.teamName) ? 'teamName-error' : null"
      />
      @if (showError(form.controls.teamName)) {
        <p id="teamName-error">{{ message(form.controls.teamName) }}</p>
      }

      <fieldset>
        <legend>Members</legend>
        <ng-container formArrayName="members">
          @for (member of form.controls.members.controls; track member; let i = $index) {
            <div [formGroupName]="i">
              <label [for]="'m-' + i">Email</label>
              <input [id]="'m-' + i" type="email" formControlName="email" [attr.aria-invalid]="showError(member.controls.email) ? true : null" />
              <select aria-label="Role" formControlName="role">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button type="button" (click)="remove(i)" [disabled]="form.controls.members.length === 1">Remove</button>
              @if (showError(member.controls.email)) {
                <p>{{ message(member.controls.email) }}</p>
              }
            </div>
          }
        </ng-container>
        <button type="button" (click)="add()">Add member</button>
        @if (showError(form.controls.members)) {
          <p>{{ message(form.controls.members) }}</p>
        }
      </fieldset>

      @if (serverError(); as error) {
        <p role="alert">{{ error }}</p>
      }
      <button type="submit" [disabled]="submitting()">{{ submitting() ? 'Inviting…' : 'Invite' }}</button>
    </form>
  `,
})
export class InviteTeamComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly http = inject(HttpClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly submitted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);

  protected readonly form = this.fb.group({
    teamName: this.fb.control('', { validators: [zodField(InviteSchema.shape.teamName)] }),
    members: this.fb.array([this.memberGroup()], { validators: [uniqueEmails] }),
  });

  private memberGroup() {
    return this.fb.group({
      email: this.fb.control('', { validators: [zodField(MemberSchema.shape.email)] }),
      role: this.fb.control<'admin' | 'member'>('member'),
    });
  }

  protected add(): void {
    this.form.controls.members.push(this.memberGroup());
  }
  protected remove(index: number): void {
    this.form.controls.members.removeAt(index);
  }

  // Quiet while typing: show errors after the first blur, or for everything after a submit attempt.
  protected showError(control: AbstractControl): boolean {
    return control.invalid && (control.touched || this.submitted());
  }
  protected message(control: AbstractControl): string {
    const errors = control.errors;
    return errors?.['zod'] ?? errors?.['server'] ?? 'Invalid value';
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.serverError.set(null);
    if (this.form.invalid) {
      this.host.querySelector<HTMLElement>('input.ng-invalid, select.ng-invalid')?.focus(); // first invalid field
      return;
    }
    this.submitting.set(true);
    try {
      await firstValueFrom(this.http.post('/api/teams', this.form.getRawValue()));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 422) {
        for (const [name, message] of Object.entries(error.error.fieldErrors as Record<string, string>)) {
          this.form.get(name)?.setErrors({ server: message }); // shown on the matching field
        }
        this.host.querySelector<HTMLElement>('input.ng-invalid')?.focus();
      } else {
        this.serverError.set('Something went wrong. Your changes were not saved.');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
```

### Async validation (Angular)

An `AsyncValidatorFn` returns an observable. Angular unsubscribes from the previous run whenever the value changes, so debouncing with `timer` and `switchMap` gives you cancellation for free, and it only runs after the synchronous validators pass.

```ts
export function teamNameAvailable(http: HttpClient): AsyncValidatorFn {
  return (control) =>
    timer(300).pipe(
      switchMap(() => http.get<{ taken: boolean }>('/api/teams/check', { params: { name: control.value } })),
      map(({ taken }) => (taken ? { server: 'That name is taken' } : null)),
      catchError(() => of(null)), // an unreachable check must not block the form; the server re-checks on submit
    );
}
// fb.control('', { validators: [...], asyncValidators: [teamNameAvailable(http)], updateOn: 'blur' })
```

`updateOn: 'blur'` on the control is Angular's version of "validate on blur, not on every keystroke". The UX rules below apply unchanged.
:::

:::vue
### The schema and form (Vue)

vee-validate is the Vue counterpart of react-hook-form: it owns field state, takes a zod schema through `@vee-validate/zod`, and provides `FieldArray` for the repeatable list. The schema is the same one the server uses.

```ts
import { z } from 'zod';

export const InviteSchema = z.object({
  teamName: z.string().trim().min(2, 'Team name must be at least 2 characters'),
  members: z
    .array(z.object({ email: z.string().email('Enter a valid email'), role: z.enum(['admin', 'member']) }))
    .min(1, 'Add at least one member')
    .refine((list) => new Set(list.map((m) => m.email.toLowerCase())).size === list.length, 'Emails must be unique'),
});
export type InviteForm = z.infer<typeof InviteSchema>;
```

```vue
<!-- InviteTeam.vue -->
<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod';
import { ErrorMessage, Field, FieldArray, useForm } from 'vee-validate';
import { InviteSchema, type InviteForm } from './schema';

const { handleSubmit, setFieldError, setErrors, errors, isSubmitting } = useForm<InviteForm>({
  validationSchema: toTypedSchema(InviteSchema),
  initialValues: { teamName: '', members: [{ email: '', role: 'member' }] },
});

function focusFirstInvalid() {
  document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

const onSubmit = handleSubmit(
  async (values) => {
    const response = await fetch('/api/teams', { method: 'POST', body: JSON.stringify(values) });
    if (response.status === 422) {
      const body: { fieldErrors: Record<string, string> } = await response.json();
      for (const [name, message] of Object.entries(body.fieldErrors)) setFieldError(name as keyof InviteForm, message);
      await nextTick();
      focusFirstInvalid();
      return;
    }
    if (!response.ok) setErrors({ members: 'Something went wrong. Your changes were not saved.' });
  },
  focusFirstInvalid, // runs when validation fails on submit
);
</script>

<template>
  <form novalidate @submit="onSubmit">
    <Field v-slot="{ field, errorMessage }" name="teamName">
      <label for="teamName">Team name</label>
      <input
        id="teamName"
        v-bind="field"
        :aria-invalid="errorMessage ? true : undefined"
        :aria-describedby="errorMessage ? 'teamName-error' : undefined"
      />
      <p v-if="errorMessage" id="teamName-error">{{ errorMessage }}</p>
    </Field>

    <fieldset>
      <legend>Members</legend>
      <FieldArray v-slot="{ fields, push, remove }" name="members">
        <div v-for="(entry, index) in fields" :key="entry.key /* vee-validate's stable key, never the index */">
          <Field v-slot="{ field, errorMessage }" :name="`members[${index}].email`">
            <label :for="`m-${entry.key}`">Email</label>
            <input :id="`m-${entry.key}`" v-bind="field" type="email" :aria-invalid="errorMessage ? true : undefined" />
            <p v-if="errorMessage">{{ errorMessage }}</p>
          </Field>
          <Field v-slot="{ field }" :name="`members[${index}].role`">
            <select v-bind="field" aria-label="Role">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <button type="button" :disabled="fields.length === 1" @click="remove(index)">Remove</button>
        </div>
        <button type="button" @click="push({ email: '', role: 'member' })">Add member</button>
      </FieldArray>
      <ErrorMessage name="members" as="p" />
    </fieldset>

    <button type="submit" :disabled="isSubmitting">{{ isSubmitting ? 'Inviting…' : 'Invite' }}</button>
  </form>
</template>
```

By default vee-validate validates a field on blur and on change rather than on every keystroke, which is the "don't shout while typing" rule; all errors appear on a submit attempt, and the invalid-submit callback is the place to focus the first invalid field.

### Async validation (Vue)

Keep the network call out of the schema. Either add a dedicated rule on the field with a debounced, cancellable check (`AbortController`, and a "Checking…" state only after about 300 ms), or validate on submit and map the server's 409 or 422 back with `setFieldError`. The server must check anyway because of the race between check and submit.
:::

### UX rules that interviewers like to hear

- Don't show errors before the user has interacted with a field; do show them all on submit and focus the first invalid field (RHF's `shouldFocusError` default).
- Keep the submit button **enabled** (disabled buttons hide why the form can't submit); validate on click instead.
- Preserve input on errors; never clear the form after a failed submit.
- Warn about unsaved changes on navigation only if `isDirty`.

### Testing

Test like a user with Testing Library: type into labeled fields, submit, assert error messages by role/text, and mock the API with MSW (including a 422 response) to test server-error mapping.

### References

- [react-hook-form: useForm](https://react-hook-form.com/docs/useform)
- [react-hook-form: useFieldArray](https://react-hook-form.com/docs/usefieldarray)
- [W3C WAI: Forms tutorial](https://www.w3.org/WAI/tutorials/forms/)

## Where do you place error boundaries and Suspense boundaries in a large app?
<!--
id: error-suspense-boundaries
level: lead
tags: error boundaries, suspense, resilience, loading states
minutes: 12
-->

> [!PROMPT]
> A large app crashes completely when one widget throws, and shows a wall of spinners on every navigation. You are asked to design where error boundaries and Suspense boundaries go.
>
> **Cover**
> - Boundary placement: app shell, route, and independent widgets, with the reasoning for each.
> - Recovery (retry with `resetKeys`, reporting to monitoring) and what boundaries do not catch (event handlers, async code).
> - Avoiding waterfalls and spinner storms: reveal order, `useTransition` for navigation, skeleton fidelity.

> [!TLDR]
> Place boundaries along **independent units of UI**: the app shell (last-resort crash screen), each route (one broken page shouldn't break navigation), and each self-contained widget or panel (one failing chart shouldn't blank the dashboard). Pair each error boundary with a recovery action (retry, reset on navigation) and reporting. Suspense boundaries follow the same regions, chosen so the page reveals in a deliberate order instead of a cascade of spinners.

:::react
### A layered layout

```tsx
<AppErrorBoundary fallback={<FatalError />}>          {/* shell: very rare */}
  <Layout>
    <RouteErrorBoundary resetKey={location.pathname}> {/* per route, resets on navigation */}
      <Suspense fallback={<PageSkeleton />}>
        <Dashboard>
          <WidgetBoundary name="revenue">              {/* per widget: error + suspense */}
            <RevenueChart />
          </WidgetBoundary>
          <WidgetBoundary name="incidents">
            <IncidentList />
          </WidgetBoundary>
        </Dashboard>
      </Suspense>
    </RouteErrorBoundary>
  </Layout>
</AppErrorBoundary>
```

```tsx
function WidgetBoundary({ name, children }: { name: string; children: React.ReactNode }) {
  const { reset } = useQueryErrorResetBoundary(); // lets "Retry" refetch failed queries
  return (
    <ErrorBoundary
      onReset={reset}
      onError={(error) => reportError(error, { widget: name })}
      fallbackRender={({ resetErrorBoundary }) => (
        <WidgetError title={`Couldn't load ${name}`} onRetry={resetErrorBoundary} />
      )}
    >
      <Suspense fallback={<WidgetSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
```

### What boundaries don't catch

- Errors in **event handlers** and async code after the render (handle them locally, or rethrow into render via state).
- Errors in the boundary itself, and in server-side rendering in some setups.
- Since React 19, `createRoot` options (`onCaughtError`, `onUncaughtError`, `onRecoverableError`) give you central reporting hooks.
:::

:::angular
### A layered layout (Angular)

Angular has no error-boundary component: a render error is reported to the global `ErrorHandler` and the rest of the view keeps running as best it can. So "boundaries" are built from three things you place deliberately: **state per widget**, **`@defer` blocks** for loading and chunk failures, and **router-level handling**.

```ts
// App shell: the last resort. One place for reporting and the fatal screen.
export class AppErrorHandler implements ErrorHandler {
  private readonly monitoring = inject(Monitoring);
  handleError(error: unknown): void {
    this.monitoring.report(error);
    console.error(error);
  }
}
// providers: [{ provide: ErrorHandler, useClass: AppErrorHandler }]
```

```ts
// Per route: failed navigations (lazy chunk missing, guard error) go to an error page; the shell stays up.
provideRouter(routes, withNavigationErrorHandler((error) => inject(Router).navigate(['/error'], { state: { message: error.error?.message } })));
```

```ts
// Per widget: each widget owns an async resource, and a small wrapper renders its three states.
@Component({
  selector: 'app-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state().error(); as error) {
      <app-widget-error [title]="errorTitle()" (retry)="state().reload()" />
    } @else if (state().isLoading()) {
      <app-widget-skeleton />
    } @else {
      <ng-content />
    }
  `,
})
export class WidgetComponent {
  readonly name = input.required<string>();
  readonly state = input.required<ResourceRef<unknown>>();
  protected readonly errorTitle = computed(() => `Couldn't load ${this.name()}`);
}
```

```html
<app-widget name="revenue" [state]="revenue">
  <app-revenue-chart [data]="revenue.value()" />
</app-widget>
```

`revenue` is a `resource()` or `rxResource()` (`error()`, `isLoading()`, `value()` and `reload()` are signals and a method on it), so retry is just `reload()`. Report failures where you create the resource, not in the template.

For lazily loaded widgets, `@defer` gives you the loading and failure states of the chunk itself:

```html
@defer (on viewport) {
  <app-revenue-chart />
} @placeholder {
  <app-widget-skeleton />
} @loading (minimum 300ms) {
  <app-widget-skeleton />
} @error {
  <app-widget-error title="Couldn't load revenue" />
}
```

### What this does not catch (Angular)

- **A component that throws while rendering** is not contained: it goes to `ErrorHandler`, and that view may end up half-rendered. Prevent it by handling failures in the data layer (`catchError` per stream, `resource` error state) so templates only ever see data or an error signal.
- `@error` covers failures to load the deferred chunk, not exceptions thrown later by the component it loaded.
- Event handlers and async code report to `ErrorHandler` too; handle them locally where the user needs feedback.
- Mention it honestly in an interview: containing render errors per subtree is a React and Vue capability that Angular does not have, and the Angular answer is "make rendering unable to throw, and isolate state per widget".
:::

:::vue
### A layered layout (Vue)

Vue gives you the equivalent pieces: `onErrorCaptured` for error boundaries, `<Suspense>` for async setup (still marked experimental in the docs), `defineAsyncComponent` for lazy components with loading and error states, and `app.config.errorHandler` for the last resort.

```ts
// App shell: the last resort, and one place for reporting.
app.config.errorHandler = (error, instance, info) => {
  monitoring.report(error, { info });
};
```

```vue
<!-- ErrorBoundary.vue -->
<script setup lang="ts">
import { onErrorCaptured, ref, watch } from 'vue';

const props = defineProps<{ name: string; resetKey?: unknown }>();
const error = ref<unknown>(null);

onErrorCaptured((err, _instance, info) => {
  error.value = err;
  monitoring.report(err, { widget: props.name, info });
  return false; // handled here: stop it propagating to parents and app.config.errorHandler
});

const reset = () => (error.value = null);
watch(() => props.resetKey, reset); // e.g. the route path, so navigating away clears the error
</script>

<template>
  <slot v-if="error === null" />
  <slot v-else name="fallback" :error="error" :reset="reset" />
</template>
```

```vue
<!-- WidgetBoundary.vue: error + suspense for one widget -->
<script setup lang="ts">
defineProps<{ name: string }>();
</script>

<template>
  <ErrorBoundary :name="name">
    <Suspense>
      <slot />
      <template #fallback><WidgetSkeleton /></template>
    </Suspense>
    <template #fallback="{ reset }">
      <WidgetError :title="`Couldn't load ${name}`" @retry="reset" />
    </template>
  </ErrorBoundary>
</template>
```

```vue
<template>
  <ErrorBoundary name="app" :reset-key="route.path">  <!-- shell and routes -->
    <Layout>
      <Suspense>
        <Dashboard>
          <WidgetBoundary name="revenue"><RevenueChart /></WidgetBoundary>
          <WidgetBoundary name="incidents"><IncidentList /></WidgetBoundary>
        </Dashboard>
        <template #fallback><PageSkeleton /></template>
      </Suspense>
    </Layout>
  </ErrorBoundary>
</template>
```

Resetting re-renders the slot, which recreates the children, so a retry re-runs their setup (and any data fetching) from scratch.

### What boundaries do and do not catch (Vue)

- Unlike React, `onErrorCaptured` also receives errors thrown in **event handlers, watchers, lifecycle hooks and async setup**, because Vue routes them through the same error pipeline. Rejected promises returned from handlers are caught too.
- It does not catch errors in the boundary's own setup, or in plain callbacks Vue never sees (a bare `setTimeout`).
- `defineAsyncComponent({ loader, loadingComponent, errorComponent, delay, timeout })` is the per-component version for lazy chunks.
- Use `app.config.errorHandler` (and `warnHandler` in development) for central reporting.
:::

### Suspense placement

- One boundary per page gives a single skeleton (simple, but slowest part gates everything).
- One per widget streams content in as it's ready, but can produce layout jumps and "popcorn" loading. Reserve space with skeletons sized like the content.
- Use transitions for navigations so the old page stays visible instead of flashing a fallback.
- `SuspenseList`-style ordering (where available) or careful nesting reveals content top to bottom.

### References

- [React: Catching rendering errors with an error boundary](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
- [react-error-boundary](https://github.com/bvaughn/react-error-boundary)
- [TanStack Query: Suspense and error resets](https://tanstack.com/query/latest/docs/framework/react/reference/QueryErrorResetBoundary)

## Review a component API: props explosion, boolean flags, slots and composition
<!--
id: component-api-review
level: lead
tags: component api, code review, composition, design systems, props
minutes: 12
-->

> [!PROMPT]
> You are reviewing a pull request that adds a seventh boolean prop to `<Modal>` (`isCentered`, `noPadding`, `hasFooter`, `wide`...). Review the API and propose a better one.
>
> **Cover**
> - The smell: boolean explosion and impossible combinations; how you'd find the real variants.
> - Alternatives: composition and slots, a `variant` union, headless parts, controlled/uncontrolled state.
> - How you give the feedback kindly, plan a non-breaking migration and add API tests (types and behavior).

> [!TLDR]
> Bad component APIs grow by accretion: every new requirement adds a boolean prop until nobody knows which combinations work. In a review, look for boolean flags that encode variants (replace with a `variant` union), props that pass content (replace with `children`/slots), props that configure internal structure (replace with composition), and impossible combinations (replace with discriminated unions). Good APIs are small, composable, consistent across the system, and hard to misuse.

:::react
### Before

```tsx
<Card
  title="Invoices"
  subtitle="Last 30 days"
  showHeader
  showFooter
  footerButtonText="View all"
  onFooterButtonClick={openInvoices}
  isPrimary
  isCompact
  hasBorder={false}
  icon="receipt"
  iconPosition="right"
  loading={isLoading}
/>
```

### After

```tsx
<Card variant="primary" density="compact">
  <Card.Header>
    <Card.Title icon={<ReceiptIcon />}>Invoices</Card.Title>
    <Card.Description>Last 30 days</Card.Description>
  </Card.Header>
  <Card.Body>{isLoading ? <InvoiceSkeleton /> : <InvoiceTable rows={rows} />}</Card.Body>
  <Card.Footer>
    <Button variant="ghost" onClick={openInvoices}>View all</Button>
  </Card.Footer>
</Card>
```
:::

:::angular
### Before (Angular)

```html
<app-card
  title="Invoices"
  subtitle="Last 30 days"
  [showHeader]="true"
  [showFooter]="true"
  footerButtonText="View all"
  (footerButtonClick)="openInvoices()"
  [isPrimary]="true"
  [isCompact]="true"
  [hasBorder]="false"
  icon="receipt"
  iconPosition="right"
  [loading]="isLoading()"
/>
```

### After (Angular)

Content projection with selectors replaces the `*Text` props and the show/hide flags; two string-union inputs replace the booleans.

```html
<app-card variant="primary" density="compact">
  <app-card-header>
    <app-card-title><app-icon name="receipt" /> Invoices</app-card-title>
    <app-card-description>Last 30 days</app-card-description>
  </app-card-header>
  <app-card-body>
    @if (isLoading()) { <app-invoice-skeleton /> } @else { <app-invoice-table [rows]="rows()" /> }
  </app-card-body>
  <app-card-footer>
    <button appButton variant="ghost" (click)="openInvoices()">View all</button>
  </app-card-footer>
</app-card>
```

```ts
@Component({
  selector: 'app-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: { class: 'card', '[attr.data-variant]': 'variant()', '[attr.data-density]': 'density()' },
})
export class CardComponent {
  readonly variant = input<'primary' | 'secondary' | 'danger'>('secondary');
  readonly density = input<'comfortable' | 'compact'>('comfortable');
}
```

Angular notes for the review: use `input.required` for mandatory inputs and `ng-content select="[card-footer]"` when you want a named slot; keep host classes and attributes on the host so consumers' own `class`, `aria-*` and `data-*` merge instead of being swallowed; and use `hostDirectives` to expose only the inputs you intend. Make "impossible states" unrepresentable with union types on inputs, plus a dev-mode check where a union cannot express the rule.
:::

:::vue
### Before (Vue)

```vue
<Card
  title="Invoices"
  subtitle="Last 30 days"
  show-header
  show-footer
  footer-button-text="View all"
  is-primary
  is-compact
  :has-border="false"
  icon="receipt"
  icon-position="right"
  :loading="isLoading"
  @footer-button-click="openInvoices"
/>
```

### After (Vue)

Named slots replace the `*Text` props and the show/hide flags; two string-union props replace the booleans.

```vue
<Card variant="primary" density="compact">
  <template #header>
    <CardTitle><ReceiptIcon /> Invoices</CardTitle>
    <CardDescription>Last 30 days</CardDescription>
  </template>

  <InvoiceSkeleton v-if="isLoading" />
  <InvoiceTable v-else :rows="rows" />

  <template #footer>
    <Button variant="ghost" @click="openInvoices">View all</Button>
  </template>
</Card>
```

```vue
<!-- Card.vue -->
<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'danger'; density?: 'comfortable' | 'compact' }>(), {
  variant: 'secondary',
  density: 'comfortable',
});
defineSlots<{ header?(): unknown; default(): unknown; footer?(): unknown }>();
</script>

<template>
  <section class="card" :data-variant="variant" :data-density="density">
    <header v-if="$slots.header"><slot name="header" /></header>
    <div class="card-body"><slot /></div>
    <footer v-if="$slots.footer"><slot name="footer" /></footer>
  </section>
</template>
```

Vue notes for the review: rendering a slot region only when `$slots.header` exists is what replaces `showHeader`; `defineSlots` gives the slots typed props and makes optional ones explicit; unrecognised attributes (`class`, `aria-*`, `data-*`, listeners) fall through to the root element by default, so native pass-through needs no `...rest`. Prefer a string union to boolean props, and use a discriminated union (or a runtime validator in development) for mutually exclusive props.
:::

### Checklist you can say out loud

1. **Variants as unions**, not booleans: `variant: 'primary' | 'secondary' | 'danger'` can't be both primary and danger.
2. **Content through children/slots**, not `*Text` props; it handles icons, formatting and i18n naturally.
3. **Native props pass through** (`...rest` onto the root element), including `className`, `data-*`, `aria-*`, `ref`.
4. **Events named after intent** (`onValueChange`, `onOpenChange`), with consistent signatures across components.
5. **Controlled and uncontrolled** support where state is involved.
6. **No impossible states**: discriminated unions for mutually exclusive props (`href` xor `onClick`).
7. **Accessible by default**: required labels are required props (`aria-label` on icon buttons), roles and keyboard handled internally.
8. **Consistency** with the rest of the system beats local cleverness: same size scale, same prop names.
9. **Escape hatches** exist but are explicit (`asChild`, `className`), not "style any internal element" props.
10. **Deprecations** are gradual: keep old props working with a dev warning and a codemod.

### References

- [Radix: Composition](https://www.radix-ui.com/primitives/docs/guides/composition)
- [Brad Frost: Atomic design](https://atomicdesign.bradfrost.com/)
- [Material UI: API design approach](https://mui.com/material-ui/guides/api/)
