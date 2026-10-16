/**
 * Content contracts shared by the build-time compiler (build/content) and the app.
 * The compiler produces these shapes; the app only ever consumes them.
 */

export const LEVELS = ['senior', 'lead', 'principal'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABEL: Record<Level, string> = {
  senior: 'Senior',
  lead: 'Lead / Staff',
  principal: 'Principal',
};

export function isLevel(value: string): value is Level {
  return LEVELS.some((level) => level === value);
}

/** Lightweight, eagerly loaded metadata for one question. Answer HTML is loaded per section. */
export interface QuestionMeta {
  /** Stable id. Progress is keyed by it, so it must never change once published. */
  id: string;
  sectionId: string;
  title: string;
  level: Level;
  tags: string[];
  /** Rough time to study the answer properly. */
  minutes: number;
  /** Plain-text TL;DR, used in search results and review cards. */
  summary: string;
  /** Lower-cased extra text (headings + opening paragraphs) used only for search. */
  searchText: string;
  /** Server mode only: false for drafts, which only admins receive. */
  published?: boolean;
  /** Server mode only: GitHub login of the community member who contributed it (if they chose credit). */
  contributor?: string;
}

export interface SectionMeta {
  id: string;
  title: string;
  /** One-line description shown on the overview. */
  description: string;
  questions: QuestionMeta[];
  /** Server mode only: false for draft rounds, which only admins receive. */
  published?: boolean;
}

/** questionId -> sanitized, pre-highlighted answer HTML. */
export type SectionAnswers = Record<string, string>;

export interface ContentModule {
  sections: SectionMeta[];
  loaders: Record<string, () => Promise<{ default: SectionAnswers }>>;
}
