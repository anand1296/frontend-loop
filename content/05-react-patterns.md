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

> [!TLDR]
> Compound components split one widget into cooperating parts (`<Tabs>`, `<Tabs.List>`, `<Tabs.Trigger>`, `<Tabs.Panel>`) that share state through a private context. Consumers get control over **structure and markup** (put a badge in a trigger, wrap the list in a toolbar) without a prop for every variation. Costs: implicit coupling through context, harder static validation, and more API surface. Use it for widgets with flexible layout; use a plain props API for simple, rigid components.

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

> [!TLDR]
> A headless component owns **behavior and accessibility** (state, keyboard handling, ARIA wiring, focus management) and gives rendering entirely to the consumer, usually through a hook that returns state plus **prop getters** (`getToggleProps()`, `getItemProps(item)`). It lets a design system support many visual styles with one correct implementation. The trade-off is more work for consumers, so most teams ship a headless layer **and** a styled layer built on it.

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

> [!TLDR]
> Reusable inputs should work both ways: **uncontrolled** (`defaultValue`, component owns state) for simple use, and **controlled** (`value` + `onChange`, parent owns state) when the parent needs to read, validate or reset it. A `useControllableState` hook picks the mode from whether `value` is `undefined`, always calls `onChange`, only updates internal state when uncontrolled, and warns when a component switches modes during its lifetime.

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

> [!TLDR]
> react-hook-form keeps fields **uncontrolled** and stores values in refs, so typing doesn't re-render the whole form. A zod schema (via `zodResolver`) gives one source of truth for types and validation, shared with the server. Handle the three error sources separately: **field validation** (schema), **async checks** (debounced, cancellable), and **server errors** (mapped back with `setError`). Make it accessible: labels, `aria-invalid`, `aria-describedby` for messages, focus the first error on submit.

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

> [!TLDR]
> Place boundaries along **independent units of UI**: the app shell (last-resort crash screen), each route (one broken page shouldn't break navigation), and each self-contained widget or panel (one failing chart shouldn't blank the dashboard). Pair each error boundary with a recovery action (retry, reset on navigation) and reporting. Suspense boundaries follow the same regions, chosen so the page reveals in a deliberate order instead of a cascade of spinners.

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

> [!TLDR]
> Bad component APIs grow by accretion: every new requirement adds a boolean prop until nobody knows which combinations work. In a review, look for boolean flags that encode variants (replace with a `variant` union), props that pass content (replace with `children`/slots), props that configure internal structure (replace with composition), and impossible combinations (replace with discriminated unions). Good APIs are small, composable, consistent across the system, and hard to misuse.

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
