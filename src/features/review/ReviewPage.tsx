import { useCallback, useMemo, useState } from 'react';
import { allQuestions, sectionsById } from '../../content/index.ts';
import { formatDayDistance, plural } from '../../lib/format.ts';
import { REVIEW_INTERVAL_DAYS } from '../../lib/srs.ts';
import { prefsStore } from '../../state/prefs.ts';
import { progressStore } from '../../state/progressStore.ts';
import { dueQuestions, upcomingQuestions } from '../../state/selectors.ts';
import { navigate } from '../../state/route.ts';
import { useStore } from '../../state/useStore.ts';
import { InlineText } from '../../components/primitives.tsx';
import { QuestionItem } from '../section/QuestionItem.tsx';

export function ReviewPage() {
  const progress = useStore(progressStore, (s) => s.questions);
  const practiceMode = useStore(prefsStore, (p) => p.practiceMode);
  // Freeze "now" for this visit so answers you just reviewed slide out
  // (their dueAt moves forward) while the list stays otherwise stable.
  const [now] = useState(() => Date.now());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const due = useMemo(() => dueQuestions(allQuestions, progress, now), [progress, now]);
  const upcoming = useMemo(() => upcomingQuestions(allQuestions, progress, now, 14), [progress, now]);

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <article className="page review-page">
      <header className="page-header">
        <p className="eyebrow">Spaced review</p>
        <h1>{due.length === 0 ? 'You are up to date' : `${plural(due.length, 'answer')} to refresh`}</h1>
        <p className="lede">
          Answers you mark done come back after {REVIEW_INTERVAL_DAYS.slice(0, -1).join(', ')} and{' '}
          {REVIEW_INTERVAL_DAYS[REVIEW_INTERVAL_DAYS.length - 1]} days. Say each one out loud, then choose "Still solid" to push it
          further out, or "Needs another pass" to put it back on your to-do list.
        </p>
      </header>

      {due.length > 0 ? (
        <ol className="q-list">
          {due.map((question) => (
            <QuestionItem
              key={question.id}
              question={question}
              open={open.has(question.id)}
              onToggle={toggle}
              practiceMode={practiceMode}
              variant="review"
            />
          ))}
        </ol>
      ) : (
        <div className="empty">
          <p>Nothing is due. Mark answers as done in any round and they will show up here when it is time to revisit them.</p>
        </div>
      )}

      {upcoming.length > 0 ? (
        <section className="upcoming" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className="section-heading">
            Coming up in the next two weeks
          </h2>
          <ul className="upcoming-list">
            {upcoming.map((question) => (
              <li key={question.id}>
                <button
                  type="button"
                  className="upcoming-item"
                  onClick={() => navigate({ name: 'section', sectionId: question.sectionId, questionId: question.id })}
                >
                  <span className="upcoming-title">
                    <InlineText text={question.title} />
                  </span>
                  <span className="upcoming-meta">
                    {sectionsById.get(question.sectionId)?.title} · {formatDayDistance(progress[question.id]?.dueAt ?? now, now)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
