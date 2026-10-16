import { useMemo, useState } from 'react';
import { allQuestions, preloadSection, questionsById, sections, sectionsById, totalMinutes } from '../../content/index.ts';
import { LEVELS, LEVEL_LABEL } from '../../content/types.ts';
import { Icon } from '../../components/Icon.tsx';
import { LoopRing } from '../../components/LoopRing.tsx';
import { InlineText, ProgressBar } from '../../components/primitives.tsx';
import { formatStudyTime, plural } from '../../lib/format.ts';
import { progressStore } from '../../state/progressStore.ts';
import { continueTarget, doneCount, dueQuestions } from '../../state/selectors.ts';
import { navigate } from '../../state/route.ts';
import { useStore } from '../../state/useStore.ts';

export function Overview() {
  const state = useStore(progressStore, (s) => s);
  const [now] = useState(() => Date.now());

  const segments = useMemo(
    () => sections.map((section) => ({ section, done: doneCount(section.questions, state.questions) })),
    [state.questions],
  );
  const done = segments.reduce((sum, s) => sum + s.done, 0);
  const total = allQuestions.length;
  const due = useMemo(() => dueQuestions(allQuestions, state.questions, now), [state.questions, now]);
  const target = useMemo(() => continueTarget(sections, state), [state]);
  const targetQuestion = target ? questionsById.get(target.questionId) : undefined;
  const targetSection = target ? sectionsById.get(target.sectionId) : undefined;

  const byLevel = LEVELS.map((level) => {
    const questions = allQuestions.filter((q) => q.level === level);
    return { level, total: questions.length, done: doneCount(questions, state.questions) };
  });

  return (
    <article className="page overview">
      <header className="overview-hero">
        <div className="overview-intro">
          <p className="eyebrow">Senior · Lead · Principal frontend interviews</p>
          <h1>Your interview loop, one round at a time.</h1>
          <p className="lede">
            {plural(total, 'question')} across {sections.length} rounds, about {formatStudyTime(totalMinutes)} of study. Read the
            question, answer it out loud, then open it and compare. Tick it off when you could say it in the room.
          </p>
        </div>
      </header>

      <section className="overview-grid" aria-label="Your progress">
        <LoopRing
          segments={segments}
          done={done}
          total={total}
          onSelect={(sectionId) => navigate({ name: 'section', sectionId })}
        />

        <div className="overview-actions">
          {target && targetQuestion && targetSection ? (
            <button
              type="button"
              className="action-card is-primary"
              onPointerEnter={() => preloadSection(target.sectionId)}
              onClick={() => navigate({ name: 'section', sectionId: target.sectionId, questionId: target.questionId })}
            >
              <span className="action-label">{target.resumed ? 'Pick up where you left off' : done === 0 ? 'Start here' : 'Up next'}</span>
              <span className="action-title">
                <InlineText text={targetQuestion.title} />
              </span>
              <span className="action-meta">
                {targetSection.title} · {targetQuestion.minutes} min
                <Icon name="arrowRight" size={18} />
              </span>
            </button>
          ) : (
            <div className="action-card is-primary">
              <span className="action-label">Loop complete</span>
              <span className="action-title">Every question is marked done.</span>
              <span className="action-meta">Keep them fresh in Review.</span>
            </div>
          )}

          <button type="button" className="action-card" onClick={() => navigate({ name: 'review' })}>
            <span className="action-label">Review</span>
            <span className="action-title">
              {due.length === 0 ? 'Nothing due right now' : `${plural(due.length, 'answer')} due for a refresher`}
            </span>
            <span className="action-meta">
              Done answers come back after 2, 5, 12, 30 and 75 days
              <Icon name="arrowRight" size={18} />
            </span>
          </button>

          <dl className="level-split">
            {byLevel.map(({ level, total: levelTotal, done: levelDone }) => (
              <div key={level}>
                <dt>{LEVEL_LABEL[level]}</dt>
                <dd className="tabular">
                  {levelDone}/{levelTotal}
                </dd>
                <ProgressBar value={levelDone} max={levelTotal} label={`${LEVEL_LABEL[level]} questions done`} />
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="rounds" aria-labelledby="rounds-heading">
        <h2 id="rounds-heading" className="section-heading">
          The rounds
        </h2>
        <ol className="round-list">
          {segments.map(({ section, done: sectionDone }, index) => (
            <li key={section.id}>
              <button
                type="button"
                className="round"
                data-complete={sectionDone === section.questions.length}
                onPointerEnter={() => preloadSection(section.id)}
                onFocus={() => preloadSection(section.id)}
                onClick={() => navigate({ name: 'section', sectionId: section.id })}
              >
                <span className="round-index tabular">{String(index + 1).padStart(2, '0')}</span>
                <span className="round-body">
                  <span className="round-title">{section.title}</span>
                  <span className="round-desc">{section.description}</span>
                </span>
                <span className="round-progress">
                  <span className="tabular">
                    {sectionDone}/{section.questions.length}
                  </span>
                  <ProgressBar value={sectionDone} max={section.questions.length} label={`${section.title} progress`} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
