/**
 * Contribute: two ways to make this app better.
 *
 * 1. Share a question from a real interview. Signed-in people submit it here;
 *    it waits for the owner's review (Admin → Submissions) and only reaches
 *    other learners once approved. Without a backend (static builds) the same
 *    path is a GitHub issue form.
 * 2. Improve the code with a pull request. The repository requires the
 *    owner's approval (CODEOWNERS + branch protection) and green CI to merge.
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { repoUrl } from 'virtual:walkthroughs';
import { Icon } from '../../components/Icon.tsx';
import { useContent } from '../../content/index.ts';
import { LEVELS, LEVEL_LABEL, type Level } from '../../content/types.ts';
import { api, ApiError } from '../../platform/api.ts';
import { useServer } from '../../platform/backend.ts';
import { navigate } from '../../state/route.ts';
import type { Submission, SubmissionInput } from '../console/consoleApi.ts';

const TEMPLATE = `> [!TLDR]
> The answer you'd give in the first 60 seconds: the core idea, the key trade-off, one concrete detail.

### How it works

Explain the mental model.

### Trade-offs and follow-ups

- **"What if …?"** A short, strong answer.
`;

const NEW_ROUND = '__new__';

const STATUS_COPY: Record<Submission['status'], string> = {
  pending: 'Waiting for review',
  approved: 'Added',
  rejected: 'Not added',
  withdrawn: 'Withdrawn',
};

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.';
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function ContributePage() {
  const server = useServer();
  const canSubmit = server.mode === 'server' && server.user !== null;
  const [writing, setWriting] = useState(false);
  const [mine, setMine] = useState<Submission[] | null>(null);

  const loadMine = useCallback(async () => {
    if (!canSubmit) return;
    try {
      setMine(await api<Submission[]>('/me/submissions'));
    } catch {
      setMine([]);
    }
  }, [canSubmit]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  return (
    <article className="page contrib-page">
      <header className="page-header">
        <p className="eyebrow">Behind the scenes</p>
        <h1>Contribute</h1>
        <p className="lede">
          This bank gets better every time someone shares what they were actually asked, or fixes something that bugged them.
          Every contribution is reviewed by the owner before it goes live, so jump in.
        </p>
      </header>

      <div className="contrib-paths">
        <section className="contrib-card" aria-labelledby="contrib-question">
          <h2 id="contrib-question">
            <Icon name="note" /> Share an interview question
          </h2>
          <p>
            Asked something memorable in a senior, lead or principal loop? Write it up with the answer you'd give. It goes to the
            owner for review and, once approved, into the bank for everyone, credited to your GitHub handle if you like.
          </p>
          <div className="button-row">
            {canSubmit ? (
              server.features.contribute ? (
                <button type="button" className="btn btn-primary" aria-expanded={writing} onClick={() => setWriting((v) => !v)}>
                  {writing ? 'Close the form' : 'Write a question'}
                </button>
              ) : (
                <p className="admin-note">Question submissions are paused right now.</p>
              )
            ) : (
              <a className="btn btn-primary" href={`${repoUrl}/issues/new?template=question.yml`} target="_blank" rel="noopener noreferrer">
                Propose it on GitHub
              </a>
            )}
          </div>
        </section>

        <section className="contrib-card" aria-labelledby="contrib-code">
          <h2 id="contrib-code">
            <Icon name="pullRequest" /> Improve the app
          </h2>
          <ol>
            <li>Fork the repository and create a branch.</li>
            <li>
              Make the change; run <code>npm run check</code> (and <code>go test ./...</code> for backend changes).
            </li>
            <li>Open a pull request against <code>main</code> using the template.</li>
            <li>CI runs, and the owner reviews. Nothing merges without their approval.</li>
          </ol>
          <div className="button-row">
            <a className="btn" href={`${repoUrl}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noopener noreferrer">
              Read the guide <Icon name="external" size={14} />
            </a>
            <a className="btn btn-quiet" href={`${repoUrl}/issues`} target="_blank" rel="noopener noreferrer">
              Open issues
            </a>
            <button type="button" className="btn btn-quiet" onClick={() => navigate({ name: 'howItsBuilt', walkthroughId: null })}>
              How it's built
            </button>
          </div>
        </section>
      </div>

      {canSubmit && writing ? (
        <QuestionForm
          onSubmitted={async () => {
            setWriting(false);
            await loadMine();
          }}
        />
      ) : null}

      {canSubmit && mine && mine.length > 0 ? <MySubmissions items={mine} onChange={loadMine} /> : null}
    </article>
  );
}

function QuestionForm({ onSubmitted }: { onSubmitted: () => Promise<void> }) {
  const { sections } = useContent();
  const formId = useId();
  const [round, setRound] = useState(sections[0]?.id ?? NEW_ROUND);
  const [newRound, setNewRound] = useState('');
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState<Level>('senior');
  const [minutes, setMinutes] = useState(10);
  const [tags, setTags] = useState('');
  const [body, setBody] = useState(TEMPLATE);
  const [context, setContext] = useState('');
  const [credit, setCredit] = useState(true);
  const [preview, setPreview] = useState<{ html: string; problems: Array<{ field: string; message: string }> } | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const input = (): SubmissionInput => ({
    sectionId: round === NEW_ROUND ? '' : round,
    newSectionTitle: round === NEW_ROUND ? newRound : '',
    title,
    level,
    minutes,
    tags: tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    body,
    context,
    credit,
  });

  const showPreview = async (): Promise<void> => {
    setStatus(null);
    try {
      setPreview(await api('/submissions/preview', { method: 'POST', body: input() }));
    } catch (error) {
      setStatus({ kind: 'error', text: message(error) });
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setProblems({});
    try {
      await api('/submissions', { method: 'POST', body: input() });
      setStatus({ kind: 'ok', text: 'Sent for review. You’ll get an email when it has been reviewed.' });
      await onSubmitted();
    } catch (error) {
      if (error instanceof ApiError && error.problems.length > 0) {
        setProblems(Object.fromEntries(error.problems.map((p) => [p.field, p.message])));
      }
      setStatus({ kind: 'error', text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (field: string) => (problems[field] ? <span className="field-error">{problems[field]}</span> : null);

  return (
    <form className="contrib-card contrib-form" onSubmit={(event) => void submit(event)} aria-label="Submit a question">
      <h2>
        <Icon name="note" /> Your question
      </h2>
      <p>
        Write it the way the interviewer asked it, then the answer you'd give. Keep out anything confidential (no company
        secrets, no NDA material, no names).
      </p>

      <div className="form-grid">
        <label htmlFor={`${formId}-title`} className="span-2">
          Question
          <input id={`${formId}-title`} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How would you design an offline-first editor?" aria-invalid={Boolean(problems.title)} />
          {fieldError('title')}
        </label>
        <label htmlFor={`${formId}-round`}>
          Round
          <select id={`${formId}-round`} value={round} onChange={(e) => setRound(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
            <option value={NEW_ROUND}>Suggest a new round…</option>
          </select>
          {fieldError('sectionId')}
        </label>
        {round === NEW_ROUND ? (
          <label htmlFor={`${formId}-newround`}>
            New round name
            <input id={`${formId}-newround`} required maxLength={120} value={newRound} onChange={(e) => setNewRound(e.target.value)} aria-invalid={Boolean(problems.newSectionTitle)} />
            {fieldError('newSectionTitle')}
          </label>
        ) : null}
        <label htmlFor={`${formId}-level`}>
          Level
          <select id={`${formId}-level`} value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${formId}-minutes`}>
          Study minutes
          <input id={`${formId}-minutes`} type="number" min={1} max={120} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          {fieldError('minutes')}
        </label>
        <label htmlFor={`${formId}-tags`} className="span-2">
          Tags <span className="you">(comma-separated)</span>
          <input id={`${formId}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="system design, offline, sync" aria-invalid={Boolean(problems.tags)} />
          {fieldError('tags')}
        </label>
        <label htmlFor={`${formId}-body`} className="span-2">
          Your answer <span className="you">(Markdown; start with the &gt; [!TLDR] callout, use ### for headings)</span>
          <textarea id={`${formId}-body`} className="body-input" value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={Boolean(problems.body)} />
          {fieldError('body')}
        </label>
        <label htmlFor={`${formId}-context`} className="span-2">
          Interview context <span className="you">(optional, only the reviewer sees it: kind of company, level, round)</span>
          <textarea id={`${formId}-context`} rows={3} maxLength={1000} value={context} onChange={(e) => setContext(e.target.value)} />
          {fieldError('context')}
        </label>
      </div>

      <label className="switch-inline" htmlFor={`${formId}-credit`}>
        <input id={`${formId}-credit`} type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} />
        Credit me on the question (shows your GitHub handle)
      </label>

      {preview ? (
        <div className="contrib-preview">
          {preview.problems.length > 0 ? (
            <ul className="problem-list" aria-label="Problems">
              {preview.problems.map((p, i) => (
                <li key={`${p.field}-${i}`}>
                  <strong>{p.field}</strong>: {p.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-message">Looks good: this would pass review checks.</p>
          )}
          {/* Server-rendered, sanitized HTML (backend/markdown escapes raw HTML and unsafe links). */}
          <div className="prose" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      ) : null}

      {status ? (
        <p className={status.kind === 'error' ? 'settings-message is-error' : 'settings-message'} role={status.kind === 'error' ? 'alert' : 'status'}>
          {status.text}
        </p>
      ) : null}

      <div className="button-row">
        <button type="button" className="btn" onClick={() => void showPreview()}>
          Preview
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send for review'}
        </button>
      </div>
    </form>
  );
}

function MySubmissions({ items, onChange }: { items: Submission[]; onChange: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const withdraw = async (id: number): Promise<void> => {
    if (!window.confirm('Withdraw this submission?')) return;
    try {
      await api(`/me/submissions/${id}`, { method: 'DELETE' });
      await onChange();
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <section aria-labelledby="mine-heading">
      <h2 id="mine-heading" className="section-heading">
        Your submissions
      </h2>
      {error ? (
        <p className="settings-message is-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="contrib-list">
        {items.map((sub) => (
          <li key={sub.id}>
            <span className="contrib-title">
              {sub.title}
              <span className="contrib-sub">
                {LEVEL_LABEL[sub.level]} · sent {dateFormat.format(new Date(sub.createdAt))}
              </span>
            </span>
            <span className="status-chip" data-status={sub.status}>
              {STATUS_COPY[sub.status]}
            </span>
            {sub.status === 'pending' ? (
              <button type="button" className="btn btn-quiet" onClick={() => void withdraw(sub.id)}>
                Withdraw
              </button>
            ) : null}
            {sub.status === 'approved' && sub.questionId ? (
              <a className="btn btn-quiet" href={`#${sub.questionId}`}>
                Open it
              </a>
            ) : null}
            {sub.reviewNote ? <p className="contrib-note">Reviewer’s note: {sub.reviewNote}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
