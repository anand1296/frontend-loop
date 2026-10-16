/**
 * The subset of the claude.ai Artifact runtime this app uses (contract 0.2.81).
 *
 * When the app is hosted as a claude.ai Artifact, `window.claude.use("db" | "user")`
 * gives a document store with access rules and facts about the viewer. Anywhere
 * else (Vercel, localhost) `window.claude` is undefined and the app runs
 * local-only. Typed narrowly on purpose: we only declare what we call.
 */
export {};

declare global {
  interface ClaudeDbError {
    code: string;
    message: string;
  }

  interface ClaudeDocSnapshot {
    id?: string;
    exists: boolean;
    data(): Record<string, unknown> | undefined;
    metadata: { fromCache: boolean; hasPendingWrites: boolean };
  }

  interface ClaudeQuerySnapshot {
    docs: ClaudeDocSnapshot[];
    size: number;
    empty: boolean;
  }

  interface ClaudeDocRef {
    set(data: Record<string, unknown>): Promise<void>;
    delete(): Promise<void>;
    onSnapshot(next: (snapshot: ClaudeDocSnapshot) => void, error?: (error: ClaudeDbError) => void): () => void;
  }

  interface ClaudeQuery {
    orderBy(field: string, dir?: 'asc' | 'desc'): ClaudeQuery;
    limit(n: number): ClaudeQuery;
    onSnapshot(next: (snapshot: ClaudeQuerySnapshot) => void, error?: (error: ClaudeDbError) => void): () => void;
  }

  interface ClaudeCollectionRef extends ClaudeQuery {
    doc(id: string): ClaudeDocRef;
  }

  interface ClaudeDb {
    doc(path: string): ClaudeDocRef;
    collection(path: string): ClaudeCollectionRef;
  }

  interface ClaudeProfile {
    id: string;
    name: string;
    avatarUrl: string;
    color: string;
    isMe: boolean;
    guest: boolean;
  }

  interface ClaudeUser {
    id(): Promise<string | null>;
    isOwner(): Promise<boolean>;
    canEdit(): Promise<boolean>;
    can(capability: string): Promise<boolean | null>;
    profiles(ids: readonly string[]): Promise<Record<string, ClaudeProfile>>;
  }

  interface ClaudeCapabilities {
    db: ClaudeDb;
    user: ClaudeUser;
  }

  interface ClaudeRuntime {
    use<K extends keyof ClaudeCapabilities>(name: K): Promise<ClaudeCapabilities[K] | null>;
  }

  interface Window {
    claude?: ClaudeRuntime;
  }
}
