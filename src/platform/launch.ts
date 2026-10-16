/**
 * One-shot parameters the app can be opened with:
 *   ?invite=<token>      an invite link from the admin console
 *   ?auth_error=<code>   the OAuth callback reporting why sign-in failed
 * They are read once and removed from the address bar, so a refresh or a
 * copied URL doesn't replay them (and the invite token doesn't linger in history).
 */
import { createStore } from '../state/createStore.ts';

export interface LaunchState {
  invite: string | null;
  authError: string | null;
}

export const launchStore = createStore<LaunchState>({ invite: null, authError: null });

const INVITE_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

export function readLaunchParams(): void {
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return;
  }
  const invite = url.searchParams.get('invite');
  const authError = url.searchParams.get('auth_error');
  if (invite === null && authError === null) return;
  launchStore.setState(() => ({
    invite: invite && INVITE_PATTERN.test(invite) ? invite : null,
    authError: authError && /^[a-z_]{1,40}$/.test(authError) ? authError : null,
  }));
  url.searchParams.delete('invite');
  url.searchParams.delete('auth_error');
  try {
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    // Sandboxed hosts may block history; the params are already consumed.
  }
}

export function clearLaunch(): void {
  launchStore.setState(() => ({ invite: null, authError: null }));
}
