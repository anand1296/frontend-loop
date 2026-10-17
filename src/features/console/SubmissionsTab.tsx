/**
 * Community submissions: questions people sent from their own interviews.
 *
 * Nothing a learner submits reaches anyone else until an admin approves it
 * here. Approving creates a real question in one transaction (the reviewer can
 * fix the wording, pick the round, set the id, or keep it as a draft); the
 * submitter is credited if they asked to be and gets an email either way.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { LEVELS, LEVEL_LABEL, type Level } from '../../content/types.ts';
import { ApiError } from '../../platform/api.ts';
import { refreshBootstrap } from '../../platform/backend.ts';
import { consoleApi, type AdminContent, type Preview, type QuestionInput, type Submission, type SubmissionStatus } from './consoleApi.ts';
import { Card, errorMessage, formatDate, LoadState, slugify, useAction, useAsync, type Flash, FlashLine } from './shared.tsx';

type Filter = SubmissionStatus | 'all';

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Not added',
  withdrawn: 'Withdrawn',
};

export function SubmissionsTab() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [selected, setSelected] = useState<Submission | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const load = useCallback(() => consoleApi.submissions(filter), [filter]);
  const list = useAsync(load);
  const content = useAsync(consoleApi.content);

  const done = async (message: string): Promise<void> => {
    setSelected(null);
    setFlash({ kind: 'ok', text: message });
    await Promise.all([list.reload(), content.reload(), refreshBootstrap()]);
  };

  if (selected && content.status === 'ready') {
    return <Review key={selected.id} submission={selected} content={content.data} onClose={() => setSelected(null)} onDone={done} />;
  }

  return (
    <Card
      title="Community submissions"
      icon={<Icon name="users" />}
      actions={
        <div className="segmented" role="radiogroup" aria-label="Show">
          {(['pending', 'all'] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={filter === value} onClick={() => setFilter(value)}>
              {value === 'pending' ? 'Waiting for review' : 'All'}
            </button>
          ))}
        </div>
      }
    >
      <p className="admin-note">
        Questions people sent from their own interviews. Nothing here is visible to anyone else until you approve it. Approving
        adds it to the bank (you can edit it first); rejecting sends the person your note.
      </p>
      <FlashLine flash={flash} />
      <LoadState state={list}>
        {(subs) =>
          subs.length === 0 ? (
            <p className="admin-note">{filter === 'pending' ? 'Nothing waiting. 🎉' : 'No submissions yet.'}</p>
          ) : (
            <ul className="contrib-list">
              {subs.map((sub) => (
                <li key={sub.id}>
                  <span className="contrib-title">
                    {sub.title}
                    <span className="contrib-sub">
                      @{sub.submitter} · {LEVEL_LABEL[sub.level]} · {sub.newSectionTitle ? `new round: ${sub.newSectionTitle}` : sub.sectionId} ·{' '}
                      {formatDate(sub.createdAt)}
                    </span>
                  </span>
                  <span className="status-chip" data-status={sub.status}>
                    {STATUS_LABEL[sub.status]}
                  </span>
                  {sub.status === 'pending' ? (
                    <button type="button" className="btn btn-primary" onClick={() => setSelected(sub)} disabled={content.status !== 'ready'}>
                      Review
                    </button>
                  ) : sub.questionId ? (
                    <a className="btn btn-quiet" href={`#${sub.questionId}`}>
                      View
                    </a>
                  ) : null}
                  {sub.reviewNote ? <p className="contrib-note">Note: {sub.reviewNote}</p> : null}
                </li>
              ))}
            </ul>
          )
        }
      </LoadState>
    </Card>
  );
}

function Review({
  submission,
  content,
  onClose,
  onDone,
}: {
  submission: Submission;
  content: AdminContent;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const formId = useId();
  const sections = content.sections;
  const [form, setForm] = useState<QuestionInput>(() => ({
    id: slugify(submission.title),
    sectionId: submission.sectionId || sections[0]?.id || '',
    title: submission.title,
    level: submission.level,
    tags: submission.tags,
    minutes: submission.minutes,
    body: submission.body,
    published: true,
  }));
  const [tagsText, setTagsText] = useState(submission.tags.join(', '));
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const { busy, flash, setFlash, run } = useAction();

  const input = useMemo<QuestionInput>(
    () => ({
      ...form,
      tags: tagsText
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    }),
    [form, tagsText],
  );
  const taken = useMemo(
    () => new Set([...sections.map((s) => s.id), ...sections.flatMap((s) => s.questions.map((q) => q.id))]),
    [sections],
  );
  const update = (patch: Partial<QuestionInput>): void => setForm((prev) => ({ ...prev, ...patch }));

  // Live preview with the server renderer (what learners will see).
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      consoleApi.preview(input, controller.signal).then(setPreview, () => undefined);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input]);

  const approve = async (): Promise<void> => {
    setProblems({});
    try {
      await consoleApi.approveSubmission(submission.id, input, note);
      await onDone(`Added “${input.title}”${input.published ? ' and published it' : ' as a draft'}. @${submission.submitter} has been told.`);
    } catch (error) {
      if (error instanceof ApiError && error.problems.length > 0) {
        setProblems(Object.fromEntries(error.problems.map((p) => [p.field, p.message])));
      }
      setFlash({ kind: 'error', text: errorMessage(error) });
    }
  };

  const reject = async (): Promise<void> => {
    if (!note.trim() && !window.confirm('Reject without a note? A short reason helps the contributor.')) return;
    const ok = await run(() => consoleApi.rejectSubmission(submission.id, note));
    if (ok) await onDone(`Rejected “${submission.title}”. @${submission.submitter} has been told.`);
  };

  const fieldError = (field: string) => (problems[field] ? <span className="field-error">{problems[field]}</span> : null);

  return (
    <section className="admin-card editor" aria-label={`Review ${submission.title}`}>
      <div className="card-head">
        <h2 className="admin-card-title">
          <Icon name="users" />
          Review submission
        </h2>
        <div className="card-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            <Icon name="close" size={16} /> Back to list
          </button>
        </div>
      </div>

      <p className="admin-note">
        From <strong>@{submission.submitter}</strong>
        {submission.submitterName ? ` (${submission.submitterName})` : ''} on {formatDate(submission.createdAt)}.{' '}
        {submission.credit ? 'They asked to be credited on the question.' : 'They asked not to be credited.'}
      </p>
      {submission.context ? (
        <blockquote className="admin-quote">
          <strong>Interview context:</strong> {submission.context}
        </blockquote>
      ) : null}
      {submission.newSectionTitle ? (
        <p className="settings-message is-error">
          They suggested a new round: <strong>{submission.newSectionTitle}</strong>. Create it in Content first if you agree, then
          come back and pick it, or choose an existing round below.
        </p>
      ) : null}

      <div className="form-grid">
        <label htmlFor={`${formId}-title`} className="span-2">
          Question
          <input id={`${formId}-title`} value={form.title} maxLength={200} onChange={(e) => update({ title: e.target.value })} />
          {fieldError('title')}
        </label>
        <label htmlFor={`${formId}-id`}>
          Id <span className="you">(permanent)</span>
          <input id={`${formId}-id`} value={form.id} pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={(e) => update({ id: e.target.value })} aria-invalid={taken.has(form.id)} />
          {taken.has(form.id) ? <span className="field-error">Already used by another round or question.</span> : fieldError('id')}
        </label>
        <label htmlFor={`${formId}-section`}>
          Round
          <select id={`${formId}-section`} value={form.sectionId} onChange={(e) => update({ sectionId: e.target.value })}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          {fieldError('sectionId')}
        </label>
        <label htmlFor={`${formId}-level`}>
          Level
          <select id={`${formId}-level`} value={form.level} onChange={(e) => update({ level: e.target.value as Level })}>
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {LEVEL_LABEL[level]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${formId}-minutes`}>
          Study minutes
          <input id={`${formId}-minutes`} type="number" min={1} max={120} value={form.minutes} onChange={(e) => update({ minutes: Number(e.target.value) })} />
        </label>
        <label htmlFor={`${formId}-tags`} className="span-2">
          Tags
          <input id={`${formId}-tags`} value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
          {fieldError('tags')}
        </label>
      </div>

      <div className="editor-panes" data-view="split">
        <div className="editor-pane">
          <label htmlFor={`${formId}-body`} className="sr-only">
            Answer (Markdown)
          </label>
          <textarea id={`${formId}-body`} className="editor-body" value={form.body} onChange={(e) => update({ body: e.target.value })} />
          {fieldError('body')}
        </div>
        <div className="editor-pane editor-preview" aria-live="polite">
          {preview && preview.problems.length > 0 ? (
            <ul className="problem-list" aria-label="Problems">
              {preview.problems.map((p, i) => (
                <li key={`${p.field}-${i}`}>
                  <strong>{p.field}</strong>: {p.message}
                </li>
              ))}
            </ul>
          ) : null}
          {preview ? (
            // Server-rendered, sanitized HTML (backend/markdown escapes raw HTML and unsafe links).
            <div className="prose" dangerouslySetInnerHTML={{ __html: preview.html }} />
          ) : (
            <p className="admin-note">Rendering preview…</p>
          )}
        </div>
      </div>

      <label htmlFor={`${formId}-note`} className="field-label">
        Note to @{submission.submitter} <span className="you">(optional; included in the email)</span>
      </label>
      <textarea id={`${formId}-note`} className="note-input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />

      <FlashLine flash={flash} />
      <div className="editor-actions">
        <label className="switch-inline" htmlFor={`${formId}-published`}>
          <input id={`${formId}-published`} type="checkbox" role="switch" className="switch" checked={form.published} onChange={(e) => update({ published: e.target.checked })} />
          {form.published ? 'Publish now' : 'Add as draft'}
        </label>
        <button type="button" className="btn btn-primary" disabled={busy || taken.has(form.id) || !form.id || !form.sectionId} onClick={() => void run(approve)}>
          <Icon name="check" size={16} /> Approve and add
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void reject()}>
          Reject
        </button>
      </div>
    </section>
  );
}
