/**
 * One place that talks to the hosting platform.
 *
 * Hosted as a claude.ai Artifact, the page gets a per-viewer identity (`user`)
 * and a document store with access rules (`db`). The artifact's owner is the
 * app's super admin. Everywhere else this resolves to "local" and every
 * platform feature (sync, admin, announcements) stays hidden.
 */
import { createStore } from '../state/createStore.ts';

export interface Platform {
  db: ClaudeDb;
  user: ClaudeUser;
  uid: string;
  isOwner: boolean;
}

export type Role = 'unknown' | 'local' | 'learner' | 'owner';

export interface PlatformState {
  role: Role;
  uid: string | null;
}

export const platformStore = createStore<PlatformState>({ role: 'unknown', uid: null });

let pending: Promise<Platform | null> | null = null;

async function connect(): Promise<Platform | null> {
  const runtime = typeof window === 'undefined' ? undefined : window.claude;
  if (!runtime || typeof runtime.use !== 'function') return null;
  try {
    const [db, user] = await Promise.all([runtime.use('db'), runtime.use('user')]);
    if (!db || !user) return null;
    const [uid, isOwner] = await Promise.all([user.id(), user.isOwner()]);
    if (!uid) return null;
    return { db, user, uid, isOwner };
  } catch {
    return null;
  }
}

/** Resolves once; every caller shares the same connection. */
export function getPlatform(): Promise<Platform | null> {
  pending ??= connect().then((platform) => {
    platformStore.setState(() =>
      platform ? { role: platform.isOwner ? 'owner' : 'learner', uid: platform.uid } : { role: 'local', uid: null },
    );
    return platform;
  });
  return pending;
}

/** The hosted app's address, used by the admin "copy invite link" button. */
export const HOSTED_URL = 'https://claude.ai/artifact/WXur8AanHGrgRZpkh4Jg9i';

/** Document paths. Access rules for each are declared at publish time (see docs/ADMIN.md). */
export const paths = {
  /** Full progress, private to each viewer (platform rule: nobody else, not even the owner, can read it). */
  progress: (uid: string) => `data/users/${uid}/progress`,
  /** Progress summary per learner: written by its learner, readable only by the owner. */
  learnersCollection: 'learners',
  learner: (uid: string) => `learners/${uid}`,
  /** Announcement shown to everyone; only the owner can write it. */
  announcement: 'config/announcement',
} as const;
