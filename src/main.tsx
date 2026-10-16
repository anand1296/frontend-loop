import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { initPrefs } from './state/prefs.ts';
import { initProgress } from './state/progressStore.ts';
import { initRouter } from './state/route.ts';
import { initAnnouncement } from './features/announcement/announcement.ts';
import { connectBackend, serverStore } from './platform/backend.ts';
import { readLaunchParams } from './platform/launch.ts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/prose.css';
import './styles/console.css';
import './styles/behind.css';

async function boot(): Promise<void> {
  initPrefs();
  readLaunchParams(); // ?invite=… and ?auth_error=… from links and the OAuth redirect
  // One request decides the mode. No backend (static host, Artifact, offline) = local-only, exactly as before.
  const backend = await connectBackend();
  initProgress(backend === 'server' ? { serverUserId: serverStore.getState().user?.id ?? null } : {});
  initRouter();
  void initAnnouncement(); // reads dismissals; subscribes to the Artifact store when hosted there

  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root element');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
