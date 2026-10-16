/**
 * The progress domain model: pure, immutable, framework-free.
 *
 * Every function takes the previous state and returns the next one (or the
 * same object when nothing changed, so subscribers can bail out cheaply).
 * `now` is always passed in, which keeps these functions deterministic and
 * trivially testable.
 */
import { nextDueAt } from '../lib/srs.ts';

export interface QuestionProgress {
  done: boolean;
  doneAt: number | null;
  /** Index into the review ladder (see lib/srs.ts). */
  stage: number;
  /** When this answer is due for a refresher; null when not done. */
  dueAt: number | null;
  /** The learner's own words. Capped to keep the synced document small. */
  notes: string;
  /** Last-write-wins clock used when merging devices/tabs. */
  updatedAt: number;
}

export interface LastVisit {
  sectionId: string;
  questionId: string | null;
  at: number;
}

export interface ProgressState {
  version: 1;
  questions: Record<string, QuestionProgress>;
  lastVisit: LastVisit | null;
}

export const NOTES_LIMIT = 2000;

export const EMPTY_PROGRESS: ProgressState = { version: 1, questions: {}, lastVisit: null };

export type ReviewOutcome = 'solid' | 'shaky';

function blank(): QuestionProgress {
  return { done: false, doneAt: null, stage: 0, dueAt: null, notes: '', updatedAt: 0 };
}

function patch(state: ProgressState, id: string, change: Partial<QuestionProgress>, now: number): ProgressState {
  const previous = state.questions[id] ?? blank();
  return {
    ...state,
    questions: { ...state.questions, [id]: { ...previous, ...change, updatedAt: now } },
  };
}

export function getQuestion(state: ProgressState, id: string): QuestionProgress {
  return state.questions[id] ?? blank();
}

export function setDone(state: ProgressState, id: string, done: boolean, now: number): ProgressState {
  if (getQuestion(state, id).done === done) return state;
  return done
    ? patch(state, id, { done: true, doneAt: now, stage: 0, dueAt: nextDueAt(0, now) }, now)
    : patch(state, id, { done: false, doneAt: null, stage: 0, dueAt: null }, now);
}

export function recordReview(state: ProgressState, id: string, outcome: ReviewOutcome, now: number): ProgressState {
  const current = state.questions[id];
  if (!current?.done) return state;
  if (outcome === 'shaky') return setDone(state, id, false, now);
  const stage = current.stage + 1;
  return patch(state, id, { stage, dueAt: nextDueAt(stage, now) }, now);
}

export function setNotes(state: ProgressState, id: string, notes: string, now: number): ProgressState {
  const clipped = notes.slice(0, NOTES_LIMIT);
  if (getQuestion(state, id).notes === clipped) return state;
  return patch(state, id, { notes: clipped }, now);
}

export function recordVisit(state: ProgressState, sectionId: string, questionId: string | null, now: number): ProgressState {
  const last = state.lastVisit;
  if (last && last.sectionId === sectionId && last.questionId === questionId) return state;
  return { ...state, lastVisit: { sectionId, questionId, at: now } };
}

export function isDue(progress: QuestionProgress | undefined, now: number): boolean {
  return Boolean(progress?.done && progress.dueAt !== null && progress.dueAt <= now);
}

/**
 * Merge two replicas (two tabs, or this device and the cloud copy).
 * Per question, the entry with the newest `updatedAt` wins; ties keep `a`.
 * This is a last-writer-wins map: a simple CRDT that converges as long as
 * clocks are roughly right, which is good enough for one person's progress.
 */
export function mergeProgress(a: ProgressState, b: ProgressState): ProgressState {
  const questions: Record<string, QuestionProgress> = { ...a.questions };
  for (const [id, incoming] of Object.entries(b.questions)) {
    const existing = questions[id];
    if (!existing || incoming.updatedAt > existing.updatedAt) questions[id] = incoming;
  }
  let lastVisit = a.lastVisit;
  if (b.lastVisit && (!lastVisit || b.lastVisit.at > lastVisit.at)) lastVisit = b.lastVisit;
  return { version: 1, questions, lastVisit };
}

function sameQuestion(a: QuestionProgress, b: QuestionProgress): boolean {
  return (
    a.done === b.done &&
    a.doneAt === b.doneAt &&
    a.stage === b.stage &&
    a.dueAt === b.dueAt &&
    a.notes === b.notes &&
    a.updatedAt === b.updatedAt
  );
}

export function progressEquals(a: ProgressState, b: ProgressState): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a.questions);
  if (aKeys.length !== Object.keys(b.questions).length) return false;
  for (const key of aKeys) {
    const left = a.questions[key];
    const right = b.questions[key];
    if (!left || !right || !sameQuestion(left, right)) return false;
  }
  const la = a.lastVisit;
  const lb = b.lastVisit;
  if (la === null || lb === null) return la === lb;
  return la.sectionId === lb.sectionId && la.questionId === lb.questionId && la.at === lb.at;
}

/* ---------- Parsing untrusted input (localStorage, imports, cloud) ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseQuestion(value: unknown): QuestionProgress | null {
  if (!isRecord(value)) return null;
  const { done, doneAt, stage, dueAt, notes, updatedAt } = value;
  if (typeof done !== 'boolean' || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;
  return {
    done,
    doneAt: finiteOrNull(doneAt),
    stage: typeof stage === 'number' && stage >= 0 ? Math.floor(stage) : 0,
    dueAt: finiteOrNull(dueAt),
    notes: typeof notes === 'string' ? notes.slice(0, NOTES_LIMIT) : '',
    updatedAt,
  };
}

function parseLastVisit(value: unknown): LastVisit | null {
  if (!isRecord(value)) return null;
  const { sectionId, questionId, at } = value;
  if (typeof sectionId !== 'string' || typeof at !== 'number') return null;
  return { sectionId, questionId: typeof questionId === 'string' ? questionId : null, at };
}

/** Validate anything that claims to be progress. Invalid entries are dropped, not trusted. */
export function parseProgress(input: unknown): ProgressState | null {
  if (!isRecord(input) || input.version !== 1 || !isRecord(input.questions)) return null;
  const questions: Record<string, QuestionProgress> = {};
  for (const [id, value] of Object.entries(input.questions)) {
    const parsed = parseQuestion(value);
    if (parsed) questions[id] = parsed;
  }
  return { version: 1, questions, lastVisit: parseLastVisit(input.lastVisit) };
}

/** A plain object view for storage APIs that expect `Record<string, unknown>`. */
export function toDocument(state: ProgressState): Record<string, unknown> {
  return { version: state.version, questions: state.questions, lastVisit: state.lastVisit };
}
