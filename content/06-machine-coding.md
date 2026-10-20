---
id: machine-coding
title: Machine Coding
description: Timed UI builds done to a senior bar: accessible typeahead, virtual list, modal, OTP input, undo/redo, infinite feed, accurate timers, an uploader, a kanban board and a queued progress bar.
---

## Build an accessible typeahead (combobox) with debounced search and race-safe results
<!--
id: typeahead-combobox
level: senior
tags: machine coding, combobox, autocomplete, accessibility, debounce, race conditions
minutes: 45
-->

> [!PROMPT]
> Build a search-as-you-type combobox for a user directory. Typing queries an async `search(query, signal)` function; results appear in a listbox and can be chosen with mouse or keyboard. Treat it as a 45-minute machine-coding round.
>
> **Requirements**
> - Search starts after 2 characters, debounced by about 250 ms; stale responses must never overwrite newer ones.
> - Loading, empty and error states; ARIA 1.2 combobox pattern; focus stays in the input.
> - Arrow keys, Enter to select, Escape to close.
>
> **Test cases**
> - Typing `a` does nothing; typing `al` calls `search` once after the debounce.
> - Typing `al` then `ali` quickly: only the `ali` results are shown, even if the `al` response arrives last.
> - ArrowDown twice then Enter selects the second option and calls `onSelect` with it; Escape closes the list and keeps the text.
> - A rejected request shows an error message and a working retry; no results shows "No matches".

> [!TLDR]
> Plan in this order: requirements (async source, min chars, debounce, keyboard, selection), state (query, results, status, active index, open), data flow (debounced query → cancellable fetch → latest-wins), then accessibility (ARIA 1.2 combobox: `role="combobox"` input with `aria-expanded`, `aria-controls`, `aria-activedescendant`; `role="listbox"` with `role="option"` items). Handle loading/empty/error states, cache recent queries, and keep focus in the input the whole time.

### Clarify (2 minutes)

- Free text allowed, or must pick from the list? (Combobox vs select-only.)
- Min characters before searching? Debounce delay? Max results?
- Highlight matched text? Recent searches when empty?
- Mobile considerations (virtual keyboard, tap targets).

### State model

```ts
type Status = 'idle' | 'loading' | 'success' | 'error';

interface ComboboxState<T> {
  query: string;
  results: T[];
  status: Status;
  open: boolean;
  activeIndex: number; // -1 = none
}
```

:::react
### Data hook: debounced, cancellable, cached, latest-wins

```tsx
function useSearch<T>(query: string, search: (q: string, signal: AbortSignal) => Promise<T[]>, { minChars = 2, delay = 250 } = {}) {
  const [state, setState] = useState<{ status: Status; results: T[]; forQuery: string }>({ status: 'idle', results: [], forQuery: '' });
  const cache = useRef(new Map<string, T[]>());
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    const q = query.trim();
    if (q.length < minChars) {
      setState({ status: 'idle', results: [], forQuery: q });
      return;
    }
    const cached = cache.current.get(q);
    if (cached) {
      setState({ status: 'success', results: cached, forQuery: q });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const results = await searchRef.current(q, controller.signal);
        cache.current.set(q, results);
        setState({ status: 'success', results, forQuery: q });
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: 'error', results: [], forQuery: q });
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort(); // a newer query supersedes this one: no stale writes
    };
  }, [query, minChars, delay]);

  return state;
}
```

The effect cleanup does both debouncing (clear the timer) and race safety (abort the in-flight request), because every keystroke re-runs the effect.

### The component

```tsx
interface Option {
  id: string;
  label: string;
}

export function Typeahead({ label, search, onSelect }: {
  label: string;
  search: (q: string, signal: AbortSignal) => Promise<Option[]>;
  onSelect: (option: Option) => void;
}) {
  const id = useId();
  const listId = `${id}-listbox`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const { status, results } = useSearch(query, search);

  // Reset highlight when results change (adjusting state during render, no effect).
  const [prevResults, setPrevResults] = useState(results);
  if (results !== prevResults) {
    setPrevResults(results);
    setActiveIndex(-1);
  }

  const select = (option: Option) => {
    setQuery(option.label);
    setOpen(false);
    onSelect(option);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setOpen(true);
        setActiveIndex((i) => (results.length === 0 ? -1 : (i + 1) % results.length));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => (results.length === 0 ? -1 : (i - 1 + results.length) % results.length));
        break;
      case 'Enter': {
        const option = results[activeIndex];
        if (open && option) {
          event.preventDefault();
          select(option);
        }
        break;
      }
      case 'Escape':
        if (open) setOpen(false);
        else setQuery('');
        break;
    }
  };

  const showList = open && query.trim().length >= 2;
  const activeId = activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined;

  return (
    <div className="typeahead">
      <label htmlFor={`${id}-input`}>{label}</label>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? activeId : undefined}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {status === 'success' && showList ? `${results.length} results` : ''}
      </div>
      {showList ? (
        <ul id={listId} role="listbox" aria-label={label}>
          {status === 'loading' && results.length === 0 ? <li role="presentation">Searching…</li> : null}
          {status === 'error' ? <li role="presentation">Search failed. Keep typing to retry.</li> : null}
          {status === 'success' && results.length === 0 ? <li role="presentation">No matches</li> : null}
          {results.map((option, index) => (
            <li
              key={option.id}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the input so blur doesn't close first
              onClick={() => select(option)}
              onMouseMove={() => setActiveIndex(index)}
            >
              <Highlight text={option.label} query={query} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const start = q ? text.toLowerCase().indexOf(q) : -1;
  if (start === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + q.length)}</mark>
      {text.slice(start + q.length)}
    </>
  );
}
```
:::

:::angular
### Data flow and component (Angular)

RxJS gives you debounce, cancellation and latest-wins as operators: `switchMap` unsubscribes from the previous inner observable, and the teardown function aborts the request. Signals hold the UI state.

```ts
import { ChangeDetectionStrategy, Component, input, linkedSignal, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';

interface Option {
  id: string;
  label: string;
}
type Status = 'idle' | 'loading' | 'success' | 'error';
interface SearchState {
  status: Status;
  results: Option[];
}
type SearchFn = (query: string, signal: AbortSignal) => Promise<Option[]>;

const IDLE: SearchState = { status: 'idle', results: [] };
let nextId = 0;

@Component({
  selector: 'app-typeahead',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label [for]="id + '-input'">{{ label() }}</label>
    <input
      [id]="id + '-input'"
      role="combobox"
      autocomplete="off"
      aria-autocomplete="list"
      [attr.aria-expanded]="showList()"
      [attr.aria-controls]="id + '-listbox'"
      [attr.aria-activedescendant]="showList() && activeIndex() >= 0 ? id + '-opt-' + activeIndex() : null"
      [value]="query()"
      (input)="onInput($event)"
      (keydown)="onKeyDown($event)"
      (blur)="open.set(false)"
    />
    <div role="status" aria-live="polite" class="sr-only">
      {{ state().status === 'success' && showList() ? state().results.length + ' results' : '' }}
    </div>
    @if (showList()) {
      <ul [id]="id + '-listbox'" role="listbox" [attr.aria-label]="label()">
        @if (state().status === 'loading' && state().results.length === 0) {
          <li role="presentation">Searching…</li>
        }
        @if (state().status === 'error') {
          <li role="presentation">Search failed. Keep typing to retry.</li>
        }
        @if (state().status === 'success' && state().results.length === 0) {
          <li role="presentation">No matches</li>
        }
        @for (option of state().results; track option.id; let i = $index) {
          <li
            [id]="id + '-opt-' + i"
            role="option"
            [attr.aria-selected]="i === activeIndex()"
            (mousedown)="$event.preventDefault()"
            (click)="select(option)"
            (mousemove)="activeIndex.set(i)"
          >
            @let parts = split(option.label);
            {{ parts[0] }}<mark>{{ parts[1] }}</mark>{{ parts[2] }}
          </li>
        }
      </ul>
    }
  `,
})
export class TypeaheadComponent {
  readonly label = input.required<string>();
  readonly search = input.required<SearchFn>();
  readonly selected = output<Option>();

  protected readonly id = `typeahead-${nextId++}`;
  protected readonly query = signal('');
  protected readonly open = signal(false);
  private readonly cache = new Map<string, Option[]>();

  protected readonly state = toSignal(
    toObservable(this.query).pipe(
      map((q) => q.trim()),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) => this.run(q)), // a new query unsubscribes the old one: no stale writes
    ),
    { initialValue: IDLE },
  );

  // Resets to -1 whenever the results change, with no effect() needed.
  protected readonly activeIndex = linkedSignal({ source: () => this.state().results, computation: () => -1 });
  protected readonly showList = () => this.open() && this.query().trim().length >= 2;

  private run(q: string): Observable<SearchState> {
    if (q.length < 2) return of(IDLE);
    const cached = this.cache.get(q);
    if (cached) return of({ status: 'success', results: cached });
    return new Observable<SearchState>((subscriber) => {
      const controller = new AbortController();
      subscriber.next({ status: 'loading', results: [] });
      this.search()(q, controller.signal).then(
        (results) => {
          this.cache.set(q, results);
          subscriber.next({ status: 'success', results });
          subscriber.complete();
        },
        () => {
          if (controller.signal.aborted) return;
          subscriber.next({ status: 'error', results: [] });
          subscriber.complete();
        },
      );
      return () => controller.abort(); // runs when switchMap drops this request
    });
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.open.set(true);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    const count = this.state().results.length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.open.set(true);
        this.activeIndex.update((i) => (count === 0 ? -1 : (i + 1) % count));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.update((i) => (count === 0 ? -1 : (i - 1 + count) % count));
        break;
      case 'Enter': {
        const option = this.state().results[this.activeIndex()];
        if (this.open() && option) {
          event.preventDefault();
          this.select(option);
        }
        break;
      }
      case 'Escape':
        if (this.open()) this.open.set(false);
        else this.query.set('');
        break;
    }
  }

  protected select(option: Option): void {
    this.query.set(option.label);
    this.open.set(false);
    this.selected.emit(option);
  }

  protected split(text: string): [string, string, string] {
    const q = this.query().trim().toLowerCase();
    const start = q ? text.toLowerCase().indexOf(q) : -1;
    return start === -1 ? [text, '', ''] : [text.slice(0, start), text.slice(start, start + q.length), text.slice(start + q.length)];
  }
}
```

Angular notes for the interview:

- `switchMap` is the whole race-safety story; say so. `exhaustMap` or `mergeMap` here would be the classic bug.
- Interpolation (`{{ }}`) escapes text, so the highlight is safe without `innerHTML`; never reach for `[innerHTML]` with raw labels.
- `OnPush` plus signals means only the list re-renders on keystrokes; `track option.id` keeps DOM nodes stable.
- In a real app you would likely use Angular CDK's `CdkListbox` or Angular Aria for the pattern instead of hand-rolling it.
:::

:::vue
### Data composable and component (Vue)

A watcher with `onWatcherCleanup` (Vue 3.5+) is the direct counterpart of the React effect cleanup: it runs before the next run, so it clears the timer and aborts the request.

```ts
// useSearch.ts
import { onWatcherCleanup, shallowRef, watch, type Ref } from 'vue';

export type Status = 'idle' | 'loading' | 'success' | 'error';

export function useSearch<T>(
  query: Ref<string>,
  search: (q: string, signal: AbortSignal) => Promise<T[]>,
  { minChars = 2, delay = 250 } = {},
) {
  const state = shallowRef<{ status: Status; results: T[] }>({ status: 'idle', results: [] });
  const cache = new Map<string, T[]>();

  watch(
    query,
    (value) => {
      const q = value.trim();
      if (q.length < minChars) {
        state.value = { status: 'idle', results: [] };
        return;
      }
      const cached = cache.get(q);
      if (cached) {
        state.value = { status: 'success', results: cached };
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(async () => {
        state.value = { status: 'loading', results: state.value.results };
        try {
          const results = await search(q, controller.signal);
          cache.set(q, results);
          state.value = { status: 'success', results };
        } catch {
          if (!controller.signal.aborted) state.value = { status: 'error', results: [] };
        }
      }, delay);
      onWatcherCleanup(() => {
        clearTimeout(timer);
        controller.abort(); // a newer query supersedes this one: no stale writes
      });
    },
    { immediate: true },
  );

  return state;
}
```

```vue
<!-- Typeahead.vue -->
<script setup lang="ts" generic="T extends { id: string; label: string }">
import { computed, ref, useId, watch } from 'vue';
import Highlight from './Highlight.vue';
import { useSearch } from './useSearch';

const props = defineProps<{
  label: string;
  search: (q: string, signal: AbortSignal) => Promise<T[]>;
}>();
const emit = defineEmits<{ select: [option: T] }>();

const id = useId();
const query = ref('');
const open = ref(false);
const activeIndex = ref(-1);
const state = useSearch(query, props.search);
const results = computed(() => state.value.results);

watch(results, () => (activeIndex.value = -1)); // reset the highlight when results change

const showList = computed(() => open.value && query.value.trim().length >= 2);
const activeId = computed(() => (showList.value && activeIndex.value >= 0 ? `${id}-opt-${activeIndex.value}` : undefined));

function select(option: T) {
  query.value = option.label;
  open.value = false;
  emit('select', option);
}

function onKeyDown(event: KeyboardEvent) {
  const count = results.value.length;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    open.value = true;
    activeIndex.value = count === 0 ? -1 : (activeIndex.value + 1) % count;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex.value = count === 0 ? -1 : (activeIndex.value - 1 + count) % count;
  } else if (event.key === 'Enter') {
    const option = results.value[activeIndex.value];
    if (open.value && option) {
      event.preventDefault();
      select(option);
    }
  } else if (event.key === 'Escape') {
    if (open.value) open.value = false;
    else query.value = '';
  }
}

</script>

<template>
  <div class="typeahead">
    <label :for="`${id}-input`">{{ label }}</label>
    <input
      :id="`${id}-input`"
      v-model="query"
      role="combobox"
      autocomplete="off"
      aria-autocomplete="list"
      :aria-expanded="showList"
      :aria-controls="`${id}-listbox`"
      :aria-activedescendant="activeId"
      @input="open = true"
      @keydown="onKeyDown"
      @blur="open = false"
    />
    <div role="status" aria-live="polite" class="sr-only">
      {{ state.status === 'success' && showList ? `${results.length} results` : '' }}
    </div>
    <ul v-if="showList" :id="`${id}-listbox`" role="listbox" :aria-label="label">
      <li v-if="state.status === 'loading' && results.length === 0" role="presentation">Searching…</li>
      <li v-if="state.status === 'error'" role="presentation">Search failed. Keep typing to retry.</li>
      <li v-if="state.status === 'success' && results.length === 0" role="presentation">No matches</li>
      <li
        v-for="(option, index) in results"
        :id="`${id}-opt-${index}`"
        :key="option.id"
        role="option"
        :aria-selected="index === activeIndex"
        @mousedown.prevent
        @click="select(option)"
        @mousemove="activeIndex = index"
      >
        <Highlight :text="option.label" :query="query" />
      </li>
    </ul>
  </div>
</template>
```

```vue
<!-- Highlight.vue -->
<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ text: string; query: string }>();
const parts = computed(() => {
  const q = props.query.trim().toLowerCase();
  const start = q ? props.text.toLowerCase().indexOf(q) : -1;
  if (start === -1) return [props.text, '', ''] as const;
  return [props.text.slice(0, start), props.text.slice(start, start + q.length), props.text.slice(start + q.length)] as const;
});
</script>

<template>{{ parts[0] }}<mark>{{ parts[1] }}</mark>{{ parts[2] }}</template>
```

Vue notes for the interview:

- `@mousedown.prevent` is the modifier form of the React `preventDefault` trick that keeps focus in the input.
- Mustache interpolation escapes text, so the highlight is safe; avoid `v-html` with labels.
- `shallowRef` for results avoids deep-reactive proxies on potentially large arrays; replacing the whole value is what triggers updates.
- `watch(results, …)` is the one place a watcher is justified: resetting derived UI state that cannot be computed.
:::

### Details that separate senior answers

- **Focus never leaves the input**; `aria-activedescendant` points at the highlighted option so screen readers announce it.
- **`onMouseDown` preventDefault** on options so the input's blur doesn't close the list before the click lands.
- **Results count announced** via a polite live region, not on every keystroke while loading.
- **Highlight with elements, not `innerHTML`** (no XSS from labels).
- **Keep previous results** visible while loading the next query to avoid flicker.
- Scroll the active option into view (`scrollIntoView({ block: 'nearest' })`) for long lists.

### Production vs interview

Production adds: virtualization for big result sets, recent searches, grouping, i18n-aware matching (`Intl.Collator`, diacritics), analytics, server-side ranking, and probably a library (Downshift, React Aria `useComboBox`) because the ARIA/IME/mobile edge cases are deep (IME composition events, iOS VoiceOver quirks).

### References

- [WAI-ARIA APG: Combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [React Aria: useComboBox](https://react-spectrum.adobe.com/react-aria/useComboBox.html)
- [Downshift](https://www.downshift-js.com/)

## Build a virtualized list from scratch (fixed and variable row heights)
<!--
id: virtual-list-from-scratch
level: lead
tags: virtualization, windowing, performance, scrolling, machine coding
minutes: 40
-->

> [!PROMPT]
> Build a `VirtualList` that renders 100,000 rows smoothly by rendering only what is visible. Start with fixed row heights, then support variable heights.
>
> **Requirements**
> - A scroll container with a spacer of the full height; rows positioned with `transform`; overscan of a few rows.
> - Variable heights measured after render (`ResizeObserver`) without scroll jumps; `scrollToIndex(i)`.
>
> **Test cases**
> - 100,000 rows, 40 px each, a 400 px viewport → about 10 rows plus overscan are in the DOM, never 100,000.
> - Scrolling to `scrollTop = 40_000` shows rows starting at index 1000.
> - `scrollToIndex(5000)` puts row 5000 at the top of the viewport.
> - Variable heights: a row growing from 40 to 120 px shifts later rows without moving the rows currently in view.

> [!TLDR]
> Render only the rows intersecting the viewport (plus overscan) inside a spacer whose height equals the total list height; position rows with `transform: translateY`. For fixed heights, the visible range is `floor(scrollTop / rowHeight)` arithmetic. For variable heights, keep a prefix-sum of measured (or estimated) heights and binary-search the start index; measure rendered rows with `ResizeObserver` and correct the offsets. Watch out for scroll anchoring when measured heights differ from estimates.

:::react
### Fixed-height version

```tsx
interface VirtualListProps<T> {
  items: readonly T[];
  rowHeight: number;
  height: number;
  overscan?: number;
  renderRow: (item: T, index: number) => React.ReactNode;
  getKey: (item: T, index: number) => string;
}

export function VirtualList<T>({ items, rowHeight, height, overscan = 6, renderRow, getKey }: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const total = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);

  const rows: React.ReactNode[] = [];
  for (let index = start; index < end; index++) {
    const item = items[index];
    if (item === undefined) continue;
    rows.push(
      <div
        key={getKey(item, index)}
        role="listitem"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: rowHeight, transform: `translateY(${index * rowHeight}px)` }}
      >
        {renderRow(item, index)}
      </div>,
    );
  }

  return (
    <div
      role="list"
      aria-rowcount={items.length}
      style={{ height, overflowY: 'auto', position: 'relative', contain: 'strict' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: total, position: 'relative' }}>{rows}</div>
    </div>
  );
}
```

Complexity: O(visible) DOM nodes and render work per scroll, independent of list size. Scroll events fire at frame rate; the state update is cheap because only ~30 rows render.
:::

:::angular
### Fixed-height version (Angular)

Signals make the window a `computed`; only the visible rows are in the template. Rows come from a projected `ng-template`, the Angular counterpart of the React `renderRow` prop.

```ts
import { ChangeDetectionStrategy, Component, TemplateRef, computed, contentChild, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

interface RowContext<T> {
  $implicit: T;
  index: number;
}

@Component({
  selector: 'app-virtual-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  template: `
    <div
      class="viewport"
      role="list"
      [attr.aria-rowcount]="items().length"
      [style.height.px]="height()"
      (scroll)="onScroll($event)"
    >
      <div class="spacer" [style.height.px]="total()">
        @for (row of rows(); track row.key) {
          <div
            class="row"
            role="listitem"
            [style.height.px]="rowHeight()"
            [style.transform]="'translateY(' + row.index * rowHeight() + 'px)'"
          >
            <ng-container [ngTemplateOutlet]="rowTemplate()" [ngTemplateOutletContext]="{ $implicit: row.item, index: row.index }" />
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .viewport { overflow-y: auto; position: relative; contain: strict; }
    .spacer { position: relative; }
    .row { position: absolute; top: 0; left: 0; right: 0; }
  `,
})
export class VirtualListComponent<T> {
  readonly items = input.required<readonly T[]>();
  readonly rowHeight = input.required<number>();
  readonly height = input.required<number>();
  readonly overscan = input(6);
  readonly getKey = input.required<(item: T, index: number) => string>();
  protected readonly rowTemplate = contentChild.required<TemplateRef<RowContext<T>>>(TemplateRef);

  private readonly scrollTop = signal(0);
  protected readonly total = computed(() => this.items().length * this.rowHeight());

  protected readonly rows = computed(() => {
    const items = this.items();
    const rowHeight = this.rowHeight();
    const start = Math.max(0, Math.floor(this.scrollTop() / rowHeight) - this.overscan());
    const end = Math.min(items.length, Math.ceil((this.scrollTop() + this.height()) / rowHeight) + this.overscan());
    const getKey = this.getKey();
    const visible: { item: T; index: number; key: string }[] = [];
    for (let index = start; index < end; index++) {
      const item = items[index];
      if (item !== undefined) visible.push({ item, index, key: getKey(item, index) });
    }
    return visible;
  });

  protected onScroll(event: Event): void {
    this.scrollTop.set((event.currentTarget as HTMLElement).scrollTop);
  }
}
```

```html
<app-virtual-list [items]="people()" [rowHeight]="48" [height]="480" [getKey]="personKey">
  <ng-template let-person let-i="index">{{ i + 1 }}. {{ person.name }}</ng-template>
</app-virtual-list>
```

Complexity is the same: O(visible) work per scroll. The `computed` only recomputes when the scroll offset or inputs change, and `OnPush` skips the rest of the tree. In production you would reach for the CDK's `cdk-virtual-scroll-viewport` with `*cdkVirtualFor`, which also handles variable sizes through a custom strategy.
:::

:::vue
### Fixed-height version (Vue)

A scoped slot is the Vue counterpart of the React `renderRow` prop. The visible window is a `computed`, so it only re-evaluates when the scroll offset or props change.

```vue
<!-- VirtualList.vue -->
<script setup lang="ts" generic="T">
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    items: readonly T[];
    rowHeight: number;
    height: number;
    overscan?: number;
    getKey: (item: T, index: number) => string;
  }>(),
  { overscan: 6 },
);

defineSlots<{ default(props: { item: T; index: number }): unknown }>();

const scrollTop = ref(0);
const total = computed(() => props.items.length * props.rowHeight);

const rows = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.overscan);
  const end = Math.min(props.items.length, Math.ceil((scrollTop.value + props.height) / props.rowHeight) + props.overscan);
  const visible: { item: T; index: number; key: string }[] = [];
  for (let index = start; index < end; index++) {
    const item = props.items[index];
    if (item !== undefined) visible.push({ item, index, key: props.getKey(item, index) });
  }
  return visible;
});

function onScroll(event: Event) {
  scrollTop.value = (event.currentTarget as HTMLElement).scrollTop;
}
</script>

<template>
  <div
    role="list"
    :aria-rowcount="items.length"
    :style="{ height: `${height}px`, overflowY: 'auto', position: 'relative', contain: 'strict' }"
    @scroll.passive="onScroll"
  >
    <div :style="{ height: `${total}px`, position: 'relative' }">
      <div
        v-for="row in rows"
        :key="row.key"
        role="listitem"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: `${rowHeight}px`,
          transform: `translateY(${row.index * rowHeight}px)`,
        }"
      >
        <slot :item="row.item" :index="row.index" />
      </div>
    </div>
  </div>
</template>
```

```vue
<VirtualList :items="people" :row-height="48" :height="480" :get-key="(p) => p.id" v-slot="{ item, index }">
  {{ index + 1 }}. {{ item.name }}
</VirtualList>
```

Two Vue-specific points. Pass big arrays as a `shallowRef` (or `markRaw`) so Vue does not wrap ten thousand objects in deep proxies. And `@scroll.passive` tells the browser the handler never calls `preventDefault`, so scrolling is not blocked. The ready-made option is `vue-virtual-scroller` or TanStack Virtual's Vue adapter.
:::

### Variable heights: prefix sums + binary search

```ts
export class HeightIndex {
  #heights: number[];
  #offsets: number[] = [0]; // offsets[i] = top of row i; lazily rebuilt
  #dirtyFrom = 0;

  constructor(count: number, estimate: number) {
    this.#heights = new Array<number>(count).fill(estimate);
  }

  setHeight(index: number, height: number): boolean {
    if (this.#heights[index] === height) return false;
    this.#heights[index] = height;
    this.#dirtyFrom = Math.min(this.#dirtyFrom, index + 1);
    return true;
  }

  #ensure(upTo: number) {
    for (let i = Math.max(1, this.#dirtyFrom); i <= upTo; i++) {
      this.#offsets[i] = (this.#offsets[i - 1] ?? 0) + (this.#heights[i - 1] ?? 0);
    }
    this.#dirtyFrom = Math.max(this.#dirtyFrom, upTo + 1);
  }

  offsetOf(index: number): number {
    this.#ensure(index);
    return this.#offsets[index] ?? 0;
  }

  totalHeight(): number {
    return this.offsetOf(this.#heights.length);
  }

  /** First row whose bottom edge is below `scrollTop`. O(log n). */
  indexAt(scrollTop: number): number {
    this.#ensure(this.#heights.length);
    let lo = 0;
    let hi = this.#heights.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.#offsets[mid + 1] ?? 0) <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
```

Rendered rows report their real height with a `ResizeObserver`; when it differs from the estimate, update the index and re-render. If a row **above** the viewport changes height, adjust `scrollTop` by the delta so the content the user is looking at doesn't jump.

### Edge cases and polish

- **Accessibility**: off-screen rows don't exist in the DOM, so screen readers can't reach them; expose `aria-rowcount`/`aria-rowindex` (grid) or `aria-setsize`/`aria-posinset` (list) and keep keyboard navigation index-based.
- **Find in page** (Ctrl+F) can't find unrendered rows. For documents, consider `content-visibility: auto` instead of virtualization.
- **Sticky headers/grouping**, **scroll to index**, **dynamic insertion at the top** (chat): each needs anchoring logic.
- **Fast scrolling** shows blank space if rendering can't keep up: increase overscan, simplify rows, or render placeholders.

### Production vs interview

Use TanStack Virtual or react-window/react-virtuoso in production; they handle measurement, horizontal/grid virtualization, sticky items, and many browser quirks. The interview tests whether you understand the math and the trade-offs.

### References

- [TanStack Virtual](https://tanstack.com/virtual/latest)
- [web.dev: Virtualize large lists](https://web.dev/articles/virtualize-long-lists-react-window)
- [MDN: content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility)

## Build a modal dialog: focus trap, scroll lock, stacking, and why `<dialog>` helps
<!--
id: modal-dialog
level: senior
tags: modal, dialog, focus management, accessibility, portals
minutes: 30
-->

> [!PROMPT]
> Build an accessible modal dialog component (title, body, actions) that works with nested modals and long content. Explain where the native `<dialog>` element helps and where it doesn't.
>
> **Requirements**
> - Moves focus in on open and restores it to the trigger on close; traps Tab and Shift+Tab; Escape and backdrop click close it.
> - Locks background scroll and makes the rest of the page inert for assistive tech; correct `role`, `aria-modal` and labelling.
>
> **Test cases**
> - Open → focus is on the first focusable element; close → focus returns to the opening button.
> - Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last.
> - Escape closes only the top modal when two are open.
> - While open, `document.body` can't scroll and background content is not reachable by Tab.

> [!TLDR]
> A modal must: move focus inside on open (first field or the dialog itself), **trap** focus while open, close on Escape (and optionally backdrop click), make the background inert to keyboard and screen readers, prevent background scroll, restore focus to the trigger on close, and have an accessible name. The native `<dialog>` element with `showModal()` gives you top-layer rendering, inert background, focus handling and Escape for free; build on it rather than reimplementing.

:::react
### On top of `<dialog>`

```tsx
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function Modal({ open, onClose, title, children, initialFocusRef }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const previouslyFocused = document.activeElement;
      dialog.showModal(); // top layer, inert background, Escape fires "cancel"
      initialFocusRef?.current?.focus();
      document.documentElement.style.overflow = 'hidden'; // scroll lock
      return () => {
        document.documentElement.style.overflow = '';
        if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus(); // restore focus
      };
    }
    if (!open && dialog.open) dialog.close();
  }, [open, initialFocusRef]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose} // Escape and dialog.close() both end here
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(); // backdrop click
      }}
      className="modal"
    >
      <div className="modal-body">
        <h2 id={titleId}>{title}</h2>
        {children}
        <button type="button" onClick={onClose} aria-label="Close">×</button>
      </div>
    </dialog>
  );
}
```

> [!NOTE]
> The effect here is legitimate: it synchronizes React state with an imperative browser API (`showModal`/`close`) and owns cleanup (scroll lock, focus restore).
:::

:::angular
### On top of `<dialog>` (Angular)

```ts
import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';

let nextId = 0;

@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="modal"
      [attr.aria-labelledby]="titleId"
      (close)="closed.emit()"
      (click)="onClick($event)"
    >
      <div class="modal-body">
        <h2 [id]="titleId">{{ title() }}</h2>
        <ng-content />
        <button type="button" (click)="closed.emit()" aria-label="Close">×</button>
      </div>
    </dialog>
  `,
})
export class ModalComponent {
  readonly open = input.required<boolean>();
  readonly title = input.required<string>();
  readonly closed = output<void>(); // Escape, the close button and the backdrop all end here

  protected readonly titleId = `modal-title-${nextId++}`;
  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect((onCleanup) => {
      const dialog = this.dialogRef().nativeElement;
      if (this.open() && !dialog.open) {
        const previouslyFocused = document.activeElement;
        dialog.showModal(); // top layer, inert background, Escape fires "cancel"
        document.documentElement.style.overflow = 'hidden'; // scroll lock
        onCleanup(() => {
          document.documentElement.style.overflow = '';
          if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus(); // restore focus
        });
      } else if (!this.open() && dialog.open) {
        dialog.close();
      }
    });
  }

  protected onClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit(); // backdrop click
  }
}
```

Put `autofocus` on the element that should receive initial focus; `showModal()` honours it, which replaces the React `initialFocusRef`.

> [!NOTE]
> `effect` is the right tool here for the same reason `useEffect` is in React: it synchronizes component state with an imperative browser API (`showModal`/`close`) and owns the cleanup. For the trap-it-yourself version below, the Angular CDK's `FocusTrap` and `Dialog` service implement the whole pattern, including the modal stack.
:::

:::vue
### On top of `<dialog>` (Vue)

```vue
<!-- Modal.vue -->
<script setup lang="ts">
import { useId, useTemplateRef, watchPostEffect } from 'vue';

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>(); // Escape, the close button and the backdrop all end here

const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const titleId = useId();

// Post-flush so the <dialog> element exists; the cleanup runs before the next run and on unmount.
watchPostEffect((onCleanup) => {
  const el = dialog.value;
  if (!el) return;
  if (props.open && !el.open) {
    const previouslyFocused = document.activeElement;
    el.showModal(); // top layer, inert background, Escape fires "cancel"
    document.documentElement.style.overflow = 'hidden'; // scroll lock
    onCleanup(() => {
      document.documentElement.style.overflow = '';
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus(); // restore focus
    });
  } else if (!props.open && el.open) {
    el.close();
  }
});
</script>

<template>
  <dialog ref="dialog" class="modal" :aria-labelledby="titleId" @close="emit('close')" @click.self="emit('close')">
    <div class="modal-body">
      <h2 :id="titleId">{{ title }}</h2>
      <slot />
      <button type="button" aria-label="Close" @click="emit('close')">×</button>
    </div>
  </dialog>
</template>
```

`@click.self` is the idiomatic backdrop check (the React version compares `target` and `currentTarget` by hand). Put `autofocus` on the element that should get initial focus. The watcher is legitimate for the same reason `useEffect` is: it synchronizes component state with an imperative browser API and owns the cleanup. For the hand-built trap version below, libraries such as `focus-trap` (with `@vueuse/integrations`) or Headless UI's `Dialog` for Vue cover the pattern, including stacking.
:::

### If you can't use `<dialog>` (or are asked to build the trap)

```ts
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(container: HTMLElement, event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
```

Plus: render in a portal, set `inert` on the app root (or `aria-hidden` + manual tab blocking for old browsers), `role="dialog"` + `aria-modal="true"`, and a stack so nested modals restore focus correctly.

### Edge cases

- **Nested modals / modal stack**: only the top modal handles Escape; restoring focus goes back down the stack.
- **Scroll lock on iOS Safari**: `overflow: hidden` on `html` may not stop rubber-banding; libraries use `position: fixed` with saved scroll position.
- **Scrollbar layout shift**: compensate with `scrollbar-gutter: stable` or padding equal to the scrollbar width.
- **Destructive confirmations**: initial focus on the least destructive action.
- **Animations**: `<dialog>` closing animations need `@starting-style` / `transition-behavior: allow-discrete` or a delayed close.

### References

- [WAI-ARIA APG: Dialog (modal) pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [MDN: The dialog element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog)
- [MDN: inert](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inert)

## Build an OTP input: paste, backspace, autofill and accessibility
<!--
id: otp-input
level: senior
tags: otp, inputs, paste, autofill, accessibility, machine coding
minutes: 25
-->

> [!PROMPT]
> Build a 6-digit one-time-password input made of single-character boxes. It must feel like one field: typing, deleting, pasting and mobile autofill all work, and it is accessible.
>
> **Requirements**
> - Digits only; auto-advance on type; Backspace clears the current box or moves left; Arrow keys move focus.
> - Paste a full code, SMS autofill (`autocomplete="one-time-code"`), `onComplete(code)` fires once.
>
> **Test cases**
> - Typing `1`, `2`, `3` fills three boxes and focuses the fourth.
> - Backspace on an empty box moves focus left and clears that box.
> - Pasting `123456` fills all boxes and calls `onComplete('123456')` once; pasting `12ab56` keeps only the digits.
> - Typing a letter is ignored; screen readers announce "Digit 3 of 6".

> [!TLDR]
> Model the value as one string, render N single-character inputs, and handle: typing (write char, move focus right), backspace (clear current or move left and clear), arrow keys, **paste of the full code** into any box, and mobile **SMS autofill** (`autocomplete="one-time-code"`, which delivers the whole code into one input). Accessibility: a group label, per-input labels like "Digit 3 of 6", and `inputmode="numeric"`. Many teams now prefer a single input with visual boxes, which makes autofill, paste and screen readers trivial.

:::react
### Implementation (multi-input)

```tsx
interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
}

export function OtpInput({ length = 6, value, onChange, onComplete }: OtpInputProps) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const groupId = useId();

  const focusAt = (index: number) => inputs.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  const writeAt = (index: number, chars: string) => {
    const digits = chars.replace(/\D/g, '');
    if (!digits) return;
    // The value is contiguous (no holes), so typing past the end writes at the end.
    const start = Math.min(index, value.length);
    commit(value.slice(0, start) + digits + value.slice(start + digits.length));
    focusAt(start + digits.length);
  };

  return (
    <div role="group" aria-labelledby={`${groupId}-label`} className="otp">
      <span id={`${groupId}-label`}>Verification code</span>
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(el) => {
            inputs.current[index] = el;
          }}
          aria-label={`Digit ${index + 1} of ${length}`}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={index === 0 ? length : 1} // first box may receive the whole autofilled code
          value={value[index] ?? ''}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => writeAt(index, e.target.value)}
          onPaste={(e) => {
            e.preventDefault();
            writeAt(index, e.clipboardData.getData('text'));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (value[index]) commit(value.slice(0, index) + value.slice(index + 1));
              else if (index > 0) {
                commit(value.slice(0, index - 1) + value.slice(index));
                focusAt(index - 1);
              }
            } else if (e.key === 'ArrowLeft') focusAt(index - 1);
            else if (e.key === 'ArrowRight') focusAt(index + 1);
          }}
        />
      ))}
    </div>
  );
}
```

### The single-input alternative

```tsx
<input
  aria-label="Verification code"
  inputMode="numeric"
  autoComplete="one-time-code"
  pattern="\d{6}"
  maxLength={6}
  className="otp-single" /* letter-spacing + background boxes via CSS */
/>
```

One input means native paste, autofill, undo, IME and screen-reader behavior all work. If design insists on boxes, draw them with CSS behind a single input.
:::

:::angular
### Implementation, multi-input (Angular)

```ts
import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, output, viewChildren } from '@angular/core';

let nextId = 0;

@Component({
  selector: 'app-otp-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="otp" role="group" [attr.aria-labelledby]="id + '-label'">
      <span [id]="id + '-label'">Verification code</span>
      @for (box of boxes(); track box) {
        <input
          #cell
          [attr.aria-label]="'Digit ' + (box + 1) + ' of ' + length()"
          inputmode="numeric"
          [attr.autocomplete]="box === 0 ? 'one-time-code' : 'off'"
          [attr.maxlength]="box === 0 ? length() : 1"
          [value]="value()[box] ?? ''"
          (focus)="selectAll($event)"
          (input)="onInput($event, box)"
          (paste)="onPaste($event, box)"
          (keydown)="onKeyDown($event, box)"
        />
      }
    </div>
  `,
})
export class OtpInputComponent {
  readonly length = input(6);
  readonly value = model(''); // two-way: [(value)]="code"
  readonly completed = output<string>();

  protected readonly id = `otp-${nextId++}`;
  protected readonly boxes = computed(() => Array.from({ length: this.length() }, (_, i) => i));
  private readonly inputs = viewChildren<ElementRef<HTMLInputElement>>('cell');

  private focusAt(index: number): void {
    const clamped = Math.max(0, Math.min(this.length() - 1, index));
    this.inputs()[clamped]?.nativeElement.focus();
  }

  private commit(next: string): void {
    const clean = next.replace(/\D/g, '').slice(0, this.length());
    this.value.set(clean);
    if (clean.length === this.length()) this.completed.emit(clean);
  }

  private writeAt(index: number, chars: string): void {
    const digits = chars.replace(/\D/g, '');
    if (!digits) return;
    const current = this.value();
    // The value is contiguous (no holes), so typing past the end writes at the end.
    const start = Math.min(index, current.length);
    this.commit(current.slice(0, start) + digits + current.slice(start + digits.length));
    this.focusAt(start + digits.length);
  }

  protected selectAll(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  protected onInput(event: Event, index: number): void {
    const el = event.target as HTMLInputElement;
    this.writeAt(index, el.value);
    el.value = this.value()[index] ?? ''; // a rejected character must not stay in the box
  }

  protected onPaste(event: ClipboardEvent, index: number): void {
    event.preventDefault();
    this.writeAt(index, event.clipboardData?.getData('text') ?? '');
  }

  protected onKeyDown(event: KeyboardEvent, index: number): void {
    const current = this.value();
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (current[index]) this.commit(current.slice(0, index) + current.slice(index + 1));
      else if (index > 0) {
        this.commit(current.slice(0, index - 1) + current.slice(index));
        this.focusAt(index - 1);
      }
    } else if (event.key === 'ArrowLeft') this.focusAt(index - 1);
    else if (event.key === 'ArrowRight') this.focusAt(index + 1);
  }
}
```

Notes: `model()` gives the parent two-way binding with `[(value)]`; it replaces the React `value`/`onChange` pair. The explicit `el.value = …` reset in `onInput` is Angular's version of what React's controlled inputs do for free: with signals, an unchanged `value()` does not re-render the binding, so a rejected letter would otherwise stay visible. For forms integration, wrap it as a `ControlValueAccessor` so it works with `FormControl`.

### The single-input alternative

```html
<input
  aria-label="Verification code"
  inputmode="numeric"
  autocomplete="one-time-code"
  pattern="\d{6}"
  maxlength="6"
  class="otp-single"
  [formControl]="code"
/>
```

One input means native paste, autofill, undo, IME and screen-reader behavior all work, and it plugs straight into Reactive Forms. If design insists on boxes, draw them with CSS behind a single input.
:::

:::vue
### Implementation, multi-input (Vue)

```vue
<!-- OtpInput.vue -->
<script setup lang="ts">
import { useId } from 'vue';

const props = withDefaults(defineProps<{ length?: number }>(), { length: 6 });
const value = defineModel<string>({ default: '' }); // v-model on the component
const emit = defineEmits<{ complete: [code: string] }>();

const groupId = useId();
const inputs: (HTMLInputElement | null)[] = []; // function refs keep index order in v-for

function focusAt(index: number) {
  inputs[Math.max(0, Math.min(props.length - 1, index))]?.focus();
}

function commit(next: string) {
  const clean = next.replace(/\D/g, '').slice(0, props.length);
  value.value = clean;
  if (clean.length === props.length) emit('complete', clean);
}

function writeAt(index: number, chars: string) {
  const digits = chars.replace(/\D/g, '');
  if (!digits) return;
  // The value is contiguous (no holes), so typing past the end writes at the end.
  const start = Math.min(index, value.value.length);
  commit(value.value.slice(0, start) + digits + value.value.slice(start + digits.length));
  focusAt(start + digits.length);
}

function onInput(event: Event, index: number) {
  const el = event.target as HTMLInputElement;
  writeAt(index, el.value);
  el.value = value.value[index] ?? ''; // a rejected character must not stay in the box
}

function onPaste(event: ClipboardEvent, index: number) {
  writeAt(index, event.clipboardData?.getData('text') ?? '');
}

function onKeyDown(event: KeyboardEvent, index: number) {
  const current = value.value;
  if (event.key === 'Backspace') {
    event.preventDefault();
    if (current[index]) commit(current.slice(0, index) + current.slice(index + 1));
    else if (index > 0) {
      commit(current.slice(0, index - 1) + current.slice(index));
      focusAt(index - 1);
    }
  } else if (event.key === 'ArrowLeft') focusAt(index - 1);
  else if (event.key === 'ArrowRight') focusAt(index + 1);
}
</script>

<template>
  <div class="otp" role="group" :aria-labelledby="`${groupId}-label`">
    <span :id="`${groupId}-label`">Verification code</span>
    <input
      v-for="index in length"
      :key="index"
      :ref="(el) => (inputs[index - 1] = el as HTMLInputElement | null)"
      :aria-label="`Digit ${index} of ${length}`"
      inputmode="numeric"
      :autocomplete="index === 1 ? 'one-time-code' : 'off'"
      :maxlength="index === 1 ? length : 1"
      :value="value[index - 1] ?? ''"
      @focus="($event.target as HTMLInputElement).select()"
      @input="onInput($event, index - 1)"
      @paste.prevent="onPaste($event, index - 1)"
      @keydown="onKeyDown($event, index - 1)"
    />
  </div>
</template>
```

Notes: `defineModel` (Vue 3.4+) replaces the `modelValue` prop plus `update:modelValue` emit boilerplate. Use function refs for `v-for` inputs, because template-ref arrays do not guarantee source order. The `el.value = …` reset does the job React's controlled inputs do automatically: when the bound value does not change, Vue does not patch the DOM, so a rejected letter would otherwise stay in the box.

### The single-input alternative

```vue
<input
  v-model="code"
  aria-label="Verification code"
  inputmode="numeric"
  autocomplete="one-time-code"
  pattern="\d{6}"
  maxlength="6"
  class="otp-single"
/>
```

One input means native paste, autofill, undo, IME and screen-reader behavior all work. If design insists on boxes, draw them with CSS behind a single input.
:::

### Edge cases

- **Non-digits** (letters, spaces in pasted "123 456") are stripped.
- **Auto-submit** on complete is convenient but announce errors and don't submit twice (guard in-flight).
- **WebOTP API** (`navigator.credentials.get({ otp })`) on Android Chrome can read the SMS code with user consent.
- **Rate limits and resend timers** belong in the surrounding flow, with the countdown announced politely.

### References

- [MDN: autocomplete one-time-code](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete)
- [MDN: WebOTP API](https://developer.mozilla.org/en-US/docs/Web/API/WebOTP_API)

## Add undo/redo to an editor: command pattern vs snapshots, coalescing, and limits
<!--
id: undo-redo-history
level: lead
tags: undo, redo, command pattern, history, state management, machine coding
minutes: 30
-->

> [!PROMPT]
> Add undo and redo to a simple drawing or text editor. Compare snapshots with the command pattern, then implement one of them, including a history limit and merging rapid edits.
>
> **Requirements**
> - `undo`, `redo`, `canUndo`, `canRedo`, keyboard shortcuts (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z).
> - A new edit after undo clears the redo stack; typing bursts coalesce into one step; memory is bounded.
>
> **Test cases**
> - Apply A, B, C then undo twice → state is A; redo once → state is B.
> - Apply A, B, undo, apply D → `canRedo` is false and the history is A, D.
> - Ten keystrokes within 500 ms create one undo step.
> - With a history limit of 50, the 51st edit drops the oldest entry and undo never goes past it.

> [!TLDR]
> Two approaches. **Snapshots**: store past/present/future states; trivial with immutable state and structural sharing, but memory grows with state size. **Commands**: store operations with `apply`/`invert` (or patches); compact and works for collaboration, but each operation needs a correct inverse. Production details: coalesce rapid edits (typing) into one undo step, cap history length, clear the redo stack on a new edit, group multi-step actions in transactions, and decide what is **not** undoable (selection, scroll, server-confirmed side effects).

### Snapshot history as a reducer

```ts
interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastCoalesceKey: string | null;
  lastAt: number;
}

type HistoryAction<T> =
  | { type: 'SET'; next: T; coalesceKey?: string; at: number }
  | { type: 'UNDO' }
  | { type: 'REDO' };

const LIMIT = 100;
const COALESCE_MS = 1000;

export function historyReducer<T>(state: History<T>, action: HistoryAction<T>): History<T> {
  switch (action.type) {
    case 'SET': {
      if (Object.is(action.next, state.present)) return state;
      const coalesce =
        action.coalesceKey !== undefined &&
        action.coalesceKey === state.lastCoalesceKey &&
        action.at - state.lastAt < COALESCE_MS;
      return {
        past: coalesce ? state.past : [...state.past, state.present].slice(-LIMIT),
        present: action.next,
        future: [], // a new edit invalidates redo
        lastCoalesceKey: action.coalesceKey ?? null,
        lastAt: action.at,
      };
    }
    case 'UNDO': {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future], lastCoalesceKey: null, lastAt: 0 };
    }
    case 'REDO': {
      const [next, ...rest] = state.future;
      if (next === undefined) return state;
      return { past: [...state.past, state.present], present: next, future: rest, lastCoalesceKey: null, lastAt: 0 };
    }
  }
}
```

Usage: `dispatch({ type: 'SET', next, coalesceKey: `text:${fieldId}`, at: Date.now() })` for typing; omit the key for discrete actions (delete, move).

Because state is immutable, consecutive snapshots share unchanged subtrees, so memory grows with the size of **changes**, not with document size × steps.

### Command (patch) history

```ts
interface Command {
  label: string;           // "Move 3 shapes", shown in the Edit menu
  apply(doc: Doc): Doc;
  invert(doc: Doc): Command; // computed from the doc *before* apply
}
```

Immer can generate this for you: `produceWithPatches` returns `[next, patches, inversePatches]`; store inverse patches for undo and patches for redo.

### Choosing

| | Snapshots | Commands/patches |
| --- | --- | --- |
| Implementation effort | Low | Higher (correct inverses) |
| Memory | Higher for large states | Low |
| Collaboration | Breaks (undo would revert others' changes) | Works with transforms/CRDTs (undo *your* ops) |
| Debuggability | Easy (time travel) | Labels make menus nice |

### Edge cases

- **Keyboard shortcuts**: Cmd/Ctrl+Z, Shift+Cmd+Z / Ctrl+Y; don't hijack them inside native text inputs, which have their own undo stack.
- **Async/server side effects**: undoing "send email" isn't possible; make such actions non-undoable or delay them (Gmail's "Undo send" holds the send for a few seconds).
- **Selection restore**: store selection with each entry so undo puts the cursor back.
- **Transactions**: a drag that produces 60 move events should be one undo step (begin/commit transaction).

### References

- [Immer: Patches](https://immerjs.github.io/immer/patches/)
- [Redux: Implementing undo history](https://redux.js.org/usage/implementing-undo-history)

## Infinite scrolling feed: cursor pagination, IntersectionObserver and scroll restoration
<!--
id: infinite-scroll-feed
level: senior
tags: infinite scroll, pagination, intersectionobserver, react query, machine coding
minutes: 35
-->

> [!PROMPT]
> Build an infinite feed for a social app: it loads the next page as the user nears the bottom, handles errors, avoids duplicates and keeps the scroll position when the user comes back.
>
> **Requirements**
> - Cursor-based pagination, an `IntersectionObserver` sentinel with `rootMargin`, no duplicate requests.
> - Error row with retry, an "end of feed" state, and scroll restoration on back navigation.
>
> **Test cases**
> - Scrolling the sentinel into view requests the next page once, even if it intersects repeatedly while loading.
> - A response containing an item that is already shown doesn't render it twice.
> - A failed page shows a retry button; retrying loads the same cursor, not the next one.
> - After navigating away and back, the list and scroll offset are restored; the last page shows "You're all caught up".

> [!TLDR]
> Use **cursor-based** pagination (stable under inserts), a sentinel element observed by `IntersectionObserver` with a `rootMargin` to prefetch before the user hits the bottom, one in-flight request at a time, deduplication by item id, explicit loading/error/end states, and a "Load more" button as an accessible fallback. Keep long feeds fast with virtualization, and restore scroll position when the user navigates back.

:::react
### Data layer with TanStack Query

```tsx
interface FeedPage {
  items: Post[];
  nextCursor: string | null;
}

function useFeed() {
  return useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam, signal }) => fetchFeed(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: FeedPage) => lastPage.nextCursor,
    staleTime: 30_000,
  });
}
```

> [!NOTE]
> `null as string | null` is the documented way to type `initialPageParam` in TanStack Query; it widens a literal rather than claiming something unchecked.

### Sentinel with IntersectionObserver

```tsx
function useInView(onEnter: () => void, { rootMargin = '600px 0px' } = {}) {
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  return useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onEnterRef.current();
      }, { rootMargin });
      observer.observe(node);
      return () => observer.disconnect(); // React 19 ref callbacks support cleanup
    },
    [rootMargin],
  );
}

export function Feed() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status, error } = useFeed();
  const posts = useMemo(() => {
    const seen = new Set<string>();
    return (data?.pages ?? [])
      .flatMap((page) => page.items)
      .filter((post) => {
        if (seen.has(post.id)) return false; // cursor overlaps happen; dedupe by id
        seen.add(post.id);
        return true;
      });
  }, [data]);
  const sentinelRef = useInView(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  });

  if (status === 'pending') return <FeedSkeleton />;
  if (status === 'error') return <ErrorState error={error} />;

  return (
    <section aria-label="Feed" aria-busy={isFetchingNextPage}>
      <ol className="feed">{posts.map((post) => <PostCard key={post.id} post={post} />)}</ol>
      {hasNextPage ? (
        <div ref={sentinelRef}>
          <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : (
        <p>You're all caught up.</p>
      )}
    </section>
  );
}
```
:::

:::angular
### Data layer with TanStack Query (Angular)

`@tanstack/angular-query-experimental` exposes the same options with signals instead of hooks.

```ts
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';

interface FeedPage {
  items: Post[];
  nextCursor: string | null;
}

function injectFeed() {
  return injectInfiniteQuery(() => ({
    queryKey: ['feed'],
    queryFn: ({ pageParam, signal }) => fetchFeed(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: FeedPage) => lastPage.nextCursor,
    staleTime: 30_000,
  }));
}
```

> [!NOTE]
> `null as string | null` is the documented way to type `initialPageParam` in TanStack Query; it widens a literal rather than claiming something unchecked.

### Sentinel with IntersectionObserver (Angular)

A small attribute directive owns the observer and its cleanup, so any element can become a sentinel.

```ts
import { DestroyRef, Directive, ElementRef, afterNextRender, inject, input, output } from '@angular/core';

@Directive({ selector: '[appInView]' })
export class InViewDirective {
  readonly rootMargin = input('600px 0px');
  readonly entered = output<void>();

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Browser only: safe with server-side rendering.
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) this.entered.emit();
        },
        { rootMargin: this.rootMargin() },
      );
      observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
```

```ts
@Component({
  selector: 'app-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InViewDirective, PostCardComponent, FeedSkeletonComponent, ErrorStateComponent],
  template: `
    @switch (feed.status()) {
      @case ('pending') {
        <app-feed-skeleton />
      }
      @case ('error') {
        <app-error-state [error]="feed.error()" />
      }
      @default {
        <section aria-label="Feed" [attr.aria-busy]="feed.isFetchingNextPage()">
          <ol class="feed">
            @for (post of posts(); track post.id) {
              <li><app-post-card [post]="post" /></li>
            }
          </ol>
          @if (feed.hasNextPage()) {
            <div appInView (entered)="loadMore()">
              <button type="button" (click)="loadMore()" [disabled]="feed.isFetchingNextPage()">
                {{ feed.isFetchingNextPage() ? 'Loading…' : 'Load more' }}
              </button>
            </div>
          } @else {
            <p>You're all caught up.</p>
          }
        </section>
      }
    }
  `,
})
export class FeedComponent {
  protected readonly feed = injectFeed();

  // Cursor overlaps happen; dedupe by id.
  protected readonly posts = computed(() => {
    const seen = new Set<string>();
    return (this.feed.data()?.pages ?? []).flatMap((page) => page.items).filter((post) => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
  });

  protected loadMore(): void {
    if (this.feed.hasNextPage() && !this.feed.isFetchingNextPage()) void this.feed.fetchNextPage();
  }
}
```

`track post.id` is required by the `@for` block, which nudges you toward stable identity. Without TanStack Query, the same shape works with an RxJS `scan` over a cursor subject and `exhaustMap` so a second trigger is ignored while a page is loading.
:::

:::vue
### Data layer with TanStack Query (Vue)

`@tanstack/vue-query` returns refs, so the template unwraps them automatically.

```ts
import { useInfiniteQuery } from '@tanstack/vue-query';

interface FeedPage {
  items: Post[];
  nextCursor: string | null;
}

export function useFeed() {
  return useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam, signal }) => fetchFeed(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: FeedPage) => lastPage.nextCursor,
    staleTime: 30_000,
  });
}
```

> [!NOTE]
> `null as string | null` is the documented way to type `initialPageParam` in TanStack Query; it widens a literal rather than claiming something unchecked.

### Sentinel with IntersectionObserver (Vue)

```ts
// useInView.ts
import { watchEffect, type Ref } from 'vue';

export function useInView(target: Ref<HTMLElement | null>, onEnter: () => void, rootMargin = '600px 0px') {
  watchEffect((onCleanup) => {
    const node = target.value;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onEnter();
      },
      { rootMargin },
    );
    observer.observe(node);
    onCleanup(() => observer.disconnect()); // runs when the sentinel unmounts or changes
  });
}
```

```vue
<!-- Feed.vue -->
<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import { useFeed } from './useFeed';
import { useInView } from './useInView';

const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status, error } = useFeed();

// Cursor overlaps happen; dedupe by id.
const posts = computed(() => {
  const seen = new Set<string>();
  return (data.value?.pages ?? []).flatMap((page) => page.items).filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
});

function loadMore() {
  if (hasNextPage.value && !isFetchingNextPage.value) void fetchNextPage();
}

const sentinel = useTemplateRef<HTMLElement>('sentinel');
useInView(sentinel, loadMore);
</script>

<template>
  <FeedSkeleton v-if="status === 'pending'" />
  <ErrorState v-else-if="status === 'error'" :error="error" />
  <section v-else aria-label="Feed" :aria-busy="isFetchingNextPage">
    <ol class="feed">
      <li v-for="post in posts" :key="post.id"><PostCard :post="post" /></li>
    </ol>
    <div v-if="hasNextPage" ref="sentinel">
      <button type="button" :disabled="isFetchingNextPage" @click="loadMore">
        {{ isFetchingNextPage ? 'Loading…' : 'Load more' }}
      </button>
    </div>
    <p v-else>You're all caught up.</p>
  </section>
</template>
```

The template ref is `null` until the sentinel renders (it is behind `v-if`), which is why the observer lives in a `watchEffect` that re-runs when the ref is set or cleared. Because `loadMore` reads current refs when it runs, there is no stale-callback problem and no need for the React "latest ref" trick.
:::

### Why cursors, not page numbers

With `?page=3`, a new post inserted at the top shifts everything: the user sees duplicates or misses items. A cursor ("items older than id X / timestamp T") is stable. Dedup by id anyway, because real backends still produce overlaps.

### Things interviewers push on

- **Scroll restoration**: when returning from a post, restore the scroll offset and the loaded pages (keep the query cache alive; store the offset in history state or `sessionStorage` keyed by route). Browsers' native restoration fails if content isn't there yet.
- **New items while reading**: don't insert above the viewport (content jumps); show a "5 new posts" pill that scrolls to top and prepends.
- **Memory**: after hundreds of items, virtualize (with variable heights), or drop far-away pages.
- **Accessibility**: infinite scroll traps keyboard users above a footer they can never reach; provide "Load more", landmarks, and `aria-busy`. Consider `role="feed"` with `aria-setsize`/`aria-posinset` on articles.
- **SEO**: crawlers don't scroll; provide paginated URLs.

### References

- [TanStack Query: Infinite queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)
- [MDN: Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [WAI-ARIA APG: Feed pattern](https://www.w3.org/WAI/ARIA/apg/patterns/feed/)

## Build an accurate countdown or stopwatch that survives background tabs
<!--
id: accurate-countdown-timer
level: senior
tags: timers, setinterval, drift, page visibility, machine coding
minutes: 20
-->

> [!PROMPT]
> Build a countdown (and a stopwatch) that stays accurate when the tab is in the background, the laptop sleeps or the main thread is busy. A naive `setInterval` version drifts by minutes in testing.
>
> **Requirements**
> - Compute remaining time from a deadline using a monotonic clock, not by counting ticks.
> - Start, pause, resume and reset; stop updating at zero and fire `onComplete` once; clean up on unmount.
>
> **Test cases** (fake timers and a controllable clock)
> - A 10 s countdown after 3 s shows 7 s, even if only one tick happened in between.
> - Pause at 4 s remaining, wait 5 s, resume → still 4 s remaining.
> - Jumping the clock forward 30 s (sleep) shows 00:00 and calls `onComplete` exactly once.
> - Unmounting during a run leaves no timers or listeners behind.

> [!TLDR]
> Never count ticks. Store a **deadline** (or start time) and compute remaining time from a monotonic clock each time you render: `remaining = deadline - performance.now()`. Timers drift and are throttled in background tabs (to ≥1s, sometimes minutes), so ticks are only a signal to re-render. Align ticks to second boundaries for a stable display, re-sync on `visibilitychange`, and for server-authoritative deadlines (auctions, seat holds), correct for client/server clock offset.

:::react
### The hook

```tsx
export function useCountdown(durationMs: number, { running = true }: { running?: boolean } = {}) {
  const [deadline] = useState(() => performance.now() + durationMs);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!running) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = performance.now();
      setNow(current);
      const remaining = deadline - current;
      if (remaining <= 0) return;
      // Schedule the next tick at the next whole-second boundary of the remaining time.
      timer = setTimeout(tick, (remaining % 1000) + 5);
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        tick(); // catch up immediately when the tab comes back
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [deadline, running]);

  const remainingMs = Math.max(0, deadline - now);
  return { remainingMs, done: remainingMs === 0 };
}

function Countdown() {
  const { remainingMs, done } = useCountdown(5 * 60_000);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const label = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  return (
    <div>
      <span aria-hidden="true" className="tabular">{label}</span>
      <span className="sr-only" aria-live="polite">{done ? 'Time is up' : ''}</span>
    </div>
  );
}
```
:::

:::angular
### The countdown (Angular)

A function that must run in an injection context (a component field initializer or constructor) plays the role of the hook. State is a signal; cleanup uses `DestroyRef`.

```ts
import { DestroyRef, afterNextRender, computed, inject, signal } from '@angular/core';

export function injectCountdown(durationMs: number) {
  const destroyRef = inject(DestroyRef);
  const deadline = performance.now() + durationMs;
  const now = signal(performance.now());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    const current = performance.now();
    now.set(current);
    const remaining = deadline - current;
    if (remaining <= 0) return;
    // Schedule the next tick at the next whole-second boundary of the remaining time.
    timer = setTimeout(tick, (remaining % 1000) + 5);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      clearTimeout(timer);
      tick(); // catch up immediately when the tab comes back
    }
  };

  afterNextRender(() => {
    tick();
    document.addEventListener('visibilitychange', onVisible);
  });
  destroyRef.onDestroy(() => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });

  const remainingMs = computed(() => Math.max(0, deadline - now()));
  return { remainingMs, done: computed(() => remainingMs() === 0) };
}

@Component({
  selector: 'app-countdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span aria-hidden="true" class="tabular">{{ label() }}</span>
    <span class="sr-only" aria-live="polite">{{ countdown.done() ? 'Time is up' : '' }}</span>
  `,
})
export class CountdownComponent {
  protected readonly countdown = injectCountdown(5 * 60_000);
  protected readonly label = computed(() => {
    const totalSeconds = Math.ceil(this.countdown.remainingMs() / 1000);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  });
}
```

Two Angular-specific points. With zone.js, every `setTimeout` triggers an application-wide change-detection pass, so a ticking timer is a good reason to adopt zoneless change detection (signals schedule only the views that read them), or to run the timers outside the zone. And `afterNextRender` keeps the timers and `document` access out of server-side rendering.
:::

:::vue
### The countdown (Vue)

```ts
// useCountdown.ts
import { computed, ref, watchEffect, type Ref } from 'vue';

export function useCountdown(durationMs: number, running: Ref<boolean> = ref(true)) {
  const deadline = performance.now() + durationMs;
  const now = ref(performance.now());

  watchEffect((onCleanup) => {
    if (!running.value || typeof document === 'undefined') return; // no timers during SSR
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = performance.now();
      now.value = current;
      const remaining = deadline - current;
      if (remaining <= 0) return;
      // Schedule the next tick at the next whole-second boundary of the remaining time.
      timer = setTimeout(tick, (remaining % 1000) + 5);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        tick(); // catch up immediately when the tab comes back
      }
    };
    tick();
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  });

  const remainingMs = computed(() => Math.max(0, deadline - now.value));
  return { remainingMs, done: computed(() => remainingMs.value === 0) };
}
```

```vue
<!-- Countdown.vue -->
<script setup lang="ts">
import { computed } from 'vue';
import { useCountdown } from './useCountdown';

const { remainingMs, done } = useCountdown(5 * 60_000);
const label = computed(() => {
  const totalSeconds = Math.ceil(remainingMs.value / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
});
</script>

<template>
  <div>
    <span aria-hidden="true" class="tabular">{{ label }}</span>
    <span class="sr-only" aria-live="polite">{{ done ? 'Time is up' : '' }}</span>
  </div>
</template>
```

The `watchEffect` cleanup replaces the `useEffect` return value. It re-runs when `running` flips, which is how pause and resume work, and it also runs when the component unmounts, so there is no leaked timer or listener.
:::

### Why each choice

- **`performance.now()`** is monotonic; `Date.now()` jumps when the system clock changes (NTP sync, manual changes, DST doesn't affect epoch ms but user changes do).
- **Deadline-based math** means a throttled or late timer only delays the *display*, never the *value*.
- **Second-boundary scheduling** avoids the display skipping or repeating a second.
- **Live region only at meaningful moments**: announcing every second is unusable for screen-reader users; announce at minute marks or at the end.

### Server-authoritative deadlines

```ts
// On load: estimate offset between server and client clocks.
const t0 = Date.now();
const { serverNow, expiresAt } = await fetchHold(); // epoch ms from the server
const t1 = Date.now();
const offset = serverNow - (t0 + t1) / 2;  // NTP-style midpoint estimate
const expiresAtClient = expiresAt - offset; // compare against Date.now() from here on
```

The server still decides; the client display is a best estimate. When the hold expires server-side, the next request fails and the UI must handle it.

### Stopwatch variant

Store `startedAt` and `accumulated` (for pause/resume): `elapsed = accumulated + (running ? performance.now() - startedAt : 0)`. Use `requestAnimationFrame` for centiseconds (only while visible).

### References

- [MDN: setTimeout reasons for delays](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#reasons_for_delays_longer_than_specified)
- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [Jake Archibald: Animation frame and timer alignment](https://gist.github.com/jakearchibald/cb03f15670817001b1157e62a076fe95)

## Build a file uploader with concurrency, progress, cancel and retry
<!--
id: file-uploader-progress
level: lead
tags: uploads, progress, xhr, concurrency, retry, machine coding
minutes: 35
-->

> [!PROMPT]
> Build a multi-file uploader: drag and drop or pick files, upload at most 3 at a time with per-file progress, and let users cancel or retry individual files.
>
> **Requirements**
> - Per-file state machine: queued, uploading (progress), done, failed, cancelled.
> - A concurrency limit, `XMLHttpRequest` or `fetch` with progress, abort, retry with the same file, and file validation (size, type).
>
> **Test cases**
> - Dropping 8 files starts 3 uploads; when one finishes the next queued file starts, never exceeding 3.
> - Progress events update only that file's bar (0 → 100%).
> - Cancelling an uploading file aborts its request and starts the next queued file; retrying a failed file requeues it.
> - A 12 MB file with a 10 MB limit is rejected before any request is made.

> [!TLDR]
> Model each file as an upload item with its own state machine (queued → uploading(progress) → done | failed | cancelled). Run uploads through a concurrency-limited queue, track progress with `XMLHttpRequest.upload.onprogress` (fetch has no upload progress in most browsers), support cancel via `xhr.abort()`, retry failures with backoff, validate type/size before uploading, and for large files use presigned URLs with chunked/resumable uploads (S3 multipart, tus).

### Item state and store

```ts
type UploadItem =
  | { id: string; file: File; status: 'queued' }
  | { id: string; file: File; status: 'uploading'; loaded: number }
  | { id: string; file: File; status: 'done'; url: string }
  | { id: string; file: File; status: 'failed'; error: string; attempts: number }
  | { id: string; file: File; status: 'cancelled' };
```

### Upload one file with progress and abort

```ts
function uploadWithProgress(
  url: string,
  file: File,
  { onProgress, signal }: { onProgress: (loaded: number) => void; signal: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url); // presigned URL: browser → storage directly, not through your API server
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve(url.split('?')[0] ?? url) : reject(new Error(`HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new TypeError('Network error'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    if (signal.aborted) return reject(new DOMException('Upload cancelled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
```

### Queue with a concurrency limit

```ts
class UploadQueue {
  #queue: string[] = [];
  #active = new Map<string, AbortController>();
  readonly #limit: number;
  readonly #run: (id: string, signal: AbortSignal) => Promise<void>;

  constructor(limit: number, run: (id: string, signal: AbortSignal) => Promise<void>) {
    this.#limit = limit;
    this.#run = run;
  }

  enqueue(id: string) {
    this.#queue.push(id);
    this.#pump();
  }

  cancel(id: string) {
    this.#queue = this.#queue.filter((queued) => queued !== id);
    this.#active.get(id)?.abort();
  }

  #pump() {
    while (this.#active.size < this.#limit && this.#queue.length > 0) {
      const id = this.#queue.shift();
      if (id === undefined) break;
      const controller = new AbortController();
      this.#active.set(id, controller);
      this.#run(id, controller.signal).finally(() => {
        this.#active.delete(id);
        this.#pump();
      });
    }
  }
}
```

The `run` callback updates the item store (`uploading` with `loaded`, then `done`/`failed`/`cancelled`) and wraps the upload in the retry helper (only for network errors and 5xx, never for 4xx like "file too large").

### UX and accessibility

- Drag-and-drop **and** a real `<input type="file" multiple accept="...">` (keyboard and screen readers need the input).
- Validate early (type via `accept` + magic bytes server-side, size, count) and explain why a file was rejected.
- Per-file `<progress value={loaded} max={file.size}>` with a text percentage; an overall progress bar; announce completions politely.
- Warn on page unload while uploads are active (`beforeunload`), and keep uploading during in-app navigation (store lives outside the page component).

### Large files

- **Chunked + resumable**: split with `file.slice()`, upload parts in parallel (S3 multipart with per-part presigned URLs), persist upload id and completed parts to resume after reloads.
- **Integrity**: checksum per part (S3 supports CRC32/SHA-256 headers).
- **Memory**: never `file.arrayBuffer()` whole multi-GB files; stream slices.

### References

- [MDN: XMLHttpRequest upload progress](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload)
- [AWS: Uploading with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [tus resumable upload protocol](https://tus.io/)


## Build a Trello-style kanban board: lists, cards, drag and drop between lists, persisted on reload
<!--
id: kanban-board-dnd
level: lead
tags: machine coding, kanban, drag and drop, state management, persistence, accessibility
minutes: 60
-->

> [!PROMPT]
> Build a Jira/Trello-like board in two hours. Users can create several lists (columns), add and delete cards, and drag cards between lists and within a list. Bonus: the board survives a page reload.
>
> **Requirements**
> - Components and state organised so that new features (rename, labels, due dates) are additions, not rewrites.
> - Dropping a card at a specific position inside a list puts it there.
> - Keyboard users can move a card without dragging.
>
> **Test cases**
> - Adding a card to "Todo" shows it at the bottom of that list; deleting it removes it everywhere.
> - Dragging card B from "Todo" onto the middle of "Doing" inserts it at that index and removes it from "Todo".
> - Dropping a card where it already is changes nothing (and does not trigger a save).
> - Deleting a list also removes its cards from storage.
> - Reloading restores lists, cards and order; corrupted storage falls back to an empty board instead of crashing.

> [!TLDR]
> Normalise the state (`lists` hold ordered `cardIds`, `cards` hold the data) and put every change behind one pure reducer, with `moveCard` as the interesting action. Drag and drop is only an input device: it computes a target list and an index and dispatches `moveCard`. Persist with a debounced, versioned, validated `localStorage` write. Always offer a keyboard path (a "Move to…" select), because native drag and drop is mouse-only.

### What they are evaluating

Component structure, state shape, the drag interaction, and whether the code would survive the next three feature requests. Say the scope out loud first: no auth, no server, one board, `localStorage` as the "database", and a clear order of work (state and reducer, then UI, then drag, then persistence, then keyboard support).

### State shape and the reducer (framework-neutral)

Nested `lists[].cards[]` is easy to render and painful to update: moving a card means rewriting two lists deep inside a tree. Normalise instead, so a move changes exactly two small arrays.

```ts
export interface Card { id: string; title: string }
export interface List { id: string; title: string; cardIds: string[] }
export interface Board {
  listOrder: string[];
  lists: Record<string, List>;
  cards: Record<string, Card>;
}

export type Action =
  | { type: 'addList'; id: string; title: string }
  | { type: 'deleteList'; listId: string }
  | { type: 'addCard'; id: string; listId: string; title: string }
  | { type: 'deleteCard'; listId: string; cardId: string }
  // toIndex is the position in the target list AFTER the card has been removed from its old spot.
  | { type: 'moveCard'; cardId: string; toListId: string; toIndex: number };

export const emptyBoard = (): Board => ({ listOrder: [], lists: {}, cards: {} });

export function reduce(board: Board, action: Action): Board {
  switch (action.type) {
    case 'addList':
      return {
        ...board,
        listOrder: [...board.listOrder, action.id],
        lists: { ...board.lists, [action.id]: { id: action.id, title: action.title, cardIds: [] } },
      };
    case 'deleteList': {
      const list = board.lists[action.listId];
      if (!list) return board;
      const { [action.listId]: _removed, ...lists } = board.lists;
      const cards = { ...board.cards };
      for (const id of list.cardIds) delete cards[id]; // no orphaned cards left in storage
      return { listOrder: board.listOrder.filter((id) => id !== action.listId), lists, cards };
    }
    case 'addCard': {
      const list = board.lists[action.listId];
      if (!list) return board;
      return {
        ...board,
        cards: { ...board.cards, [action.id]: { id: action.id, title: action.title } },
        lists: { ...board.lists, [list.id]: { ...list, cardIds: [...list.cardIds, action.id] } },
      };
    }
    case 'deleteCard': {
      const list = board.lists[action.listId];
      if (!list) return board;
      const { [action.cardId]: _removed, ...cards } = board.cards;
      return { ...board, cards, lists: { ...board.lists, [list.id]: { ...list, cardIds: list.cardIds.filter((id) => id !== action.cardId) } } };
    }
    case 'moveCard':
      return moveCard(board, action.cardId, action.toListId, action.toIndex);
  }
}

function moveCard(board: Board, cardId: string, toListId: string, toIndex: number): Board {
  const from = Object.values(board.lists).find((list) => list.cardIds.includes(cardId));
  const to = board.lists[toListId];
  if (!from || !to) return board;

  const remaining = from.cardIds.filter((id) => id !== cardId);
  const target = from.id === to.id ? remaining : to.cardIds;
  const index = Math.max(0, Math.min(toIndex, target.length));
  const next = [...target.slice(0, index), cardId, ...target.slice(index)];

  if (from.id === to.id && next.every((id, i) => id === from.cardIds[i])) return board; // dropped where it was: same reference, no re-render, no save
  return { ...board, lists: { ...board.lists, [from.id]: { ...from, cardIds: remaining }, [to.id]: { ...to, cardIds: next } } };
}
```

The reducer is pure and framework-free, so it is unit-testable in a dozen lines and reusable if the framework changes. Ids are generated by the caller (`crypto.randomUUID()`), which keeps the reducer deterministic.

### Persistence that survives bad data

```ts
const KEY = 'board:v1'; // version the key: a future shape change can migrate or ignore old data

function isBoard(value: unknown): value is Board {
  if (typeof value !== 'object' || value === null) return false;
  const { listOrder, lists, cards } = value as Partial<Board>;
  if (!Array.isArray(listOrder) || typeof lists !== 'object' || lists === null || typeof cards !== 'object' || cards === null) return false;
  return listOrder.every((id) => id in lists) && Object.values(lists).every((list) => list.cardIds.every((id) => id in cards));
}

export function loadBoard(): Board {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return isBoard(parsed) ? parsed : emptyBoard();
  } catch {
    return emptyBoard(); // corrupted JSON or storage blocked
  }
}

export function saveBoard(board: Board): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(board));
  } catch {
    /* quota exceeded or private mode: the board still works in memory */
  }
}
```

Save from an effect on the state, debounced (a drag produces one `moveCard`, but typing and bulk edits can be chatty). Because `moveCard` returns the same reference for a no-op drop, change detection sees nothing to save.

### Where a drop lands

Native HTML5 drag and drop tells you which list the pointer is over, not which index. Compute the index from the pointer's Y position against the midpoints of the cards that are not being dragged; excluding the dragged card makes the result the "after removal" index the reducer expects.

```ts
export function dropIndex(listElement: HTMLElement, clientY: number): number {
  const cards = [...listElement.querySelectorAll<HTMLElement>('[data-card-id]:not([data-dragging])')];
  const index = cards.findIndex((card) => {
    const box = card.getBoundingClientRect();
    return clientY < box.top + box.height / 2;
  });
  return index === -1 ? cards.length : index;
}
```

:::react
### Implementation (React)

One `useReducer`, one debounced save effect, small components. The list handles `dragover` and `drop` once for all its cards.

```tsx
import { useEffect, useReducer, useState, type FormEvent } from 'react';
import { reduce, loadBoard, saveBoard, type Board, type Action } from './board';
import { dropIndex } from './dropIndex';

function useBoard() {
  const [board, dispatch] = useReducer(reduce, undefined, loadBoard);
  useEffect(() => {
    const timer = setTimeout(() => saveBoard(board), 200);
    return () => clearTimeout(timer); // only the last state in a burst is written
  }, [board]);
  return [board, dispatch] as const;
}

export function BoardView() {
  const [board, dispatch] = useBoard();
  const [dragging, setDragging] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const addList = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    dispatch({ type: 'addList', id: crypto.randomUUID(), title: title.trim() });
    setTitle('');
  };

  return (
    <div className="board">
      {board.listOrder.map((listId) => (
        <ListView key={listId} board={board} listId={listId} dispatch={dispatch} dragging={dragging} setDragging={setDragging} />
      ))}
      <form onSubmit={addList} className="add-list">
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New list name" placeholder="Add a list" />
        <button>Add list</button>
      </form>
    </div>
  );
}

function ListView({ board, listId, dispatch, dragging, setDragging }: {
  board: Board; listId: string; dispatch: (action: Action) => void;
  dragging: string | null; setDragging: (id: string | null) => void;
}) {
  const list = board.lists[listId];
  const [title, setTitle] = useState('');
  if (!list) return null;

  return (
    <section
      className="list"
      aria-label={list.title}
      onDragOver={(event) => {
        if (dragging) event.preventDefault(); // without this the browser refuses the drop
      }}
      onDrop={(event) => {
        const cardId = event.dataTransfer.getData('text/plain');
        if (cardId) dispatch({ type: 'moveCard', cardId, toListId: list.id, toIndex: dropIndex(event.currentTarget, event.clientY) });
        setDragging(null);
      }}
    >
      <header>
        <h2>{list.title}</h2>
        <button onClick={() => dispatch({ type: 'deleteList', listId: list.id })} aria-label={`Delete list ${list.title}`}>×</button>
      </header>
      <ul>
        {list.cardIds.map((cardId) => {
          const card = board.cards[cardId];
          if (!card) return null;
          return (
            <li
              key={card.id}
              data-card-id={card.id}
              data-dragging={dragging === card.id ? '' : undefined}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', card.id);
                event.dataTransfer.effectAllowed = 'move';
                setDragging(card.id);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <span>{card.title}</span>
              {/* Keyboard and screen-reader path: native drag and drop has none. */}
              <select
                aria-label={`Move "${card.title}" to`}
                value={list.id}
                onChange={(event) => dispatch({ type: 'moveCard', cardId: card.id, toListId: event.target.value, toIndex: Infinity })}
              >
                {board.listOrder.map((id) => <option key={id} value={id}>{board.lists[id]?.title}</option>)}
              </select>
              <button onClick={() => dispatch({ type: 'deleteCard', listId: list.id, cardId: card.id })} aria-label={`Delete ${card.title}`}>×</button>
            </li>
          );
        })}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          dispatch({ type: 'addCard', id: crypto.randomUUID(), listId: list.id, title: title.trim() });
          setTitle('');
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={`New card in ${list.title}`} />
        <button>Add card</button>
      </form>
    </section>
  );
}
```

React notes for the interview:

- `ListView` re-renders on every board change; for large boards split cards into a `memo`'d `CardView` keyed by id (the reducer keeps untouched card objects referentially equal, so `memo` works).
- State that only the drag needs (`dragging`) stays out of the persisted board.
- For production, `dnd-kit` gives pointer, touch and keyboard sensors, collision detection and live placeholders; native drag and drop has no touch support on many mobile browsers.
:::

:::angular
### Implementation (Angular)

A signal-based store service wraps the same reducer, and the CDK drag-drop module supplies the interaction (pointer, touch, animation). The drop handler only dispatches `moveCard`; do not use `transferArrayItem`, which would mutate arrays behind the store's back.

```ts
import { Injectable, computed, effect, signal } from '@angular/core';
import { reduce, loadBoard, saveBoard, type Action } from './board';

@Injectable({ providedIn: 'root' })
export class BoardStore {
  private readonly state = signal(loadBoard());

  readonly columns = computed(() => {
    const board = this.state();
    return board.listOrder.flatMap((id) => {
      const list = board.lists[id];
      return list ? [{ ...list, cards: list.cardIds.flatMap((cardId) => board.cards[cardId] ?? []) }] : [];
    });
  });

  constructor() {
    effect((onCleanup) => {
      const board = this.state();
      const timer = setTimeout(() => saveBoard(board), 200);
      onCleanup(() => clearTimeout(timer));
    });
  }

  dispatch(action: Action): void {
    this.state.update((board) => reduce(board, action));
  }
}
```

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { BoardStore } from './board.store';

@Component({
  selector: 'app-board',
  imports: [CdkDropListGroup, CdkDropList, CdkDrag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="board" cdkDropListGroup>
      @for (column of store.columns(); track column.id) {
        <section class="list" [attr.aria-label]="column.title">
          <header>
            <h2>{{ column.title }}</h2>
            <button (click)="store.dispatch({ type: 'deleteList', listId: column.id })" [attr.aria-label]="'Delete list ' + column.title">×</button>
          </header>
          <ul cdkDropList [cdkDropListData]="column.id" (cdkDropListDropped)="onDrop($event)">
            @for (card of column.cards; track card.id) {
              <li cdkDrag [cdkDragData]="card.id">
                <span>{{ card.title }}</span>
                <select [attr.aria-label]="'Move ' + card.title + ' to'" (change)="moveTo(card.id, $any($event.target).value)">
                  @for (target of store.columns(); track target.id) {
                    <option [value]="target.id" [selected]="target.id === column.id">{{ target.title }}</option>
                  }
                </select>
                <button (click)="store.dispatch({ type: 'deleteCard', listId: column.id, cardId: card.id })" [attr.aria-label]="'Delete ' + card.title">×</button>
              </li>
            }
          </ul>
          <form (submit)="addCard($event, column.id, title)">
            <input #title [attr.aria-label]="'New card in ' + column.title" />
            <button>Add card</button>
          </form>
        </section>
      }
      <form (submit)="addList($event, listName)" class="add-list">
        <input #listName aria-label="New list name" placeholder="Add a list" />
        <button>Add list</button>
      </form>
    </div>
  `,
})
export class BoardComponent {
  protected readonly store = inject(BoardStore);

  protected onDrop(event: CdkDragDrop<string, string, string>): void {
    // currentIndex is already the final index in the target list.
    this.store.dispatch({ type: 'moveCard', cardId: event.item.data, toListId: event.container.data, toIndex: event.currentIndex });
  }

  protected moveTo(cardId: string, toListId: string): void {
    this.store.dispatch({ type: 'moveCard', cardId, toListId, toIndex: Number.POSITIVE_INFINITY });
  }

  protected addCard(event: Event, listId: string, input: HTMLInputElement): void {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    this.store.dispatch({ type: 'addCard', id: crypto.randomUUID(), listId, title });
    input.value = '';
  }

  protected addList(event: Event, input: HTMLInputElement): void {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    this.store.dispatch({ type: 'addList', id: crypto.randomUUID(), title });
    input.value = '';
  }
}
```

Angular notes for the interview:

- `cdkDropListGroup` connects every list inside it, so cards can cross lists without wiring `cdkDropListConnectedTo` by hand.
- Because `track card.id` keeps DOM nodes stable and the store replaces arrays immutably, CDK's drop animation and the re-render agree on where the card ends up.
- The CDK also handles touch and auto-scroll; it does not give keyboard dragging, so keep the select (or add your own handlers).
:::

:::vue
### Implementation (Vue)

A composable holds the board in a `shallowRef` (replaced wholesale by the reducer, so deep reactivity would be wasted work) and saves with a debounced watcher. The template uses native drag events and the shared `dropIndex`.

```ts
// useBoard.ts
import { onWatcherCleanup, shallowRef, watch } from 'vue';
import { reduce, loadBoard, saveBoard, type Action } from './board';

export function useBoard() {
  const board = shallowRef(loadBoard());

  const dispatch = (action: Action) => {
    board.value = reduce(board.value, action);
  };

  watch(board, (value) => {
    const timer = setTimeout(() => saveBoard(value), 200);
    onWatcherCleanup(() => clearTimeout(timer)); // Vue 3.5+: only the last change in a burst is written
  });

  return { board, dispatch };
}
```

```vue
<!-- BoardView.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { useBoard } from './useBoard';
import { dropIndex } from './dropIndex';

const { board, dispatch } = useBoard();
const dragging = ref<string | null>(null);
const listName = ref('');
const cardTitles = ref<Record<string, string>>({});

function addList() {
  const title = listName.value.trim();
  if (!title) return;
  dispatch({ type: 'addList', id: crypto.randomUUID(), title });
  listName.value = '';
}

function addCard(listId: string) {
  const title = (cardTitles.value[listId] ?? '').trim();
  if (!title) return;
  dispatch({ type: 'addCard', id: crypto.randomUUID(), listId, title });
  cardTitles.value[listId] = '';
}

function onDrop(event: DragEvent, listId: string) {
  const cardId = event.dataTransfer?.getData('text/plain');
  if (cardId && event.currentTarget instanceof HTMLElement) {
    dispatch({ type: 'moveCard', cardId, toListId: listId, toIndex: dropIndex(event.currentTarget, event.clientY) });
  }
  dragging.value = null;
}

function onDragStart(event: DragEvent, cardId: string) {
  event.dataTransfer?.setData('text/plain', cardId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  dragging.value = cardId;
}
</script>

<template>
  <div class="board">
    <section
      v-for="listId in board.listOrder"
      :key="listId"
      class="list"
      :aria-label="board.lists[listId]?.title"
      @dragover="dragging && $event.preventDefault()"
      @drop="onDrop($event, listId)"
    >
      <header>
        <h2>{{ board.lists[listId]?.title }}</h2>
        <button :aria-label="`Delete list ${board.lists[listId]?.title}`" @click="dispatch({ type: 'deleteList', listId })">×</button>
      </header>
      <ul>
        <li
          v-for="cardId in board.lists[listId]?.cardIds"
          :key="cardId"
          :data-card-id="cardId"
          :data-dragging="dragging === cardId ? '' : undefined"
          draggable="true"
          @dragstart="onDragStart($event, cardId)"
          @dragend="dragging = null"
        >
          <span>{{ board.cards[cardId]?.title }}</span>
          <select
            :aria-label="`Move ${board.cards[cardId]?.title} to`"
            :value="listId"
            @change="dispatch({ type: 'moveCard', cardId, toListId: ($event.target as HTMLSelectElement).value, toIndex: Infinity })"
          >
            <option v-for="id in board.listOrder" :key="id" :value="id">{{ board.lists[id]?.title }}</option>
          </select>
          <button :aria-label="`Delete ${board.cards[cardId]?.title}`" @click="dispatch({ type: 'deleteCard', listId, cardId })">×</button>
        </li>
      </ul>
      <form @submit.prevent="addCard(listId)">
        <input v-model="cardTitles[listId]" :aria-label="`New card in ${board.lists[listId]?.title}`" />
        <button>Add card</button>
      </form>
    </section>
    <form class="add-list" @submit.prevent="addList">
      <input v-model="listName" aria-label="New list name" placeholder="Add a list" />
      <button>Add list</button>
    </form>
  </div>
</template>
```

Vue notes for the interview:

- `shallowRef` plus whole-object replacement matches the reducer's immutable style; with a deep `ref`/`reactive` store you would mutate in place instead and lose the easy "no-op returns the same reference" check.
- `v-for` needs `:key` on both loops, or Vue patches DOM nodes in place and the dragged element's identity is lost.
- For production, `vuedraggable` (SortableJS) or `@vueuse/integrations/useSortable` handles touch and animation.
:::

### Why this design

- **Normalised state + reducer**: moves touch two arrays, deleting a list cleans its cards, and the whole behaviour is testable without a DOM.
- **Drag as an input, not as state**: the library or native events only produce `(cardId, toListId, toIndex)`. Swap native events for a library, add keyboard moves, or add a "move to top" menu without touching the logic.
- **Debounced, validated persistence**: storage is untrusted input; never `JSON.parse` straight into state.

### Edge cases and accessibility

- Dropping on empty space of a list appends (`dropIndex` returns the length); dropping outside any list does nothing.
- Duplicate or stale ids in storage are rejected by `isBoard`; a deleted card cannot be dragged because it is no longer rendered.
- Native drag events do not fire from keyboards or screen readers: provide the "Move to…" select (or arrow-key handlers with live-region announcements such as "Moved to Doing, position 2 of 4").
- Touch: native HTML5 drag and drop is unreliable on mobile; use pointer events or a library for touch support.
- Multiple tabs: listen to the `storage` event to merge or reload, or accept last-write-wins and say so.

### Follow-ups

- **Reorder lists too?** Add a `moveList` action that mirrors `moveCard` on `listOrder`.
- **Persist to a server?** Optimistic update, send the action (`moveCard` with ids and index), roll back on failure; store a float or fractional-index "rank" per card so concurrent moves do not renumber the list.
- **A thousand cards per list?** Virtualise each list; the reducer is unchanged.
- **Undo?** Keep the previous states or the inverse action; the reducer makes both straightforward.
- **Real-time collaboration?** Send actions as operations, resolve with server ordering or a CRDT; the pure reducer is what you replay.

> [!WARNING]
> Common mistakes: nesting cards inside lists so every move rewrites a tree; storing the dragged element or index in persisted state; forgetting `preventDefault()` on `dragover` (the drop never fires); computing the index from the list's `children` including the dragged card (off-by-one when moving down inside the same list); trusting `localStorage` content; and shipping drag and drop with no keyboard alternative.

### References

- [MDN: HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API)
- [Angular CDK: Drag and drop](https://material.angular.io/cdk/drag-drop/overview)
- [W3C APG: Keyboard interface and drag-and-drop alternatives (WCAG 2.5.7 Dragging Movements)](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- [dnd-kit](https://dndkit.com/)


## Build progress bars that each fill in n seconds and run one after another when you click quickly
<!--
id: progress-bar-queue
level: senior
tags: machine coding, progress bar, queue, promises, requestanimationframe, async
minutes: 30
-->

> [!PROMPT]
> A button adds a progress bar that fills from 0 to 100% in `n` seconds. If a bar is already running when the button is clicked again, the new bar waits and starts only after the current one completes.
>
> **Requirements**
> - Bars run strictly one at a time, in click order.
> - Reusable: the timing and the queue are separate from the UI.
> - Accessible progress semantics; no leaked timers when a bar is removed or the component unmounts.
>
> **Test cases**
> - Three clicks with `n = 3`: the first bar finishes at 3 s, the second at 6 s, the third at 9 s; the second and third show "Waiting" until their turn.
> - A click after everything finished starts immediately.
> - Removing a waiting bar skips it without stalling the queue; unmounting mid-run stops the animation.
> - A tab hidden for 10 s resumes with the bar at the right place, not 10 s behind.

> [!TLDR]
> Make two small, framework-free pieces: `animateProgress(duration, onProgress, signal)`, a promise that computes progress from elapsed time with `requestAnimationFrame` (not from frame counts), and `createSerialQueue()`, which chains tasks on a promise tail so the next one starts only when the previous settles, even if it fails or is cancelled. Each bar simply enqueues "animate me" when it mounts and aborts on unmount.

### Clarify first

Ask what a click during a run should do: queue (this question), ignore, restart, or run in parallel. The answer changes the data structure. Also ask whether bars can be cancelled and whether progress must be exact (a fake bar is a timer; a real one reflects work done).

### The two reusable pieces (framework-neutral)

```ts
/** Resolves when `durationMs` has elapsed; rejects with AbortError if cancelled. */
export function animateProgress(durationMs: number, onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      // Derived from the clock, so a throttled background tab catches up instead of falling behind.
      const ratio = Math.min(Math.max((now - start) / durationMs, 0), 1);
      onProgress(ratio);
      if (ratio < 1) frame = requestAnimationFrame(tick);
      else resolve();
    };
    frame = requestAnimationFrame(tick);

    signal?.addEventListener(
      'abort',
      () => {
        cancelAnimationFrame(frame);
        reject(new DOMException('Cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** Runs tasks one at a time, in the order they were enqueued. */
export function createSerialQueue() {
  let tail: Promise<void> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined, // a failed or cancelled task must not block everything behind it
    );
    return result;
  };
}

export type Enqueue = ReturnType<typeof createSerialQueue>;

export const ignoreAbort = (error: unknown): void => {
  if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
};
```

`tail.then(task)` is the whole queue: promise reactions run in order, so each task begins only after the previous one settled. The same idea with an explicit array (`queue.push`, run the head, shift on completion) is fine too; the promise chain just gets ordering and error propagation for free.

:::react
### Implementation (React)

Each bar owns its animation state, so a frame update re-renders one bar, not the page. Mount enqueues the work; cleanup aborts it, which also lets the queue skip bars that were removed while waiting.

```tsx
import { useEffect, useRef, useState } from 'react';
import { animateProgress, createSerialQueue, ignoreAbort, type Enqueue } from './progress';

type Status = 'waiting' | 'running' | 'done';

function ProgressBar({ seconds, enqueue, label }: { seconds: number; enqueue: Enqueue; label: string }) {
  const [state, setState] = useState<{ status: Status; ratio: number }>({ status: 'waiting', ratio: 0 });

  useEffect(() => {
    const controller = new AbortController();
    enqueue(async () => {
      controller.signal.throwIfAborted(); // removed while waiting: skip without animating
      setState({ status: 'running', ratio: 0 });
      await animateProgress(seconds * 1000, (ratio) => setState({ status: 'running', ratio }), controller.signal);
      setState({ status: 'done', ratio: 1 });
    }).catch(ignoreAbort);
    return () => controller.abort(); // also covers StrictMode's mount, unmount, mount in development
  }, [seconds, enqueue]);

  const percent = Math.round(state.ratio * 100);
  return (
    <div className="bar-row">
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="bar">
        <div className="fill" style={{ transform: `scaleX(${state.ratio})` }} />
      </div>
      <span>{state.status === 'waiting' ? 'Waiting' : state.status === 'done' ? 'Done' : `${percent}%`}</span>
    </div>
  );
}

export function ProgressQueue({ seconds = 3 }: { seconds?: number }) {
  const [enqueue] = useState(createSerialQueue); // one queue for the lifetime of the component
  const [ids, setIds] = useState<number[]>([]);
  const nextId = useRef(1);

  const start = () => {
    const id = nextId.current++;
    setIds((list) => [...list, id]);
  };

  return (
    <>
      <button onClick={start}>Start progress ({seconds}s)</button>
      {ids.map((id) => (
        <ProgressBar key={id} seconds={seconds} enqueue={enqueue} label={`Progress ${id}`} />
      ))}
    </>
  );
}
```

React notes for the interview:

- `scaleX` on a full-width element animates on the compositor; changing `width` forces layout every frame.
- Never put the queue in a module-level global: two component instances (or two tests) would share it. `useState(createSerialQueue)` creates it once per mount.
- If the per-frame `setState` bothers you, write `ratio` to a CSS variable through a ref and keep React state to `waiting | running | done`.
:::

:::angular
### Implementation (Angular)

The bar component starts its work in `ngOnInit` and cancels on destroy through `DestroyRef`. Signals hold the status and ratio; with `OnPush` only the bar that changed is checked.

```ts
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { animateProgress, ignoreAbort, type Enqueue } from './progress';

type Status = 'waiting' | 'running' | 'done';

@Component({
  selector: 'app-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" role="progressbar" [attr.aria-label]="label()" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="percent()">
      <div class="fill" [style.transform]="'scaleX(' + ratio() + ')'"></div>
    </div>
    <span>{{ status() === 'waiting' ? 'Waiting' : status() === 'done' ? 'Done' : percent() + '%' }}</span>
  `,
})
export class ProgressBarComponent implements OnInit {
  readonly seconds = input.required<number>();
  readonly enqueue = input.required<Enqueue>();
  readonly label = input('Progress');

  protected readonly status = signal<Status>('waiting');
  protected readonly ratio = signal(0);
  protected readonly percent = computed(() => Math.round(this.ratio() * 100));
  private readonly controller = new AbortController();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.controller.abort());
  }

  ngOnInit(): void {
    this.enqueue()(async () => {
      this.controller.signal.throwIfAborted(); // destroyed while waiting: skip
      this.status.set('running');
      await animateProgress(this.seconds() * 1000, (ratio) => this.ratio.set(ratio), this.controller.signal);
      this.status.set('done');
    }).catch(ignoreAbort);
  }
}
```

```ts
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { createSerialQueue } from './progress';
import { ProgressBarComponent } from './progress-bar.component';

@Component({
  selector: 'app-progress-queue',
  imports: [ProgressBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button (click)="start()">Start progress ({{ seconds() }}s)</button>
    @for (id of ids(); track id) {
      <app-progress-bar [seconds]="seconds()" [enqueue]="enqueue" [label]="'Progress ' + id" />
    }
  `,
})
export class ProgressQueueComponent {
  readonly seconds = signal(3);
  protected readonly enqueue = createSerialQueue();
  protected readonly ids = signal<number[]>([]);
  private nextId = 1;

  protected start(): void {
    this.ids.update((list) => [...list, this.nextId++]);
  }
}
```

Angular notes for the interview:

- RxJS is an alternative: `concatMap` over a click stream is a serial queue (`clicks$.pipe(concatMap(() => progress$(seconds)))`) with `takeUntilDestroyed` for cleanup. `exhaustMap` would be the "ignore clicks while running" variant and `switchMap` the "restart" variant; naming that mapping is a strong answer.
- With zone.js, each `requestAnimationFrame` callback triggers a change detection pass; signals and `OnPush` keep that pass cheap, and zoneless Angular avoids it entirely.
:::

:::vue
### Implementation (Vue)

Each bar is a component with its own refs; mount enqueues, unmount aborts.

```vue
<!-- ProgressBar.vue -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { animateProgress, ignoreAbort, type Enqueue } from './progress';

const props = defineProps<{ seconds: number; enqueue: Enqueue; label: string }>();

const status = ref<'waiting' | 'running' | 'done'>('waiting');
const ratio = ref(0);
const percent = computed(() => Math.round(ratio.value * 100));
const controller = new AbortController();

onMounted(() => {
  props
    .enqueue(async () => {
      controller.signal.throwIfAborted(); // unmounted while waiting: skip
      status.value = 'running';
      await animateProgress(props.seconds * 1000, (value) => (ratio.value = value), controller.signal);
      status.value = 'done';
    })
    .catch(ignoreAbort);
});
onUnmounted(() => controller.abort());
</script>

<template>
  <div class="bar-row">
    <div class="bar" role="progressbar" :aria-label="label" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent">
      <div class="fill" :style="{ transform: `scaleX(${ratio})` }" />
    </div>
    <span>{{ status === 'waiting' ? 'Waiting' : status === 'done' ? 'Done' : `${percent}%` }}</span>
  </div>
</template>
```

```vue
<!-- ProgressQueue.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { createSerialQueue } from './progress';
import ProgressBar from './ProgressBar.vue';

const seconds = 3;
const enqueue = createSerialQueue(); // one queue per component instance
const ids = ref<number[]>([]);
let nextId = 1;

function start() {
  ids.value.push(nextId++);
}
</script>

<template>
  <button @click="start">Start progress ({{ seconds }}s)</button>
  <ProgressBar v-for="id in ids" :key="id" :seconds="seconds" :enqueue="enqueue" :label="`Progress ${id}`" />
</template>
```

Vue notes for the interview:

- `<script setup>` runs once per instance, so `createSerialQueue()` there is per instance, not global.
- `:key` is what makes "remove a waiting bar" work: the removed component unmounts, its controller aborts, and the queue skips it.
- A CSS-only version (`transition: transform Ns linear` plus a `transitionend` listener) is legitimate for purely visual bars; the rAF version is better when you need the exact ratio for text, analytics or syncing with other state.
:::

### Why this design

- **Time-based progress** survives dropped frames and throttled tabs; incrementing by a fixed step per frame does not.
- **Promise-tail queue** makes the ordering rule one line and keeps the UI free of "is something running?" flags.
- **Abort support** turns "remove the bar" into a first-class event instead of a leaked `requestAnimationFrame` loop.

### Edge cases and testing

- A task that throws still lets the queue continue (see `tail`); the caller still sees the rejection through `result`.
- `n = 0` or very small durations: `animateProgress` completes in one frame; guard against negative or `NaN` input at the boundary.
- Reduced motion: the bar is informational, but avoid easing and do not add decorative animation.
- Tests: inject the frame function and the clock into `animateProgress` (defaulting to `requestAnimationFrame` and `performance.now`) so a test can advance time deterministically instead of waiting real seconds; assert the order of completion for three queued bars.

### Follow-ups

- **Run up to N at a time?** Replace the serial queue with a concurrency-limited pool (see the task runner question in the async round).
- **Pause and resume?** Keep elapsed time in the task and restart the frame loop from it; an `AbortSignal` alone cannot resume.
- **Cancel the running bar and start the next?** Expose the controller per item and abort it; the queue treats an abort like any settled task.
- **Why not `setInterval`?** It drifts, is throttled in background tabs, and is not aligned with paint; `requestAnimationFrame` is.

> [!WARNING]
> Common mistakes: a global `isRunning` boolean with a click counter (breaks on removal and errors); updating progress by `+= 1` per interval tick; chaining with `await` inside a click handler so clicks block each other; never cancelling on unmount; and a queue that stops forever after one rejection.

### References

- [MDN: requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [MDN: ARIA progressbar role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/progressbar_role)
- [MDN: AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
