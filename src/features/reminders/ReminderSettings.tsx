/**
 * "Email reminders" in Settings (server mode, signed in). Off by default.
 * When on, a daily job emails the learner at the chosen frequency: progress,
 * reviews due, the next question with a link back, and a motivational line.
 */
import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '../../platform/api.ts';
import { isAdminRole, useServer } from '../../platform/backend.ts';

type Frequency = 'daily' | 'every3days' | 'weekly';

interface Reminders {
  enabled: boolean;
  frequency: Frequency;
  email: string;
  emailConfigured: boolean;
  available: boolean;
  lastSentAt: string | null;
  lastError: string;
}

const FREQUENCIES: ReadonlyArray<{ value: Frequency; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'every3days', label: 'Every 3 days' },
  { value: 'weekly', label: 'Weekly' },
];

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function message(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.';
}

export function ReminderSettings() {
  const { mode, user, features } = useServer();
  const [state, setState] = useState<Reminders | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const switchId = useId();
  const active = mode === 'server' && user !== null && features.emailReminders;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api<Reminders>('/me/reminders').then(
      (result) => !cancelled && setState(result),
      (error: unknown) => !cancelled && setStatus({ kind: 'error', text: message(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active) return null;

  const save = async (next: { enabled: boolean; frequency: Frequency }): Promise<void> => {
    if (!state) return;
    const previous = state;
    setState({ ...state, ...next }); // optimistic; reverted on error
    setBusy(true);
    setStatus(null);
    try {
      const saved = await api<Reminders>('/me/reminders', { method: 'PUT', body: next });
      setState(saved);
      setStatus({
        kind: 'ok',
        text: saved.enabled
          ? `Reminders on: ${FREQUENCIES.find((f) => f.value === saved.frequency)?.label.toLowerCase()}, to ${saved.email}.`
          : 'Reminders off.',
      });
    } catch (error) {
      setState(previous);
      setStatus({ kind: 'error', text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async (): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await api<{ to: string }>('/me/reminders/test', { method: 'POST' });
      setStatus({ kind: 'ok', text: `Test email sent to ${result.to}. It can take a minute to arrive; check spam the first time.` });
    } catch (error) {
      setStatus({ kind: 'error', text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" aria-labelledby={`${switchId}-heading`}>
      <h3 id={`${switchId}-heading`}>Email reminders</h3>
      {!state ? (
        <p className="settings-copy">{status ? status.text : 'Loading…'}</p>
      ) : (
        <>
          <label className="switch-row" htmlFor={switchId}>
            <span>
              Get a short email with your progress, what's due for review, the next question to open and a nudge to keep going.
            </span>
            <input
              id={switchId}
              type="checkbox"
              role="switch"
              className="switch"
              checked={state.enabled}
              disabled={busy || (!state.enabled && !state.email)}
              onChange={(event) => void save({ enabled: event.target.checked, frequency: state.frequency })}
            />
          </label>

          <div className="segmented" role="radiogroup" aria-label="How often">
            {FREQUENCIES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={state.frequency === option.value}
                disabled={busy}
                onClick={() => void save({ enabled: state.enabled, frequency: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>

          {state.email ? (
            <p className="settings-copy">
              Sent to <strong>{state.email}</strong> (your verified GitHub email), at most once a day, around 9 am India time.
              {state.lastSentAt ? ` Last sent ${dateFormat.format(new Date(state.lastSentAt))}.` : ''}
            </p>
          ) : (
            <p className="settings-message is-error">
              We don't have a verified email for you yet. Sign out and sign in again, and allow GitHub to share your email address.
            </p>
          )}
          {state.enabled && state.lastError ? (
            <p className="settings-message is-error">The last reminder couldn't be sent; it will be retried tomorrow.</p>
          ) : null}
          {!state.emailConfigured ? (
            <p className="settings-message is-error">
              {isAdminRole(user?.role)
                ? 'Email sending isn’t set up on this server yet: add the SMTP settings in Vercel (docs/DEPLOYMENT.md, “Email reminders”). Your choice is saved and takes effect once it is.'
                : 'Email sending isn’t set up on this server yet. Your choice is saved and takes effect once the admin sets it up.'}
            </p>
          ) : null}

          <div className="button-row">
            <button type="button" className="btn" disabled={busy || !state.email || !state.emailConfigured} onClick={() => void sendTest()}>
              Send me a test email
            </button>
          </div>
        </>
      )}
      {status && state ? (
        <p className={status.kind === 'error' ? 'settings-message is-error' : 'settings-message'} role={status.kind === 'error' ? 'alert' : 'status'}>
          {status.text}
        </p>
      ) : null}
    </section>
  );
}
