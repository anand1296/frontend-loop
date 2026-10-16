/**
 * Small building blocks shared by the console tabs.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../platform/api.ts';

export type Async<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: string };

/**
 * Load data for a tab. `load` must be stable (a module-level function or a
 * useCallback). `reload()` refetches without flashing the loading state: the
 * old data stays on screen until the new data arrives.
 */
export function useAsync<T>(load: () => Promise<T>): Async<T> & { reload: () => Promise<void> } {
  const [state, setState] = useState<Async<T>>({ status: 'loading' });
  const mounted = useRef(true);

  const run = useCallback(async () => {
    try {
      const data = await load();
      if (mounted.current) setState({ status: 'ready', data });
    } catch (error) {
      if (mounted.current) setState({ status: 'error', error: errorMessage(error) });
    }
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    void run();
    return () => {
      mounted.current = false;
    };
  }, [run]);

  return { ...state, reload: run };
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = error.problems.map((p) => `${p.field}: ${p.message}`).join('; ');
    return fields ? `${error.message} (${fields})` : error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** One status line under a form: what happened after the last action. */
export interface Flash {
  kind: 'ok' | 'error';
  text: string;
}

export function FlashLine({ flash }: { flash: Flash | null }) {
  if (!flash) return null;
  return (
    <p className={flash.kind === 'error' ? 'settings-message is-error' : 'settings-message'} role={flash.kind === 'error' ? 'alert' : 'status'}>
      {flash.text}
    </p>
  );
}

/** Run an action with a busy flag and a flash message. */
export function useAction(): {
  busy: boolean;
  flash: Flash | null;
  setFlash: (flash: Flash | null) => void;
  run: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
} {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setFlash(null);
    try {
      await action();
      if (success) setFlash({ kind: 'ok', text: success });
      return true;
    } catch (error) {
      setFlash({ kind: 'error', text: errorMessage(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, flash, setFlash, run };
}

export function Card({ title, icon, actions, children, className }: { title: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`admin-card ${className ?? ''}`}>
      <div className="card-head">
        <h2 className="admin-card-title">
          {icon}
          {title}
        </h2>
        {actions ? <div className="card-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function LoadState<T>({ state, children }: { state: Async<T>; children: (data: T) => ReactNode }) {
  if (state.status === 'loading') return <p className="admin-note">Loading…</p>;
  if (state.status === 'error') {
    return (
      <p className="settings-message is-error" role="alert">
        {state.error}
      </p>
    );
  }
  return <>{children(state.data)}</>;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(value: string | number | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
}

/** "my-new-question" from "My new question?" */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
