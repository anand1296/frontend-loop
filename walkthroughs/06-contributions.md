---
id: contributions
title: Community contributions with a human in the loop
summary: Members submit questions from their own interviews; nothing reaches anyone else until the owner approves it. Code changes go through pull requests that can't merge without the owner's review. How both review gates are built.
order: 6
minutes: 11
tags: product, go, postgres, react, github, moderation
---

> [!TLDR]
> A submitted question is stored in its own `submissions` table, **never** in `questions`, so there's no flag that could accidentally publish it. It's validated against the same bar as a published question, rate-limited per person, and the owner is emailed. In **Admin → Submissions** the owner can edit it, pick the round and id, then approve, which creates the real question and closes the submission **in one transaction**, credits the author if they asked, and emails them. Code contributions are gated by GitHub itself: `CODEOWNERS` plus branch protection mean no pull request merges into `main` without the owner's approval and green CI.

### Two kinds of contribution, two gates

```text
Question from an interview                       Code change
──────────────────────────                       ───────────
#contribute form (signed in)                     fork → branch → PR (template)
  │ POST /api/submissions                          │
  ▼                                                ▼
submissions (status = pending)  ──email──▶ owner   CI: web · go · e2e-server
  │                                                │
Admin → Submissions: edit, approve / reject        CODEOWNERS → owner review required
  │ one transaction                                │ branch protection on main
  ▼                                                ▼
questions (+ contributed_by)  ──email──▶ author    merge (only the owner can approve)
```

### The data model: a separate table, on purpose

```sql excerpt=backend/store/migrations/003_submissions.sql#submissions
```

Why not add a `pending` flag to `questions`? Because then every query that reads questions (the reader API, search, reminders, exports) would have to remember to filter it out, forever. A separate table makes "unreviewed content is invisible" true **by construction**: no reader query can see it. Approval is the only path from one table to the other.

The status is a closed set enforced by a `CHECK` constraint, and the reviewer, note and resulting question id are recorded for the history. `contributed_by` on `questions` is `ON DELETE SET NULL`, so if a contributor deletes their account the question stays and the credit disappears.

### Submitting: same bar as publishing, plus abuse limits

```go excerpt=backend/server/submissions.go#checkSubmission
```

The submission runs through the **same validator and Markdown compiler** an admin's published question does (TL;DR required, safe HTML, tag and length limits). That keeps review about *content*, not formatting. The form also has a preview that calls the same check, so contributors see problems before sending.

[`createSubmission`](repo:backend/server/submissions.go#createSubmission) adds limits that only make sense for user-generated content: at most 5 a day and 10 waiting per person. It respects the `contribute` feature flag, so the owner can pause submissions from the console without a deploy.

### Approving: one transaction or nothing

```go excerpt=backend/store/submissions.go#ApproveSubmission
```

What this protects against:

- **Double approval** (two admins, two tabs): the submission row is locked `FOR UPDATE` and must still be `pending`, otherwise `ErrNotPending` → `409`.
- **Half-done approvals**: creating the question, crediting the author, closing the submission, bumping the content version and the audit entry all commit together or not at all.
- **Id collisions**: the reviewer chooses the final id; inserting a question with an id that's taken fails the whole transaction.

The reviewer sends the *final* question in the request ([`approveSubmission`](repo:backend/server/submissions.go#approveSubmission)), so editing the wording, choosing a round, or adding it as a draft are part of approving, not a second step.

### Telling people what happened

Email notifications reuse the reminder mailer ([`send`](repo:backend/server/submissions.go#send)) and are **best effort**: the state change has already been committed, so an SMTP hiccup must not turn a successful approval into an error. The owner hears about new submissions ([`notifyOwnerOfSubmission`](repo:backend/server/submissions.go#notifyOwnerOfSubmission)); the author hears about the decision, with the reviewer's note and a link straight to their question ([`notifySubmitter`](repo:backend/server/submissions.go#notifySubmitter)). The app also shows a count badge on Admin for pending reviews (`pendingSubmissions` in [`bootstrap`](repo:backend/server/public.go#bootstrap), admins only).

### The UI

- [ContributePage.tsx](repo:src/features/contribute/ContributePage.tsx#ContributePage): the two paths, the form with preview, and "your submissions" with status and withdraw. Without a backend (the static build) the question path becomes a GitHub issue form instead.
- [SubmissionsTab.tsx](repo:src/features/console/SubmissionsTab.tsx#SubmissionsTab): the review queue. Reviewing reuses the editor's building blocks and the server-rendered preview, so the owner sees exactly what learners will see.
- Credit shows under the answer as "Contributed by @login" ([QuestionItem.tsx](repo:src/features/section/QuestionItem.tsx)).

### The code path: GitHub enforces the review

The rule "nobody merges without my approval" isn't something the app can enforce; GitHub does, through configuration that lives partly in the repository:

- [CODEOWNERS](repo:.github/CODEOWNERS) makes the owner the required reviewer for every file.
- Branch protection on `main` (set in the repository settings): require a pull request, one approving review, **review from Code Owners**, re-approval after new pushes, passing `web`, `go` and `e2e-server` checks, resolved conversations, and no force-pushes or deletions.
- First-time contributors' CI runs wait for the owner's approval, so a pull request can't run arbitrary code in Actions unreviewed.
- [CONTRIBUTING.md](repo:CONTRIBUTING.md), the [pull request template](repo:.github/pull_request_template.md) and [issue forms](repo:.github/ISSUE_TEMPLATE/) set expectations up front, and [SECURITY.md](repo:SECURITY.md) routes vulnerabilities to a private channel.

> [!PRINCIPAL]
> Notice the symmetry: both paths are **"anyone can propose, one person decides, and the system makes skipping the decision impossible"**. In the app that's a separate table and a transactional approval; on GitHub it's CODEOWNERS and branch protection. Designing moderation is mostly designing where the gate sits so that it can't be bypassed by accident.

### How it's tested

[`TestQuestionSubmissions`](repo:backend/server/server_test.go#TestQuestionSubmissions) covers the whole lifecycle against Postgres: validation problems, rate limits, learners can't reach admin routes, a pending question is invisible to readers, approving creates a credited question and emails both sides, a second approval gets `409`, rejecting and withdrawing.

### If you're asked about this in an interview

- **"Design user-submitted content with moderation."** Separate storage for unreviewed content, the same validation as first-party content, per-user limits, an audited, transactional approval, notifications, and a way to pause intake.
- **"How do you protect `main` in an open-source repo?"** Code owners, required reviews and checks, stale-review dismissal, approval for first-time contributors' workflows, and least-privilege `GITHUB_TOKEN` permissions.
