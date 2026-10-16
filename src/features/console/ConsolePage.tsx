/**
 * The admin console (server mode). Everything an admin changes here is live
 * for everyone immediately: no rebuild, no redeploy.
 *
 * Tabs follow the WAI-ARIA tabs pattern (arrow keys move between tabs).
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { isAdminRole, useServer } from '../../platform/backend.ts';
import { readJson, writeJson } from '../../state/persistence/local.ts';
import { ROLE_LABEL } from '../account/Account.tsx';
import { ActivityTab } from './ActivityTab.tsx';
import { ContentTab } from './ContentTab.tsx';
import { InvitesTab } from './InvitesTab.tsx';
import { PeopleTab } from './PeopleTab.tsx';
import { SettingsTab } from './SettingsTab.tsx';

const TABS = [
  { id: 'content', label: 'Content' },
  { id: 'people', label: 'Learners' },
  { id: 'invites', label: 'Invites' },
  { id: 'settings', label: 'Features & settings' },
  { id: 'activity', label: 'Activity' },
] as const;

type TabId = (typeof TABS)[number]['id'];
const TAB_KEY = 'frontend-loop:console-tab';

function initialTab(): TabId {
  const saved = readJson(TAB_KEY);
  return TABS.some((t) => t.id === saved) ? (saved as TabId) : 'content';
}

export function ConsolePage() {
  const { user } = useServer();
  const [tab, setTab] = useState<TabId>(initialTab);
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (!user || !isAdminRole(user.role)) {
    return (
      <article className="page">
        <header className="page-header">
          <p className="eyebrow">Admin</p>
          <h1>Admins only</h1>
          <p className="lede">{user ? 'Ask the owner if you need admin access.' : 'Sign in with an admin account to open the console.'}</p>
        </header>
      </article>
    );
  }

  const select = (next: TabId): void => {
    setTab(next);
    writeJson(TAB_KEY, next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = TABS.findIndex((t) => t.id === tab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    const target = TABS[next];
    if (!target) return;
    select(target.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <article className="page console-page">
      <header className="page-header">
        <p className="eyebrow">
          {ROLE_LABEL[user.role]} · @{user.login}
        </p>
        <h1>Admin console</h1>
        <p className="lede">
          Add rounds and questions, invite people, follow progress and switch features on or off. Changes are live for everyone as
          soon as you save.
        </p>
      </header>

      <div className="console-tabs" role="tablist" aria-label="Admin sections" onKeyDown={onKeyDown}>
        {TABS.map((t, index) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${baseId}-panel-${tab}`} aria-labelledby={`${baseId}-tab-${tab}`} className="console-panel">
        {tab === 'content' ? <ContentTab /> : null}
        {tab === 'people' ? <PeopleTab me={user} /> : null}
        {tab === 'invites' ? <InvitesTab me={user} /> : null}
        {tab === 'settings' ? <SettingsTab me={user} /> : null}
        {tab === 'activity' ? <ActivityTab /> : null}
      </div>

      <p className="admin-note console-foot">
        <Icon name="shield" size={16} /> Every change is recorded in Activity. Question edits keep their history and can be restored.
      </p>
    </article>
  );
}
