/**
 * Per-device preferences (theme, practice mode, list filters).
 * Unlike progress, these are conveniences: they never sync and losing them is harmless.
 */
import { isLevel, type Level } from '../content/types.ts';
import { isFrameworkId, type FrameworkId } from '../features/section/frameworks.ts';
import { createStore } from './createStore.ts';
import { readJson, writeJson } from './persistence/local.ts';

export type ThemePref = 'system' | 'light' | 'dark';
export type StatusFilter = 'all' | 'todo' | 'done';
export type LevelFilter = 'all' | Level;

export interface Prefs {
  theme: ThemePref;
  /** Hide answers until the learner has attempted them out loud. */
  practiceMode: boolean;
  /** Which framework's code to show in answers that have variants. */
  framework: FrameworkId;
  status: StatusFilter;
  level: LevelFilter;
}

const PREFS_KEY = 'whetstone:prefs:v1';

export const DEFAULT_PREFS: Prefs = { theme: 'system', practiceMode: false, framework: 'react', status: 'all', level: 'all' };

function parsePrefs(input: unknown): Prefs {
  if (typeof input !== 'object' || input === null) return DEFAULT_PREFS;
  const theme = 'theme' in input ? input.theme : undefined;
  const practiceMode = 'practiceMode' in input ? input.practiceMode : undefined;
  const framework = 'framework' in input ? input.framework : undefined;
  const status = 'status' in input ? input.status : undefined;
  const level = 'level' in input ? input.level : undefined;
  return {
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : DEFAULT_PREFS.theme,
    practiceMode: typeof practiceMode === 'boolean' ? practiceMode : DEFAULT_PREFS.practiceMode,
    framework: isFrameworkId(framework) ? framework : DEFAULT_PREFS.framework,
    status: status === 'todo' || status === 'done' || status === 'all' ? status : DEFAULT_PREFS.status,
    level: typeof level === 'string' && (level === 'all' || isLevel(level)) ? level : DEFAULT_PREFS.level,
  };
}

export const prefsStore = createStore<Prefs>(DEFAULT_PREFS);

export function updatePrefs(change: Partial<Prefs>): void {
  prefsStore.setState((prev) => ({ ...prev, ...change }));
}

function applyTheme(theme: ThemePref): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function initPrefs(): void {
  prefsStore.setState(() => parsePrefs(readJson(PREFS_KEY)));
  const initial = prefsStore.getState().theme;
  // "system" leaves any host-provided data-theme alone on first load.
  if (initial !== 'system') applyTheme(initial);
  let lastTheme = initial;
  prefsStore.subscribe(() => {
    const prefs = prefsStore.getState();
    writeJson(PREFS_KEY, prefs);
    if (prefs.theme !== lastTheme) {
      lastTheme = prefs.theme;
      applyTheme(prefs.theme);
    }
  });
}
