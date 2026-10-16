import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { ProgressBar } from '../../components/primitives.tsx';
import { formatDayDistance, percent } from '../../lib/format.ts';
import type { ServerUser } from '../../platform/backend.ts';
import { Avatar, ROLE_LABEL } from '../account/Account.tsx';
import { consoleApi, type Person, type PeopleResponse } from './consoleApi.ts';
import { Card, FlashLine, LoadState, useAction, useAsync } from './shared.tsx';

const WEEK_MS = 7 * 86_400_000;

function canManage(me: ServerUser, person: Person): boolean {
  if (person.role === 'owner' || person.id === me.id) return false;
  if (person.role === 'admin') return me.role === 'owner';
  return true;
}

function Row({ me, person, rounds, now, onChanged }: { me: ServerUser; person: Person; rounds: PeopleResponse['rounds']; now: number; onChanged: () => Promise<void> }) {
  const { busy, flash, run } = useAction();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { summary } = person;
  const finished = rounds.filter((r) => r.total > 0 && (summary.byRound[r.id] ?? 0) >= r.total).length;
  const studying = rounds.find((r) => r.id === summary.lastSectionId)?.title ?? '—';
  const manageable = canManage(me, person);

  const act = async (action: () => Promise<unknown>): Promise<void> => {
    if (await run(action)) await onChanged();
  };

  return (
    <tr data-disabled={person.disabled}>
      <td>
        <span className="learner">
          <Avatar user={person} size={28} />
          <span>
            {person.name || person.login}
            <span className="you"> @{person.login}</span>
            {person.id === me.id ? <span className="you"> (you)</span> : null}
            <br />
            <span className="role-chip">{ROLE_LABEL[person.role]}</span>
            {person.disabled ? <span className="draft-chip">Disabled</span> : null}
          </span>
        </span>
      </td>
      <td>
        <span className="learner-progress">
          <ProgressBar value={summary.doneCount} max={summary.total} label={`${person.login} progress`} />
          <span className="tabular">{percent(summary.doneCount, summary.total)}%</span>
        </span>
        <span className="cell-sub tabular">
          {summary.doneCount}/{summary.total} · {finished} rounds finished · {summary.dueCount} due
        </span>
      </td>
      <td>
        {summary.lastActiveAt ? formatDayDistance(summary.lastActiveAt, now) : 'not yet'}
        <span className="cell-sub">{studying}</span>
      </td>
      <td>
        {manageable ? (
          <div className="row-actions">
            {me.role === 'owner' ? (
              <label className="sr-only" htmlFor={`role-${person.id}`}>
                Role for {person.login}
              </label>
            ) : null}
            {me.role === 'owner' ? (
              <select
                id={`role-${person.id}`}
                value={person.role}
                disabled={busy}
                onChange={(event) => void act(() => consoleApi.updatePerson(person.id, { role: event.target.value === 'admin' ? 'admin' : 'learner' }))}
              >
                <option value="learner">Learner</option>
                <option value="admin">Admin</option>
              </select>
            ) : null}
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void act(() => consoleApi.updatePerson(person.id, { disabled: !person.disabled }))}>
              {person.disabled ? 'Enable' : 'Disable'}
            </button>
            {confirmRemove ? (
              <>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void act(() => consoleApi.removePerson(person.id))}>
                  Remove for good
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setConfirmRemove(true)}>
                Remove…
              </button>
            )}
          </div>
        ) : (
          <span className="you">{person.role === 'owner' ? 'Set by OWNER_GITHUB_LOGIN' : '—'}</span>
        )}
        <FlashLine flash={flash?.kind === 'error' ? flash : null} />
      </td>
    </tr>
  );
}

export function PeopleTab({ me }: { me: ServerUser }) {
  const state = useAsync(consoleApi.people);
  const [now] = useState(() => Date.now());
  const [query, setQuery] = useState('');

  const stats = useMemo(() => {
    if (state.status !== 'ready') return null;
    const users = state.data.users;
    const active = users.filter((u) => now - u.summary.lastActiveAt < WEEK_MS).length;
    const avg = users.length === 0 ? 0 : Math.round(users.reduce((sum, u) => sum + percent(u.summary.doneCount, u.summary.total), 0) / users.length);
    const ticked = users.reduce((sum, u) => sum + u.summary.doneCount, 0);
    return { people: users.length, active, avg, ticked };
  }, [state, now]);

  return (
    <Card
      title="Learners"
      icon={<Icon name="users" />}
      actions={
        <button type="button" className="btn btn-quiet" onClick={() => void state.reload()}>
          <Icon name="refresh" size={16} /> Refresh
        </button>
      }
    >
      {stats ? (
        <dl className="admin-stats">
          <div>
            <dt>People</dt>
            <dd className="tabular">{stats.people}</dd>
          </div>
          <div>
            <dt>Active this week</dt>
            <dd className="tabular">{stats.active}</dd>
          </div>
          <div>
            <dt>Average completion</dt>
            <dd className="tabular">{stats.avg}%</dd>
          </div>
          <div>
            <dt>Answers ticked</dt>
            <dd className="tabular">{stats.ticked}</dd>
          </div>
        </dl>
      ) : null}
      <LoadState state={state}>
        {(data) => {
          const q = query.trim().toLowerCase();
          const users = q ? data.users.filter((u) => `${u.login} ${u.name}`.toLowerCase().includes(q)) : data.users;
          return (
            <>
              {data.users.length > 6 ? (
                <input className="console-search" type="search" placeholder="Filter by name or login" aria-label="Filter people" value={query} onChange={(e) => setQuery(e.target.value)} />
              ) : null}
              <div className="table-wrap">
                <table className="learners-table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col">Progress</th>
                      <th scope="col">Last active</th>
                      <th scope="col">Manage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((person) => (
                      <Row key={person.id} me={me} person={person} rounds={data.rounds} now={now} onChanged={state.reload} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </LoadState>
      <p className="admin-note">
        Admins see this summary only. Notes and review schedules stay private to each learner. Only the owner can change roles;
        disabling someone signs them out everywhere.
      </p>
    </Card>
  );
}
