import { useCallback, useEffect, useMemo, useState } from 'react';
import { sectionIndex, sections } from '../../content/index.ts';
import { LEVELS, LEVEL_LABEL, type SectionMeta } from '../../content/types.ts';
import { Icon } from '../../components/Icon.tsx';
import { ProgressBar } from '../../components/primitives.tsx';
import { formatMinutes, plural } from '../../lib/format.ts';
import { prefsStore, updatePrefs, type LevelFilter, type StatusFilter } from '../../state/prefs.ts';
import { progressActions, progressStore } from '../../state/progressStore.ts';
import { doneCount } from '../../state/selectors.ts';
import { navigate } from '../../state/route.ts';
import { useStore } from '../../state/useStore.ts';
import { QuestionItem } from './QuestionItem.tsx';

interface Props {
  section: SectionMeta;
  focusId: string | null;
  focusAt: number;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'todo', label: 'To do' },
  { value: 'done', label: 'Done' },
];

const LEVEL_OPTIONS: ReadonlyArray<{ value: LevelFilter; label: string }> = [
  { value: 'all', label: 'Any level' },
  ...LEVELS.map((level) => ({ value: level, label: LEVEL_LABEL[level].split(' ')[0] ?? level })),
];

export function SectionPage({ section, focusId, focusAt }: Props) {
  const status = useStore(prefsStore, (p) => p.status);
  const level = useStore(prefsStore, (p) => p.level);
  const practiceMode = useStore(prefsStore, (p) => p.practiceMode);
  const progress = useStore(progressStore, (s) => s.questions);

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(focusId ? [focusId] : []));
  const [scrollTarget, setScrollTarget] = useState<{ id: string; at: number } | null>(
    focusId ? { id: focusId, at: focusAt } : null,
  );

  // A new navigation to a question in this same section (search, "Continue"):
  // adjust state during render instead of in an effect, per React's guidance.
  const [seenFocusAt, setSeenFocusAt] = useState(focusAt);
  if (focusAt !== seenFocusAt) {
    setSeenFocusAt(focusAt);
    if (focusId) {
      setOpen((prev) => new Set(prev).add(focusId));
      setScrollTarget({ id: focusId, at: focusAt });
    }
  }

  // Scrolling and focusing are DOM side effects: an effect is the right tool here.
  useEffect(() => {
    if (!scrollTarget) return;
    progressActions.visit(section.id, scrollTarget.id);
    const item = document.getElementById(`q-${scrollTarget.id}`);
    item?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    document.getElementById(`q-trigger-${scrollTarget.id}`)?.focus({ preventScroll: true });
  }, [scrollTarget, section.id]);

  const visible = useMemo(
    () =>
      section.questions.filter((question) => {
        if (question.id === focusId) return true;
        const done = progress[question.id]?.done ?? false;
        if (status === 'todo' && done) return false;
        if (status === 'done' && !done) return false;
        return level === 'all' || question.level === level;
      }),
    [section.questions, progress, status, level, focusId],
  );

  const toggle = useCallback(
    (id: string) => {
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  const visibleIds = visible.map((q) => q.id).join('|');
  const advance = useCallback(
    (id: string) => {
      const ids = visibleIds.split('|');
      const nextId = ids[ids.indexOf(id) + 1];
      if (!nextId) return;
      setOpen((prev) => {
        const next = new Set(prev);
        next.delete(id);
        next.add(nextId);
        return next;
      });
      progressActions.visit(section.id, nextId);
      setScrollTarget({ id: nextId, at: Date.now() });
    },
    [visibleIds, section.id],
  );

  const position = sectionIndex(section.id);
  const nextSection = sections[position + 1];
  const done = doneCount(section.questions, progress);
  const minutes = section.questions.reduce((sum, q) => sum + q.minutes, 0);
  const allOpen = visible.length > 0 && visible.every((q) => open.has(q.id));
  const lastVisibleId = visible[visible.length - 1]?.id;

  return (
    <article className="page section-page">
      <header className="page-header">
        <p className="eyebrow">
          Round {position + 1} of {sections.length} · {plural(section.questions.length, 'question')} · about {formatMinutes(minutes)}
        </p>
        <h1>{section.title}</h1>
        <p className="lede">{section.description}</p>
        <div className="section-progress">
          <ProgressBar value={done} max={section.questions.length} label={`${section.title} progress`} />
          <span className="tabular">
            {done} of {section.questions.length} done
          </span>
        </div>
      </header>

      <div className="toolbar">
        <Segmented label="Show" value={status} options={STATUS_OPTIONS} onChange={(value) => updatePrefs({ status: value })} />
        <Segmented label="Level" value={level} options={LEVEL_OPTIONS} onChange={(value) => updatePrefs({ level: value })} />
        <button
          type="button"
          className="btn btn-quiet toolbar-end"
          onClick={() => setOpen(allOpen ? new Set() : new Set(visible.map((q) => q.id)))}
        >
          <Icon name={allOpen ? 'collapse' : 'expand'} size={16} />
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <p>No questions match these filters.</p>
          <button type="button" className="btn" onClick={() => updatePrefs({ status: 'all', level: 'all' })}>
            Show all questions
          </button>
        </div>
      ) : (
        <ol className="q-list">
          {visible.map((question) => (
            <QuestionItem
              key={question.id}
              question={question}
              open={open.has(question.id)}
              onToggle={toggle}
              onAdvance={question.id === lastVisibleId ? undefined : advance}
              practiceMode={practiceMode}
            />
          ))}
        </ol>
      )}

      {nextSection ? (
        <nav className="next-section" aria-label="Next round">
          <span className="eyebrow">Next round</span>
          <button type="button" className="next-section-link" onClick={() => navigate({ name: 'section', sectionId: nextSection.id })}>
            {nextSection.title}
            <Icon name="arrowRight" />
          </button>
        </nav>
      ) : null}
    </article>
  );
}
