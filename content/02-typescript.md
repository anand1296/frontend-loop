---
id: typescript
title: TypeScript for Real Codebases
description: Model data so the compiler does the work: narrowing without assertions, inference-friendly generics, type-level programming, React typing and runtime boundaries.
---

## Model your data so you never need `as`: unions, narrowing, type guards and `satisfies`
<!--
id: narrowing-without-assertions
level: senior
tags: narrowing, type guards, satisfies, unknown, assertions
minutes: 15
-->

> [!TLDR]
> `as` tells the compiler "trust me" and switches checking off at that point. Most assertions disappear when you (1) model states as **discriminated unions**, (2) treat external data as `unknown` and **narrow** it with checks or a schema, (3) write **type predicates** for reusable checks, and (4) use **`satisfies`** to validate a literal against a type without widening it. Keep the few real assertions in small, tested adapter modules.

### Why assertions are a smell

```ts
const user = JSON.parse(raw) as User; // compiles; crashes later when `raw` is `{"error":"..."}`
const el = document.getElementById('save') as HTMLButtonElement; // wrong if markup changes
```

Both move a runtime question ("is this really a `User`?") out of sight. The bug surfaces far from the cause.

### Tool 1: narrowing with real checks

```ts
const el = document.getElementById('save');
if (el instanceof HTMLButtonElement) {
  el.disabled = true; // narrowed, and the check runs at runtime too
}

function formatValue(value: string | number | Date | null): string {
  if (value === null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toFixed(2);
  return value.toISOString(); // only Date is left
}
```

Built-in narrowing: `typeof`, `instanceof`, `in`, equality, truthiness, `Array.isArray`, and control flow (early returns, `switch`).

### Tool 2: type predicates for reusable checks

```ts
interface User {
  id: string;
  name: string;
  email: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUser(value: unknown): value is User {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.email === null || typeof value.email === 'string')
  );
}

const data: unknown = await response.json();
if (!isUser(data)) throw new Error('Unexpected /me response');
data.name; // User
```

TypeScript 5.5+ also **infers** predicates for simple arrow functions:

```ts
const ids = [1, null, 3].filter((x) => x !== null); // number[] (no predicate needed)
```

Assertion functions (`asserts value is User`) narrow for the rest of the scope by throwing on failure, useful in tests and at boundaries.

> [!WARNING]
> A type predicate is itself a trusted claim. `function isUser(v): v is User { return true }` compiles. Keep predicates tiny and test them, or generate them from a schema (zod/valibot) so the runtime check and the type can't drift.

### Tool 3: `satisfies` instead of annotations or `as`

```ts
type Route = { path: string; auth: boolean };

const routes = {
  home: { path: '/', auth: false },
  settings: { path: '/settings', auth: true },
} satisfies Record<string, Route>;

routes.settings.path; // checked against Route...
type RouteName = keyof typeof routes; // ...but keys stay literal: "home" | "settings"
```

An annotation (`const routes: Record<string, Route>`) would widen keys to `string`; `as` would skip checking entirely.

### Tool 4: discriminated unions instead of optional soup

```ts
// Before: every field optional, every consumer guesses.
interface RequestStateLoose<T> {
  loading?: boolean;
  data?: T;
  error?: Error;
}

// After: impossible states are unrepresentable.
type RequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

function render<T>(state: RequestState<T>) {
  switch (state.status) {
    case 'success':
      return state.data; // available only here
    case 'error':
      return state.error.message;
    default:
      return null;
  }
}
```

### Other `as`-free techniques

- `as const` for literal tuples and config (this one is fine: it narrows instead of lying).
- Generic helpers that preserve types: `Object.entries` loses key types; write `typedEntries` once in a utility module rather than asserting at every call site.
- `useRef<HTMLInputElement>(null)` and DOM APIs like `querySelector<HTMLInputElement>('input')` (still a claim, but scoped and conventional).
- Non-null `!` is an assertion too; prefer an explicit check with an error message.

### Follow-ups

- **"When is `as` acceptable?"** In adapters where TypeScript can't express a proven invariant (a `WeakMap` cache keyed by object, test fixtures with partial data), or when migrating JS. Localize it, comment why, and cover it with a test.
- **"`unknown` vs `any`?"** `unknown` forces narrowing before use; `any` disables checking and spreads silently. Turn on `noImplicitAny`, `useUnknownInCatchVariables`, and lint `no-explicit-any` / `no-unsafe-*`.

### References

- [TypeScript handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [TS 4.9: the satisfies operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)
- [TS 5.5: inferred type predicates](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html#inferred-type-predicates)

## Write generic functions whose types infer correctly: constraints, `const` type parameters and `NoInfer`
<!--
id: generics-inference
level: senior
tags: generics, inference, const type parameters, noinfer
minutes: 15
-->

> [!TLDR]
> Good generics are **invisible at the call site**: callers never write type arguments, and the result type is exactly what they'd expect. Get there by putting type parameters where TypeScript infers from values, constraining them (`extends`) only as much as needed, relating parameters to each other (`K extends keyof T`), using `const` type parameters to keep literals, and `NoInfer` to stop a parameter from being an inference site.

### Relate parameters instead of widening them

```ts
// Weak: returns unknown, caller must assert.
function pluckWeak(items: object[], key: string): unknown[] {
  return items.map((item) => Reflect.get(item, key));
}

// Strong: key must exist, result type follows.
function pluck<T, K extends keyof T>(items: readonly T[], key: K): T[K][] {
  return items.map((item) => item[key]);
}

const users = [{ id: 1, name: 'Ada' }];
const names = pluck(users, 'name'); // string[]
pluck(users, 'email');              // error: '"email"' is not assignable to '"id" | "name"'
```

### Preserve literal types with `const` type parameters (TS 5.0+)

```ts
function defineSteps<const T extends readonly string[]>(steps: T): T {
  return steps;
}
const steps = defineSteps(['account', 'billing', 'review']);
type Step = (typeof steps)[number]; // "account" | "billing" | "review"
```

Without `const`, `T` infers as `string[]` and the union is lost (unless callers remember `as const`).

### Stop bad inference with `NoInfer` (TS 5.4+)

```ts
function createSelect<T extends string>(options: T[], defaultValue: NoInfer<T>) {
  return { options, value: defaultValue };
}

createSelect(['sm', 'md', 'lg'], 'md');  // ok
createSelect(['sm', 'md', 'lg'], 'xl');  // error, instead of silently widening T to include "xl"
```

### Overloads vs generics vs unions

```ts
// Return type depends on an input flag: an overload set reads better than a conditional type.
function parseDate(input: string, options: { strict: true }): Date;
function parseDate(input: string, options?: { strict?: false }): Date | null;
function parseDate(input: string, options?: { strict?: boolean }): Date | null {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    if (options?.strict) throw new RangeError(`Invalid date: ${input}`);
    return null;
  }
  return date;
}
```

Rules of thumb:

- Use a generic when the **output type depends on the input type**. If a parameter appears once, it probably shouldn't be generic (`function log<T>(x: T): void` is just `x: unknown`).
- Constrain with the **minimum** structure you use (`T extends { id: string }`), not a concrete model.
- Avoid generics that callers must specify explicitly; that usually means inference has nothing to infer from.

### A realistic example: a typed fetcher

```ts
interface Endpoints {
  '/users': { response: User[]; query: { page?: number } };
  '/users/:id': { response: User; query: Record<string, never> };
}

async function api<P extends keyof Endpoints>(
  path: P,
  query: Endpoints[P]['query'],
  init?: RequestInit,
): Promise<Endpoints[P]['response']> {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

const list = await api('/users', { page: 2 }); // User[]
```

> [!WARNING]
> `response.json()` returns `Promise<any>`, which is why the return type above "just works": it's an unchecked claim. In production, validate at this boundary (see the runtime-validation question) or generate the client from an OpenAPI schema.

### Follow-ups

- **"Why does `Object.keys` return `string[]`?"** Objects can have more keys at runtime than their type lists (structural typing), so `(keyof T)[]` would be unsound.
- **"What are `in`/`out` variance annotations?"** Optional hints on type parameters for performance and clarity in complex generic types; rarely needed in app code.

### References

- [TypeScript handbook: Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- [TS 5.0: const type parameters](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#const-type-parameters)
- [TS 5.4: NoInfer](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-4.html#the-noinfer-utility-type)

## Conditional types, `infer` and mapped types: build `DeepReadonly`, `PathValue` and a typed event map
<!--
id: conditional-mapped-types
level: lead
tags: conditional types, infer, mapped types, template literal types
minutes: 20
-->

> [!TLDR]
> Conditional types (`T extends U ? X : Y`) are `if` statements at the type level; they **distribute** over unions when `T` is a naked type parameter. `infer` extracts a piece of a matched type. Mapped types (`{ [K in keyof T]: ... }`) transform each property and can remap keys with `as`. Template literal types build string types. Together they let library code compute precise types; in app code, use them sparingly and test them.

### Distribution, and how to turn it off

```ts
type ToArray<T> = T extends unknown ? T[] : never;
type A = ToArray<string | number>; // string[] | number[]   (distributed)

type ToArrayNoDist<T> = [T] extends [unknown] ? T[] : never;
type B = ToArrayNoDist<string | number>; // (string | number)[]
```

### `infer`

```ts
type Awaited2<T> = T extends PromiseLike<infer U> ? Awaited2<U> : T;
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;
type PropsOf<C> = C extends (props: infer P) => unknown ? P : never;
```

### `DeepReadonly`

```ts
type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyMap<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends ReadonlySet<infer V>
      ? ReadonlySet<DeepReadonly<V>>
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;
```

Functions are left alone, collections are handled explicitly, and the mapped type recurses. Arrays work because mapped types over array types produce readonly arrays.

### Key remapping and template literals: a typed event map

```ts
interface Model {
  name: string;
  age: number;
}

type ChangeHandlers<T> = {
  [K in keyof T & string as `on${Capitalize<K>}Change`]: (value: T[K]) => void;
};

type ModelHandlers = ChangeHandlers<Model>;
// { onNameChange: (value: string) => void; onAgeChange: (value: number) => void }
```

### `Path` and `PathValue` for typed form field names

```ts
type Primitive = string | number | boolean | bigint | symbol | null | undefined | Date;

type Path<T> = T extends Primitive
  ? never
  : {
      [K in keyof T & string]: T[K] extends Primitive ? K : K | `${K}.${Path<T[K]>}`;
    }[keyof T & string];

type PathValue<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? PathValue<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

interface Form {
  user: { name: string; address: { city: string } };
  terms: boolean;
}

type FormPath = Path<Form>; // "user" | "user.name" | "user.address" | "user.address.city" | "terms"
type City = PathValue<Form, 'user.address.city'>; // string

declare function register<P extends Path<Form>>(name: P): { value: PathValue<Form, P> };
```

This is essentially how `react-hook-form` types `register('user.address.city')`.

### Testing type-level code

```ts
type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

type _cases = [
  Expect<Equal<PathValue<Form, 'terms'>, boolean>>,
  Expect<Equal<ElementOf<string[]>, string>>,
];
```

Or use `expectTypeOf` from Vitest / `tsd`. Type utilities without tests rot quietly.

> [!PRINCIPAL]
> Type-level cleverness has a cost: slower compiles, unreadable errors, and code only one person can maintain. In a large codebase, keep heavy types inside a few library boundaries (forms, API client, router), expose simple types to product code, and watch `tsc --extendedDiagnostics` / `--generateTrace` for instantiation hot spots.

### Follow-ups

- **"Why does recursion depth matter?"** TS caps instantiation depth (~50 for some recursions, with tail-recursion optimization for conditional types up to 1000). Deep paths over huge models can hit "Type instantiation is excessively deep".
- **"How do you debug a type?"** Hover in the editor, break it into intermediate aliases, and use a `Prettify<T> = { [K in keyof T]: T[K] } & {}` helper to flatten intersections in tooltips.

### References

- [TypeScript handbook: Conditional types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [TypeScript handbook: Mapped types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)
- [TypeScript handbook: Template literal types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html)
- [type-challenges](https://github.com/type-challenges/type-challenges)

## Type a UI state machine with discriminated unions and exhaustive checks
<!--
id: exhaustive-state-machines
level: senior
tags: discriminated unions, never, reducers, state machines
minutes: 12
-->

> [!TLDR]
> Represent each state as its own object type with a literal `status` tag and only the fields valid in that state. Model events the same way. A reducer that `switch`es on both, ends with an `assertNever(x: never)` default, and returns the same state for invalid transitions gives you a state machine where impossible states can't be built and adding a new state is a compile error everywhere it isn't handled.

### Example: an upload widget

```ts
type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; file: File; progress: number; controller: AbortController }
  | { status: 'done'; file: File; url: string }
  | { status: 'failed'; file: File; error: string; retries: number };

type UploadEvent =
  | { type: 'START'; file: File; controller: AbortController }
  | { type: 'PROGRESS'; progress: number }
  | { type: 'SUCCESS'; url: string }
  | { type: 'FAILURE'; error: string }
  | { type: 'RESET' };

function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}

function uploadReducer(state: UploadState, event: UploadEvent): UploadState {
  switch (event.type) {
    case 'START':
      if (state.status === 'uploading') return state; // ignore double start
      return { status: 'uploading', file: event.file, progress: 0, controller: event.controller };
    case 'PROGRESS':
      if (state.status !== 'uploading') return state; // late event after cancel: ignore
      return { ...state, progress: event.progress };
    case 'SUCCESS':
      if (state.status !== 'uploading') return state;
      return { status: 'done', file: state.file, url: event.url };
    case 'FAILURE':
      if (state.status !== 'uploading') return state;
      return { status: 'failed', file: state.file, error: event.error, retries: 0 };
    case 'RESET':
      return { status: 'idle' };
    default:
      return assertNever(event);
  }
}
```

Why this is good:

- `state.url` only exists in `done`; the UI can't render a link while uploading.
- Late `PROGRESS` events after a cancel are **ignored by construction**, which is the classic race in upload UIs.
- Add `{ status: 'paused' }` and every `switch (state.status)` with `assertNever` fails to compile until handled.

### Rendering by state

```tsx
function UploadView({ state, onCancel }: { state: UploadState; onCancel: () => void }) {
  switch (state.status) {
    case 'idle':
      return <p>Choose a file to upload.</p>;
    case 'uploading':
      return (
        <div>
          <progress value={state.progress} max={1} aria-label={`Uploading ${state.file.name}`} />
          <button onClick={onCancel}>Cancel</button>
        </div>
      );
    case 'done':
      return <a href={state.url}>{state.file.name}</a>;
    case 'failed':
      return <p role="alert">Upload failed: {state.error}</p>;
    default:
      return assertNever(state);
  }
}
```

> [!NOTE]
> Storing an `AbortController` (non-serializable) in reducer state is fine for local `useReducer`. In Redux it violates serializability; keep controllers in a ref or a side map keyed by upload id.

### When to reach for XState

A hand-written reducer is enough for a handful of states. Consider a statechart library when you have **parallel** states (upload + validation), **hierarchical** states, timers/delayed transitions, or you want visualizations to share with product and QA.

### Follow-ups

- **"`switch` vs lookup object?"** A `Record<State['status'], ...>` map gets exhaustiveness for free via the key type; `switch` reads better when branches need narrowing.
- **"How do you test it?"** Pure reducer: table-driven tests of `(state, event) → state`, including invalid transitions.

### References

- [TypeScript handbook: Discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
- [XState docs](https://stately.ai/docs)

## Type React components well: polymorphic `as` props, generic components and forwarding props
<!--
id: typing-react-components
level: lead
tags: react, typescript, polymorphic components, generic components, props
minutes: 18
-->

> [!TLDR]
> Use `ComponentProps<'button'>` / `ComponentPropsWithoutRef` to extend native elements, `Omit` what you override, and pass the rest through. Make list-like components **generic** so `onSelect` knows the item type. Polymorphic `as` components are useful for design systems but expensive to type and to check; many teams prefer an `asChild`/slot pattern instead. In React 19, `ref` is a normal prop, so `forwardRef` is no longer required.

### Extending native elements

```tsx
import type { ComponentProps } from 'react';

type ButtonProps = Omit<ComponentProps<'button'>, 'type'> & {
  variant?: 'primary' | 'secondary';
  type?: 'button' | 'submit';
};

export function Button({ variant = 'secondary', type = 'button', className, ...rest }: ButtonProps) {
  return <button type={type} className={cx('btn', `btn-${variant}`, className)} {...rest} />;
}
```

Every native attribute (`aria-*`, `disabled`, `onClick`, `ref` in React 19) works, and defaulting `type="button"` prevents accidental form submits.

### Generic components

```tsx
interface ListboxProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
}

export function Listbox<T>({ items, getKey, renderItem, onSelect }: ListboxProps<T>) {
  return (
    <ul role="listbox">
      {items.map((item) => (
        <li key={getKey(item)} role="option" aria-selected={false} onClick={() => onSelect(item)}>
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}

<Listbox items={users} getKey={(u) => u.id} renderItem={(u) => u.name} onSelect={(u) => openProfile(u.id)} />;
// `u` is inferred as User everywhere
```

### Polymorphic `as`

```tsx
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

type TextProps<E extends ElementType> = {
  as?: E;
  tone?: 'default' | 'muted';
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<E>, 'as' | 'tone' | 'children'>;

export function Text<E extends ElementType = 'span'>({ as, tone = 'default', ...rest }: TextProps<E>) {
  const Component: ElementType = as ?? 'span';
  return <Component data-tone={tone} {...rest} />;
}

<Text as="label" htmlFor="email">Email</Text>; // htmlFor is allowed because E = "label"
<Text as="a" href="/docs">Docs</Text>;
```

Costs to mention: slow type checking at scale, confusing errors, and it's easy to render invalid semantics (`<Text as="button">` without button behavior).

### The `asChild` alternative (Radix-style)

```tsx
<Tooltip.Trigger asChild>
  <Link to="/settings">Settings</Link>
</Tooltip.Trigger>
```

The component merges its props and ref into its single child via `cloneElement`/a `Slot`. Types stay simple, and the consumer controls the element.

### Children and render props

- `children: ReactNode` for content; `children: (state: S) => ReactNode` for render props.
- Avoid `React.FC`: it used to add implicit `children` and doesn't support generics well. Plain function signatures are clearer.
- Event handler types: `React.ChangeEvent<HTMLInputElement>`, or let inference do it by writing handlers inline or typing the prop (`onChange: ComponentProps<'input'>['onChange']`).

### Follow-ups

- **"How do you type a component that accepts either `href` or `onClick`?"** A union of prop shapes with a discriminator (`{ href: string } | { onClick: () => void; href?: never }`), rendering `<a>` or `<button>` accordingly. This keeps semantics correct.
- **"Typing context without `undefined` checks everywhere?"** Create the context as `createContext<Value | null>(null)` and a `useX()` hook that throws a clear error outside the provider; consumers get `Value`.

### References

- [React TypeScript Cheatsheet](https://react-typescript-cheatsheet.netlify.app/)
- [React 19: ref as a prop](https://react.dev/blog/2024/12/05/react-19#ref-as-a-prop)
- [Radix: Composition (asChild)](https://www.radix-ui.com/primitives/docs/guides/composition)

## Types vanish at runtime. Where do you validate data, and how do you share types with the backend?
<!--
id: runtime-validation-boundaries
level: lead
tags: zod, validation, openapi, api contracts, boundaries
minutes: 12
-->

> [!TLDR]
> Validate at **trust boundaries**: API responses, `localStorage`, URL params, `postMessage`, feature flags, form input and AI model output. Inside the app, trust the types. Use one source of truth so the type and the runtime check can't drift: either a schema library (zod/valibot) with `z.infer`, or code generated from the backend contract (OpenAPI, GraphQL, protobuf). Decide per boundary whether invalid data should throw, degrade gracefully, or be reported.

### Schema as the source of truth

```ts
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: z.enum(['admin', 'member']),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

export async function getUser(id: string, signal?: AbortSignal): Promise<User> {
  const response = await fetch(`/api/users/${id}`, { signal });
  if (!response.ok) throw new HttpError(response.status);
  const result = UserSchema.safeParse(await response.json());
  if (!result.success) {
    reportContractViolation('/api/users/:id', result.error); // to Sentry/Datadog, with the path
    throw new ContractError('User payload did not match schema');
  }
  return result.data;
}
```

### Which boundaries, which policy

| Boundary | Policy |
| --- | --- |
| Critical API data (payments, auth) | Validate strictly, fail loudly |
| Large lists/feeds | Validate items, drop or flag invalid items, keep the page usable |
| `localStorage` / IndexedDB | Validate and fall back to defaults; version the shape and migrate |
| URL/search params | Parse with defaults; never trust for authorization |
| `postMessage` | Check `event.origin` first, then the shape |
| LLM structured output | Validate, retry with the validation error, then fall back |

### Sharing types with the backend

- **OpenAPI → generated client** (`openapi-typescript`, Orval, Kubb): backend owns the contract; CI fails when the spec changes incompatibly. Add response validation in dev/test if the backend isn't trusted to match its own spec.
- **GraphQL codegen**: types per operation, not per entity, which matches what each screen actually fetches.
- **tRPC / shared TS monorepo**: zero-codegen end-to-end types, but couples deploys and only works TS-to-TS.

> [!WARNING]
> Validating every response with a heavy schema on the main thread can cost real milliseconds on big payloads. Validate once at the boundary (not in selectors), consider sampling in production, and keep schemas lean.

### Follow-ups

- **"Isn't this duplicating the backend's validation?"** The backend validates input for security; the frontend validates output for robustness. A contract-violation report is often the first signal of a backend deploy that broke a client.
- **"How do you evolve APIs without breaking older clients?"** Additive changes only, tolerant readers (ignore unknown fields, default missing optional ones), and versioning or feature flags for breaking changes.

### References

- [Zod](https://zod.dev/)
- [openapi-typescript](https://openapi-ts.dev/)
- [Parse, don't validate (Alexis King)](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)

## Where is TypeScript unsound, and how do you defend against it?
<!--
id: typescript-unsoundness
level: principal
tags: soundness, variance, any, index access, compiler options
minutes: 12
-->

> [!TLDR]
> TypeScript deliberately trades soundness for usability. Holes include `any` (which spreads), unchecked index access, method parameter **bivariance**, array covariance, type assertions, `JSON.parse`/`.json()` returning `any`, and non-null `!`. Defend with strict compiler flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), lint rules against unsafe `any`, validation at boundaries, and code review norms on assertions.

### The holes, with examples

```ts
// 1. Index access assumes the key exists.
const scores: Record<string, number> = {};
scores['missing'].toFixed(); // compiles; crashes. Fixed by noUncheckedIndexedAccess (number | undefined).

// 2. Array covariance.
const dogs: Dog[] = [];
const animals: Animal[] = dogs; // allowed
animals.push(new Cat());        // now dogs contains a Cat

// 3. Method parameter bivariance.
interface Handler {
  handle(event: Event): void; // method syntax: parameters checked bivariantly
}
const h: Handler = { handle(e: MouseEvent) { e.clientX; } }; // allowed even with strictFunctionTypes
// Property syntax `handle: (event: Event) => void` would reject this.

// 4. any leaks.
const data = JSON.parse(raw); // any
const total: number = data.items.reduce((a, b) => a + b.price, 0); // all unchecked

// 5. Optional vs undefined.
interface Options { timeout?: number }
const o: Options = { timeout: undefined }; // allowed unless exactOptionalPropertyTypes
```

### A defensive configuration

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true
  }
}
```

Plus `typescript-eslint` rules: `no-explicit-any`, `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-return`, `no-non-null-assertion`, `consistent-type-assertions` (ban object-literal assertions).

> [!PRINCIPAL]
> Turning these on in a 500k-line codebase is a migration, not a config change. Enable per package or per directory (project references or separate tsconfigs), count violations in CI and only allow the number to go down (a "ratchet"), and fix the highest-traffic modules first. Track `any` density as a code-health metric alongside test coverage.

### Follow-ups

- **"Why not make TS sound?"** Soundness would reject lots of valid JavaScript patterns (DOM events, mutable arrays) and slow adoption. The team chose pragmatism; your job is to know where the edges are.
- **"How do you handle third-party `any` types?"** Wrap the library in a small typed adapter, validate its outputs if they cross a trust boundary, and contribute fixes to DefinitelyTyped when it's worth it.

### References

- [TypeScript FAQ: Why are function parameters bivariant?](https://github.com/microsoft/TypeScript/wiki/FAQ#why-are-function-parameters-bivariant)
- [TSConfig reference: noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess)
- [typescript-eslint: no-unsafe-* rules](https://typescript-eslint.io/rules/no-unsafe-assignment/)
