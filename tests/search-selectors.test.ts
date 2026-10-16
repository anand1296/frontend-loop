import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { QuestionMeta, SectionMeta } from '../src/content/types.ts';
import { buildSearchIndex, searchQuestions, tokenize } from '../src/lib/search.ts';
import { continueTarget, dueQuestions } from '../src/state/selectors.ts';
import { EMPTY_PROGRESS, recordVisit, setDone } from '../src/state/progress.ts';
import { DAY_MS } from '../src/lib/srs.ts';

function q(id: string, sectionId: string, title: string, tags: string[] = [], summary = ''): QuestionMeta {
  return { id, sectionId, title, level: 'senior', tags, minutes: 5, summary, searchText: '' };
}

const sections: SectionMeta[] = [
  {
    id: 'js',
    title: 'JavaScript',
    description: '',
    questions: [q('loop', 'js', 'Explain the event loop', ['event loop']), q('closures', 'js', 'Closures and memory leaks', ['memory'])],
  },
  {
    id: 'react',
    title: 'React',
    description: '',
    questions: [
      q('effects', 'react', 'When you do not need `useEffect`', ['effects'], 'Effects synchronize with external systems'),
      q('memo', 'react', 'When does a component re-render?', ['memo', 'performance']),
    ],
  },
];

describe('search', () => {
  const index = buildSearchIndex(sections);

  it('tokenizes on whitespace and commas', () => {
    assert.deepEqual(tokenize('  Event, Loop  '), ['event', 'loop']);
  });

  it('ranks title matches first and requires every token to match', () => {
    assert.equal(searchQuestions(index, 'useeffect')[0]?.id, 'effects');
    assert.deepEqual(searchQuestions(index, 'event loop').map((h) => h.id), ['loop']);
    assert.deepEqual(searchQuestions(index, 'event nonsense'), []);
  });

  it('matches tags, summaries and section titles', () => {
    assert.equal(searchQuestions(index, 'performance')[0]?.id, 'memo');
    assert.equal(searchQuestions(index, 'synchronize')[0]?.id, 'effects');
    assert.equal(searchQuestions(index, 'react').length, 2);
  });
});

describe('continueTarget', () => {
  it('starts at the first question with no history', () => {
    assert.deepEqual(continueTarget(sections, EMPTY_PROGRESS), { sectionId: 'js', questionId: 'loop', resumed: false });
  });

  it('resumes the last opened question if it is not done', () => {
    const s = recordVisit(EMPTY_PROGRESS, 'react', 'effects', 1);
    assert.deepEqual(continueTarget(sections, s), { sectionId: 'react', questionId: 'effects', resumed: true });
  });

  it('moves to the next not-done question after the last one, wrapping around', () => {
    let s = setDone(EMPTY_PROGRESS, 'memo', true, 1);
    s = recordVisit(s, 'react', 'memo', 2);
    assert.equal(continueTarget(sections, s)?.questionId, 'loop');
  });

  it('returns null when everything is done', () => {
    let s = EMPTY_PROGRESS;
    for (const id of ['loop', 'closures', 'effects', 'memo']) s = setDone(s, id, true, 1);
    assert.equal(continueTarget(sections, s), null);
  });
});

describe('dueQuestions', () => {
  it('lists done answers whose review date has passed, oldest first', () => {
    let s = setDone(EMPTY_PROGRESS, 'memo', true, 0);
    s = setDone(s, 'loop', true, DAY_MS);
    const all = sections.flatMap((x) => x.questions);
    assert.deepEqual(dueQuestions(all, s.questions, 1).map((x) => x.id), []);
    assert.deepEqual(dueQuestions(all, s.questions, 30 * DAY_MS).map((x) => x.id), ['memo', 'loop']);
  });
});
