# Admin, roles and inviting people

Frontend Loop is hosted as a claude.ai Artifact. claude.ai handles sign-in and sharing; the app adds roles, a learner dashboard and announcements on top, enforced by database access rules declared at publish time (not just hidden in the UI).

## Roles

| Role | Who | Can do |
| --- | --- | --- |
| **Super admin** | The artifact's owner (you) | Everything learners can, plus the **Admin** page: live learner dashboard, announcements, invite instructions |
| **Learner (synced)** | Shared with **Contributor** access (or Editor) | Study; progress, notes and review dates sync across their devices; a progress summary appears on your dashboard |
| **Learner (browser-only)** | Shared as **Viewer/Commenter**, or outside-org guests invited by email (unless Editor) | Study; progress stays in their browser; they don't appear on your dashboard |

Editors (co-maintainers) can publish new page versions but still **cannot** see the dashboard or change announcements: those rules check for the owner specifically.

## Inviting people

1. Open the artifact in claude.ai and use the **Share** menu at the top.
2. Add people by name or email, or enable access for your organization.
3. Choose **Contributor** for learners.
4. Send them the link (the Admin page has a copy button). They sign in to claude.ai to open it.

The page itself can't send invitations or change sharing; that is deliberately reserved to claude.ai's Share menu.

## What you can see about learners

Each learner's app writes a **summary** only: questions done per round, total, last active time, and the round they were last in. Their full progress (per-question state, notes, review dates) lives in a per-user private document that nobody else can read, including you. Learners are told this in Settings.

## Data model and access rules

| Path | Contents | Read | Write |
| --- | --- | --- | --- |
| `data/users/<uid>/progress` | Full progress (private) | that user only | that user (Contributor+) |
| `learners/<uid>` | Progress summary | owner, and that user | that user (Contributor+), owner |
| `config/announcement` | Announcement banner | everyone who can open the page | owner only |

Declared at publish:

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

`data/users/{self}` privacy is the platform default. The `profile` scope lets the dashboard show names and avatars; the app stores only opaque user ids, never names.

Verified after publishing: as the owner, the `learners` collection is readable; at Editor (`admin`) level it reads as empty, and writing `config/announcement` is refused.

## Where it lives in code

| File | Role |
| --- | --- |
| `src/platform/runtime.ts` | Connects once to `window.claude`, exposes role (`owner` / `learner` / `local`) and document paths |
| `src/state/summary.ts` | Computes and validates the shared summary (derived from progress only, so no write churn) |
| `src/state/persistence/cloudSync.ts` | `syncWithRemote` (private progress) and `syncSummary` (dashboard row); `readonly` status for view-only access |
| `src/features/admin/AdminPage.tsx` | Dashboard, invite panel, announcement editor (owner only) |
| `src/features/announcement/*` | Announcement store, banner, owner publish |
| `e2e/admin.spec.ts` | Owner, learner and viewer flows against an in-memory runtime that enforces the same rules |

## Running outside claude.ai

On Vercel/Netlify/localhost there is no `window.claude`: the app runs local-only, the Admin entry is hidden, and `#admin` explains that admin features need the hosted version. To get multi-user admin on your own hosting, implement the same three documents on a backend with auth (Supabase/Firebase); the `RemoteDoc`/`WritableDoc` interfaces in `cloudSync.ts` are the seam.
