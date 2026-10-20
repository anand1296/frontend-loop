# Admin guide: roles, invites, content and features

There are two ways the app can be hosted, and admin works differently in each:

- **With the Go backend** (Vercel + Neon, Docker): full admin console, described first.
- **As a claude.ai Artifact** (no backend): owner dashboard and announcements through claude.ai's storage and sharing, described at the end.

---

## Part 1: With the Go backend

### Roles

| Role | Who | Can do |
| --- | --- | --- |
| **Owner** (super admin) | The GitHub account in `OWNER_GITHUB_LOGIN` (`anand1296`) | Everything below, plus: change anyone's role, manage admins, invite admins, site settings (name, headline, registration, content access). Can't be disabled or demoted from the app. |
| **Admin** | People the owner promotes or invites as admin | All content editing, learner dashboard, learner invites, disable/remove learners, feature flags, announcements, activity log |
| **Learner** | Invited people (or anyone, if registration is open) | Study with progress synced across devices; delete their own account |
| Anonymous | Not signed in | Sees only the sign-in screen (default, members-only). If the owner makes content public: study with progress in the browser |

Full matrix: docs/SPEC.md §2.5.

### Inviting people

Admin → **Invites** → choose *who it's for* (a note only admins see), *joins as* (learner; admin if you're the owner), *can be used* (once, or 5/25/100 times for a group link) and *expires after* → **Create invite link** → copy and send it. The owner can copy the link again any time from the *Invite links* table (**Copy link**); invites created before this change (migration 004) only keep a fingerprint, so their link can't be shown.

- The link is shown **once**; the server stores only a fingerprint (hash). Lost it? Revoke it and create another.
- The person opens the link, sees who invited them, and signs in with GitHub. Their account is created with the invite's role.
- Returning users never need a link again.
- **Registration** (owner, Features & settings → Site & access): *Only people with an invite link* (default) or *Anyone with a GitHub account*.
- **Content access**: *Signed-in members only* (default: visitors land on the sign-in screen) or *Everyone* (sign-in only syncs progress).

### Your super admin "credentials"

There is no admin password. You are the super admin because you sign in with the GitHub account named in `OWNER_GITHUB_LOGIN` (`anand1296`). Protect that GitHub account (2FA) and you've protected the app. To hand ownership to someone else, change the variable and redeploy; you become an admin.

### Managing content (no code, no deploy)

Admin → **Content**.

- **Rounds:** *New round* (title; id is derived and permanent; description). Select a round to edit its title and description, publish/hide it, export it as Markdown, view it in the app, reorder with the arrows, or delete it (its questions go to Trash).
- **Questions:** *New question* opens the editor:
  - Question title (backticks render as code), permanent id (derived from the title), round, level, study minutes, tags.
  - The answer in Markdown with **Write / Side by side / Preview**. The preview is rendered by the server, exactly as learners will see it, and lists every problem.
  - *Insert…* adds callouts, code blocks and tables at the cursor. *Markdown help* summarizes the rules.
  - **Draft** vs **Published** switch. Drafts can be incomplete and are visible only to admins (marked "Draft" in the app). Publishing requires a `> [!TLDR]` callout and at least 200 characters.
  - **Save** (or Ctrl/⌘+S). If someone else saved since you opened it, you'll be told and can load their version.
  - **History**: every previous version; *Load into editor* then Save to restore it.
- **Trash:** deleted questions; *Restore as draft*.
- **Sync from repository:** compares the database with the `content/*.md` files deployed with this version. *Add what's missing* imports new rounds/questions committed to git. *Overwrite changed…* replaces edited questions with the repository version (history kept). Questions created in the console are never touched.
- **Export all (.zip):** every published round as `content/NN-id.md`, ready to commit to the repository.

Every change is live for everyone immediately and recorded in **Activity**.

#### Two ways to manage content: pick one as the source of truth

| | Console-first | Git-first |
| --- | --- | --- |
| Edit in | the admin console | `content/*.md` in the repo (PR review) |
| Get changes into the other | *Export all* → commit | push → deploy → *Sync from repository* |
| Best for | quick edits, non-engineers, drafts | review workflow, bulk changes |

### Learners

Admin → **Learners**: everyone with role, progress (% and done/total), rounds finished, reviews due, last active and current round. The owner can change roles; admins can disable/enable and remove learners; the owner can also manage admins. Disabling someone signs them out everywhere.

Privacy: admins see this summary only. Notes, review dates and per-question history are never sent to admins. Learners are told this in Settings, and can delete their account there.

### Community submissions

Members can propose questions from their own interviews (sidebar → **Behind the scenes → Contribute**). You get an email for each one, and a count badge appears on **Admin** and on the **Submissions** tab.

Admin → **Submissions** → **Review**:

1. Read the interview context (only reviewers see it) and the live preview.
2. Edit anything: wording, round, level, minutes, tags, the answer. Choose the **permanent id**. If they suggested a new round, create it in **Content** first, or pick an existing one.
3. Choose **Publish now** or **Add as draft**, optionally write a note to the author, then **Approve and add**. The question is created and the submission closed in one step; the author is credited (if they asked) and emailed.
4. Or **Reject** with a short note; the author is emailed and sees the note on their Contribute page.

Nothing a member submits is visible to anyone else until you approve it. Each person can send 5 a day and have 10 waiting. To pause submissions, switch off **Contribute** in Features & settings.

### Pull requests on GitHub (repository rules)

The repository ships `CODEOWNERS` (you own every file), `CONTRIBUTING.md`, PR and issue templates, a code of conduct and `SECURITY.md`. GitHub only enforces "nobody merges without my approval" once these settings are on (one time, in the repository on github.com):

1. **Settings → Branches → Add branch protection rule** (or *Rules → Rulesets → New branch ruleset* targeting `main`), branch name pattern `main`:
   - **Require a pull request before merging** → *Require approvals: 1* → **Dismiss stale pull request approvals when new commits are pushed** → **Require review from Code Owners** → **Require approval of the most recent reviewable push**.
   - **Require status checks to pass before merging** → *Require branches to be up to date* → add `web`, `go`, `e2e-server` (they appear after CI has run once on a PR).
   - **Require conversation resolution before merging**.
   - Leave **Allow force pushes** and **Allow deletions** off.
   - Leave *Do not allow bypassing the above settings* **off** if you want to keep merging your own PRs without a second reviewer (GitHub doesn't let you approve your own PR); turn it on for the strictest setup.
2. **Settings → Actions → General → Fork pull request workflows from outside collaborators** → **Require approval for all outside collaborators**, and **Workflow permissions** → *Read repository contents permission*.
3. **Settings → General → Pull Requests** → tick **Automatically delete head branches**.
4. **Settings → Security → Private vulnerability reporting** → **Enable** (SECURITY.md points there).
5. Optional: add a `LICENSE` file so others know how they may use the code (without one, the code is "all rights reserved" by default).

### Features and settings

Admin → **Features & settings**:

- **Announcement:** message, tone (info, good news, heads-up), optional link (`https://…` or `#round-id`). Shown at the top of the app until each person dismisses it. *Clear current* removes it.
- **Features:** switch built-in features on or off for everyone, instantly: Spaced review, Search, Personal notes, Round filters, Export and import, Level breakdown, Email reminders, How it's built, Contribute.
- **Email reminders** are opt-in per person (Settings → Email reminders, default off; daily, every 3 days or weekly). Turning the feature off here stops all reminder emails. Sending needs the SMTP settings and `CRON_SECRET` (docs/DEPLOYMENT.md §1.7). You never see people's email addresses.
- **Site & access** (owner): app name, overview headline, registration, content access.

### Changing or adding features themselves

Switching features is a setting. **Building a new feature is a code change**, and that is deliberate (ADR-019):

1. Change the code (or ask Claude to) on a branch; CI runs every test.
2. Merge to `main`; Vercel deploys in about a minute. Database migrations, if any, run automatically.
3. Ship new features behind a new flag that defaults to off, then switch it on from the console when ready.

### Where it lives in code

| Area | Files |
| --- | --- |
| Roles, sign-in, invites, sessions | `backend/store/users.go`, `backend/server/session.go`, `backend/auth/` |
| Content management | `backend/store/content.go`, `backend/server/admin.go`, `backend/catalog/`, `backend/markdown/` |
| Settings and flags | `backend/server/settings.go` |
| Console UI | `src/features/console/` (`ContentTab`, `QuestionEditor`, `SubmissionsTab`, `PeopleTab`, `InvitesTab`, `SettingsTab`, `ActivityTab`) |
| Community submissions | `backend/store/submissions.go`, `backend/server/submissions.go`, `src/features/contribute/` |
| How it's built | `walkthroughs/*.md`, `build/walkthroughs/compile.ts`, `src/features/howItsBuilt/` |
| Sign-in UI | `src/features/account/Account.tsx`, `src/platform/backend.ts`, `src/platform/launch.ts` |
| Tests | `backend/server/server_test.go` (every rule above), `e2e/server.spec.ts` |

---

## Part 2: As a claude.ai Artifact

The single-file build hosted as a claude.ai Artifact has no backend. claude.ai handles sign-in and sharing; the app adds an owner dashboard and announcements on top, enforced by storage access rules declared at publish time.

| Role | Who | Can do |
| --- | --- | --- |
| **Super admin** | The artifact's owner | Admin page: live learner dashboard, announcements, invite instructions |
| **Learner (synced)** | Shared with **Contributor** access (or Editor) | Progress, notes and review dates sync across devices; a summary appears on the dashboard |
| **Learner (browser-only)** | Viewer/Commenter, or outside-org guests (unless Editor) | Study; progress stays in their browser |

**Inviting:** Share menu in claude.ai → add people or your organization → Contributor → send the link (the Admin page has a copy button). The page itself can't send invitations.

**Data and rules:**

| Path | Contents | Read | Write |
| --- | --- | --- | --- |
| `data/users/<uid>/progress` | Full progress (private) | that user only | that user (Contributor+) |
| `learners/<uid>` | Progress summary | owner, and that user | that user (Contributor+), owner |
| `config/announcement` | Announcement banner | everyone who can open the page | owner only |

```json
{
  "db": {
    "rules": [
      { "path": "learners", "read": "owner", "write": "owner" },
      { "path": "learners/{self}", "read": "interact", "write": "interact" },
      { "path": "config", "read": "view", "write": "owner" }
    ]
  },
  "user": { "scopes": ["profile"] }
}
```

Code: `src/platform/runtime.ts`, `src/state/summary.ts`, `src/state/persistence/cloudSync.ts` (`syncWithRemote`, `syncSummary`), `src/features/admin/AdminPage.tsx`, `src/features/announcement/*`, `e2e/admin.spec.ts`.
