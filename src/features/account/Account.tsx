/**
 * Accounts in server mode: sign in (GitHub, or dev sign-in locally), invite
 * links, sign-in errors, members-only lock screen, and account settings.
 * None of this renders in local-only mode.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Dialog } from '../../components/primitives.tsx';
import { ApiError } from '../../platform/api.ts';
import {
  AUTH_ERRORS,
  deleteAccount,
  devSignIn,
  fetchInvite,
  isAdminRole,
  signInUrl,
  signOut,
  useServer,
  type InviteInfo,
  type ServerUser,
} from '../../platform/backend.ts';
import { clearLaunch, launchStore } from '../../platform/launch.ts';
import { forgetLocalProgress } from '../../state/progressStore.ts';
import { useStore } from '../../state/useStore.ts';

export const ROLE_LABEL: Record<ServerUser['role'], string> = { owner: 'Super admin', admin: 'Admin', learner: 'Learner' };

function GitHubMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function Avatar({ user, size = 28 }: { user: Pick<ServerUser, 'avatarUrl' | 'login'>; size?: number }) {
  if (user.avatarUrl) return <img className="avatar" src={user.avatarUrl} alt="" width={size} height={size} />;
  return (
    <span className="avatar avatar-fallback" style={{ width: size, height: size }} aria-hidden="true">
      {user.login.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** GitHub button plus, on local/dev deployments, a password-less form. */
export function SignInOptions({ invite }: { invite?: string }) {
  const { auth } = useServer();
  const [login, setLogin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await devSignIn(login.trim(), invite);
      window.location.reload();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? (AUTH_ERRORS[err.code] ?? err.message) : 'Sign-in failed.');
    }
  };

  return (
    <div className="signin-options">
      {auth.github ? (
        <a className="btn btn-primary btn-github" href={signInUrl(invite)}>
          <GitHubMark /> Continue with GitHub
        </a>
      ) : null}
      {auth.dev ? (
        <form className="dev-signin" onSubmit={(event) => void submit(event)}>
          <label htmlFor={fieldId}>Developer sign-in (local only)</label>
          <div className="copy-link">
            <input
              id={fieldId}
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              placeholder="any-github-style-login"
              autoComplete="username"
              pattern="[A-Za-z0-9\-]{1,39}"
              required
            />
            <button type="submit" className="btn" disabled={busy}>
              Sign in
            </button>
          </div>
        </form>
      ) : null}
      {!auth.github && !auth.dev ? (
        <p className="admin-note">Sign-in isn't configured on this deployment yet (it needs a GitHub OAuth app).</p>
      ) : null}
      {error ? (
        <p className="settings-message is-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { site } = useServer();
  return (
    <Dialog open={open} onClose={onClose} label="Sign in" className="dialog dialog-small">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>Sign in to {site.name}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <p className="settings-copy">
          Your checkmarks, notes and review dates follow you to every device. Anything you've already done in this browser is
          kept and added to your account.
        </p>
        {site.registration === 'invite' ? (
          <p className="settings-copy">New here? You'll need an invite link from the admin.</p>
        ) : null}
        <SignInOptions />
      </div>
    </Dialog>
  );
}

/** Opened via ?invite=…: explains the invite and signs the person in with it. */
export function InviteDialog() {
  const invite = useStore(launchStore, (l) => l.invite);
  const { user, mode } = useServer();
  const [info, setInfo] = useState<InviteInfo | null>(null);

  useEffect(() => {
    if (!invite || mode !== 'server') return;
    let cancelled = false;
    fetchInvite(invite).then(
      (result) => !cancelled && setInfo(result),
      () => !cancelled && setInfo({ status: 'invalid' }),
    );
    return () => {
      cancelled = true;
    };
  }, [invite, mode]);

  const open = Boolean(invite) && mode === 'server';
  const close = (): void => clearLaunch();
  const roleText = info?.role === 'admin' ? 'an admin' : 'a learner';

  return (
    <Dialog open={open} onClose={close} label="Invitation" className="dialog dialog-small">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>You're invited</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {!info ? <p className="settings-copy">Checking your invite…</p> : null}
        {info && user ? (
          <p className="settings-copy">
            You're already signed in as <strong>@{user.login}</strong>, so there's nothing to accept. Enjoy the loop.
          </p>
        ) : null}
        {info && !user && info.status === 'active' ? (
          <>
            <p className="settings-copy">
              {info.invitedBy ? <>@{info.invitedBy} invited you</> : <>You've been invited</>} to join{' '}
              <strong>{info.siteName ?? 'Frontend Loop'}</strong> as {roleText}. Sign in to accept; your progress will then sync
              across devices.
            </p>
            <SignInOptions invite={invite ?? undefined} />
          </>
        ) : null}
        {info && !user && info.status !== 'active' ? (
          <p className="settings-copy" role="alert">
            {info.status === 'used'
              ? 'This invite link has already been used.'
              : info.status === 'expired'
                ? 'This invite link has expired.'
                : info.status === 'revoked'
                  ? 'This invite link was withdrawn.'
                  : "This invite link isn't valid."}{' '}
            Ask the admin for a new one. You can still study here; progress stays in this browser.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Opened via ?auth_error=… after a failed OAuth round trip. */
export function AuthErrorDialog({ onSignIn }: { onSignIn: () => void }) {
  const code = useStore(launchStore, (l) => l.authError);
  const close = (): void => clearLaunch();
  return (
    <Dialog open={code !== null} onClose={close} label="Sign-in problem" className="dialog dialog-small">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>Couldn't sign you in</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <p className="settings-copy" role="alert">
          {(code && AUTH_ERRORS[code]) ?? 'Sign-in failed. Please try again.'}
        </p>
        <div className="button-row">
          {code !== 'not_invited' && code !== 'disabled' ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                close();
                onSignIn();
              }}
            >
              Try again
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** "Account" block inside Settings. */
export function AccountSection({ onSignIn }: { onSignIn: () => void }) {
  const { user, mode } = useServer();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (mode !== 'server') return null;

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      window.location.assign(window.location.pathname);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  return (
    <section className="settings-section">
      <h3>Account</h3>
      {user ? (
        <>
          <div className="account-row">
            <Avatar user={user} size={36} />
            <span>
              <strong>{user.name || user.login}</strong>
              <span className="you"> @{user.login}</span>
              <br />
              <span className="role-chip">{ROLE_LABEL[user.role]}</span>
            </span>
          </div>
          <p className="settings-copy">
            {isAdminRole(user.role)
              ? 'You can manage content, people and features from Admin in the sidebar.'
              : 'Admins see a summary of your progress (questions done per round, last active). Your notes and review dates stay private.'}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await forgetLocalProgress();
                  await signOut();
                })
              }
            >
              Sign out
            </button>
            {user.role !== 'owner' ? (
              confirmDelete ? (
                <>
                  <span className="danger-copy">Delete your account and synced progress?</span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await deleteAccount();
                        await forgetLocalProgress();
                      })
                    }
                  >
                    Delete for good
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(true)}>
                  Delete account…
                </button>
              )
            ) : null}
          </div>
          {error ? (
            <p className="settings-message is-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="settings-copy">Sign in to keep your progress in sync across devices.</p>
          <div className="button-row">
            <button type="button" className="btn btn-primary" onClick={onSignIn}>
              Sign in
            </button>
          </div>
        </>
      )}
    </section>
  );
}
