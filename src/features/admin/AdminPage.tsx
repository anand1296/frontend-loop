import { useEffect, useMemo, useState } from 'react';
import { allQuestions, sections, sectionsById } from '../../content/index.ts';
import { Icon } from '../../components/Icon.tsx';
import { ProgressBar } from '../../components/primitives.tsx';
import { formatDayDistance, percent, plural } from '../../lib/format.ts';
import { getPlatform, HOSTED_URL, paths, platformStore } from '../../platform/runtime.ts';
import { parseSummary, type LearnerSummary } from '../../state/summary.ts';
import { useStore } from '../../state/useStore.ts';
import { ANNOUNCEMENT_LIMIT, announcementStore, publishAnnouncement } from '../announcement/announcement.ts';

interface LearnerRow {
  uid: string;
  summary: LearnerSummary;
}

type LoadState = { status: 'loading' } | { status: 'ready'; rows: LearnerRow[] } | { status: 'error'; message: string };

const WEEK_MS = 7 * 86_400_000;

/** Live list of every learner's summary. Only the owner's reads succeed (access rule on `learners`). */
function useLearners(): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void getPlatform().then((platform) => {
      if (cancelled) return;
      if (!platform) {
        setState({ status: 'error', message: 'The learner dashboard is available in the hosted version of the app.' });
        return;
      }
      unsubscribe = platform.db
        .collection(paths.learnersCollection)
        .orderBy('lastActiveAt', 'desc')
        .limit(1000)
        .onSnapshot(
          (snapshot) => {
            const rows: LearnerRow[] = [];
            for (const doc of snapshot.docs) {
              const summary = parseSummary(doc.data());
              if (doc.id && summary) rows.push({ uid: doc.id, summary });
            }
            setState({ status: 'ready', rows });
          },
          (error) => setState({ status: 'error', message: `Couldn't load learners (${error.code}).` }),
        );
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
  return state;
}

/** Display names for learner ids, resolved by the platform for this viewer. Never stored. */
function useProfiles(ids: string[]): Record<string, ClaudeProfile> {
  const [profiles, setProfiles] = useState<Record<string, ClaudeProfile>>({});
  const key = ids.join('|');
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void getPlatform().then(async (platform) => {
      if (!platform || cancelled) return;
      const resolved = await platform.user.profiles(key.split('|'));
      if (!cancelled) setProfiles(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return profiles;
}

function CopyLink() {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'select'>('idle');
  return (
    <div className="copy-link">
      <input id="invite-link" readOnly value={HOSTED_URL} aria-label="Link to this app" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(HOSTED_URL);
            setCopied('copied');
          } catch {
            document.querySelector<HTMLInputElement>('#invite-link')?.select();
            setCopied('select');
          }
        }}
      >
        <Icon name="link" size={16} />
        {copied === 'copied' ? 'Copied' : copied === 'select' ? 'Press Ctrl+C' : 'Copy link'}
      </button>
    </div>
  );
}

function InvitePanel() {
  return (
    <section className="admin-card" aria-labelledby="invite-heading">
      <h2 id="invite-heading" className="admin-card-title">
        <Icon name="users" /> Invite people
      </h2>
      <ol className="steps">
        <li>
          Open the <strong>Share</strong> menu at the top of this page in claude.ai.
        </li>
        <li>Add people by name or email, or turn on access for your whole organization.</li>
        <li>
          Give learners <strong>Contributor</strong> access. Then send them the link below; they sign in to claude.ai to open
          it.
        </li>
      </ol>
      <CopyLink />
      <div className="table-wrap">
        <table className="access-table">
          <thead>
            <tr>
              <th>Access level</th>
              <th>Studies</th>
              <th>Progress follows them across devices</th>
              <th>Shows up in your dashboard</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Contributor</strong> (recommended)
              </td>
              <td>Yes</td>
              <td>Yes</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Viewer or Commenter</td>
              <td>Yes</td>
              <td>No, saved in their browser</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Editor</td>
              <td>Yes</td>
              <td>Yes</td>
              <td>Yes, but can also publish new versions of the page. Give it only to co-maintainers.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="admin-note">
        The page can't send invitations itself; sharing always goes through claude.ai, which checks who may open the link.
        People invited by email from outside your organization get view-only access unless you make them Editors, so their
        progress stays in their own browser. Only you, the owner, can see this Admin page and the learner dashboard, even
        if you make someone an Editor.
      </p>
    </section>
  );
}

function AnnouncementEditor() {
  const current = useStore(announcementStore, (a) => a);
  const [draft, setDraft] = useState(current?.message ?? '');
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' });

  const save = async (message: string) => {
    setStatus({ kind: 'saving' });
    try {
      await publishAnnouncement(message);
      setStatus({ kind: 'saved', text: message.trim() ? 'Announcement published to everyone.' : 'Announcement cleared.' });
      if (!message.trim()) setDraft('');
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save the announcement.' });
    }
  };

  return (
    <section className="admin-card" aria-labelledby="announce-heading">
      <h2 id="announce-heading" className="admin-card-title">
        <Icon name="megaphone" /> Announcement
      </h2>
      <p className="admin-note">Shown as a banner at the top of the app for everyone until they dismiss it.</p>
      <label htmlFor="announcement-text" className="sr-only">
        Announcement text
      </label>
      <textarea
        id="announcement-text"
        rows={3}
        maxLength={ANNOUNCEMENT_LIMIT}
        value={draft}
        placeholder="e.g. Mock interview session on Saturday 10:00 IST. Finish the System Design round before then."
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="button-row">
        <button type="button" className="btn btn-primary" disabled={status.kind === 'saving' || !draft.trim()} onClick={() => void save(draft)}>
          Publish announcement
        </button>
        {current ? (
          <button type="button" className="btn btn-quiet" disabled={status.kind === 'saving'} onClick={() => void save('')}>
            Clear current
          </button>
        ) : null}
        <span className="notes-count">
          {draft.length} / {ANNOUNCEMENT_LIMIT}
        </span>
      </div>
      {status.text ? (
        <p className={status.kind === 'error' ? 'settings-message is-error' : 'settings-message'} role="status">
          {status.text}
        </p>
      ) : null}
    </section>
  );
}

function LearnersPanel({ state, myUid }: { state: LoadState; myUid: string | null }) {
  const rows = state.status === 'ready' ? state.rows : [];
  const profiles = useProfiles(rows.map((row) => row.uid));
  const [now] = useState(() => Date.now());
  const total = allQuestions.length;

  const stats = useMemo(() => {
    const learners = rows.length;
    const active = rows.filter((row) => now - row.summary.lastActiveAt < WEEK_MS).length;
    const avg = learners === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + percent(row.summary.doneCount, total), 0) / learners);
    const done = rows.reduce((sum, row) => sum + row.summary.doneCount, 0);
    return { learners, active, avg, done };
  }, [rows, now, total]);

  return (
    <section className="admin-card admin-learners" aria-labelledby="learners-heading">
      <h2 id="learners-heading" className="admin-card-title">
        <Icon name="shield" /> Learners
      </h2>
      <dl className="admin-stats">
        <div>
          <dt>Learners</dt>
          <dd className="tabular">{stats.learners}</dd>
        </div>
        <div>
          <dt>Active this week</dt>
          <dd className="tabular">{stats.active}</dd>
        </div>
        <div>
          <dt>Average completion</dt>
          <dd className="tabular">{stats.avg}%</dd>
        </div>
        <div>
          <dt>Answers ticked</dt>
          <dd className="tabular">{stats.done}</dd>
        </div>
      </dl>

      {state.status === 'loading' ? <p className="admin-note">Loading learners…</p> : null}
      {state.status === 'error' ? (
        <p className="admin-note" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === 'ready' && rows.length === 0 ? (
        <div className="empty">
          <p>Nobody has opened the app with Contributor access yet. Invite people below; they appear here as soon as they open it.</p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="learners-table">
            <thead>
              <tr>
                <th scope="col">Learner</th>
                <th scope="col">Progress</th>
                <th scope="col">Rounds finished</th>
                <th scope="col">Last active</th>
                <th scope="col">Studying</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ uid, summary }) => {
                const profile = profiles[uid];
                const name = profile?.name || 'Someone';
                const finished = sections.filter((s) => (summary.byRound[s.id] ?? 0) >= s.questions.length).length;
                return (
                  <tr key={uid}>
                    <td>
                      <span className="learner">
                        {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" width={24} height={24} /> : null}
                        <span>
                          {name}
                          {uid === myUid ? <span className="you"> (you)</span> : null}
                          {profile?.guest ? <span className="you"> · guest</span> : null}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="learner-progress">
                        <ProgressBar value={summary.doneCount} max={total} label={`${name} progress`} />
                        <span className="tabular">
                          {summary.doneCount}/{total}
                        </span>
                      </span>
                    </td>
                    <td className="tabular">
                      {finished}/{sections.length}
                    </td>
                    <td>{summary.lastActiveAt ? formatDayDistance(summary.lastActiveAt, now) : 'not yet'}</td>
                    <td>{summary.lastSectionId ? sectionsById.get(summary.lastSectionId)?.title ?? '—' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="admin-note">
        Learners share only this summary with you. Their notes and review schedules stay private to them.
      </p>
    </section>
  );
}

export function AdminPage() {
  const { role, uid } = useStore(platformStore, (p) => p);
  const learners = useLearners();

  if (role === 'unknown') {
    return (
      <article className="page">
        <p className="admin-note">Checking your access…</p>
      </article>
    );
  }

  if (role !== 'owner') {
    return (
      <article className="page">
        <header className="page-header">
          <p className="eyebrow">Admin</p>
          <h1>Only the owner can open this page</h1>
          <p className="lede">
            {role === 'local'
              ? 'Admin features are available when the app is opened from its hosted claude.ai link.'
              : 'Ask the person who shared this app with you if you need anything changed.'}
          </p>
        </header>
      </article>
    );
  }

  return (
    <article className="page admin-page">
      <header className="page-header">
        <p className="eyebrow">Super admin · visible only to you</p>
        <h1>Admin</h1>
        <p className="lede">
          See how everyone is progressing, post an announcement, and invite people. You have {plural(sections.length, 'round')} and{' '}
          {plural(allQuestions.length, 'question')} published.
        </p>
      </header>
      <LearnersPanel state={learners} myUid={uid} />
      <InvitePanel />
      <AnnouncementEditor />
    </article>
  );
}
