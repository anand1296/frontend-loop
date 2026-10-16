import { useDeferredValue, useMemo, useState, type KeyboardEvent } from 'react';
import { questionsById, sections, sectionsById } from '../../content/index.ts';
import { Icon } from '../../components/Icon.tsx';
import { Dialog, InlineText, LevelChip } from '../../components/primitives.tsx';
import { buildSearchIndex, searchQuestions } from '../../lib/search.ts';
import { progressStore } from '../../state/progressStore.ts';
import { navigate } from '../../state/route.ts';
import { useStore } from '../../state/useStore.ts';

const index = buildSearchIndex(sections);

type Result =
  | { kind: 'question'; id: string }
  | { kind: 'section'; id: string };

function SearchPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Keep typing responsive even if result rendering ever gets heavy.
  const deferredQuery = useDeferredValue(query);
  const progress = useStore(progressStore, (s) => s.questions);

  const results = useMemo<Result[]>(() => {
    if (deferredQuery.trim() === '') return sections.map((s) => ({ kind: 'section', id: s.id }));
    return searchQuestions(index, deferredQuery, 40).map((hit) => ({ kind: 'question', id: hit.id }));
  }, [deferredQuery]);

  // Reset the highlighted row when the result set changes (state adjustment during render).
  const [lastResults, setLastResults] = useState(results);
  if (lastResults !== results) {
    setLastResults(results);
    setActive(0);
  }

  const choose = (result: Result | undefined): void => {
    if (!result) return;
    onClose();
    if (result.kind === 'section') navigate({ name: 'section', sectionId: result.id });
    else {
      const question = questionsById.get(result.id);
      if (question) navigate({ name: 'section', sectionId: question.sectionId, questionId: question.id });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? Math.min(active + 1, results.length - 1) : Math.max(active - 1, 0);
      setActive(next);
      document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    }
  };

  const listId = 'search-results';
  const optionId = (i: number): string => `search-option-${i}`;

  return (
    <div className="search">
      <div className="search-field">
        <Icon name="search" />
        <input
          autoFocus
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-label="Search questions"
          placeholder="Search questions, topics, tags…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close search">
          <Icon name="close" />
        </button>
      </div>
      <p className="search-hint" aria-live="polite">
        {deferredQuery.trim() === ''
          ? 'Jump to a round, or start typing to search every question.'
          : results.length === 0
            ? `No questions match "${deferredQuery}".`
            : `${results.length} ${results.length === 1 ? 'match' : 'matches'}`}
      </p>
      <ul className="search-results" id={listId} role="listbox" aria-label="Results">
        {results.map((result, i) => {
          const isActive = i === active;
          if (result.kind === 'section') {
            const section = sectionsById.get(result.id);
            if (!section) return null;
            return (
              <li
                key={result.id}
                id={optionId(i)}
                role="option"
                aria-selected={isActive}
                className="search-result"
                onMouseMove={() => setActive(i)}
                onClick={() => choose(result)}
              >
                <span className="search-result-title">{section.title}</span>
                <span className="search-result-meta">{section.questions.length} questions</span>
              </li>
            );
          }
          const question = questionsById.get(result.id);
          if (!question) return null;
          return (
            <li
              key={result.id}
              id={optionId(i)}
              role="option"
              aria-selected={isActive}
              className="search-result"
              onMouseMove={() => setActive(i)}
              onClick={() => choose(result)}
            >
              <span className="search-result-title">
                {progress[question.id]?.done ? <Icon name="check" size={14} className="search-done" /> : null}
                <InlineText text={question.title} />
              </span>
              <span className="search-result-meta">
                <LevelChip level={question.level} /> {sectionsById.get(question.sectionId)?.title}
              </span>
              <span className="search-result-summary">{question.summary}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} label="Search questions" className="dialog dialog-search">
      <SearchPanel onClose={onClose} />
    </Dialog>
  );
}
