/**
 * Server mode: the Go backend (backend/, api/) is the source of truth for
 * who you are, what's switched on, and the content itself.
 *
 * The app makes one request before its first render, GET /api/bootstrap. If it
 * answers with `mode: "server"`, content, features and the signed-in user come
 * from there. Anything else (404 on a static host, 503 when no database is
 * configured, a network error, a timeout) leaves the app in its original,
 * fully working local-only mode. A missing backend is never an error.
 */
import { setContent, setServerAnswerLoader } from '../content/index.ts';
import { isLevel, type QuestionMeta, type SectionAnswers, type SectionMeta } from '../content/types.ts';
import { createStore } from '../state/createStore.ts';
import { useStore } from '../state/useStore.ts';
import { announcementStore, type Announcement } from '../features/announcement/announcement.ts';
import { api, apiFetch } from './api.ts';

export type Role = 'owner' | 'admin' | 'learner';

export interface ServerUser {
  id: number;
  login: string;
  name: string;
  avatarUrl: string;
  role: Role;
}

export interface SiteSettings {
  name: string;
  tagline: string;
  registration: 'invite' | 'open';
  contentAccess: 'public' | 'members';
}

export const FEATURE_KEYS = ['review', 'search', 'notes', 'filters', 'progressTransfer', 'levelOverview'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

/** What a deployed but unfinished backend reports (booleans only, never values). */
export interface SetupInfo {
  reason: 'not_configured' | 'unavailable';
  database: boolean;
  github: boolean;
  owner: boolean;
  appUrl: boolean;
}

export interface ServerState {
  /**
   * static: no backend (static host, Artifact, offline) or the visitor chose to study offline.
   * server: backend connected. setup: a backend is deployed but not configured or not reachable.
   */
  mode: 'static' | 'server' | 'setup';
  setup: SetupInfo | null;
  user: ServerUser | null;
  site: SiteSettings;
  features: Features;
  auth: { github: boolean; dev: boolean };
  /** Members-only site and nobody signed in: content is withheld. */
  locked: boolean;
}

const ALL_ON = Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])) as Features;

export const DEFAULT_SITE: SiteSettings = { name: 'Frontend Loop', tagline: '', registration: 'invite', contentAccess: 'public' };

export const serverStore = createStore<ServerState>({
  mode: 'static',
  setup: null,
  user: null,
  site: DEFAULT_SITE,
  features: ALL_ON,
  auth: { github: false, dev: false },
  locked: false,
});

export function useServer(): ServerState {
  return useStore(serverStore, (s) => s);
}

/** Feature flags are always on in local-only mode. */
export function useFeature(key: FeatureKey): boolean {
  return useStore(serverStore, (s) => s.features[key]);
}

export function isAdminRole(role: Role | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/* ---------------------------------------------------------------- parsing (defensive) */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

function parseQuestion(value: unknown): QuestionMeta | null {
  if (!isRecord(value)) return null;
  const level = str(value.level);
  if (!value.id || !isLevel(level)) return null;
  return {
    id: str(value.id),
    sectionId: str(value.sectionId),
    title: str(value.title),
    level,
    tags: Array.isArray(value.tags) ? value.tags.filter((t): t is string => typeof t === 'string') : [],
    minutes: typeof value.minutes === 'number' ? value.minutes : 0,
    summary: str(value.summary),
    searchText: str(value.searchText),
    published: value.published !== false,
  };
}

export function parseSections(value: unknown): SectionMeta[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): SectionMeta[] => {
    if (!isRecord(raw) || typeof raw.id !== 'string') return [];
    const questions = Array.isArray(raw.questions) ? raw.questions.map(parseQuestion).filter((q): q is QuestionMeta => q !== null) : [];
    return [{ id: raw.id, title: str(raw.title), description: str(raw.description), published: raw.published !== false, questions }];
  });
}

function parseUser(value: unknown): ServerUser | null {
  if (!isRecord(value) || typeof value.id !== 'number') return null;
  const role = value.role === 'owner' || value.role === 'admin' ? value.role : 'learner';
  return { id: value.id, login: str(value.login), name: str(value.name), avatarUrl: str(value.avatarUrl), role };
}

function parseSite(value: unknown): SiteSettings {
  if (!isRecord(value)) return DEFAULT_SITE;
  return {
    name: str(value.name, DEFAULT_SITE.name) || DEFAULT_SITE.name,
    tagline: str(value.tagline),
    registration: value.registration === 'open' ? 'open' : 'invite',
    contentAccess: value.contentAccess === 'members' ? 'members' : 'public',
  };
}

function parseFeatures(value: unknown): Features {
  const out = { ...ALL_ON };
  if (isRecord(value)) for (const key of FEATURE_KEYS) if (typeof value[key] === 'boolean') out[key] = value[key];
  return out;
}

export function parseServerAnnouncement(value: unknown): Announcement | null {
  if (!isRecord(value) || typeof value.message !== 'string' || !value.message.trim()) return null;
  const tone = value.tone === 'success' || value.tone === 'warning' ? value.tone : 'info';
  return {
    message: value.message,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    tone,
    linkUrl: str(value.linkUrl),
    linkLabel: str(value.linkLabel),
  };
}

/* ---------------------------------------------------------------- bootstrap */

function apply(body: Record<string, unknown>): void {
  const auth = isRecord(body.auth) ? body.auth : {};
  serverStore.setState(() => ({
    mode: 'server',
    setup: null,
    user: parseUser(body.user),
    site: parseSite(body.site),
    features: parseFeatures(body.features),
    auth: { github: auth.github === true, dev: auth.dev === true },
    locked: body.locked === true,
  }));
  const content = isRecord(body.content) ? body.content : null;
  setContent(content ? parseSections(content.sections) : [], 'server', content && typeof content.version === 'number' ? content.version : -1);
  announcementStore.setState(() => parseServerAnnouncement(body.announcement));
  if (typeof document !== 'undefined') document.title = parseSite(body.site).name;
}

async function fetchBootstrap(timeoutMs: number): Promise<Record<string, unknown> | null> {
  try {
    const body = await api<unknown>('/bootstrap', { timeoutMs });
    return isRecord(body) && body.mode === 'server' ? body : null;
  } catch {
    return null;
  }
}

const OFFLINE_KEY = 'frontend-loop:study-offline';

function parseSetup(body: unknown): SetupInfo | null {
  if (!isRecord(body) || !isRecord(body.setup) || !isRecord(body.error)) return null;
  const code = body.error.code;
  if (code !== 'not_configured' && code !== 'unavailable') return null;
  const s = body.setup;
  return { reason: code, database: s.database === true, github: s.github === true, owner: s.owner === true, appUrl: s.appUrl === true };
}

export type BackendMode = 'server' | 'setup' | 'none';

/**
 * Probe for the backend once, before the first render.
 * - 'server': connected; content, settings and the user come from the API.
 * - 'setup': an API is deployed here but not configured (or its database is
 *   unreachable); the app shows a setup checklist instead of pretending to sync.
 * - 'none': no API at all (static host, Artifact build); local-only mode.
 */
export async function connectBackend(timeoutMs = 10_000): Promise<BackendMode> {
  if (typeof __BACKEND__ === 'undefined' || !__BACKEND__) return 'none';
  let body: unknown = null;
  let status = 0;
  try {
    const res = await apiFetch('/bootstrap', { timeoutMs });
    status = res.status;
    if ((res.headers.get('Content-Type') ?? '').includes('application/json')) body = await res.json();
  } catch {
    return 'none';
  }
  if (status === 200 && isRecord(body) && body.mode === 'server') {
    setServerAnswerLoader(async (sectionId) => {
      const res = await api<{ answers?: SectionAnswers }>(`/content/sections/${encodeURIComponent(sectionId)}`);
      return res.answers ?? {};
    });
    apply(body);
    return 'server';
  }
  const setup = status === 503 ? parseSetup(body) : null;
  if (setup) {
    let offline = false;
    try {
      offline = sessionStorage.getItem(OFFLINE_KEY) === '1';
    } catch {
      offline = false;
    }
    if (offline) return 'none';
    serverStore.setState((s) => ({ ...s, mode: 'setup', setup }));
    return 'setup';
  }
  return 'none';
}

/** From the setup screen: study with local-only progress for this browser session. */
export function continueOffline(): void {
  try {
    sessionStorage.setItem(OFFLINE_KEY, '1');
  } catch {
    // Without sessionStorage the choice lasts until reload, which is fine.
  }
  serverStore.setState((s) => ({ ...s, mode: 'static' }));
}

/** Re-read content and settings, e.g. after an admin saves something. */
export async function refreshBootstrap(): Promise<void> {
  if (serverStore.getState().mode !== 'server') return;
  const body = await fetchBootstrap(15_000);
  if (body) apply(body);
}

/* ---------------------------------------------------------------- sign-in */

/** Where "Sign in with GitHub" goes. Returns to the current in-app route afterwards. */
export function signInUrl(invite?: string): string {
  const params = new URLSearchParams();
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  if (/^#[A-Za-z0-9_-]{1,100}$/.test(hash)) params.set('next', hash);
  if (invite) params.set('invite', invite);
  const query = params.toString();
  return `/api/auth/github/start${query ? `?${query}` : ''}`;
}

/** Local development / E2E only (the server refuses it unless DEV_LOGIN=1 outside production). */
export async function devSignIn(login: string, invite?: string): Promise<void> {
  await api('/auth/dev-login', { method: 'POST', body: invite ? { login, invite } : { login } });
}

export async function signOut(): Promise<void> {
  await api('/auth/logout', { method: 'POST' });
}

export async function deleteAccount(): Promise<void> {
  await api('/me', { method: 'DELETE' });
}

export interface InviteInfo {
  status: 'active' | 'used' | 'expired' | 'revoked' | 'invalid';
  role?: Role;
  invitedBy?: string | null;
  siteName?: string;
}

export function fetchInvite(token: string): Promise<InviteInfo> {
  return api<InviteInfo>(`/invites/${encodeURIComponent(token)}`);
}

export const AUTH_ERRORS: Record<string, string> = {
  not_invited: "Your GitHub account isn't on the list yet. Ask the admin for an invite link, then open it and sign in again.",
  disabled: 'This account has been disabled by an admin.',
  denied: 'GitHub sign-in was cancelled.',
  state: 'That sign-in link expired or was opened in another browser. Please try again.',
  expired: 'The sign-in took too long. Please try again.',
  github: "GitHub didn't confirm the sign-in. Please try again.",
  server: 'Something went wrong on our side while signing you in. Please try again.',
};
