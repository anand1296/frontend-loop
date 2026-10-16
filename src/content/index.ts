/**
 * The app-facing content API. Components import from here, never from the
 * virtual module directly, so the content source can change in one place.
 */
import { loaders, sections } from 'virtual:content';
import type { QuestionMeta, SectionAnswers, SectionMeta } from './types.ts';

export { sections };

export const allQuestions: QuestionMeta[] = sections.flatMap((section) => section.questions);

export const sectionsById = new Map<string, SectionMeta>(sections.map((section) => [section.id, section]));

export const questionsById = new Map<string, QuestionMeta>(allQuestions.map((question) => [question.id, question]));

export const totalMinutes = allQuestions.reduce((sum, question) => sum + question.minutes, 0);

const answerCache = new Map<string, Promise<SectionAnswers>>();

/**
 * Returns a cached promise per section so React's `use()` sees a stable
 * promise across renders. A failed load is evicted so "Try again" can refetch.
 */
export function loadAnswers(sectionId: string): Promise<SectionAnswers> {
  const cached = answerCache.get(sectionId);
  if (cached) return cached;
  const loader = loaders[sectionId];
  const promise = loader
    ? loader().then((module) => module.default)
    : Promise.reject(new Error(`Unknown section "${sectionId}"`));
  promise.catch(() => answerCache.delete(sectionId));
  answerCache.set(sectionId, promise);
  return promise;
}

/** Warm a section's chunk on hover/focus so opening it feels instant. */
export function preloadSection(sectionId: string): void {
  loadAnswers(sectionId).catch(() => {});
}

export function sectionIndex(sectionId: string): number {
  return sections.findIndex((section) => section.id === sectionId);
}
