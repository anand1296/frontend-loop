/**
 * Derived data. Pure functions of (content, progress, now) so they are easy to
 * test and cheap to memoize in components.
 */
import type { QuestionMeta, SectionMeta } from '../content/types.ts';
import { isDue, type ProgressState, type QuestionProgress } from './progress.ts';

type ProgressMap = Record<string, QuestionProgress>;

export function isDone(progress: ProgressMap, id: string): boolean {
  return progress[id]?.done ?? false;
}

export function doneCount(questions: QuestionMeta[], progress: ProgressMap): number {
  return questions.reduce((count, question) => count + (isDone(progress, question.id) ? 1 : 0), 0);
}

export function dueQuestions(questions: QuestionMeta[], progress: ProgressMap, now: number): QuestionMeta[] {
  return questions
    .filter((question) => isDue(progress[question.id], now))
    .sort((a, b) => (progress[a.id]?.dueAt ?? 0) - (progress[b.id]?.dueAt ?? 0));
}

export function upcomingQuestions(questions: QuestionMeta[], progress: ProgressMap, now: number, withinDays: number): QuestionMeta[] {
  const horizon = now + withinDays * 86_400_000;
  return questions
    .filter((question) => {
      const entry = progress[question.id];
      return Boolean(entry?.done && entry.dueAt !== null && entry.dueAt > now && entry.dueAt <= horizon);
    })
    .sort((a, b) => (progress[a.id]?.dueAt ?? 0) - (progress[b.id]?.dueAt ?? 0));
}

export interface ContinueTarget {
  sectionId: string;
  questionId: string;
  /** True when this is where the learner actually stopped (vs. the next to-do). */
  resumed: boolean;
}

/**
 * Where "Continue" should take you:
 * 1. the question you last opened, if it isn't done yet;
 * 2. otherwise the next not-done question after it, wrapping across sections;
 * 3. with no history, the first not-done question in the learning path.
 */
export function continueTarget(sections: SectionMeta[], state: ProgressState): ContinueTarget | null {
  const ordered = sections.flatMap((section) => section.questions);
  if (ordered.length === 0) return null;
  const last = state.lastVisit;

  let start = 0;
  if (last) {
    const lastIndex = last.questionId ? ordered.findIndex((q) => q.id === last.questionId) : -1;
    if (lastIndex >= 0) {
      const lastQuestion = ordered[lastIndex];
      if (lastQuestion && !isDone(state.questions, lastQuestion.id)) {
        return { sectionId: lastQuestion.sectionId, questionId: lastQuestion.id, resumed: true };
      }
      start = lastIndex + 1;
    } else {
      const firstInSection = ordered.findIndex((q) => q.sectionId === last.sectionId);
      start = Math.max(0, firstInSection);
    }
  }

  for (let offset = 0; offset < ordered.length; offset++) {
    const question = ordered[(start + offset) % ordered.length];
    if (question && !isDone(state.questions, question.id)) {
      return { sectionId: question.sectionId, questionId: question.id, resumed: false };
    }
  }
  return null;
}
