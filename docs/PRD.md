# Product Requirements: Frontend Loop

**Status:** v2.0 implemented (Go backend, accounts, admin CMS) · **Owner:** Anand · **Last updated:** 2026-10-16

> The complete, current specification (requirements with IDs, architecture, data model, API, security, roadmap) is [SPEC.md](SPEC.md). This PRD keeps the product reasoning and the v1 → v2 story.

## 1. Problem

Senior, lead and principal frontend interviews cover a wide surface: JavaScript and TypeScript internals, React at depth, machine coding, browser and performance, testing, accessibility, security, system design, architecture, AI features and behavioral rounds. Preparation material is scattered across blogs, docs, courses and chat transcripts. It is usually either shallow (definitions and trivia) or long-form (books) with no way to track what you've actually mastered or to keep it fresh in the weeks before interviews.

## 2. Users

| Persona | Context | Needs |
| --- | --- | --- |
| **Senior engineer, active search** (primary) | 5–8 years, interviewing in 2–8 weeks, studies in 30–60 minute sessions on laptop and phone | A structured path, answers deep enough to survive follow-ups, progress that survives across sessions and devices |
| **Lead/staff candidate** | Owns architecture and teams | Architecture, system design and leadership questions with principal-level nuance |
| **Interviewer / mentor** | Prepares questions or coaches others | Shareable deep links to individual questions; consistent answer quality |

## 3. Goals and non-goals

### Goals

1. A topic-wise question bank where each answer is interview-grade: a 60-second spoken answer, the mental model, correct code, trade-offs, edge cases, follow-ups, common mistakes and references.
2. Make progress tracking effortless: tick a question done, and the app remembers it and resumes where you left off.
3. Make knowledge stick: spaced review of done answers, and a practice mode that forces active recall before reading.
4. Simple and minimal: no account required, no setup, fast on a mid-range phone, accessible.
5. A codebase that is itself a learning project: it should demonstrate the practices its answers recommend.

### Non-goals (v1)

- User-generated content, comments or social features.
- An AI tutor or mock interviewer (see Roadmap).
- Video content, courses or certificates.
- Accounts and server-side storage beyond the optional host-provided sync. *(Changed in v2: accounts, invites and server storage are now in scope, with the no-account local mode kept.)*

## 4. User stories

| # | As a… | I want to… | So that… | Priority |
| --- | --- | --- | --- | --- |
| U1 | learner | browse questions grouped by topic ("rounds") | I can study one area at a time | Must |
| U2 | learner | see only the question until I expand it | I can try answering first | Must |
| U3 | learner | read a detailed answer with code and references | I understand it deeply enough for follow-ups | Must |
| U4 | learner | tick a question as done from the list or the answer | my progress is saved | Must |
| U5 | learner | return later and continue where I left off | I don't hunt for my place | Must |
| U6 | learner | see progress per round and overall | I know what's left | Must |
| U7 | learner | search all questions by keyword | I can jump to a topic before an interview | Should |
| U8 | learner | filter by status and level | I can focus on gaps or my target level | Should |
| U9 | learner | get done answers back for review on a schedule | I don't forget them | Should |
| U10 | learner | hide answers until I've practiced aloud (with a timer) | I practice recall like the real interview | Should |
| U11 | learner | write my own notes per question | I can rehearse stories and answers in my words | Should |
| U12 | learner | export/import my progress | I can move between browsers or back it up | Should |
| U13 | learner | use it comfortably on my phone and in dark mode | I can study anywhere | Must |
| U14 | mentor | share a link to one question | others land directly on it | Could |
| U15 (v2) | learner | sign in once and have progress on every device | I can switch between laptop and phone | Must |
| U16 (v2) | owner | invite people with a link and decide who may join | the group stays the people I chose | Must |
| U17 (v2) | admin | add or edit rounds and questions in the browser, with a preview, drafts and history | the bank grows without deploys or mistakes | Must |
| U18 (v2) | admin | see each learner's progress (not their notes) | I can help people who are stuck | Should |
| U19 (v2) | admin | switch features on or off and post announcements | I can tailor the app to the group | Should |
| U20 (v2) | owner | export content back to Markdown | the repository stays the long-term record | Should |

## 5. Functional requirements

1. **Content**
   - 15 rounds, ~110 questions, tagged by level (Senior, Lead/Staff, Principal), estimated study minutes and topic tags.
   - Every answer starts with a "60-second answer" summary.
   - Code is syntax-highlighted with a copy button; tables scroll horizontally on small screens.
2. **Accordion list** per round; panels lazy-render their content; expand/collapse all.
3. **Progress**: per-question done state, done time, review stage and due date, notes; last visited question.
4. **Resume**: Overview's primary action opens the last visited question if not done, otherwise the next not-done question in the learning path.
5. **Spaced review**: done answers come back after 2, 5, 12, 30, 75 days; "Still solid" advances, "Needs another pass" un-marks.
6. **Search**: keyboard shortcut (`/`, Ctrl/⌘+K), weighted multi-token search across titles, tags, summaries and opening text, accessible combobox.
7. **Practice mode**: answer gated behind "Reveal the answer" with a stopwatch.
8. **Settings**: theme (system/light/dark), practice mode, export (copy/download JSON), import (merge/replace), reset with confirmation.
9. **Deep links**: `#<round-id>` and `#<question-id>` open the right round and question.
10. **Persistence**: survives reloads; syncs across tabs; syncs across devices where the host provides per-user storage.

## 6. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance | First render without network round trips for content; LCP < 1.5s on desktop broadband for the hosted build; interaction feedback < 100ms |
| Accessibility | WCAG 2.2 AA intent: keyboard operable, visible focus, semantic accordion (button + region), labelled checkboxes, skip link, reduced motion |
| Reliability | Corrupt or old saved data never crashes the app (validated on read); storage failures degrade to in-memory |
| Security | No runtime HTML from untrusted sources; content HTML produced at build time with raw HTML escaped and link schemes restricted |
| Privacy | No analytics or tracking in v1; data stays in the browser unless the host syncs it to the user's own account |
| Maintainability | Strict TypeScript, no unnecessary type assertions, content validated in CI with file:line errors, unit tests for all state logic |
| Portability | Deployable as static files anywhere, or as one self-contained HTML file |

## 7. Success metrics

- **Activation:** % of visitors who mark at least one question done in their first session.
- **Retention:** % of learners who return within 7 days; median sessions per learner.
- **Learning:** % of done answers that are "Still solid" at first review.
- **Coverage:** median % of the bank completed per active learner after 4 weeks.
- **Quality:** zero content build errors on main; zero JS errors per 1,000 sessions (once instrumented).

## 8. Release plan

| Version | Scope |
| --- | --- |
| **v1.0** (this release) | Everything in §5, 109 questions across 15 rounds, docs, unit tests, CI |
| v1.1 | Component tests (Testing Library) and Playwright E2E in CI; Lighthouse CI budgets |
| v1.2 | Offline support (service worker), installable PWA |
| **v2.0** (this release) | Go + Postgres backend; GitHub sign-in; owner/admin/learner roles; invite links; synced progress; admin console (content CMS with preview, drafts, revisions, trash, repository sync and export; learners; invites; feature flags; site settings; announcements; activity log); full-stack CI |
| v2.1 | Tracks (groups of rounds) and the first backend/Go, data and cloud rounds |
| v2.2 | Redis (shared rate limits, caches), live updates via Server-Sent Events |
| v3.0 | Mock-interview mode, confidence ratings, AI follow-ups and feedback, semantic search; optional AWS deployment with Terraform (SPEC §18) |

## 9. Open questions

- Should practice mode record time-to-answer per question to suggest weak areas?
- Should notes be exportable as a personal "story bank" document?
- Should rounds be reorderable to fit a specific company's loop?
