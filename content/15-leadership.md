---
id: leadership-behavioral
title: Leadership & Behavioral
description: The round that decides senior vs staff: a story bank, migrations, disagreement, mentoring, tech debt, technical strategy, failures and influence without authority.
---

## Build your story bank: STAR(L) structure and the eight stories every senior engineer needs
<!--
id: story-bank-star
level: senior
tags: behavioral, star, storytelling, interview preparation
minutes: 15
-->

> [!TLDR]
> Prepare 6–8 real stories, each told in **STAR + L** (Situation, Task, Action, Result, Learning) in about two minutes, with numbers and your personal decisions front and center ("I", not "we"). Map each story to several common questions so a small bank covers most prompts. The bar rises with level: senior stories show ownership of a hard technical outcome; lead/staff stories show multiplying others and cross-team influence; principal stories show setting direction for an organization.

### The eight stories

| Story | Covers questions like |
| --- | --- |
| A large technical project you drove end to end | "Most impactful work", "complex project", "ownership" |
| A migration or modernization | "Legacy code", "long-term thinking", "risk management" |
| A performance or reliability win with numbers | "Data-driven decision", "impact" |
| A disagreement you handled well | "Conflict", "pushback", "influence" |
| A failure or incident you owned | "Mistake", "failure", "what you learned" |
| Mentoring/growing someone | "Leadership", "raising the bar" |
| A trade-off under deadline pressure | "Prioritization", "ambiguity", "scope cuts" |
| Cross-team alignment | "Influence without authority", "stakeholders" |

### STAR(L) template

- **Situation (15s)**: context and stakes. "Our Cypress suite took ~60 minutes per PR and failed intermittently; merges were backing up."
- **Task (10s)**: your responsibility. "I took ownership of bringing CI under 25 minutes without losing coverage."
- **Action (60–75s)**: 3–4 specific decisions **you** made, why, and alternatives you rejected.
- **Result (15s)**: numbers and second-order effects. "~20 minutes, flake re-runs down sharply, PR throughput up."
- **Learning (10s)**: what you'd do differently or now do by default.

### Delivery tips

- Lead with the headline result if the interviewer seems impatient, then tell the story.
- Quantify: time, money, latency, error rates, team size, number of screens/services.
- Name the hard part: a constraint, a skeptic, a technical risk.
- Prepare follow-ups: "What would you do differently?", "How did you measure?", "What did others think?"
- Be honest about the team's contribution while making your own role clear.

### References

- [Amazon: Leadership principles (behavioral interview reference)](https://www.amazon.jobs/content/en/our-workplace/leadership-principles)
- [StaffEng: Guides](https://staffeng.com/guides/)

## "Tell me about a large migration you led"
<!--
id: migration-story
level: lead
tags: behavioral, migration, leadership, legacy, angularjs, react
minutes: 12
-->

> [!TLDR]
> Interviewers want to hear: why the migration was worth it (business case, not just "old tech"), how you avoided a feature freeze (incremental strategy), how you made decisions (bridge architecture, prioritization), how you brought people along (patterns, docs, reviews), how you measured progress and quality, and how you finished. A strong answer has a clear arc and numbers.

### A model answer (adapt the specifics to your experience)

> **Situation.** "Parts of our cloud console were still AngularJS and Svelte, past end-of-life for AngularJS, and every feature touching those screens took longer: two UI stacks, two sets of components, and new hires didn't know AngularJS."
>
> **Task.** "I led the frontend side of moving those experiences to React without pausing the roadmap."
>
> **Action.** "First, I set up a bridge: React components could mount inside legacy pages, and our router could send migrated routes to the React app. We shared design tokens so both stacks looked the same. Second, I prioritized by change frequency and traffic, so the screens the team touched most got migrated first, and we paired migrations with planned feature work. Third, I wrote a per-screen definition of done: feature parity, analytics events, accessibility checks, E2E tests ported, performance budget. Fourth, I made progress visible: a dashboard of screens remaining and legacy bundle size. And I introduced a rule of no new code in the legacy stack."
>
> **Result.** "We migrated the planned screens over several quarters while shipping features, removed the legacy runtime from the main bundle, and feature work on those areas became noticeably faster. Defects stayed flat because of the parity checklist."
>
> **Learning.** "I'd budget the last 10% explicitly; the long tail of small screens and shared utilities is where migrations stall."

### Follow-ups to prepare

- "How did you decide what to migrate first?" (value × change frequency, risk, dependencies)
- "What went wrong?" (have one real setback: a shared state bug across stacks, a performance regression, a stalled screen)
- "How did you convince leadership?" (velocity, hiring, security/EOL risk, user-facing quality)
- "Would you do micro-frontends next time?" (depends on team count and independence needs; see the architecture round)

### References

- [Martin Fowler: Strangler Fig Application](https://martinfowler.com/bliki/StranglerFigApplication.html)

## "Tell me about a time you disagreed with a technical decision"
<!--
id: disagreement-story
level: senior
tags: behavioral, conflict, disagreement, communication, influence
minutes: 10
-->

> [!TLDR]
> Show that you disagree **with evidence and respect**, separate the decision from the person, seek to understand the other side's constraints, propose a way to decide (data, prototype, time-boxed experiment, clear criteria), and **commit** once a decision is made even if it isn't yours. The best stories end with a better outcome or with you being visibly gracious about being wrong.

### Structure

1. **The decision and why it mattered** (stakes: performance, maintainability, timeline).
2. **Your concern** in concrete terms, not taste.
3. **How you engaged**: 1:1 first, asked questions, wrote a short comparison doc with criteria, built a small prototype or benchmark.
4. **The resolution**: agreed criteria, decision owner decided, you committed.
5. **Outcome and learning.**

### Example outline

> "A teammate proposed adding a global Redux slice for all server data in a new feature. I was concerned we'd re-implement caching, invalidation and loading states we already got from React Query, and that stale data bugs would follow. Rather than argue in the PR, I asked what they needed from Redux: it was cross-component access and devtools visibility. I put together a short comparison and a prototype showing the same screen with React Query and its devtools, plus how we'd share data via query keys. We agreed on criteria (fewer moving parts, consistent with the rest of the app, testability) and went with React Query. Where I was wrong: there was a genuine piece of client-only workflow state, so we kept a small Zustand store for it."

### Pitfalls

- Stories where you were simply right and others were wrong (sounds like low collaboration).
- Escalating before talking directly.
- No commitment after the decision ("I still think...").

### References

- [Amazon: Have backbone; disagree and commit](https://www.amazon.jobs/content/en/our-workplace/leadership-principles)

## How do you mentor engineers and raise the bar of a team?
<!--
id: mentoring-raising-the-bar
level: lead
tags: behavioral, mentoring, leadership, code review, team growth
minutes: 10
-->

> [!TLDR]
> Mentoring is tailored: understand the person's goals and gaps, give them stretch work with a safety net, and give specific, timely feedback. Raising the bar is systemic: code review norms that teach (explain the "why", link to docs), written patterns and RFCs, pairing on hard problems, incident reviews without blame, and making quality visible (tests, performance budgets, accessibility checks in CI). Measure success by what others can do without you.

### Practices to mention

- **Stretch assignments**: give someone the lead on a feature slightly beyond them; meet weekly; let them present it.
- **Code review as teaching**: label comments (`nit:`, `suggestion:`, `blocking:`), explain reasoning, praise good decisions, and turn repeated comments into docs or lint rules.
- **Pairing/mobbing** on unfamiliar areas (performance profiling, a tricky migration).
- **Design reviews/RFCs** for non-trivial changes, so juniors learn to write and defend decisions.
- **Learning in public**: short internal talks, demos of tools (profiling, debugging).
- **Career conversations**: help them articulate their next level and find work that demonstrates it.

### A short example

> "A newer engineer struggled with flaky tests and avoided them. I paired on two failures to show the debugging approach, then had them own a small flake-reduction project with a dashboard. They wrote our guide on writing stable E2E tests and later led the CI optimization work."

### References

- [Lara Hogan: Mentors, coaches and sponsors](https://larahogan.me/blog/what-sponsorship-looks-like/)
- [Google: Code review developer guide](https://google.github.io/eng-practices/review/)

## How do you get tech debt prioritized against feature work?
<!--
id: tech-debt-prioritization
level: lead
tags: behavioral, tech debt, prioritization, stakeholders, roadmap
minutes: 12
-->

> [!TLDR]
> Translate debt into **business impact** (slower delivery, incidents, performance, hiring, security risk), quantify it where possible, and attach it to the roadmap instead of competing with it. Use a mix of mechanisms: fix-as-you-go on code you touch, a standing capacity allocation (e.g. 15–20%), and dedicated projects for large debt with a clear payoff. Track outcomes so the next ask is easier.

### Making the case

| Debt | Impact framing | Metric |
| --- | --- | --- |
| Slow, flaky CI | Engineering hours lost, slower releases | CI duration, re-run rate, PR lead time |
| Legacy framework | Feature lead time, hiring, EOL security | Cycle time on affected areas |
| No tests in billing | Incident risk on revenue | Incidents/regressions per quarter |
| Bundle bloat | Conversion/engagement via Web Vitals | LCP/INP per route, bytes |

### Mechanisms

- **Boy-scout rule** with guardrails (small, safe improvements in the PRs that touch the code).
- **Debt register** with owner, impact, effort and a rough priority, reviewed with product each quarter.
- **Bundling**: "We're building the new invoices flow; migrating that area adds 20% and halves future changes there."
- **Error budgets/SLOs**: if reliability falls below target, prioritization shifts automatically.

### Example

> "Our PR CI took about an hour, so engineers batched changes and context-switched. I measured the cost (re-runs, waiting time across the team) and proposed a focused effort with a target. Leadership agreed because the payback was obvious; we hit ~20 minutes, and I reported the before/after numbers, which made the next infrastructure request easy."

### References

- [Martin Fowler: Technical debt quadrant](https://martinfowler.com/bliki/TechnicalDebtQuadrant.html)
- [Google SRE: Embracing risk (error budgets)](https://sre.google/sre-book/embracing-risk/)

## Write and drive a technical strategy or RFC across teams
<!--
id: technical-strategy-rfc
level: principal
tags: behavioral, rfc, technical strategy, architecture, principal engineer, writing
minutes: 15
-->

> [!TLDR]
> A good RFC states the problem with evidence, the goals and non-goals, options with honest trade-offs, a recommendation, and a rollout and migration plan with success metrics. Driving it means pre-wiring stakeholders before the review, inviting criticism early, deciding with a clear owner and deadline, and following through with tooling and examples so adoption is easy. Strategy documents go one level up: diagnose the situation, set guiding policies, and define coherent actions over quarters.

### RFC outline

```text
1. Context and problem         (evidence: incidents, metrics, developer survey)
2. Goals / non-goals
3. Proposal                    (architecture, APIs, examples)
4. Alternatives considered     (and why not)
5. Trade-offs and risks        (what gets worse; mitigation)
6. Rollout and migration       (phases, codemods, deprecation timeline, owners)
7. Success metrics             (how we'll know it worked; when we'll check)
8. Open questions
```

### Driving adoption

- **Pre-wire**: share drafts 1:1 with the most affected and most skeptical people; incorporate feedback before the meeting.
- **Decide explicitly**: who decides, by when; record the decision (ADR) with dissent noted.
- **Make the right path easy**: templates, generators, codemods, lint rules, docs with copy-paste examples.
- **Pilot** with one team, publish results, then expand.
- **Follow up** on metrics and revisit if assumptions were wrong.

### Example topics at principal scope

Standardizing data fetching across 12 frontend teams; a rendering-architecture shift (SPA → SSR/RSC) for SEO surfaces; introducing a shared design system with a deprecation plan for three legacy libraries; defining frontend SLOs and on-call.

### References

- [Will Larson: Writing engineering strategy](https://lethain.com/eng-strategies/)
- [Architecture decision records](https://adr.github.io/)

## "Tell me about a failure or production incident you owned"
<!--
id: failure-incident-story
level: senior
tags: behavioral, failure, incidents, postmortem, ownership
minutes: 10
-->

> [!TLDR]
> Pick a real failure with real consequences, own your part without excuses, and spend most of the time on **what you did next**: how you mitigated, how you found the root cause, what systemic fixes you put in place, and what you changed in how you work. Show calm under pressure and a blameless mindset. Avoid fake failures ("I work too hard").

### Structure

1. **What happened** and the impact (users affected, duration).
2. **Your role** in causing or missing it.
3. **Mitigation**: rollback, feature flag off, communication to stakeholders.
4. **Root cause** (the real one, often a process gap, not just a typo).
5. **Systemic fixes**: tests, alerts, guardrails, runbooks.
6. **What changed in you**.

### Example outline

> "I shipped a change to our data-table component that memoized row rendering. It passed tests, but in production a filter combination showed stale rows to some customers for about an hour. I rolled back via our feature flag as soon as the error reports came in, posted in the incident channel, and wrote the postmortem. The root cause was a memo comparison that ignored a nested filter prop, and our tests didn't cover that combination. We added interaction tests for filter combinations, a lint rule against shallow-comparing that prop shape, and per-release error-rate alerts. Since then I add a rollout flag and a specific production check for any change to shared components."

### References

- [Google SRE: Postmortem culture](https://sre.google/sre-book/postmortem-culture/)
- [Atlassian: Blameless postmortems](https://www.atlassian.com/incident-management/postmortem/blameless)

## Influence without authority: aligning several teams on a frontend platform change
<!--
id: influence-without-authority
level: principal
tags: behavioral, influence, stakeholders, cross-team, platform, principal engineer
minutes: 12
-->

> [!TLDR]
> You can't order other teams to adopt your change, so make it **in their interest**: understand each team's goals and pain, show how the change helps them (with data and a working prototype), lower the cost of adoption to near zero (migrations, codemods, pairing), find early adopters and make them successful and visible, and use the organization's existing mechanisms (architecture reviews, OKRs, platform roadmaps) to make the decision durable. Give credit away generously.

### A playbook

1. **Listen first**: interview teams about their pain; the problem statement should use their words.
2. **Evidence**: incidents, metrics, survey results that show the cost of the status quo.
3. **Prototype**: a working slice in a real product area beats a slide deck.
4. **Early adopter**: one respected team adopts with your hands-on help; publish the before/after.
5. **Make it cheap**: codemods, templates, documentation, office hours, migration pairing.
6. **Formalize**: RFC/ADR, add to platform roadmap and team OKRs, set a deprecation timeline for the old way.
7. **Measure and report**: adoption percentage, outcomes, and thank the teams publicly.

### Example

> "Five teams each had their own way of fetching data, leading to inconsistent loading/error states and duplicate requests. I interviewed the teams, measured duplicate request rates and bugs linked to stale data, and built a shared data-client package with React Query conventions and generated typed hooks. One team adopted it for a new feature with my help; their bug count on that surface dropped and they presented it at our frontend guild. With that evidence, the RFC passed, we added a codemod for common patterns, and adoption reached most product areas within two quarters."

### References

- [Tanya Reilly: The Staff Engineer's Path (O'Reilly)](https://www.oreilly.com/library/view/the-staff-engineers/9781098118723/)
- [StaffEng: Staff archetypes](https://staffeng.com/guides/staff-archetypes/)
