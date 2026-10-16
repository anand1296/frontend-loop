/**
 * The progress summary a learner shares with the app's owner.
 *
 * Deliberately coarse: counts per round and last activity. Notes, review
 * dates and per-question detail stay in the learner's private document.
 * Derived only from progress data (never from the clock), so it changes only
 * when the learner actually does something and never causes write churn.
 */
import type { SectionMeta } from '../content/types.ts';
import type { ProgressState } from './progress.ts';

export interface LearnerSummary {
  doneCount: number;
  total: number;
  byRound: Record<string, number>;
  lastActiveAt: number;
  lastSectionId: string | null;
  version: 1;
}

export function computeSummary(sections: SectionMeta[], state: ProgressState): LearnerSummary {
  const byRound: Record<string, number> = {};
  let doneCount = 0;
  let total = 0;
  for (const section of sections) {
    let done = 0;
    for (const question of section.questions) {
      total += 1;
      if (state.questions[question.id]?.done) done += 1;
    }
    byRound[section.id] = done;
    doneCount += done;
  }
  let lastActiveAt = state.lastVisit?.at ?? 0;
  for (const entry of Object.values(state.questions)) lastActiveAt = Math.max(lastActiveAt, entry.updatedAt);
  return { doneCount, total, byRound, lastActiveAt, lastSectionId: state.lastVisit?.sectionId ?? null, version: 1 };
}

export function summaryEquals(a: LearnerSummary, b: LearnerSummary): boolean {
  if (a.doneCount !== b.doneCount || a.total !== b.total || a.lastActiveAt !== b.lastActiveAt || a.lastSectionId !== b.lastSectionId) {
    return false;
  }
  const keys = Object.keys(a.byRound);
  return keys.length === Object.keys(b.byRound).length && keys.every((key) => a.byRound[key] === b.byRound[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a summary read from the shared store (written by other people: untrusted). */
export function parseSummary(input: unknown): LearnerSummary | null {
  if (!isRecord(input) || input.version !== 1) return null;
  const { doneCount, total, byRound, lastActiveAt, lastSectionId } = input;
  if (typeof doneCount !== 'number' || typeof total !== 'number' || typeof lastActiveAt !== 'number' || !isRecord(byRound)) return null;
  const rounds: Record<string, number> = {};
  for (const [key, value] of Object.entries(byRound)) if (typeof value === 'number') rounds[key] = value;
  return {
    doneCount: Math.max(0, Math.floor(doneCount)),
    total: Math.max(0, Math.floor(total)),
    byRound: rounds,
    lastActiveAt,
    lastSectionId: typeof lastSectionId === 'string' ? lastSectionId : null,
    version: 1,
  };
}

export function summaryDocument(summary: LearnerSummary): Record<string, unknown> {
  return { ...summary };
}
