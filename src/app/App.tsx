import { useEffect, useState } from 'react';
import { useContent } from '../content/index.ts';
import { Icon, LoopMark } from '../components/Icon.tsx';
import { Dialog } from '../components/primitives.tsx';
import { Overview } from '../features/overview/Overview.tsx';
import { ReviewPage } from '../features/review/ReviewPage.tsx';
import { AdminPage } from '../features/admin/AdminPage.tsx';
import { AuthErrorDialog, InviteDialog, LockedPage, SignInDialog } from '../features/account/Account.tsx';
import { ConsolePage } from '../features/console/ConsolePage.tsx';
import { useServer } from '../platform/backend.ts';
import { AnnouncementBanner } from '../features/announcement/AnnouncementBanner.tsx';
import { SearchDialog } from '../features/search/SearchDialog.tsx';
import { SectionPage } from '../features/section/SectionPage.tsx';
import { SettingsDialog } from '../features/settings/SettingsDialog.tsx';
import { navigate, routeStore, type Route } from '../state/route.ts';
import { useStore } from '../state/useStore.ts';
import { Sidebar } from './Sidebar.tsx';

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function View({ route }: { route: Route }) {
  const { sectionsById } = useContent();
  const { mode, locked, features } = useServer();
  if (mode === 'server') {
    if (route.name === 'admin') return <ConsolePage />;
    if (locked) return <LockedPage />;
  }
  if (route.name === 'review' && features.review) return <ReviewPage />;
  if (route.name === 'admin') return <AdminPage />;
  if (route.name === 'section') {
    const section = sectionsById.get(route.sectionId);
    if (section) {
      // key: a different section is a different page, so its local UI state resets.
      return <SectionPage key={section.id} section={section} focusId={route.questionId} focusAt={route.focusAt} />;
    }
  }
  return <Overview />;
}

export function App() {
  const route = useStore(routeStore, (r) => r);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const { site, features } = useServer();
  const searchEnabled = features.search;

  // Global keyboard shortcuts: "/" or Cmd/Ctrl+K opens search.
  useEffect(() => {
    if (!searchEnabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const modK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !isTypingTarget(event.target);
      if (modK || slash) {
        event.preventDefault();
        setDrawerOpen(false);
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchEnabled]);

  const sidebarProps = {
    onSearch: () => {
      setDrawerOpen(false);
      setSearchOpen(true);
    },
    onSettings: () => {
      setDrawerOpen(false);
      setSettingsOpen(true);
    },
    onSignIn: () => {
      setDrawerOpen(false);
      setSignInOpen(true);
    },
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        Skip to content
      </a>

      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Open rounds menu" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
          <Icon name="menu" />
        </button>
        <button type="button" className="brand brand-compact" onClick={() => navigate({ name: 'overview' })}>
          <LoopMark size={22} />
          <span>{site.name}</span>
        </button>
        {searchEnabled ? (
          <button type="button" className="icon-btn" aria-label="Search questions" onClick={() => setSearchOpen(true)}>
            <Icon name="search" />
          </button>
        ) : (
          <span className="icon-btn" aria-hidden="true" />
        )}
      </header>

      <aside className="sidebar" aria-label="Navigation">
        <Sidebar {...sidebarProps} />
      </aside>

      <Dialog open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Navigation" className="dialog dialog-drawer">
        <div className="drawer-head">
          <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        <Sidebar {...sidebarProps} onNavigate={() => setDrawerOpen(false)} />
      </Dialog>

      <main id="main" className="main" tabIndex={-1}>
        <AnnouncementBanner />
        <View route={route} />
      </main>

      {searchEnabled ? <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} /> : null}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSignIn={() => {
          setSettingsOpen(false);
          setSignInOpen(true);
        }}
      />
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
      <InviteDialog />
      <AuthErrorDialog onSignIn={() => setSignInOpen(true)} />
    </div>
  );
}
