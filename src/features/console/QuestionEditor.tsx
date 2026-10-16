/**
 * The question editor: structured fields + a Markdown answer with a live,
 * server-rendered preview.
 *
 * Why the preview is rendered by the server: the Go renderer is the one that
 * produces what learners will see (and it enforces the safety rules), so
 * "what you preview is what you publish" holds by construction.
 *
 * Saves use optimistic concurrency: the editor sends the revision it loaded,
 * and the server rejects the save (409) if someone else saved in between.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { LEVELS, LEVEL_LABEL, type Level } from '../../content/types.ts';
import { ApiError } from '../../platform/api.ts';
import { navigate } from '../../state/route.ts';
import { consoleApi, type AdminContent, type Preview, type QuestionInput, type Revision } from './consoleApi.ts';
import { errorMessage, formatDate, slugify, type Flash, FlashLine } from './shared.tsx';

const TEMPLATE = `> [!TLDR]
> The answer you'd give in the first 60 seconds: the core idea, the key trade-off, and one concrete detail that shows depth.

### Mental model

Explain how it works. A small diagram in a \`text\` block helps:

\`\`\`text
request → cache? → network → render
\`\`\`

### Implementation

\`\`\`ts
// Small, complete, production-quality example.
\`\`\`

### Trade-offs and edge cases

-

> [!WARNING]
> The most common mistake candidates make here.

### Follow-ups

- **"What if …?"** Short, strong answer.

### References

- [Primary source](https://developer.mozilla.org/)
`;

const SNIPPETS: Record<string, string> = {
  'TL;DR callout': '> [!TLDR]\n> ',
  'Tip callout': '> [!TIP]\n> ',
  'Common-mistake callout': '> [!WARNING]\n> ',
  'Principal-depth callout': '> [!PRINCIPAL]\n> ',
  'Note callout': '> [!NOTE]\n> ',
  'TypeScript code': '```ts\n\n```',
  'TSX code': '```tsx\n\n```',
  Table: '| Option | When | Cost |\n| --- | --- | --- |\n|  |  |  |',
  Heading: '### ',
};

type View = 'write' | 'preview' | 'split';

interface Props {
  content: AdminContent;
  questionId: string | null;
  defaultSectionId: string | null;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}

function emptyForm(sectionId: string): QuestionInput {
  return { id: '', sectionId, title: '', level: 'senior', tags: [], minutes: 10, body: TEMPLATE, published: false };
}

function sameForm(a: QuestionInput, b: QuestionInput): boolean {
  return (
    a.id === b.id &&
    a.sectionId === b.sectionId &&
    a.title === b.title &&
    a.level === b.level &&
    a.tags.join(',') === b.tags.join(',') &&
    a.minutes === b.minutes &&
    a.body === b.body &&
    a.published === b.published
  );
}

function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function QuestionEditor({ content, questionId, defaultSectionId, onClose, onSaved }: Props) {
  const isNew = questionId === null;
  const firstSection = defaultSectionId ?? content.sections[0]?.id ?? '';
  const [form, setForm] = useState<QuestionInput>(() => emptyForm(firstSection));
  const [saved, setSaved] = useState<QuestionInput>(() => emptyForm(firstSection));
  const [tagsText, setTagsText] = useState('');
  const [revision, setRevision] = useState(0);
  const [meta, setMeta] = useState<{ updatedAt: string; updatedBy: string | null } | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [idTouched, setIdTouched] = useState(false);
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth >= 1200 ? 'split' : 'write'));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Flash | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Revision[] | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const formId = useId();

  const effective: QuestionInput = useMemo(
    () => ({ ...form, id: isNew && !idTouched ? slugify(form.title) : form.id, tags: parseTags(tagsText) }),
    [form, isNew, idTouched, tagsText],
  );
  const dirty = !sameForm(effective, saved);

  const takenIds = useMemo(
    () => new Set<string>([...content.sections.map((s) => s.id), ...content.sections.flatMap((s) => s.questions.map((q) => q.id))]),
    [content],
  );
  const idTaken = isNew && takenIds.has(effective.id);

  // Load the question being edited.
  useEffect(() => {
    if (isNew || !questionId) return;
    let cancelled = false;
    consoleApi.question(questionId).then(
      (record) => {
        if (cancelled) return;
        const input: QuestionInput = {
          id: record.id,
          sectionId: record.sectionId,
          title: record.title,
          level: record.level,
          tags: record.tags,
          minutes: record.minutes,
          body: record.body,
          published: record.published,
        };
        setForm(input);
        setSaved(input);
        setTagsText(record.tags.join(', '));
        setRevision(record.revision);
        setMeta({ updatedAt: record.updatedAt, updatedBy: record.updatedBy });
        setLoading(false);
      },
      (error: unknown) => {
        if (cancelled) return;
        setFlash({ kind: 'error', text: errorMessage(error) });
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isNew, questionId]);

  // Live preview, debounced; stale requests are aborted.
  const showPreview = view !== 'write';
  useEffect(() => {
    if (!showPreview || loading) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      consoleApi.preview(effective, controller.signal).then(
        (result) => {
          setPreview(result);
          setPreviewError(null);
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setPreviewError(errorMessage(error));
        },
      );
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [effective, showPreview, loading]);

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const update = (patch: Partial<QuestionInput>): void => setForm((prev) => ({ ...prev, ...patch }));

  const save = async (publish?: boolean): Promise<void> => {
    const input = { ...effective, published: publish ?? effective.published };
    setBusy(true);
    setFlash(null);
    setProblems({});
    try {
      const record = isNew ? await consoleApi.createQuestion(input) : await consoleApi.updateQuestion({ ...input, revision });
      const next: QuestionInput = { ...input, tags: record.tags, body: record.body };
      setForm(next);
      setSaved(next);
      setRevision(record.revision);
      setMeta({ updatedAt: record.updatedAt, updatedBy: record.updatedBy });
      setFlash({ kind: 'ok', text: input.published ? 'Saved and published. Learners see it now.' : 'Saved as a draft (only admins see it).' });
      setHistory(null);
      await onSaved(record.id);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conflict') setConflict(true);
      if (error instanceof ApiError && error.problems.length > 0) {
        setProblems(Object.fromEntries(error.problems.map((p) => [p.field, p.message])));
      }
      setFlash({ kind: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  // Ctrl/Cmd+S saves.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const close = (): void => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    onClose();
  };

  const insert = (snippet: string): void => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? form.body.length;
    const end = el?.selectionEnd ?? start;
    const before = form.body.slice(0, start);
    const needsBreak = before.length > 0 && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const text = `${needsBreak}${snippet}`;
    update({ body: before + text + form.body.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      const caret = start + text.length - (snippet.endsWith('```') ? 4 : 0);
      el?.setSelectionRange(caret, caret);
    });
  };

  const loadHistory = async (): Promise<void> => {
    if (!questionId) return;
    try {
      setHistory(await consoleApi.revisions(questionId));
    } catch (error) {
      setFlash({ kind: 'error', text: errorMessage(error) });
    }
  };

  const loadRevision = async (rev: Revision): Promise<void> => {
    if (!questionId) return;
    try {
      const old = await consoleApi.revision(questionId, rev.id);
      setForm((prev) => ({ ...prev, title: old.title, level: old.level, minutes: old.minutes, body: old.body }));
      setTagsText(old.tags.join(', '));
      setFlash({ kind: 'ok', text: `Loaded revision ${rev.revision} into the editor. Review it, then save to make it current.` });
    } catch (error) {
      setFlash({ kind: 'error', text: errorMessage(error) });
    }
  };

  const reloadLatest = async (): Promise<void> => {
    if (!questionId) return;
    const record = await consoleApi.question(questionId);
    const input: QuestionInput = { ...record };
    setForm(input);
    setSaved(input);
    setTagsText(record.tags.join(', '));
    setRevision(record.revision);
    setConflict(false);
    setFlash({ kind: 'ok', text: 'Loaded the latest version.' });
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void save();
  };

  if (loading) return <p className="admin-note">Loading the question…</p>;

  const fieldError = (field: string) => (problems[field] ? <span className="field-error">{problems[field]}</span> : null);

  return (
    <form className="admin-card editor" onSubmit={submit} aria-label={isNew ? 'New question' : `Edit ${saved.title}`}>
      <div className="card-head">
        <h2 className="admin-card-title">
          <Icon name="note" />
          {isNew ? 'New question' : 'Edit question'}
          {dirty ? <span className="draft-chip">Unsaved</span> : null}
        </h2>
        <div className="card-actions">
          {!isNew ? (
            <button type="button" className="btn btn-quiet" onClick={() => navigate({ name: 'section', sectionId: saved.sectionId, questionId: saved.id })}>
              View in app
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet" onClick={close}>
            <Icon name="close" size={16} /> Close
          </button>
        </div>
      </div>

      {meta ? (
        <p className="admin-note">
          Revision {revision} · last saved {formatDate(meta.updatedAt)}
          {meta.updatedBy ? ` by @${meta.updatedBy}` : ''}
        </p>
      ) : null}

      <div className="form-grid">
        <label htmlFor={`${formId}-title`} className="span-2">
          Question <span className="you">(as an interviewer would ask it; `backticks` render as code)</span>
          <input id={`${formId}-title`} value={form.title} maxLength={200} required onChange={(e) => update({ title: e.target.value })} aria-invalid={Boolean(problems.title)} />
          {fieldError('title')}
        </label>
        <label htmlFor={`${formId}-id`}>
          Id <span className="you">{isNew ? '(permanent: progress is keyed by it)' : '(permanent)'}</span>
          <input
            id={`${formId}-id`}
            value={effective.id}
            readOnly={!isNew}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            aria-invalid={idTaken || Boolean(problems.id)}
            onChange={(e) => {
              setIdTouched(true);
              update({ id: e.target.value });
            }}
          />
          {idTaken ? <span className="field-error">Already used by another round or question.</span> : fieldError('id')}
        </label>
        <label htmlFor={`${formId}-section`}>
          Round
          <select id={`${formId}-section`} value={form.sectionId} onChange={(e) => update({ sectionId: e.target.value })}>
            {content.sections.map((s) => (
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
          {fieldError('minutes')}
        </label>
        <label htmlFor={`${formId}-tags`} className="span-2">
          Tags <span className="you">(comma-separated; the first three show in lists)</span>
          <input id={`${formId}-tags`} value={tagsText} placeholder="react, hooks, performance" onChange={(e) => setTagsText(e.target.value)} aria-invalid={Boolean(problems.tags)} />
          {fieldError('tags')}
        </label>
      </div>

      <div className="editor-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Editor view">
          {(['write', 'split', 'preview'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>
              {v === 'write' ? 'Write' : v === 'split' ? 'Side by side' : 'Preview'}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor={`${formId}-snippet`}>
          Insert
        </label>
        <select
          id={`${formId}-snippet`}
          value=""
          onChange={(e) => {
            const snippet = SNIPPETS[e.target.value];
            if (snippet) insert(snippet);
          }}
        >
          <option value="">Insert…</option>
          {Object.keys(SNIPPETS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <details className="cheatsheet">
          <summary>Markdown help</summary>
          <p>
            Start with a <code>&gt; [!TLDR]</code> callout (required to publish). Use <code>###</code> for headings (<code>##</code> would start a
            new question in the repository format). Callouts: TLDR, NOTE, TIP, WARNING, IMPORTANT, PRINCIPAL. Code fences: ts, tsx, js, jsx,
            html, css, bash, json, yaml, graphql, diff, http, text. Raw HTML is shown as text; links must be https or #ids.
          </p>
        </details>
      </div>

      <div className="editor-panes" data-view={view}>
        {view !== 'preview' ? (
          <div className="editor-pane">
            <label htmlFor={`${formId}-body`} className="sr-only">
              Answer (Markdown)
            </label>
            <textarea
              id={`${formId}-body`}
              ref={bodyRef}
              className="editor-body"
              value={form.body}
              spellCheck
              onChange={(e) => update({ body: e.target.value })}
              aria-invalid={Boolean(problems.body)}
            />
            {fieldError('body')}
            <p className="notes-count">{form.body.length.toLocaleString()} characters</p>
          </div>
        ) : null}
        {view !== 'write' ? (
          <div className="editor-pane editor-preview" aria-live="polite">
            {previewError ? (
              <p className="settings-message is-error" role="alert">
                {previewError}
              </p>
            ) : null}
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
        ) : null}
      </div>

      {conflict ? (
        <div className="settings-message is-error" role="alert">
          Someone else saved this question after you opened it.{' '}
          <button type="button" className="btn btn-quiet" onClick={() => void reloadLatest()}>
            Load their version (discards yours)
          </button>
        </div>
      ) : null}
      <FlashLine flash={flash} />

      <div className="editor-actions">
        <label className="switch-inline" htmlFor={`${formId}-published`}>
          <input id={`${formId}-published`} type="checkbox" role="switch" className="switch" checked={form.published} onChange={(e) => update({ published: e.target.checked })} />
          {form.published ? 'Published' : 'Draft'}
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || idTaken || !effective.id}>
          {busy ? 'Saving…' : isNew ? 'Create question' : 'Save'}
        </button>
        <span className="you">Ctrl/⌘ + S</span>
        {!isNew ? (
          <button type="button" className="btn btn-quiet editor-history-btn" onClick={() => void loadHistory()}>
            <Icon name="clock" size={16} /> History
          </button>
        ) : null}
      </div>

      {history ? (
        <div className="history">
          <h3>Previous versions</h3>
          {history.length === 0 ? <p className="admin-note">No earlier versions yet.</p> : null}
          <ol className="trash-list">
            {history.map((rev) => (
              <li key={rev.id}>
                <span>
                  <strong>Revision {rev.revision}</strong> · {rev.title}
                  <span className="cell-sub">
                    {rev.action === 'delete' ? 'before delete' : 'replaced'} {formatDate(rev.editedAt)} by @{rev.editedBy ?? 'someone'}
                  </span>
                </span>
                <button type="button" className="btn" onClick={() => void loadRevision(rev)}>
                  Load into editor
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </form>
  );
}
