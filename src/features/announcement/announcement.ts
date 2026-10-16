/**
 * A single announcement the owner can show to everyone (exam dates, new rounds,
 * study-group sessions). Stored in one shared document that everyone can read
 * and only the owner can write (enforced by the access rules, not just the UI).
 */
import { createStore } from '../../state/createStore.ts';
import { readJson, writeJson } from '../../state/persistence/local.ts';
import { getPlatform, paths } from '../../platform/runtime.ts';

export interface Announcement {
  message: string;
  updatedAt: number;
}

export const ANNOUNCEMENT_LIMIT = 280;
const DISMISSED_KEY = 'frontend-loop:announcement-dismissed';

export const announcementStore = createStore<Announcement | null>(null);
export const dismissedStore = createStore<number>(0);

export function parseAnnouncement(input: unknown): Announcement | null {
  if (typeof input !== 'object' || input === null) return null;
  const message = 'message' in input ? input.message : undefined;
  const updatedAt = 'updatedAt' in input ? input.updatedAt : undefined;
  if (typeof message !== 'string' || typeof updatedAt !== 'number') return null;
  const trimmed = message.trim().slice(0, ANNOUNCEMENT_LIMIT);
  return trimmed ? { message: trimmed, updatedAt } : null;
}

let started = false;

export async function initAnnouncement(): Promise<void> {
  if (started) return;
  started = true;
  const saved = readJson(DISMISSED_KEY);
  if (typeof saved === 'number') dismissedStore.setState(() => saved);
  const platform = await getPlatform();
  if (!platform) return;
  platform.db.doc(paths.announcement).onSnapshot(
    (snapshot) => announcementStore.setState(() => (snapshot.exists ? parseAnnouncement(snapshot.data()) : null)),
    () => announcementStore.setState(() => null),
  );
}

export function dismissAnnouncement(updatedAt: number): void {
  dismissedStore.setState(() => updatedAt);
  writeJson(DISMISSED_KEY, updatedAt);
}

/** Owner only. Rejects if the store refuses the write (e.g. not the owner). */
export async function publishAnnouncement(message: string): Promise<void> {
  const platform = await getPlatform();
  if (!platform) throw new Error('Announcements need the hosted version of the app.');
  await platform.db.doc(paths.announcement).set({ message: message.trim().slice(0, ANNOUNCEMENT_LIMIT), updatedAt: Date.now() });
}
