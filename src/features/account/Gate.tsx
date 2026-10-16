/**
 * Full-page gates shown instead of the app shell:
 *
 * - SignInScreen: the site is members-only (the default) and nobody is signed
 *   in. It handles invite links (?invite=…) and sign-in errors (?auth_error=…)
 *   inline, so an invited person sees who invited them right where they sign in.
 * - SetupScreen: an API is deployed here but isn't configured yet (or can't
 *   reach its database). Instead of silently pretending to sync, it shows the
 *   owner a checklist and lets anyone study offline meanwhile.
 */
import { useEffect, useState } from 'react';
import { Icon, LoopMark } from '../../components/Icon.tsx';
import { AUTH_ERRORS, continueOffline, fetchInvite, useServer, type InviteInfo } from '../../platform/backend.ts';
import { launchStore } from '../../platform/launch.ts';
import { useStore } from '../../state/useStore.ts';
import { SignInOptions } from './Account.tsx';

const DEPLOY_GUIDE = 'https://github.com/anand1296/frontend-loop/blob/main/docs/DEPLOYMENT.md';
const DEPLOYMENT_SECTION = `${DEPLOY_GUIDE}#13-create-a-github-oauth-app`;

function InviteNote({ token }: { token: string }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchInvite(token).then(
      (result) => !cancelled && setInfo(result),
      () => !cancelled && setInfo({ status: 'invalid' }),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!info) return <p className="auth-note">Checking your invite…</p>;
  if (info.status !== 'active') {
    const why =
      info.status === 'used'
        ? 'has already been used'
        : info.status === 'expired'
          ? 'has expired'
          : info.status === 'revoked'
            ? 'was withdrawn'
            : "isn't valid";
    return (
      <p className="auth-note is-error" role="alert">
        This invite link {why}. Ask the admin for a new one.
      </p>
    );
  }
  return (
    <p className="auth-note is-invite" role="status">
      <Icon name="users" size={18} />
      <span>
        {info.invitedBy ? <>@{info.invitedBy} invited you</> : <>You've been invited</>} to join as{' '}
        {info.role === 'admin' ? 'an admin' : 'a learner'}. Sign in with GitHub to accept.
      </span>
    </p>
  );
}

export function SignInScreen() {
  const { site, auth } = useServer();
  const { invite, authError } = useStore(launchStore, (l) => l);

  return (
    <main className="auth-screen" id="main">
      <div className="auth-card">
        <div className="auth-brand">
          <LoopMark size={40} />
          <span>{site.name}</span>
        </div>
        <h1>{invite ? "You're invited" : 'Sign in to continue'}</h1>
        <p className="auth-lede">{site.tagline || 'Interview prep for senior, lead and principal engineers: deep answers, progress that follows you, spaced review.'}</p>

        {authError ? (
          <p className="auth-note is-error" role="alert">
            {AUTH_ERRORS[authError] ?? 'Sign-in failed. Please try again.'}
          </p>
        ) : null}
        {invite ? <InviteNote token={invite} /> : null}

        <SignInOptions invite={invite ?? undefined} />

        {!auth.github ? (
          <p className="auth-note">
            GitHub sign-in isn't switched on for this deployment yet. Owner: add <code>GITHUB_CLIENT_ID</code> and{' '}
            <code>GITHUB_CLIENT_SECRET</code> in Vercel (
            <a href={DEPLOYMENT_SECTION} target="_blank" rel="noopener noreferrer">
              how
            </a>
            ).
          </p>
        ) : null}

        <p className="auth-foot">
          {site.registration === 'invite'
            ? 'Access is by invitation. New here? Open the invite link the admin sent you.'
            : 'Anyone with a GitHub account can join.'}{' '}
          We only read your public GitHub profile (name and avatar).
        </p>
      </div>
    </main>
  );
}

const CHECKS = [
  { key: 'database', label: 'Database', detail: 'DATABASE_URL: Vercel → Storage → create a free Neon Postgres and connect it' },
  { key: 'owner', label: 'Super admin', detail: 'OWNER_GITHUB_LOGIN: your GitHub username (it becomes the super admin)' },
  { key: 'github', label: 'GitHub sign-in', detail: 'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET from a GitHub OAuth app' },
  { key: 'appUrl', label: 'App URL', detail: 'APP_URL: this site’s address, e.g. https://your-app.vercel.app' },
] as const;

export function SetupScreen() {
  const { setup, site } = useServer();
  if (!setup) return null;
  const unreachable = setup.reason === 'unavailable';

  return (
    <main className="auth-screen" id="main">
      <div className="auth-card auth-card-wide">
        <div className="auth-brand">
          <LoopMark size={40} />
          <span>{site.name}</span>
        </div>
        <h1>{unreachable ? "Can't reach the database" : 'Almost there: connect the backend'}</h1>
        <p className="auth-lede">
          {unreachable
            ? 'The server is deployed and configured, but its database is not answering. Neon databases sleep when idle and wake in a few seconds, so try again; if it persists, check DATABASE_URL in Vercel.'
            : 'The app and its Go API are deployed, but the API has no database yet, so there is nothing to sign in to. Until it is connected, progress can only be saved in this browser.'}
        </p>

        {!unreachable ? (
          <>
            <ul className="setup-list" aria-label="Configuration checklist">
              {CHECKS.map((check) => {
                const done = setup[check.key];
                return (
                  <li key={check.key} data-done={done}>
                    <span className="setup-mark" aria-hidden="true">
                      {done ? <Icon name="check" size={16} /> : null}
                    </span>
                    <span>
                      <strong>{check.label}</strong> <span className="sr-only">{done ? '(set)' : '(missing)'}</span>
                      <span className="setup-detail">{check.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="auth-note">
              Add the missing environment variables in Vercel → Settings → Environment Variables, then <strong>redeploy</strong>. The first
              request creates the tables and loads all questions. Step-by-step:{' '}
              <a href={DEPLOY_GUIDE} target="_blank" rel="noopener noreferrer">
                docs/DEPLOYMENT.md
              </a>
              .
            </p>
          </>
        ) : null}

        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            <Icon name="refresh" size={16} /> Check again
          </button>
          <button type="button" className="btn btn-quiet" onClick={continueOffline}>
            Study offline for now
          </button>
        </div>
      </div>
    </main>
  );
}
