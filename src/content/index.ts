/**
 * The app-facing content API. Components read content through `useContent()`
 * (or `getContent()` outside React), never from the virtual module directly,
 * so the source can change in one place:
 *
 * - bundled: compiled from content/*.md at build time (static hosting, the
 *   claude.ai Artifact, offline). Answer HTML is code-split per round.
 * - server: served by the Go backend from Postgres, editable in the admin
 *   console. Swapped in by `setContent()` before the first render and again
 *   whenever an admin changes something.
 */
import { loaders, sections as bundledSections } from 'virtual:content';
import { createStore } from '../state/createStore.ts';
import { useStore } from '../state/useStore.ts';
import type { QuestionMeta, SectionAnswers, SectionMeta } from './types.ts';

export type ContentSource = 'bundled' | 'server';

export interface ContentState {
  source: ContentSource;
  /** Server content version (changes on every edit); 0 for bundled content. */
  version: number;
  sections: SectionMeta[];
  allQuestions: QuestionMeta[];
  sectionsById: Map<string, SectionMeta>;
  questionsById: Map<string, QuestionMeta>;
  totalMinutes: number;
}

function build(sections: SectionMeta[], source: ContentSource, version: number): ContentState {
  const allQuestions = sections.flatMap((section) => section.questions);
  return {
    source,
    version,
    sections,
    allQuestions,
    sectionsById: new Map(sections.map((section) => [section.id, section])),
    questionsById: new Map(allQuestions.map((question) => [question.id, question])),
    totalMinutes: allQuestions.reduce((sum, question) => sum + question.minutes, 0),
  };
}

export const contentStore = createStore<ContentState>(build(bundledSections, 'bundled', 0));

export function getContent(): ContentState {
  return contentStore.getState();
}

export function useContent(): ContentState {
  return useStore(contentStore, (state) => state);
}

/** Replace the content (server mode). Cached answers for older versions are dropped. */
export function setContent(sections: SectionMeta[], source: ContentSource, version: number): void {
  const current = contentStore.getState();
  if (current.source === source && current.version === version && source === 'server') return;
  answerCache.clear();
  contentStore.setState(() => build(sections, source, version));
}

/** Where server-mode answers come from. Set by the backend client. */
let fetchServerAnswers: ((sectionId: string) => Promise<SectionAnswers>) | null = null;

export function setServerAnswerLoader(loader: (sectionId: string) => Promise<SectionAnswers>): void {
  fetchServerAnswers = loader;
}

const answerCache = new Map<string, Promise<SectionAnswers>>();

/**
 * Returns a cached promise per section so React's `use()` sees a stable
 * promise across renders. A failed load is evicted so "Try again" can refetch.
 */
export function loadAnswers(sectionId: string): Promise<SectionAnswers> {
  const { source, version } = contentStore.getState();
  const key = `${source}:${version}:${sectionId}`;
  const cached = answerCache.get(key);
  if (cached) return cached;
  let promise: Promise<SectionAnswers>;
  if (source === 'server' && fetchServerAnswers) {
    promise = fetchServerAnswers(sectionId);
  } else {
    const loader = loaders[sectionId];
    promise = loader ? loader().then((module) => module.default) : Promise.reject(new Error(`Unknown section "${sectionId}"`));
  }
  promise.catch(() => answerCache.delete(key));
  answerCache.set(key, promise);
  return promise;
}

/** Warm a section's answers on hover/focus so opening it feels instant. */
export function preloadSection(sectionId: string): void {
  loadAnswers(sectionId).catch(() => {});
}

export function sectionIndex(sectionId: string): number {
  return contentStore.getState().sections.findIndex((section) => section.id === sectionId);
}
