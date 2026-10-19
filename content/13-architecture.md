---
id: architecture-at-scale
title: Architecture at Scale
description: Lead and principal territory: micro-frontends, monorepos, incremental migrations, rendering architecture, state ownership, design system governance, API layers, observability and feature flags.
---

## Micro-frontends and Module Federation: when do they pay off, and how do they fail?
<!--
id: microfrontends-module-federation
level: principal
tags: micro-frontends, module federation, architecture, team topology, webpack
minutes: 20
-->

> [!PROMPT]
> Three teams want to split a 400-page admin app into micro-frontends with Module Federation. You are asked whether it's worth it and how to do it without a mess.
>
> **Cover**
> - Problems micro-frontends solve (team autonomy, independent deploys) and problems they create (duplication, UX drift, performance, version skew).
> - Integration design: shared dependencies, routing, shared state/events, design-system consistency.
> - Failure modes (a remote is down), testing, observability and the exit criteria if it doesn't work.

> [!TLDR]
> Micro-frontends split a frontend by **business domain** so teams can build, test and deploy independently. They pay off when you have many teams blocked on a shared release train, or when you must migrate incrementally between stacks. They cost runtime complexity (shared dependency versions, multiple React copies, cross-app state and routing), performance (more JS, waterfalls), and consistency (design drift). Module Federation solves runtime code sharing; it doesn't solve contracts, ownership or UX consistency. Prefer a well-structured monorepo with independent deploy units first; adopt runtime composition only where independent deployability is worth its price.

### Composition options

| Approach | Independence | Cost | Good for |
| --- | --- | --- | --- |
| Monorepo + build-time packages | Shared release | Low | Most orgs; strong consistency |
| Server-side/edge composition (fragments, ESI) | High | Infra complexity | Content-heavy sites |
| Route-level split (separate apps per path) | High | Full reloads or shell routing | Distinct product areas |
| Runtime composition (Module Federation, import maps) | High | Version/shared-deps complexity | Many teams, one SPA shell, migrations |
| iframes | Total isolation | UX/a11y/perf penalties | Untrusted or legacy embeds |

### Module Federation essentials

```ts
// host (shell) webpack/rspack config, Module Federation 2 style
new ModuleFederationPlugin({
  name: 'shell',
  remotes: { billing: 'billing@https://cdn.acme.com/billing/remoteEntry.js' },
  shared: {
    react: { singleton: true, requiredVersion: '^19.0.0' },
    'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
    '@acme/design-system': { singleton: true, requiredVersion: '^4.0.0' },
  },
});

// host code
const BillingApp = lazy(() => import('billing/App'));
```

- **Singletons** for React and anything holding global state (router, design system theme, query client), or you get two Reacts and broken hooks/context.
- **Version skew**: a remote built against `react@19.1` loaded into a shell with `19.0` may be fine or may break; set policies (shell owns platform versions, remotes declare ranges, CI checks compatibility).
- **Runtime failure**: a remote's CDN 404 must not white-screen the shell: error boundary + fallback + retry, and a manifest service for versions.

### Contracts between micro-frontends

- **Routing**: shell owns top-level routes; remotes own sub-routes under a basename.
- **Communication**: props at mount boundaries, URL state, and a small typed event bus for cross-cutting events. Avoid sharing stores directly.
- **Auth/session**: shell provides an auth client; remotes don't implement login.
- **Design system**: shared as a singleton package with semver discipline; visual drift is the most common failure.
- **Performance budgets** per remote, because each team adds JS independently.

### How they fail (say this to sound experienced)

1. Splitting by technical layer (header team, footer team) instead of domain → constant cross-team changes.
2. Too fine-grained: a "micro-frontend per widget" multiplies overhead.
3. No platform team: every team reinvents build config, auth, observability.
4. Independent deploys without contract tests → runtime breakage in production.
5. Shared mutable global state across remotes → coupling worse than a monolith.

> [!PRINCIPAL]
> Frame the decision as an organizational one (Conway's law). Ask: how many teams, how often are they blocked by each other's releases, how much UI do they share, and what's the migration path? Often the right answer is a modular monolith with enforced boundaries (Nx/ESLint module boundaries) plus independent deployability for only one or two areas (e.g. a legacy-to-new migration path).

### References

- [Martin Fowler: Micro Frontends](https://martinfowler.com/articles/micro-frontends.html)
- [Module Federation documentation](https://module-federation.io/)
- [Luca Mezzalira: Building Micro-Frontends (O'Reilly)](https://www.oreilly.com/library/view/building-micro-frontends/9781492082989/)

## Monorepos for frontend: pnpm workspaces, Nx or Turborepo, boundaries and CI caching
<!--
id: monorepo-tooling
level: lead
tags: monorepo, pnpm, nx, turborepo, ci, code ownership
minutes: 15
-->

> [!PROMPT]
> Your company has 12 frontend repos with duplicated tooling and painful cross-repo changes. Propose a monorepo setup and how you migrate to it.
>
> **Cover**
> - Workspace and task tooling (pnpm, Nx, Turborepo): remote caching, affected-only builds, boundaries.
> - Versioning and publishing, code ownership, CI time and dependency rules.
> - Migration plan with minimal disruption, and the downsides to be honest about.

> [!TLDR]
> A monorepo puts apps and shared packages in one repository so changes across them are atomic, versions stay aligned, and code reuse is cheap. It needs tooling for three things: a **package manager with workspaces** (pnpm), a **task runner with caching and affected detection** (Nx or Turborepo) so CI only builds and tests what changed, and **enforced boundaries** (who may import what) so it doesn't become a big ball of mud. Add CODEOWNERS and consistent configs.

### Layout

```text
apps/
  console/            # the product SPA
  marketing/          # Next.js site
packages/
  design-system/      # components, tokens
  data-client/        # typed API client + React Query hooks
  feature-billing/    # domain feature package
  config-eslint/      # shared lint config
  config-ts/          # shared tsconfig bases
```

### Affected + caching

```json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "lint": {}
  }
}
```

`turbo run test --filter=...[origin/main]` (or `nx affected -t test`) runs only for packages changed since main **and their dependents**; remote caching shares results across CI runs and developer machines.

### Boundaries

- Tag packages (`type:app`, `type:feature`, `type:ui`, `type:util`, `scope:billing`) and lint rules: features can't import other features; UI can't import data clients; apps compose features.
- Use package `exports` so consumers can't deep-import internals.
- TypeScript project references for faster incremental type checking at scale.

### Trade-offs

- Tooling and CI investment upfront; repository size and IDE performance at very large scale.
- Everyone sees everything (good for refactors, needs CODEOWNERS for review routing).
- Atomic changes encourage tight coupling if boundaries aren't enforced.

### References

- [pnpm workspaces](https://pnpm.io/workspaces)
- [Turborepo docs](https://turborepo.com/docs)
- [Nx: Enforce module boundaries](https://nx.dev/features/enforce-module-boundaries)
- [monorepo.tools](https://monorepo.tools/)

## Lead an incremental migration (for example AngularJS to React) without a rewrite freeze
<!--
id: incremental-migration-strangler
level: principal
tags: migration, strangler fig, angularjs, legacy, architecture, leadership
minutes: 20
-->

> [!PROMPT]
> You lead an AngularJS to React migration of a product with 300 screens and a roadmap that can't pause. Describe how you'd run it.
>
> **Cover**
> - The strangler approach: a bridge between old and new, routing, shared state and styling.
> - Prioritization (what to migrate first), tooling to prevent new legacy code, and how you measure progress.
> - Risks (parallel UX, performance, morale), communication with stakeholders and what "done" means.

> [!TLDR]
> Never stop feature work for a big-bang rewrite. Use the **strangler fig** approach: build a bridge so old and new can run side by side, migrate route by route (or widget by widget) prioritized by business value and change frequency, keep shared concerns (auth, routing, design tokens, API client) consistent across both, measure progress, and delete legacy code as you go. Leadership work is as important as technical work: a clear plan, milestones, a definition of done per screen, and guardrails that prevent new legacy code.

### Technical bridge options

| Bridge | How | When |
| --- | --- | --- |
| React inside legacy | Mount React components in legacy pages (`createRoot` in a directive/wrapper) | Start: new widgets in React immediately |
| Legacy inside React | Host the legacy app shell inside a React route (or vice versa) | Mid-migration |
| Route-level split | Router decides: migrated routes → React app, others → legacy | Clean ownership, full screens |
| Micro-frontends | Module Federation shell loads both | Many teams, long migration |

```tsx
// AngularJS directive hosting a React component (the classic first step)
angular.module('app').directive('reactUsage', () => ({
  restrict: 'E',
  scope: { accountId: '<' },
  link(scope: angular.IScope & { accountId: string }, element: JQLite) {
    const root = createRoot(element[0]);
    const render = () => root.render(<UsageChart accountId={scope.accountId} />);
    scope.$watch('accountId', render);
    scope.$on('$destroy', () => root.unmount());
  },
}));
```

### Sequencing

1. **Foundations**: React build pipeline, shared design tokens/components, API client, auth/session bridge, routing bridge, observability.
2. **Guardrail**: no new features in legacy (lint rule or review policy).
3. **Migrate by value**: high-traffic and frequently changed screens first (biggest payoff), simple screens early to build momentum and patterns.
4. **Parity checklist per screen**: features, permissions, analytics events, a11y, performance budget, E2E tests ported.
5. **Delete** legacy code when a screen ships; track lines/screens remaining on a visible dashboard.
6. **Finish**: remove the bridge and legacy runtime; this last 10% is where migrations stall, so plan it explicitly.

### Risks and how to manage them

- **Two UX patterns at once**: shared design tokens and CSS isolation (prefixes/scoping) to avoid style leaks.
- **Double bundle size** during transition: lazy-load the legacy runtime only on legacy routes.
- **State shared across frameworks**: keep it on the server or in a framework-agnostic store with subscriptions.
- **Stalling**: tie migration to product work ("we're redesigning billing anyway, so billing migrates now").

### How to tell it in an interview

Context (why: hiring, performance, maintainability, end-of-life), the bridge you chose and why, how you prioritized, how you kept shipping features, metrics (screens migrated, bundle/perf changes, defect rates, dev velocity), and what you'd do differently.

### References

- [Martin Fowler: Strangler Fig Application](https://martinfowler.com/bliki/StranglerFigApplication.html)
- [React: Add React to an existing project](https://react.dev/learn/add-react-to-an-existing-project)

## Choose a rendering architecture: SPA, SSR, SSG/ISR, streaming, islands or React Server Components
<!--
id: rendering-architecture-choice
level: lead
tags: rendering, ssr, ssg, csr, islands, rsc, architecture
minutes: 18
-->

> [!PROMPT]
> A new product has a marketing site, an authenticated app and a docs section. The team debates SPA versus SSR versus static. Decide per surface.
>
> **Cover**
> - The criteria: SEO, personalization, interactivity, data freshness, team skills and infrastructure.
> - Trade-offs of SPA, SSR, SSG/ISR, streaming, islands and RSC.
> - Your recommendation for each surface, and how you keep the option to change later.

> [!TLDR]
> Decide per surface using: how **dynamic** the content is (static, per request, per user), how **interactive** the page is, whether **SEO**/first paint matter, and operational constraints (servers, caching, team skills). Static and SEO-critical: SSG/ISR at the edge. Personalized but content-heavy: SSR with streaming, or RSC. Highly interactive app behind login: SPA (CSR) with code splitting is often simplest. Content with sprinkles of interactivity: islands. Many products mix strategies by route.

### Decision table

| Strategy | First paint | Interactivity cost | Server cost | Freshness | Typical fit |
| --- | --- | --- | --- | --- | --- |
| CSR/SPA | Slow-ish (JS first) | Full app JS | Static hosting | Live | Dashboards, editors behind auth |
| SSR | Fast HTML | Full hydration | Per request | Live | Personalized, SEO pages |
| SSR + streaming | Fastest meaningful paint | Hydration (selective) | Per request | Live | Pages with slow sub-parts |
| SSG | Fastest | Hydration | Build time | Stale until rebuild | Docs, marketing |
| ISR / edge cache + revalidate | Fast | Hydration | Low | Bounded staleness | Catalogs, blogs |
| Islands (Astro) | Fast | Only islands hydrate | Low | Varies | Content sites with widgets |
| RSC | Fast | Only client components | Per request/cached | Live | Content + interactivity mixes |

### Hydration costs (often ignored)

SSR shows content early, but the page isn't interactive until JS downloads, parses and hydrates. On slow phones that gap hurts INP (clicks during hydration are delayed). Reduce JS, hydrate selectively (Suspense boundaries), or ship less client code (islands/RSC).

### Common mistakes

- SSR for logged-in dashboards where SEO doesn't matter and data is user-specific: server cost and complexity without much benefit; a fast SPA shell + skeletons may be better.
- `Date.now()`/random/locale differences between server and client → hydration mismatches.
- Caching personalized SSR output in shared caches.

### References

- [web.dev: Rendering on the web](https://web.dev/articles/rendering-on-the-web)
- [patterns.dev: Rendering patterns](https://www.patterns.dev/react/)
- [Astro: Islands architecture](https://docs.astro.build/en/concepts/islands/)

## State architecture: server state, client state, URL state and form state. Who owns what?
<!--
id: state-ownership-architecture
level: lead
tags: state management, react query, redux, url state, forms, architecture
minutes: 15
-->

> [!PROMPT]
> A codebase keeps all state in one global store: server data, form drafts, UI toggles and URL filters. Bugs are everywhere. Propose a state architecture.
>
> **Cover**
> - The kinds of state (server, client, URL, form, ephemeral) and the right owner for each.
> - Tooling choices (a server-state cache, URL as state, local state first) and where a global store is justified.
> - A migration path and rules that keep it from drifting back.

> [!TLDR]
> Most "state management" problems come from mixing kinds of state. **Server state** (data owned by the backend) belongs in a cache with fetching, invalidation and staleness (TanStack Query, RTK Query, Apollo). **URL state** (filters, tabs, pagination, selected ids) belongs in the URL so it's shareable and survives reloads. **Form state** belongs in a form library or local state until submit. **Client/UI state** (theme, open panels, wizard steps) stays local, lifted only as far as needed; a global store is for genuinely global, client-owned state. Once server state leaves Redux, most apps need very little global state.

### Classify before choosing tools

| State | Examples | Owner | Tool |
| --- | --- | --- | --- |
| Server | Users, orders, permissions | Backend | TanStack Query / RTK Query / GraphQL client |
| URL | `?status=open&page=3`, `/projects/:id` | Router | Router search params (typed, validated) |
| Form | Draft values, dirty/touched, errors | Form | react-hook-form, `useActionState` |
| Local UI | Hover, open dropdown, input focus | Component | `useState`/`useReducer` |
| Shared UI | Theme, sidebar collapsed, toasts | App | Context (rarely changing) or a small store |
| Session | Auth user, feature flags | App shell | Context provided once, or query cache |

### Smells

- Copying server data into Redux/`useState` and keeping it in sync manually ("why is this list stale?").
- Filters in component state, so the back button and sharing don't work.
- A giant global store everyone writes to, with selectors returning new objects (re-render storms).
- Duplicated sources of truth: a value derived from props stored in state.

### URL state example (typed)

```ts
const FiltersSchema = z.object({
  status: z.enum(['open', 'closed', 'all']).catch('open'),
  page: z.coerce.number().int().min(1).catch(1),
  q: z.string().catch(''),
});

function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters = FiltersSchema.parse(Object.fromEntries(params));
  const update = (patch: Partial<z.infer<typeof FiltersSchema>>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(patch)) next.set(key, String(value));
      if (!('page' in patch)) next.set('page', '1'); // reset paging when filters change
      return next;
    });
  return [filters, update] as const;
}
```

### References

- [TkDodo: React Query as a state manager](https://tkdodo.eu/blog/react-query-as-a-state-manager)
- [Kent C. Dodds: Application state management with React](https://kentcdodds.com/blog/application-state-management-with-react)
- [TanStack Router: Search params](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)

## Run a design system as a product: versioning, contribution, adoption and breaking changes
<!--
id: design-system-governance
level: principal
tags: design systems, governance, versioning, adoption, codemods, platform
minutes: 15
-->

> [!PROMPT]
> You are asked to run the design system as a product for 20 product teams. Adoption is low, teams fork components and a breaking change last quarter caused outages.
>
> **Cover**
> - Scope, ownership and contribution model; how you decide what belongs in the system.
> - Versioning, deprecation and migration tooling (codemods), plus documentation and support.
> - Metrics (adoption, time to ship, accessibility) and how you convince teams to use it.

> [!TLDR]
> A design system succeeds when product teams **choose** it because it makes them faster and their UI better. Treat it as a product: clear scope (tokens, primitives, patterns), documentation with live examples, semantic versioning with changelogs, a contribution model (core team owns quality, product teams contribute with review), adoption metrics, and a deprecation process with codemods so breaking changes don't strand teams. Accessibility and performance are features the system guarantees.

### Building blocks

- **Tokens** (color, spacing, type, radius, motion) in a platform-neutral format (DTCG JSON) → CSS variables, TS, mobile.
- **Primitives** (Button, Input, Dialog, Menu, Combobox...) with accessibility built in.
- **Patterns** (forms, tables, empty states, page layouts) documented with do/don't.
- **Docs site** (Storybook/Docusaurus) with usage guidance, props tables generated from types, a11y notes, and playgrounds.

### Versioning and change management

- Semver; changesets for changelogs; release often in small increments.
- Deprecate before removing: runtime dev warnings, lint rules (`no-deprecated-design-system-props`), and **codemods** (jscodeshift/ts-morph) that migrate call sites automatically.
- Visual regression tests per component to catch unintended changes.
- Support window: N-1 major versions, with a published timeline.

### Contribution model

| Model | Pros | Cons |
| --- | --- | --- |
| Centralized (core team builds all) | Consistency | Bottleneck |
| Federated (anyone contributes) | Scale | Inconsistency without strong review |
| Hybrid (core owns primitives, teams contribute patterns via RFC) | Balance | Needs process |

### Measuring adoption and health

- Percentage of UI built from system components (static analysis of imports), per product area.
- Detached/forked components count; one-off CSS overrides.
- Time for a team to build a standard screen; designer-developer handoff issues.
- Accessibility defects in system components (should trend to zero).

### Common failure modes

Too generic (teams can't build what they need, so they fork), too rigid (no escape hatches), breaking changes without migration help, no ownership after the initial launch, and design and code libraries drifting apart.

### References

- [Nathan Curtis: Design system team models](https://medium.com/eightshapes-llc/team-models-for-scaling-a-design-system-2cf9d03be6a0)
- [Design Tokens Community Group format](https://www.designtokens.org/)
- [Changesets](https://github.com/changesets/changesets)

## API layer choices: REST vs GraphQL vs tRPC, Backend-for-Frontend, and generated clients
<!--
id: api-layer-bff-graphql
level: lead
tags: api design, rest, graphql, trpc, bff, openapi
minutes: 15
-->

> [!PROMPT]
> Your React app calls 6 REST endpoints per screen and over-fetches on mobile. Compare REST, GraphQL, tRPC and a Backend-for-Frontend, and pick one with reasons.
>
> **Cover**
> - Performance, caching, type safety, tooling, team structure and operational cost of each.
> - Generated clients and contract testing; versioning and deprecation.
> - Migration without a rewrite, and the failure modes of your choice.

> [!TLDR]
> REST is simple, cacheable at the HTTP layer, and universal, but screens often need several calls or get over-fetched payloads. GraphQL lets each screen ask for exactly what it needs in one round trip with a typed schema, at the cost of server complexity, caching via normalized client stores, and query-cost controls. tRPC gives end-to-end TypeScript types with almost no ceremony but couples client and server to one TS codebase. A **BFF** (backend-for-frontend) owned by the frontend team aggregates and shapes upstream APIs per client, and is often the highest-leverage choice regardless of protocol. Generate typed clients from schemas either way.

### Comparison

| | REST (+OpenAPI) | GraphQL | tRPC |
| --- | --- | --- | --- |
| Typing | Generated from OpenAPI | Generated per operation | Inferred directly |
| Over/under-fetching | Common | Solved by queries | Per procedure |
| HTTP caching | Natural (GET + CDN) | Harder (POST; persisted queries help) | Possible for queries |
| Tooling/ecosystem | Universal | Rich (Apollo, Relay, urql) | TS-only |
| Server complexity | Low | Higher (resolvers, N+1, cost limits) | Low |
| Multiple client languages | Easy | Easy | No |

### BFF responsibilities

- Aggregate calls (one request per screen), shape responses for the UI, handle auth tokens server-side, apply caching and rate limits, hide internal service topology, and version independently of core services.
- Owned by the team that owns the UI, so contract changes don't wait on other teams.
- Risk: business logic creeping into the BFF and duplicating services; keep it to composition and presentation.

### Patterns worth naming

- **Persisted queries** (GraphQL) for security and CDN caching.
- **Fragment colocation** (Relay): each component declares its data needs; parents compose fragments.
- **Error model**: consistent error envelope (`code`, `message`, `fieldErrors`), and partial success semantics.
- **Pagination**: cursor-based, consistent across endpoints.
- **Contract testing** (Pact) or schema diff checks in CI to catch breaking changes.

### References

- [Sam Newman: Backends for Frontends](https://samnewman.io/patterns/architectural/bff/)
- [GraphQL: Learn](https://graphql.org/learn/)
- [tRPC](https://trpc.io/docs)

## Frontend observability: errors, RUM, tracing, source maps and alerting people trust
<!--
id: frontend-observability
level: lead
tags: observability, rum, error tracking, tracing, source maps, alerting, datadog, sentry
minutes: 15
-->

> [!PROMPT]
> After a release, conversion drops 4% but there are no alerts and the error tracker is noisy. Design frontend observability so the team learns about problems before users complain.
>
> **Cover**
> - Signals: errors (with source maps and release tags), Web Vitals RUM, logs, traces and business events.
> - Alerting that people trust: thresholds, deduplication, ownership, and release health.
> - Privacy and cost (sampling, PII), and how you use the data in incident response.

> [!TLDR]
> You need four signals: **errors** (grouped, deobfuscated with private source maps, tagged with release and user context), **performance** (Web Vitals and custom timings from real users), **traces** (frontend spans propagated to backend via `traceparent` so a slow click maps to a slow service), and **product analytics** (did the feature work for users?). Alert on user-impacting symptoms (error rate per release, p75 vitals per route, failed critical journeys), not on every exception. Tie everything to releases and feature flags so regressions point at a change.

### Instrumentation essentials

```ts
// One place to initialize, with consistent context
initRum({
  service: 'console-web',
  env: import.meta.env.MODE,
  version: __RELEASE__,                 // matches uploaded source maps
  sessionSampleRate: 20,
  allowedTracingUrls: [/^https:\/\/api\.acme\.com/], // inject traceparent headers
  beforeSend: (event) => scrubPii(event),            // redact emails, tokens, query params
});

setGlobalContext({ tenantTier: account.tier, featureFlags: flags.activeKeys() });

// Custom timing for a product moment
performance.mark('report:start');
await renderReport();
performance.measure('report:ready', 'report:start');
```

### Making errors actionable

- Upload source maps privately at build time; don't serve them publicly.
- Group by fingerprint, ignore noise (browser extensions, `ResizeObserver loop` warnings, aborted fetches), and rate-limit.
- Capture breadcrumbs (route changes, clicks, failed requests) for reproduction.
- Session replay for hard bugs, with strict privacy masking by default.

### Alerting that people trust

- Alert per release: "error rate for v4.12 is 3× baseline in the first 30 minutes" → auto-pause the rollout.
- Synthetic checks for critical journeys (login, checkout) every few minutes from several regions.
- SLOs for frontend: e.g. "99.5% of page loads without a JS error", "p75 INP < 200ms on the editor route".
- Route alerts to owning teams (CODEOWNERS-style ownership metadata on routes/components).

### References

- [Datadog: Real User Monitoring](https://docs.datadoghq.com/real_user_monitoring/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [Google SRE book: Monitoring distributed systems](https://sre.google/sre-book/monitoring-distributed-systems/)

## Feature flags and progressive delivery: kill switches, flag debt and testing
<!--
id: feature-flags-progressive-delivery
level: lead
tags: feature flags, progressive delivery, canary, experimentation, release management
minutes: 12
-->

> [!PROMPT]
> Your team ships big features behind flags, but nobody removes them and a half-enabled flag combination caused an incident. Design your feature flag and progressive delivery practice.
>
> **Cover**
> - Flag types (release, experiment, ops, permission), targeting and percentage rollouts, kill switches.
> - Lifecycle and flag debt: ownership, expiry, cleanup automation; testing combinations.
> - Rollout and monitoring: canary, automatic rollback on metrics, and avoiding flicker on the client.

> [!TLDR]
> Feature flags decouple **deploy** from **release**: code ships dark, then turns on for internal users, a percentage, a segment, or everyone, with instant rollback. Use them for incremental rollouts, kill switches for risky dependencies, experiments, and trunk-based development. Manage their cost: evaluate flags consistently (server and client agree, no UI flicker), type them, give each an owner and expiry, test both paths for critical flags, and delete them promptly; stale flags are tech debt that multiplies code paths.

### Implementation details that matter

- **No flicker**: evaluate flags before first render (server-side or bootstrap them into the HTML), not after an async fetch that swaps UI.
- **Typed flags**: a generated or declared registry (`flags.newBilling: boolean`) instead of string lookups everywhere.
- **Sticky bucketing** by user/account id so users don't flip between variants.
- **Kill switches** default to the safe behavior when the flag service is unreachable.
- **Observability**: attach active flags to RUM/error events so you can correlate regressions with a rollout.

```tsx
function BillingPage() {
  const newBilling = useFlag('newBilling'); // typed, bootstrapped, no async flicker
  return newBilling ? <BillingV2 /> : <BillingV1 />;
}
```

### Flag hygiene

- Every flag has an owner, a purpose (release, experiment, ops, permission), and a removal date.
- Lint/CI reports flags older than N days or fully rolled out.
- Remove the dead branch and the flag in one PR after rollout.

### Progressive delivery

Canary deploys (a small percentage of traffic gets the new build), automated analysis of error rate and vitals, automatic rollback; for frontends, versioned asset deploys plus routing a percentage of users to the new `index.html`.

### References

- [Martin Fowler: Feature Toggles](https://martinfowler.com/articles/feature-toggles.html)
- [OpenFeature specification](https://openfeature.dev/)
