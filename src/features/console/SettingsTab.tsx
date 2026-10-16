import { useId, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { refreshBootstrap, type ServerUser } from '../../platform/backend.ts';
import { consoleApi, type AnnouncementSetting, type FeatureDef, type SettingsResponse, type SiteSetting } from './consoleApi.ts';
import { Card, FlashLine, formatDate, LoadState, useAction, useAsync } from './shared.tsx';

const ANNOUNCEMENT_LIMIT = 280;

function AnnouncementForm({ initial, onSaved }: { initial: AnnouncementSetting; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(initial);
  const { busy, flash, run } = useAction();
  const id = useId();

  const save = async (value: AnnouncementSetting, message: string): Promise<void> => {
    if (await run(() => consoleApi.putSetting('announcement', value), message)) {
      await refreshBootstrap();
      await onSaved();
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void save(draft, 'Published. Everyone sees it at the top of the app until they dismiss it.');
  };

  return (
    <form className="console-form" onSubmit={submit}>
      <label htmlFor={`${id}-msg`}>Message</label>
      <textarea
        id={`${id}-msg`}
        rows={3}
        maxLength={ANNOUNCEMENT_LIMIT}
        value={draft.message}
        placeholder="e.g. Mock interviews on Saturday 10:00. Finish the System Design round before then."
        onChange={(e) => setDraft({ ...draft, message: e.target.value })}
      />
      <div className="form-grid">
        <label htmlFor={`${id}-tone`}>
          Tone
          <select id={`${id}-tone`} value={draft.tone} onChange={(e) => setDraft({ ...draft, tone: e.target.value === 'success' ? 'success' : e.target.value === 'warning' ? 'warning' : 'info' })}>
            <option value="info">Info</option>
            <option value="success">Good news</option>
            <option value="warning">Heads-up</option>
          </select>
        </label>
        <label htmlFor={`${id}-url`}>
          Link <span className="you">(optional: https://… or #round-id)</span>
          <input id={`${id}-url`} value={draft.linkUrl} placeholder="#system-design" onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} />
        </label>
        <label htmlFor={`${id}-label`}>
          Link text
          <input id={`${id}-label`} value={draft.linkLabel} maxLength={40} placeholder="Open the round" onChange={(e) => setDraft({ ...draft, linkLabel: e.target.value })} />
        </label>
      </div>
      <div className="button-row">
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.message.trim()}>
          Publish announcement
        </button>
        {initial.message ? (
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => {
              const cleared = { ...draft, message: '', linkUrl: '', linkLabel: '' };
              setDraft(cleared);
              void save(cleared, 'Announcement cleared.');
            }}
          >
            Clear current
          </button>
        ) : null}
        <span className="notes-count">
          {draft.message.length} / {ANNOUNCEMENT_LIMIT}
          {initial.updatedAt ? ` · last published ${formatDate(initial.updatedAt)}` : ''}
        </span>
      </div>
      <FlashLine flash={flash} />
    </form>
  );
}

function FeatureSwitches({ list, initial }: { list: FeatureDef[]; initial: Record<string, boolean> }) {
  const [flags, setFlags] = useState(initial);
  const { busy, flash, run } = useAction();

  const toggle = async (key: string, on: boolean): Promise<void> => {
    const next = { ...flags, [key]: on };
    setFlags(next);
    const ok = await run(() => consoleApi.putSetting('features', next), `${list.find((f) => f.key === key)?.label ?? key} ${on ? 'switched on' : 'switched off'} for everyone.`);
    if (ok) await refreshBootstrap();
    else setFlags(flags);
  };

  return (
    <div className="feature-list">
      {list.map((feature) => (
        <label key={feature.key} className="switch-row" htmlFor={`feature-${feature.key}`}>
          <span>
            <strong>{feature.label}</strong>
            <br />
            {feature.description}
          </span>
          <input
            id={`feature-${feature.key}`}
            type="checkbox"
            role="switch"
            className="switch"
            checked={flags[feature.key] ?? feature.default}
            disabled={busy}
            onChange={(e) => void toggle(feature.key, e.target.checked)}
          />
        </label>
      ))}
      <FlashLine flash={flash} />
    </div>
  );
}

function SiteForm({ initial, me }: { initial: SiteSetting; me: ServerUser }) {
  const [site, setSite] = useState(initial);
  const { busy, flash, run } = useAction();
  const id = useId();
  const owner = me.role === 'owner';

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (await run(() => consoleApi.putSetting('site', site), 'Site settings saved.')) await refreshBootstrap();
  };

  return (
    <form className="console-form" onSubmit={(event) => void submit(event)}>
      {!owner ? <p className="admin-note">Only the owner can change these.</p> : null}
      <fieldset disabled={!owner || busy}>
        <div className="form-grid">
          <label htmlFor={`${id}-name`}>
            App name
            <input id={`${id}-name`} value={site.name} maxLength={40} required onChange={(e) => setSite({ ...site, name: e.target.value })} />
          </label>
          <label htmlFor={`${id}-tagline`}>
            Overview headline <span className="you">(optional)</span>
            <input id={`${id}-tagline`} value={site.tagline} maxLength={200} placeholder="Your interview loop, one round at a time." onChange={(e) => setSite({ ...site, tagline: e.target.value })} />
          </label>
        </div>
        <div className="radio-group" role="radiogroup" aria-label="Who can create an account">
          <p className="field-label">Who can create an account</p>
          <label>
            <input type="radio" name={`${id}-reg`} checked={site.registration === 'invite'} onChange={() => setSite({ ...site, registration: 'invite' })} /> Only people with an
            invite link
          </label>
          <label>
            <input type="radio" name={`${id}-reg`} checked={site.registration === 'open'} onChange={() => setSite({ ...site, registration: 'open' })} /> Anyone with a GitHub
            account
          </label>
        </div>
        <div className="radio-group" role="radiogroup" aria-label="Who can read the content">
          <p className="field-label">Who can read the questions</p>
          <label>
            <input type="radio" name={`${id}-access`} checked={site.contentAccess === 'public'} onChange={() => setSite({ ...site, contentAccess: 'public' })} /> Everyone
            (signing in only syncs progress)
          </label>
          <label>
            <input type="radio" name={`${id}-access`} checked={site.contentAccess === 'members'} onChange={() => setSite({ ...site, contentAccess: 'members' })} /> Signed-in
            members only
          </label>
        </div>
        <div className="button-row">
          <button type="submit" className="btn btn-primary">
            Save site settings
          </button>
        </div>
      </fieldset>
      <FlashLine flash={flash} />
    </form>
  );
}

export function SettingsTab({ me }: { me: ServerUser }) {
  const state = useAsync(consoleApi.settings);
  return (
    <LoadState state={state}>
      {(data: SettingsResponse) => (
        <>
          <Card title="Announcement" icon={<Icon name="megaphone" />}>
            <AnnouncementForm initial={data.announcement} onSaved={state.reload} />
          </Card>
          <Card title="Features" icon={<Icon name="settings" />}>
            <p className="admin-note">
              Switch built-in features on or off for everyone, instantly. Building a brand-new feature is a code change: push it to
              the repository and Vercel deploys it (see docs/ADMIN.md).
            </p>
            <FeatureSwitches list={data.featureList} initial={data.features} />
          </Card>
          <Card title="Site & access" icon={<Icon name="shield" />}>
            <SiteForm initial={data.site} me={me} />
          </Card>
        </>
      )}
    </LoadState>
  );
}
