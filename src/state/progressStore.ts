/**
 * The app's progress store plus the only functions that change it.
 * Components call `progressActions.*`; they never build state themselves.
 */
import { createStore } from './createStore.ts';
import {
  EMPTY_PROGRESS,
  mergeProgress,
  progressEquals,
  recordReview,
  recordVisit,
  setDone,
  setNotes,
  type ProgressState,
  type ReviewOutcome,
} from './progress.ts';
import { loadProgress, onOtherTabWrite, saveProgress } from './persistence/local.ts';
import { startCloudSync } from './persistence/cloudSync.ts';
import { computeSummary } from './summary.ts';
import { sections } from '../content/index.ts';

export const progressStore = createStore<ProgressState>(EMPTY_PROGRESS);

const now = (): number => Date.now();

export const progressActions = {
  setDone(id: string, done: boolean): void {
    progressStore.setState((s) => setDone(s, id, done, now()));
  },
  review(id: string, outcome: ReviewOutcome): void {
    progressStore.setState((s) => recordReview(s, id, outcome, now()));
  },
  saveNotes(id: string, notes: string): void {
    progressStore.setState((s) => setNotes(s, id, notes, now()));
  },
  visit(sectionId: string, questionId: string | null): void {
    progressStore.setState((s) => recordVisit(s, sectionId, questionId, now()));
  },
  importProgress(incoming: ProgressState, mode: 'merge' | 'replace'): void {
    progressStore.setState((s) => (mode === 'merge' ? mergeProgress(s, incoming) : incoming));
  },
  /**
   * Reset keeps question entries as "not done" tombstones with a fresh clock
   * instead of deleting them, so the reset wins when merged with other devices.
   */
  reset(): void {
    progressStore.setState((s) => {
      const t = now();
      const questions: ProgressState['questions'] = {};
      for (const id of Object.keys(s.questions)) {
        questions[id] = { done: false, doneAt: null, stage: 0, dueAt: null, notes: '', updatedAt: t };
      }
      return { version: 1, questions, lastVisit: null };
    });
  },
};

let initialized = false;

/** Boot persistence once: hydrate, save on change, follow other tabs, try cloud sync. */
export function initProgress(): void {
  if (initialized) return;
  initialized = true;
  progressStore.setState(() => loadProgress());
  progressStore.subscribe(() => saveProgress(progressStore.getState()));
  onOtherTabWrite((incoming) => {
    progressStore.setState((s) => {
      const merged = mergeProgress(s, incoming);
      return progressEquals(merged, s) ? s : merged;
    });
  });
  void startCloudSync(progressStore, (state) => computeSummary(sections, state));
}
