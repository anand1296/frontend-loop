/**
 * Tiny spaced-repetition schedule.
 *
 * When you mark an answer done, it comes back for a quick refresher after
 * 2 days; each "still solid" pushes it further out. "Needs another pass"
 * un-marks it so it returns to your to-do list. Deliberately simpler than
 * SM-2/FSRS: interview prep is weeks long, not years, and a fixed ladder is
 * easy to explain and to trust.
 */
export const REVIEW_INTERVAL_DAYS = [2, 5, 12, 30, 75] as const;

export const DAY_MS = 86_400_000;

export function intervalDays(stage: number): number {
  const last = REVIEW_INTERVAL_DAYS[REVIEW_INTERVAL_DAYS.length - 1] ?? 75;
  return REVIEW_INTERVAL_DAYS[Math.max(0, Math.min(stage, REVIEW_INTERVAL_DAYS.length - 1))] ?? last;
}

export function nextDueAt(stage: number, now: number): number {
  return now + intervalDays(stage) * DAY_MS;
}
