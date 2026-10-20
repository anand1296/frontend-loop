import { useId, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon.tsx';
import type { ServerUser } from '../../platform/backend.ts';
import { consoleApi } from './consoleApi.ts';
import { Card, copyText, FlashLine, formatDate, LoadState, useAction, useAsync } from './shared.tsx';

function NewInvite({ me, onCreated }: { me: ServerUser; onCreated: () => Promise<void> }) {
  const [role, setRole] = useState<'learner' | 'admin'>('learner');
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const [days, setDays] = useState(14);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, flash, run } = useAction();
  const id = useId();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setCopied(false);
    const ok = await run(async () => {
      const created = await consoleApi.createInvite({ role, note, maxUses, expiresInDays: days });
      setLink(created.url);
    });
    if (ok) {
      setNote('');
      await onCreated();
    }
  };

  return (
    <form className="console-form" onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <label htmlFor={`${id}-note`}>
          Who is it for? <span className="you">(optional, only you see it)</span>
          <input id={`${id}-note`} value={note} maxLength={120} placeholder="e.g. Priya, study group, React meetup" onChange={(e) => setNote(e.target.value)} />
        </label>
        <label htmlFor={`${id}-role`}>
          Joins as
          <select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value === 'admin' ? 'admin' : 'learner')}>
            <option value="learner">Learner</option>
            {me.role === 'owner' ? <option value="admin">Admin (can edit content)</option> : null}
          </select>
        </label>
        <label htmlFor={`${id}-uses`}>
          Can be used
          <select id={`${id}-uses`} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))}>
            <option value={1}>once (one person)</option>
            <option value={5}>5 times</option>
            <option value={25}>25 times</option>
            <option value={100}>100 times (a group link)</option>
          </select>
        </label>
        <label htmlFor={`${id}-days`}>
          Expires after
          <select id={`${id}-days`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>
      <div className="button-row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Icon name="link" size={16} /> Create invite link
        </button>
      </div>
      <FlashLine flash={flash} />
      {link ? (
        <div className="invite-result" role="status">
          <p>
            <strong>Send this link.</strong> People open it and sign in with GitHub to join. You can copy it again later from the
            invite links table.
          </p>
          <div className="copy-link">
            <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn"
              onClick={async () => {
                setCopied(await copyText(link));
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function CopyInviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-quiet"
      onClick={async () => {
        const ok = await copyText(url);
        setCopied(ok);
        if (ok) window.setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Icon name="link" size={14} /> {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

export function InvitesTab({ me }: { me: ServerUser }) {
  const state = useAsync(consoleApi.invites);
  const { busy, flash, run } = useAction();

  return (
    <>
      <Card title="Invite people" icon={<Icon name="users" />}>
        <NewInvite me={me} onCreated={state.reload} />
      </Card>
      <Card title="Invite links" icon={<Icon name="link" />}>
        <FlashLine flash={flash} />
        <LoadState state={state}>
          {(invites) =>
            invites.length === 0 ? (
              <p className="admin-note">No invites yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="learners-table">
                  <thead>
                    <tr>
                      <th scope="col">For</th>
                      <th scope="col">Role</th>
                      <th scope="col">Used</th>
                      <th scope="col">Status</th>
                      <th scope="col">Expires</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((invite) => (
                      <tr key={invite.id}>
                        <td>
                          {invite.note || <span className="you">no note</span>}
                          <span className="cell-sub">by @{invite.createdBy ?? 'someone'} · {formatDate(invite.createdAt)}</span>
                        </td>
                        <td>{invite.role === 'admin' ? 'Admin' : 'Learner'}</td>
                        <td className="tabular">
                          {invite.uses}/{invite.maxUses}
                        </td>
                        <td>
                          <span className="status-chip" data-status={invite.status}>
                            {invite.status}
                          </span>
                        </td>
                        <td>{formatDate(invite.expiresAt)}</td>
                        <td>
                          {invite.url && invite.status === 'active' ? <CopyInviteLink url={invite.url} /> : null}
                          {invite.status === 'active' && !invite.url && me.role === 'owner' ? (
                            <span className="cell-sub">Link not stored (created before this feature)</span>
                          ) : null}
                          {invite.status === 'active' ? (
                            <button
                              type="button"
                              className="btn btn-quiet"
                              disabled={busy}
                              onClick={() => void run(() => consoleApi.revokeInvite(invite.id), 'Invite revoked.').then(async (ok) => {
                                if (ok) await state.reload();
                              })}
                            >
                              Revoke
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </LoadState>
      </Card>
    </>
  );
}
