import { memo, Suspense, useEffect, useRef, useState } from 'react';
import { useFeature } from '../../platform/backend.ts';
import { loadAnswers } from '../../content/index.ts';
import type { QuestionMeta } from '../../content/types.ts';
import { Icon } from '../../components/Icon.tsx';
import { ErrorBoundary, InlineText, LevelChip } from '../../components/primitives.tsx';
import { formatDayDistance, formatElapsed } from '../../lib/format.ts';
import { NOTES_LIMIT } from '../../state/progress.ts';
import { progressActions, progressStore } from '../../state/progressStore.ts';
import { useStore } from '../../state/useStore.ts';
import { Answer, AnswerSkeleton } from './Answer.tsx';

export interface QuestionItemProps {
  question: QuestionMeta;
  open: boolean;
  onToggle: (id: string) => void;
  /** Open the next question in the current list. Absent on the last item. */
  onAdvance?: (id: string) => void;
  practiceMode: boolean;
  variant?: 'study' | 'review';
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function PracticeGate({ onReveal }: { onReveal: () => void }) {
  const [startedAt] = useState(() => Date.now());
  const now = useNow(1000);
  return (
    <div className="practice">
      <div>
        <p className="practice-title">Answer it out loud first</p>
        <p className="practice-copy">
          Talk it through as you would in the room: clarify the problem, explain the mental model, sketch the code, name the
          trade-offs. Aim for two to four minutes, then compare.
        </p>
      </div>
      <div className="practice-actions">
        <span className="practice-timer" aria-hidden="true">
          <Icon name="clock" size={16} /> {formatElapsed(now - startedAt)}
        </span>
        <button type="button" className="btn btn-primary" onClick={onReveal}>
          Reveal the answer
        </button>
      </div>
    </div>
  );
}

function Notes({ id }: { id: string }) {
  const saved = useStore(progressStore, (s) => s.questions[id]?.notes ?? '');
  const [visible, setVisible] = useState(saved !== '');
  const [length, setLength] = useState(saved.length);
  const pending = useRef<number | undefined>(undefined);
  const latest = useRef(saved);

  const flush = (): void => {
    window.clearTimeout(pending.current);
    progressActions.saveNotes(id, latest.current);
  };

  // Save any pending edit if the panel closes mid-typing.
  useEffect(() => () => {
    window.clearTimeout(pending.current);
    if (latest.current !== progressStore.getState().questions[id]?.notes) progressActions.saveNotes(id, latest.current);
  }, [id]);

  const textareaId = `notes-${id}`;
  return (
    <div className="notes">
      <button type="button" className="btn btn-quiet" aria-expanded={visible} aria-controls={textareaId} onClick={() => setVisible((v) => !v)}>
        <Icon name="note" size={16} />
        {visible ? 'Hide your notes' : saved ? 'Your notes' : 'Add your own notes'}
      </button>
      {visible ? (
        <div className="notes-field">
          <label className="sr-only" htmlFor={textareaId}>
            Your notes for this question
          </label>
          <textarea
            id={textareaId}
            defaultValue={saved}
            maxLength={NOTES_LIMIT}
            rows={4}
            placeholder="Write the answer in your own words, or the story from your own work you'd use here."
            onChange={(event) => {
              latest.current = event.target.value;
              setLength(event.target.value.length);
              window.clearTimeout(pending.current);
              pending.current = window.setTimeout(flush, 600);
            }}
            onBlur={flush}
          />
          <p className="notes-count">
            {length} / {NOTES_LIMIT} · saved automatically
          </p>
        </div>
      ) : null}
    </div>
  );
}

export const QuestionItem = memo(function QuestionItem({
  question,
  open,
  onToggle,
  onAdvance,
  practiceMode,
  variant = 'study',
}: QuestionItemProps) {
  const progress = useStore(progressStore, (s) => s.questions[question.id]);
  const notesOn = useFeature('notes');
  const done = progress?.done ?? false;
  const [revealed, setRevealed] = useState(false);
  const plainTitle = question.title.replace(/`/g, '');
  const triggerId = `q-trigger-${question.id}`;
  const panelId = `q-panel-${question.id}`;
  const showGate = practiceMode && !revealed && !done && variant === 'study';

  return (
    <li className="q" id={`q-${question.id}`} data-open={open} data-done={done}>
      <div className="q-head">
        <label className="done-box">
          <input
            type="checkbox"
            checked={done}
            onChange={(event) => progressActions.setDone(question.id, event.target.checked)}
            aria-label={`Done: ${plainTitle}`}
          />
          <span className="done-box-ui" aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
        </label>
        <h2 className="q-heading">
          <button
            type="button"
            className="q-trigger"
            id={triggerId}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => {
              if (!open) progressActions.visit(question.sectionId, question.id);
              onToggle(question.id);
            }}
            onPointerEnter={() => void loadAnswers(question.sectionId).catch(() => {})}
          >
            <span className="q-title">
              <InlineText text={question.title} />
            </span>
            <span className="q-meta">
              {question.published === false ? <span className="draft-chip">Draft</span> : null}
              <LevelChip level={question.level} />
              <span>{question.minutes} min</span>
              {variant === 'review' && progress?.dueAt ? (
                <span className="q-due">due {formatDayDistance(progress.dueAt, Date.now())}</span>
              ) : (
                <span className="q-tags">{question.tags.slice(0, 3).join(' · ')}</span>
              )}
            </span>
            <Icon name="chevron" className="q-chevron" />
          </button>
        </h2>
      </div>

      <div className="q-panel" id={panelId} role="region" aria-labelledby={triggerId} hidden={!open}>
        {open ? (
          <>
            <ErrorBoundary>
              <Suspense fallback={<AnswerSkeleton />}>
                <Answer
                  sectionId={question.sectionId}
                  questionId={question.id}
                  gate={showGate ? <PracticeGate onReveal={() => setRevealed(true)} /> : null}
                />
              </Suspense>
                {question.contributor && !showGate ? (
                  <p className="contributor-line">
                    Contributed by{' '}
                    <a href={`https://github.com/${encodeURIComponent(question.contributor)}`} target="_blank" rel="noopener noreferrer">
                      @{question.contributor}
                    </a>{' '}
                    from a real interview. Thank you!
                  </p>
                ) : null}
              </ErrorBoundary>
            <div className="q-footer">
              {variant === 'review' ? (
                <div className="q-actions">
                  <button type="button" className="btn btn-primary" onClick={() => progressActions.review(question.id, 'solid')}>
                    <Icon name="check" size={16} /> Still solid
                  </button>
                  <button type="button" className="btn" onClick={() => progressActions.review(question.id, 'shaky')}>
                    Needs another pass
                  </button>
                </div>
              ) : (
                <div className="q-actions">
                  <button
                    type="button"
                    className={done ? 'btn btn-done' : 'btn btn-primary'}
                    aria-pressed={done}
                    onClick={() => {
                      progressActions.setDone(question.id, !done);
                      if (!done && onAdvance) onAdvance(question.id);
                    }}
                  >
                    <Icon name="check" size={16} />
                    {done ? 'Done' : onAdvance ? 'Mark done & next' : 'Mark as done'}
                  </button>
                  {onAdvance ? (
                    <button type="button" className="btn btn-quiet" onClick={() => onAdvance(question.id)}>
                      Skip to next <Icon name="arrowRight" size={16} />
                    </button>
                  ) : null}
                </div>
              )}
              {notesOn ? <Notes id={question.id} /> : null}
            </div>
          </>
        ) : null}
      </div>
    </li>
  );
});
