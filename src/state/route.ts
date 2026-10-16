/**
 * Hash routing with a single bare token: "#review", "#react-internals", or a
 * question id like "#event-loop-rendering-order". Section and question ids
 * share one namespace (the content compiler enforces uniqueness), so one token
 * is enough and every URL is shareable.
 *
 * Why not React Router: three views, no nested layouts, no loaders. The
 * router is ~40 lines and works inside sandboxed hosts where only a plain
 * #anchor survives.
 */
import { contentStore, getContent } from '../content/index.ts';
import { createStore } from './createStore.ts';

export type Route =
  | { name: 'overview' }
  | { name: 'review' }
  | { name: 'admin' }
  | { name: 'contribute' }
  /** "How it's built": the index (`walkthroughId: null`) or one walkthrough. */
  | { name: 'howItsBuilt'; walkthroughId: string | null }
  /** `focusAt` changes on every navigation, so re-selecting the same question re-scrolls. */
  | { name: 'section'; sectionId: string; questionId: string | null; focusAt: number };

export function parseHash(hash: string): Route {
  const token = decodeURIComponent(hash.replace(/^#/, ''));
  if (token === 'review') return { name: 'review' };
  if (token === 'admin') return { name: 'admin' };
  if (token === 'contribute') return { name: 'contribute' };
  if (token === 'how-its-built') return { name: 'howItsBuilt', walkthroughId: null };
  if (token.startsWith('how-its-built/')) return { name: 'howItsBuilt', walkthroughId: token.slice('how-its-built/'.length) || null };
  const { sectionsById, questionsById } = getContent();
  if (sectionsById.has(token)) return { name: 'section', sectionId: token, questionId: null, focusAt: Date.now() };
  const question = questionsById.get(token);
  if (question) return { name: 'section', sectionId: question.sectionId, questionId: question.id, focusAt: Date.now() };
  return { name: 'overview' };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'overview':
      return '';
    case 'review':
      return 'review';
    case 'admin':
      return 'admin';
    case 'contribute':
      return 'contribute';
    case 'howItsBuilt':
      return route.walkthroughId ? `how-its-built/${route.walkthroughId}` : 'how-its-built';
    case 'section':
      return route.questionId ?? route.sectionId;
  }
}

function currentHash(): string {
  try {
    return window.location.hash;
  } catch {
    return '';
  }
}

export const routeStore = createStore<Route>({ name: 'overview' });

export type RouteTarget =
  | { name: 'overview' }
  | { name: 'review' }
  | { name: 'admin' }
  | { name: 'contribute' }
  | { name: 'howItsBuilt'; walkthroughId: string | null }
  | { name: 'section'; sectionId: string; questionId?: string | null };

export function navigate(target: RouteTarget): void {
  const route: Route =
    target.name === 'section'
      ? { name: 'section', sectionId: target.sectionId, questionId: target.questionId ?? null, focusAt: Date.now() }
      : target;
  routeStore.setState(() => route);
  try {
    const hash = routeToHash(route);
    window.history.pushState(null, '', hash ? `#${hash}` : window.location.pathname + window.location.search);
  } catch {
    // Some sandboxed hosts block history access; in-memory routing still works.
  }
  if (route.name !== 'section' || route.questionId === null) {
    window.scrollTo({ top: 0 });
  }
}

export function initRouter(): void {
  routeStore.setState(() => parseHash(currentHash()));
  const sync = (): void => routeStore.setState(() => parseHash(currentHash()));
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
  // Server content arrives (or changes after an admin edit): re-resolve the current link.
  contentStore.subscribe(() => {
    const next = parseHash(currentHash());
    const current = routeStore.getState();
    if (routeToHash(next) !== routeToHash(current)) routeStore.setState(() => next);
  });
}
