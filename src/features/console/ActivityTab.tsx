import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { consoleApi, type AuditEntry } from './consoleApi.ts';
import { Card, errorMessage, formatDate } from './shared.tsx';

const ACTION_LABEL: Record<string, string> = {
  'user.joined': 'joined',
  'user.updated': 'updated a person',
  'user.deleted': 'removed a person',
  'invite.created': 'created an invite',
  'invite.revoked': 'revoked an invite',
  'section.created': 'created a round',
  'section.updated': 'edited a round',
  'section.deleted': 'deleted a round',
  'section.reordered': 'reordered rounds',
  'question.created': 'created a question',
  'question.updated': 'edited a question',
  'question.deleted': 'deleted a question',
  'question.reordered': 'reordered questions',
  'content.synced': 'synced content from the repository',
  'settings.updated': 'changed settings',
};

export function ActivityTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [state, setState] = useState<'loading' | 'idle' | 'done' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async (before?: number) => {
    setState('loading');
    try {
      const page = await consoleApi.audit(before);
      setEntries((prev) => (before ? [...prev, ...page] : page));
      setState(page.length < 50 ? 'done' : 'idle');
    } catch (err) {
      setError(errorMessage(err));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card title="Activity" icon={<Icon name="clock" />}>
      {entries.length === 0 && state === 'done' ? <p className="admin-note">Nothing has happened yet.</p> : null}
      <ol className="audit-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className="audit-when">{formatDate(entry.at)}</span>
            <span>
              <strong>{entry.actor ? `@${entry.actor}` : entry.action === 'user.joined' ? `@${entry.target}` : 'System'}</strong>{' '}
              {ACTION_LABEL[entry.action] ?? entry.action}
              {entry.target && entry.action !== 'user.joined' ? <code className="audit-target">{entry.target}</code> : null}
            </span>
          </li>
        ))}
      </ol>
      {state === 'error' ? (
        <p className="settings-message is-error" role="alert">
          {error}
        </p>
      ) : null}
      {state === 'idle' ? (
        <button type="button" className="btn" onClick={() => void load(entries[entries.length - 1]?.id)}>
          Load older
        </button>
      ) : null}
      {state === 'loading' ? <p className="admin-note">Loading…</p> : null}
    </Card>
  );
}
