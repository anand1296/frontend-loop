---
id: email-reminders
title: Email reminders, end to end
summary: A Settings toggle, a Postgres table, a daily Vercel Cron job and plain SMTP. How a nudge gets from a switch to your inbox exactly once, and why each piece looks the way it does.
order: 2
minutes: 14
tags: go, postgres, smtp, vercel cron, react
---

> [!TLDR]
> You flip a switch in Settings; the choice lands in a `reminder_prefs` row. Once a day Vercel Cron calls a secret-protected endpoint, which **claims** the people who are due in one SQL statement (so two runs can never email the same person), composes a progress email from pure Go code, and sends it over plain SMTP. Every email carries a one-click unsubscribe link that works without signing in.

### What the learner sees

In **Settings → Email reminders** there is a switch (off by default), a frequency (daily, every 3 days, weekly) and a "Send me a test email" button. The email says how far you are, what's due for review, which question to open next (with a link straight to it), and one line of encouragement that fits your situation.

### The shape of it

```text
Settings switch ──PUT /api/me/reminders──▶ reminder_prefs (Postgres)

Vercel Cron, 03:30 UTC daily
   └─GET /api/cron/reminders  (Authorization: Bearer CRON_SECRET)
        ├─ ClaimDueReminders   one UPDATE … FOR UPDATE SKIP LOCKED
        ├─ composeReminder     progress + published rounds → reminders.Compose
        └─ mail.SMTP.Send      Gmail (app password), Resend, Mailpit…
              ├─ ok    → ReminderSent   (clear last error)
              └─ error → ReminderFailed (restore last_sent_at, retry tomorrow)

"Unsubscribe" link ──GET/POST /api/reminders/unsubscribe?token=…──▶ enabled = false
```

Three properties drove the design:

1. **Opt-in and honest.** Off by default, sent only to your *verified* GitHub email, and trivially easy to stop.
2. **Exactly once (or retried).** A scheduler can fire twice, a function can time out halfway. Neither may double-send or silently drop someone.
3. **Boring infrastructure.** No queue, no worker, no email SDK. One table, one cron entry, the Go standard library.

### Step 1: the switch (React)

The component lives in [ReminderSettings.tsx](repo:src/features/reminders/ReminderSettings.tsx) and only renders in server mode for a signed-in user with the `emailReminders` feature flag on. Saving is **optimistic**: the UI flips immediately and rolls back if the server says no (for example "we don't have a verified email for you").

```tsx excerpt=src/features/reminders/ReminderSettings.tsx#save
```

> [!NOTE]
> Why optimistic? A switch that lags 300 ms behind your click feels broken. The server is still the authority: whatever it returns replaces local state, and an error restores the previous value.

### Step 2: where the choice lives (Postgres)

Migration [002_reminders.sql](repo:backend/store/migrations/002_reminders.sql) adds the user's email and one row per person who has ever touched the setting:

```sql excerpt=backend/store/migrations/002_reminders.sql#reminder_prefs
```

A few deliberate choices:

- **`last_sent_at` is the whole scheduling model.** "Due" means `last_sent_at` is older than the frequency's gap. No per-user cron, no job rows.
- **The gaps are a bit shorter than the nominal period** ([`ReminderGaps`](repo:backend/store/reminders.go#ReminderGaps): 20 h, 68 h, 164 h) because the cron fires "sometime within the hour". With an exact 24 h gap a run that starts two minutes early would skip you for a whole day.
- **The partial index** `WHERE enabled` keeps the daily scan tiny even if most people never switch reminders on.
- **The unsubscribe token is created once** ([`SetReminderPrefs`](repo:backend/store/reminders.go#SetReminderPrefs) only uses it on insert), so a link in an old email keeps working after you change your frequency.

The handler [`putReminders`](repo:backend/server/reminders.go#putReminders) validates the frequency, refuses to enable reminders when the feature is off or you have no verified email, and saves.

#### Where the email address comes from

Sign-in asks GitHub for the `user:email` scope ([`Scope`](repo:backend/auth/auth.go#Scope)) and keeps only the **primary, verified** address ([`primaryEmail`](repo:backend/auth/auth.go#primaryEmail)). We never ask people to type an address, so we never email an address nobody verified, and admins never see it.

### Step 3: the daily run

[vercel.json](repo:vercel.json#crons) declares one cron entry. Vercel calls the path with `Authorization: Bearer $CRON_SECRET`, which the handler checks in constant time:

```go excerpt=backend/server/reminders.go#cronReminders
```

Notice the order: **claim, then send, then confirm or release**. That is the heart of the feature.

#### Claim-then-send in one statement

```go excerpt=backend/store/reminders.go#ClaimDueReminders
```

Reading it inside out:

1. The CTE picks due people, oldest first, and **locks their rows** with `FOR UPDATE … SKIP LOCKED`. A second, overlapping run skips rows the first one holds instead of waiting for them.
2. The `UPDATE` stamps `last_sent_at = now` *before* any email goes out, so even if this function is killed mid-loop, a later run will not resend to people already claimed.
3. `RETURNING … due.previous` hands back the old timestamp. If sending fails, [`ReminderFailed`](repo:backend/store/reminders.go#ReminderFailed) puts it back, which makes the person due again tomorrow, and records the error so Settings can say "the last reminder couldn't be sent".

> [!PRINCIPAL]
> This is the outbox/lease pattern without a queue. The trade-off: an email that was *sent* but whose confirmation write failed could be sent once more the next day. We accept "at least once, rarely twice" over "maybe never", and a lost reminder is invisible while a duplicate is merely mildly annoying. With thousands of users you'd move to a queue with idempotency keys; at this scale a 50-row batch per run ([`cronBatch`](repo:backend/server/reminders.go#cronBatch)) inside a 25-second budget is plenty.

### Step 4: deciding what to say (pure Go)

[`composeReminder`](repo:backend/server/reminders.go#composeReminder) gathers the inputs (your progress document and the published rounds) and hands them to the [`reminders`](repo:backend/reminders/reminders.go) package, which does **no I/O at all**. That makes every branch unit-testable: [reminders_test.go](repo:backend/reminders/reminders_test.go) checks the progress maths, each motivational branch and that question titles are HTML-escaped.

The encouragement isn't random; it reacts to where you are:

```go excerpt=backend/reminders/reminders.go#Motivation
```

The general lines rotate by day-of-year plus user id, so a daily subscriber doesn't read the same sentence twice in a row and two colleagues don't get identical emails.

[`Compose`](repo:backend/reminders/reminders.go#Compose) renders a plain-text and an HTML part with Go's `text/template` and `html/template` (the latter escapes everything by context), and adds the **RFC 8058** headers Gmail and Yahoo expect from regular senders:

```go excerpt=backend/reminders/reminders.go#Compose
```

### Step 5: sending over plain SMTP

[mail.go](repo:backend/mail/mail.go) is ~200 lines of standard library. Why not a provider SDK? SMTP is the lowest common denominator: the same code talks to a Gmail account with an app password (what production uses), Resend, Postmark, SES, or Mailpit on your laptop (`docker compose up`). Switching providers is an environment-variable change.

```go excerpt=backend/mail/mail.go#Send
```

Security details worth noticing:

- Port 465 uses implicit TLS; anything else upgrades with **STARTTLS**, and the code **refuses to send credentials in clear text** if the server doesn't offer it.
- [`Build`](repo:backend/mail/mail.go#Build) strips CR/LF from header values, so a crafted name can't inject extra headers (tested in [`TestBuildRejectsHeaderInjection`](repo:backend/mail/mail_test.go#TestBuildRejectsHeaderInjection)).
- The whole exchange honours the context deadline, so one slow SMTP server can't eat the function's 30-second budget.

### Step 6: unsubscribe without signing in

The link in every email is `/api/reminders/unsubscribe?token=…`. A `GET` shows a confirmation page (mail scanners pre-fetch links, so a GET must never change anything); the `POST` from that page, or the one-click POST a mail provider sends, flips `enabled` off ([`Unsubscribe`](repo:backend/store/reminders.go#Unsubscribe)).

That POST is the only state-changing route exempt from the CSRF check, and the exemption is safe because the request is authorized by the unguessable token in the URL, not by a cookie a forged request could ride on:

```go excerpt=backend/server/server.go#withCSRF
```

### How it's tested

- **Pure logic:** [reminders_test.go](repo:backend/reminders/reminders_test.go) (summary, next question, motivation, escaping).
- **SMTP:** [`TestSMTPSendEndToEnd`](repo:backend/mail/mail_test.go#TestSMTPSendEndToEnd) runs a fake SMTP server in-process and checks the bytes on the wire.
- **The whole flow against real Postgres:** [`TestEmailReminders`](repo:backend/server/server_test.go#TestEmailReminders) toggles reminders, runs the cron twice (the second run must send nothing), makes a send fail and checks it's retried, and unsubscribes via the token. [`TestCronNeedsASecret`](repo:backend/server/server_test.go#TestCronNeedsASecret) makes sure nobody else can trigger the job.

### Decisions, recorded

The reasoning above is condensed from [ADR-023](repo:docs/DECISIONS.md#ADR-023) in the decision log, and the production setup (Gmail app password, `CRON_SECRET`) is in [DEPLOYMENT.md](repo:docs/DEPLOYMENT.md).

### If you're asked about this in an interview

- **"How do you make a scheduled job safe to run twice?"** Lease the work atomically (claim rows with `SKIP LOCKED` and a timestamp) and make the side effect's confirmation a separate, idempotent write.
- **"Why not a queue?"** Because one daily batch of a few dozen emails doesn't need one. Name the threshold where you'd add it (per-run volume beyond the time budget, retries with backoff, per-provider rate limits) instead of reaching for it by default.
- **"How do you keep transactional email out of spam?"** Verified sender domain (SPF/DKIM via the provider), a plain-text part, `List-Unsubscribe` + one-click POST, and only emailing people who opted in.
