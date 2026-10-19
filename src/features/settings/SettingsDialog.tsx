import { useState } from 'react';
import { useContent } from '../../content/index.ts';
import { Icon } from '../../components/Icon.tsx';
import { Dialog } from '../../components/primitives.tsx';
import { parseProgress } from '../../state/progress.ts';
import { syncStatusStore, type SyncStatus } from '../../state/persistence/cloudSync.ts';
import { prefsStore, updatePrefs, type ThemePref } from '../../state/prefs.ts';
import { progressActions, progressStore } from '../../state/progressStore.ts';
import { useStore } from '../../state/useStore.ts';
import { platformStore } from '../../platform/runtime.ts';
import { useServer } from '../../platform/backend.ts';
import { AccountSection } from '../account/Account.tsx';
import { ReminderSettings } from '../reminders/ReminderSettings.tsx';

export const SYNC_COPY: Record<SyncStatus, string> = {
  local: 'Saved in this browser',
  connecting: 'Connecting to your account…',
  synced: 'Synced to your account',
  saving: 'Saving to your account…',
  readonly: 'Saved in this browser only',
  error: 'Sync paused, saved in this browser',
};

const THEMES: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function ProgressTools() {
  const [message, setMessage] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const exportJson = (): string =>
    JSON.stringify({ ...progressStore.getState(), exportedAt: new Date().toISOString(), app: 'frontend-loop' }, null, 2);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(exportJson());
      setMessage('Progress copied as JSON. Paste it into a file or another device.');
    } catch {
      setImportOpen(true);
      setImportText(exportJson());
      setMessage('Clipboard is blocked here. Select the JSON below and copy it.');
    }
  };

  const download = (): void => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `frontend-loop-progress-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runImport = (mode: 'merge' | 'replace'): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setMessage('That is not valid JSON. Paste the full export, including the outer { }.');
      return;
    }
    const progress = parseProgress(parsed);
    if (!progress) {
      setMessage('That JSON is not a Frontend Loop export (expected "version": 1 and "questions").');
      return;
    }
    progressActions.importProgress(progress, mode);
    setImportText('');
    setImportOpen(false);
    setMessage(mode === 'merge' ? 'Imported and merged with your current progress.' : 'Imported. Your previous progress was replaced.');
  };

  return (
    <div className="settings-block">
      <div className="button-row">
        <button type="button" className="btn" onClick={() => void copy()}>
          Copy progress as JSON
        </button>
        {!isFramed() ? (
          <button type="button" className="btn" onClick={download}>
            Download backup
          </button>
        ) : null}
        <button type="button" className="btn" aria-expanded={importOpen} onClick={() => setImportOpen((v) => !v)}>
          Import…
        </button>
      </div>
      {importOpen ? (
        <div className="import">
          <label htmlFor="import-json">Paste an export</label>
          <textarea id="import-json" rows={6} value={importText} onChange={(event) => setImportText(event.target.value)} spellCheck={false} />
          <div className="button-row">
            <button type="button" className="btn btn-primary" disabled={importText.trim() === ''} onClick={() => runImport('merge')}>
              Merge with current
            </button>
            <button type="button" className="btn" disabled={importText.trim() === ''} onClick={() => runImport('replace')}>
              Replace current
            </button>
          </div>
        </div>
      ) : null}
      <div className="button-row">
        {confirmReset ? (
          <>
            <span className="danger-copy">Clear every checkmark, note and review date?</span>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                progressActions.reset();
                setConfirmReset(false);
                setMessage('Progress cleared.');
              }}
            >
              Yes, clear it
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setConfirmReset(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={() => setConfirmReset(true)}>
            Reset progress…
          </button>
        )}
      </div>
      {message ? (
        <p className="settings-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsDialog({ open, onClose, onSignIn }: { open: boolean; onClose: () => void; onSignIn: () => void }) {
  const { allQuestions, source } = useContent();
  const server = useServer();
  const theme = useStore(prefsStore, (p) => p.theme);
  const practiceMode = useStore(prefsStore, (p) => p.practiceMode);
  const sync = useStore(syncStatusStore, (s) => s);
  const role = useStore(platformStore, (p) => p.role);

  return (
    <Dialog open={open} onClose={onClose} label="Settings" className="dialog dialog-settings">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            <Icon name="close" />
          </button>
        </div>

        <section className="settings-section">
          <h3>Appearance</h3>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme === option.value}
                onClick={() => updatePrefs({ theme: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h3>Practice mode</h3>
          <label className="switch-row" htmlFor="practice-mode">
            <span>
              Every answer already waits behind a Reveal answer button. Practice mode adds a stopwatch and a reminder to talk
              it through out loud first. Closer to the real interview, and recall sticks far better than re-reading.
            </span>
            <input
              id="practice-mode"
              type="checkbox"
              role="switch"
              className="switch"
              checked={practiceMode}
              onChange={(event) => updatePrefs({ practiceMode: event.target.checked })}
            />
          </label>
        </section>

        <AccountSection onSignIn={onSignIn} />

        <ReminderSettings />

        <section className="settings-section">
          <h3>Your progress</h3>
          <p className="settings-copy">
            <span className="sync-dot" data-status={sync} /> {SYNC_COPY[sync]}.{' '}
            {sync === 'synced' || sync === 'saving'
              ? 'Checkmarks, notes and review dates follow you to any device where you open this page signed in.'
              : server.mode === 'server' && !server.user
                ? 'Sign in to sync it across devices; what you do now is kept and added to your account.'
              : sync === 'readonly'
                ? 'Your access to this page is view-only, so progress stays in this browser. Ask the person who shared it for Contributor access to sync across devices.'
                : 'Use export and import to move it between browsers.'}
          </p>
          {role === 'learner' ? (
            <p className="settings-copy">
              The person who shared this app can see a summary of your progress: questions done per round and when you were last
              active. Your notes and review dates stay private to you.
            </p>
          ) : null}
          {role === 'owner' ? (
            <p className="settings-copy">You own this app. Manage learners, announcements and invitations from Admin in the sidebar.</p>
          ) : null}
          {server.features.progressTransfer ? <ProgressTools /> : null}
        </section>

        <p className="settings-foot">
          {server.site.name} · {allQuestions.length} questions ·{' '}
          {source === 'server' ? 'content served by the Go backend' : 'content compiled at build time'}
        </p>
      </div>
    </Dialog>
  );
}
