import { useId, useMemo, useState } from 'react';
import { allQuestions, preloadSection, sections } from '../content/index.ts';
import { Icon, LoopMark } from '../components/Icon.tsx';
import { SYNC_COPY } from '../features/settings/SettingsDialog.tsx';
import { syncStatusStore } from '../state/persistence/cloudSync.ts';
import { platformStore } from '../platform/runtime.ts';
import { progressStore } from '../state/progressStore.ts';
import { doneCount, dueQuestions } from '../state/selectors.ts';
import { navigate, routeStore } from '../state/route.ts';
import { useStore } from '../state/useStore.ts';

interface SidebarProps {
  onSearch: () => void;
  onSettings: () => void;
  /** Called after any navigation (closes the mobile drawer). */
  onNavigate?: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function Sidebar({ onSearch, onSettings, onNavigate }: SidebarProps) {
  const route = useStore(routeStore, (r) => r);
  const progress = useStore(progressStore, (s) => s.questions);
  const sync = useStore(syncStatusStore, (s) => s);
  const role = useStore(platformStore, (p) => p.role);
  const [now] = useState(() => Date.now());
  const dueCount = useMemo(() => dueQuestions(allQuestions, progress, now).length, [progress, now]);
  const activeSection = route.name === 'section' ? route.sectionId : null;
  const roundsLabelId = useId();

  const go = (target: Parameters<typeof navigate>[0]): void => {
    navigate(target);
    onNavigate?.();
  };

  return (
    <div className="sidebar-inner">
      <button type="button" className="brand" onClick={() => go({ name: 'overview' })}>
        <LoopMark />
        <span>Frontend Loop</span>
      </button>

      <button type="button" className="search-trigger" onClick={onSearch}>
        <Icon name="search" size={18} />
        <span>Search questions</span>
        <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <nav aria-label="Main">
        <ul className="nav-list">
          <li>
            <button
              type="button"
              className="nav-item"
              aria-current={route.name === 'overview' ? 'page' : undefined}
              onClick={() => go({ name: 'overview' })}
            >
              <Icon name="home" size={18} />
              <span>Overview</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="nav-item"
              aria-current={route.name === 'review' ? 'page' : undefined}
              onClick={() => go({ name: 'review' })}
            >
              <Icon name="refresh" size={18} />
              <span>Review</span>
              {dueCount > 0 ? (
                <span className="badge" aria-label={`${dueCount} due`}>
                  {dueCount}
                </span>
              ) : null}
            </button>
          </li>
          {role === 'owner' ? (
            <li>
              <button
                type="button"
                className="nav-item"
                aria-current={route.name === 'admin' ? 'page' : undefined}
                onClick={() => go({ name: 'admin' })}
              >
                <Icon name="shield" size={18} />
                <span>Admin</span>
                <span className="role-chip">Super admin</span>
              </button>
            </li>
          ) : null}
        </ul>

        <p className="nav-label" id={roundsLabelId}>
          Rounds
        </p>
        <ol className="nav-list nav-rounds" aria-labelledby={roundsLabelId}>
          {sections.map((section) => {
            const done = doneCount(section.questions, progress);
            const total = section.questions.length;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  className="nav-item nav-round"
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  data-complete={done === total}
                  onPointerEnter={() => preloadSection(section.id)}
                  onClick={() => go({ name: 'section', sectionId: section.id })}
                >
                  <span className="nav-round-title">{section.title}</span>
                  <span className="nav-round-count tabular" aria-label={`${done} of ${total} done`}>
                    {done}/{total}
                  </span>
                  <span className="nav-round-bar" aria-hidden="true">
                    <span style={{ width: `${(done / total) * 100}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="sidebar-foot">
        <span className="sync-line">
          <span className="sync-dot" data-status={sync} />
          {SYNC_COPY[sync]}
        </span>
        <button type="button" className="icon-btn" onClick={onSettings} aria-label="Settings">
          <Icon name="settings" />
        </button>
      </div>
    </div>
  );
}
