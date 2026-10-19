/**
 * Content management: rounds and questions, live.
 *
 * The left list is the rounds in learning order; the right side edits the
 * selected round and lists its questions. Editing a question opens the full
 * editor (QuestionEditor). Every save refreshes the app's own content too,
 * so the sidebar and pages update without a reload.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Dialog, LevelChip } from '../../components/primitives.tsx';
import { plural } from '../../lib/format.ts';
import { refreshBootstrap } from '../../platform/backend.ts';
import { navigate } from '../../state/route.ts';
import { consoleApi, type AdminContent, type AdminSection, type DeletedQuestion, type SyncPlan } from './consoleApi.ts';
import { QuestionEditor } from './QuestionEditor.tsx';
import { Card, errorMessage, FlashLine, formatDate, LoadState, slugify, useAction, useAsync } from './shared.tsx';

/** `session` keys the editor: creating a question turns the same editor session into an edit, without remounting. */
type Editing = { kind: 'new'; sectionId: string; session: number } | { kind: 'edit'; id: string; session: number } | null;

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}

function ReorderButtons({ label, index, count, disabled, onMove }: { label: string; index: number; count: number; disabled: boolean; onMove: (delta: number) => void }) {
  return (
    <span className="reorder">
      <button type="button" className="icon-btn icon-btn-sm" aria-label={`Move ${label} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
        <Icon name="collapse" size={16} />
      </button>
      <button type="button" className="icon-btn icon-btn-sm" aria-label={`Move ${label} down`} disabled={disabled || index === count - 1} onClick={() => onMove(1)}>
        <Icon name="expand" size={16} />
      </button>
    </span>
  );
}

/* ---------------------------------------------------------------- dialogs */

function NewRoundDialog({ open, takenIds, onClose, onCreated }: { open: boolean; takenIds: Set<string>; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [description, setDescription] = useState('');
  const { busy, flash, run } = useAction();
  const formId = useId();
  const effectiveId = idTouched ? id : slugify(title);
  const taken = takenIds.has(effectiveId);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const ok = await run(() => consoleApi.createSection({ id: effectiveId, title, description, published: true }));
    if (ok) {
      setTitle('');
      setId('');
      setIdTouched(false);
      setDescription('');
      await onCreated(effectiveId);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} label="New round" className="dialog dialog-small">
      <form className="dialog-body console-form" onSubmit={(event) => void submit(event)}>
        <div className="dialog-head">
          <h2>New round</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <label htmlFor={`${formId}-title`}>
          Title
          <input id={`${formId}-title`} value={title} required maxLength={200} placeholder="e.g. Web Components & Design Systems" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label htmlFor={`${formId}-id`}>
          Id <span className="you">(the URL, e.g. #{effectiveId || 'web-components'}; permanent)</span>
          <input
            id={`${formId}-id`}
            value={effectiveId}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            aria-invalid={taken}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value);
            }}
          />
          {taken ? <span className="field-error">Already used by another round or question.</span> : null}
        </label>
        <label htmlFor={`${formId}-desc`}>
          One-line description
          <input id={`${formId}-desc`} value={description} required maxLength={300} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <p className="admin-note">The round appears to learners once it has at least one published question.</p>
        <FlashLine flash={flash} />
        <div className="button-row">
          <button type="submit" className="btn btn-primary" disabled={busy || taken || !effectiveId}>
            Create round
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function SyncDialog({ open, onClose, onSynced }: { open: boolean; onClose: () => void; onSynced: () => Promise<void> }) {
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const { busy, flash, run } = useAction();

  // Fetching is a side effect of opening the dialog: an effect, not render logic.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPlan(null);
    setError(null);
    consoleApi.syncPlan().then(
      (result) => !cancelled && setPlan(result),
      (err: unknown) => !cancelled && setError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  const apply = async (overwrite: boolean): Promise<void> => {
    let result: SyncPlan | null = null;
    const ok = await run(async () => {
      result = await consoleApi.applySync(overwrite);
    });
    if (ok && result) {
      await onSynced();
      setPlan(await consoleApi.syncPlan());
      setConfirmOverwrite(false);
    }
  };

  const nothingNew = plan ? plan.newSections.length === 0 && plan.newQuestions.length === 0 : true;

  return (
    <Dialog open={open} onClose={onClose} label="Sync from repository" className="dialog dialog-small">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>Sync from repository</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <p className="settings-copy">
          Compares the database with the <code>content/*.md</code> files deployed with this version of the app. New questions
          committed to git show up here after the deploy.
        </p>
        {error ? (
          <p className="settings-message is-error" role="alert">
            {error}
          </p>
        ) : null}
        {!plan && !error ? <p className="admin-note">Comparing…</p> : null}
        {plan ? (
          <ul className="sync-plan">
            <li>
              <strong className="tabular">{plan.newSections.length}</strong> new rounds and <strong className="tabular">{plan.newQuestions.length}</strong> new
              questions in the repository
            </li>
            <li>
              <strong className="tabular">{plan.changedQuestions.length}</strong> questions differ from the repository (edited here or there)
            </li>
            <li>
              <strong className="tabular">{plan.unchanged}</strong> identical · <strong className="tabular">{plan.onlyInDatabase}</strong> created in the console (never
              touched by sync)
            </li>
          </ul>
        ) : null}
        {plan && nothingNew && plan.changedQuestions.length > 0 ? (
          <p className="admin-note">
            Nothing new to add, but {plural(plan.changedQuestions.length, 'question')} changed in the repository since they were saved here (or were edited
            in the console). If you haven't edited them here, choose <strong>Overwrite changed…</strong> to bring them up to date; the previous versions stay
            in each question's history.
          </p>
        ) : null}
        <FlashLine flash={flash} />
        <div className="button-row">
          <button type="button" className="btn btn-primary" disabled={busy || !plan || nothingNew} onClick={() => void apply(false)}>
            Add what's missing
          </button>
          {plan && plan.changedQuestions.length > 0 ? (
            confirmOverwrite ? (
              <>
                <span className="danger-copy">Replace {plural(plan.changedQuestions.length, 'edited question')} with the repository version?</span>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void apply(true)}>
                  Overwrite
                </button>
              </>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirmOverwrite(true)}>
                Overwrite changed…
              </button>
            )
          ) : null}
        </div>
        <p className="admin-note">Overwritten questions keep their history, so you can restore your version from the editor.</p>
      </div>
    </Dialog>
  );
}

function TrashDialog({ open, onClose, onRestored }: { open: boolean; onClose: () => void; onRestored: () => Promise<void> }) {
  const [items, setItems] = useState<DeletedQuestion[] | null>(null);
  const { busy, flash, run } = useAction();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setItems(null);
    consoleApi.trash().then(
      (result) => !cancelled && setItems(result),
      () => !cancelled && setItems([]),
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} label="Deleted questions" className="dialog dialog-small">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>Deleted questions</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {!items ? <p className="admin-note">Loading…</p> : null}
        {items && items.length === 0 ? <p className="admin-note">Nothing deleted.</p> : null}
        {items && items.length > 0 ? (
          <ul className="trash-list">
            {items.map((item) => (
              <li key={item.questionId}>
                <span>
                  <strong>{item.title}</strong>
                  <span className="cell-sub">
                    from {item.sectionId} · deleted {formatDate(item.editedAt)} by @{item.editedBy ?? 'someone'}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(() => consoleApi.restore(item.questionId, item.id), `Restored "${item.title}" as a draft.`).then(async (ok) => {
                      if (!ok) return;
                      setItems((prev) => prev?.filter((x) => x.questionId !== item.questionId) ?? null);
                      await onRestored();
                    })
                  }
                >
                  Restore as draft
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <FlashLine flash={flash} />
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- round detail */

function RoundDetail({ section, index, total, onChanged, onEdit, onNew, onDeleted }: {
  section: AdminSection;
  index: number;
  total: number;
  onChanged: () => Promise<void>;
  onEdit: (id: string) => void;
  onNew: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [title, setTitle] = useState(section.title);
  const [description, setDescription] = useState(section.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const { busy, flash, run } = useAction();
  const formId = useId();
  const dirty = title !== section.title || description !== section.description;
  const drafts = section.questions.filter((q) => !q.published).length;

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (await run(() => consoleApi.updateSection(section.id, { title, description }), 'Round saved.')) await onChanged();
  };

  const togglePublished = async (): Promise<void> => {
    const next = !section.published;
    if (await run(() => consoleApi.updateSection(section.id, { published: next }), next ? 'Round published.' : 'Round hidden from learners.')) await onChanged();
  };

  const reorder = async (questionIndex: number, delta: number): Promise<void> => {
    const ids = move(section.questions.map((q) => q.id), questionIndex, delta);
    if (await run(() => consoleApi.reorderQuestions(section.id, ids))) await onChanged();
  };

  return (
    <div className="round-detail">
      <form className="console-form" onSubmit={(event) => void save(event)}>
        <div className="round-detail-head">
          <p className="eyebrow">
            Round {index + 1} of {total} · <code>#{section.id}</code>
          </p>
          <label className="switch-inline" htmlFor={`${formId}-pub`}>
            <input id={`${formId}-pub`} type="checkbox" role="switch" className="switch" checked={section.published} disabled={busy} onChange={() => void togglePublished()} />
            {section.published ? 'Published' : 'Hidden (draft)'}
          </label>
        </div>
        <label htmlFor={`${formId}-title`}>
          Title
          <input id={`${formId}-title`} value={title} required maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label htmlFor={`${formId}-desc`}>
          Description
          <input id={`${formId}-desc`} value={description} required maxLength={300} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="button-row">
          <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
            Save round
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => navigate({ name: 'section', sectionId: section.id })}>
            View in app
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => void run(() => consoleApi.exportSection(section.id))}>
            Export .md
          </button>
          {confirmDelete ? (
            <>
              <span className="danger-copy">Delete this round and its {plural(section.questions.length, 'question')}?</span>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void run(() => consoleApi.deleteSection(section.id)).then(async (ok) => {
                  if (ok) await onDeleted();
                })}
              >
                Delete round
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(true)}>
              Delete…
            </button>
          )}
        </div>
        <FlashLine flash={flash} />
      </form>

      <div className="card-head">
        <h3>
          {plural(section.questions.length, 'question')}
          {drafts > 0 ? <span className="you"> · {drafts} draft</span> : null}
        </h3>
        <button type="button" className="btn btn-primary" onClick={onNew}>
          New question
        </button>
      </div>
      {section.questions.length === 0 ? <p className="admin-note">No questions yet. Add the first one.</p> : null}
      <ol className="cms-list">
        {section.questions.map((question, questionIndex) => (
          <li key={question.id} className="cms-item">
            <ReorderButtons label={question.title} index={questionIndex} count={section.questions.length} disabled={busy} onMove={(delta) => void reorder(questionIndex, delta)} />
            <button type="button" className="cms-item-main" onClick={() => onEdit(question.id)}>
              <span className="cms-item-title">{question.title}</span>
              <span className="q-meta">
                {question.published ? null : <span className="draft-chip">Draft</span>}
                <LevelChip level={question.level} />
                <span>{question.minutes} min</span>
                <span className="you">edited {formatDate(question.updatedAt)}</span>
              </span>
            </button>
            {pendingDelete === question.id ? (
              <span className="row-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void run(() => consoleApi.deleteQuestion(question.id), 'Question deleted. Restore it from Trash.').then(async (ok) => {
                    if (ok) await onChanged();
                  })}
                >
                  Delete
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setPendingDelete(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <span className="row-actions">
                <button type="button" className="btn btn-quiet" onClick={() => onEdit(question.id)}>
                  Edit
                </button>
                <button type="button" className="btn btn-quiet" aria-label={`Delete ${question.title}`} onClick={() => setPendingDelete(question.id)}>
                  Delete…
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------------------------------------------------------- tab */

export function ContentTab() {
  const state = useAsync(consoleApi.content);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [dialog, setDialog] = useState<'round' | 'sync' | 'trash' | null>(null);
  const { busy, flash, run } = useAction();

  const refresh = async (): Promise<void> => {
    await state.reload();
    await refreshBootstrap();
  };

  if (editing && state.status === 'ready') {
    return (
      <QuestionEditor
        key={editing.session}
        content={state.data}
        questionId={editing.kind === 'edit' ? editing.id : null}
        defaultSectionId={editing.kind === 'new' ? editing.sectionId : null}
        onClose={() => setEditing(null)}
        onSaved={async (id) => {
          await refresh();
          setEditing({ kind: 'edit', id, session: editing.session });
        }}
      />
    );
  }

  return (
    <LoadState state={state}>
      {(content: AdminContent) => {
        const sections = content.sections;
        const current = sections.find((s) => s.id === selected) ?? sections[0];
        const currentIndex = current ? sections.indexOf(current) : -1;
        const takenIds = new Set<string>([...sections.map((s) => s.id), ...sections.flatMap((s) => s.questions.map((q) => q.id))]);
        const questionCount = sections.reduce((sum, s) => sum + s.questions.length, 0);

        const reorderRounds = async (index: number, delta: number): Promise<void> => {
          const ids = move(sections.map((s) => s.id), index, delta);
          if (await run(() => consoleApi.reorderSections(ids))) await refresh();
        };

        return (
          <Card
            title="Content"
            icon={<Icon name="note" />}
            className="cms-card"
            actions={
              <>
                <button type="button" className="btn" onClick={() => setDialog('round')}>
                  New round
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setDialog('sync')}>
                  Sync from repository
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setDialog('trash')}>
                  Trash
                </button>
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void run(() => consoleApi.exportAll())}>
                  Export all (.zip)
                </button>
              </>
            }
          >
            <p className="admin-note">
              {plural(sections.length, 'round')} · {plural(questionCount, 'question')}. Drafts are visible only to admins (marked
              “Draft” in the app). Exports use the repository's Markdown format, so you can commit them back to git.
            </p>
            <FlashLine flash={flash} />
            <div className="cms-layout">
              <nav aria-label="Rounds" className="cms-rounds">
                <ol className="cms-list">
                  {sections.map((section, index) => (
                    <li key={section.id} className="cms-item" data-active={section.id === current?.id}>
                      <ReorderButtons label={section.title} index={index} count={sections.length} disabled={busy} onMove={(delta) => void reorderRounds(index, delta)} />
                      <button type="button" className="cms-item-main" aria-current={section.id === current?.id ? 'true' : undefined} onClick={() => setSelected(section.id)}>
                        <span className="cms-item-title">
                          {index + 1}. {section.title}
                        </span>
                        <span className="q-meta">
                          {section.published ? null : <span className="draft-chip">Hidden</span>}
                          <span>{plural(section.questions.length, 'question')}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
              {current ? (
                <RoundDetail
                  key={`${current.id}:${current.updatedAt}`}
                  section={current}
                  index={currentIndex}
                  total={sections.length}
                  onChanged={refresh}
                  onEdit={(id) => setEditing({ kind: 'edit', id, session: Date.now() })}
                  onNew={() => setEditing({ kind: 'new', sectionId: current.id, session: Date.now() })}
                  onDeleted={async () => {
                    setSelected(null);
                    await refresh();
                  }}
                />
              ) : (
                <p className="admin-note">No rounds yet. Create one, or sync from the repository.</p>
              )}
            </div>
            <NewRoundDialog
              open={dialog === 'round'}
              takenIds={takenIds}
              onClose={() => setDialog(null)}
              onCreated={async (id) => {
                setDialog(null);
                setSelected(id);
                await refresh();
              }}
            />
            <SyncDialog open={dialog === 'sync'} onClose={() => setDialog(null)} onSynced={refresh} />
            <TrashDialog open={dialog === 'trash'} onClose={() => setDialog(null)} onRestored={refresh} />
          </Card>
        );
      }}
    </LoadState>
  );
}
