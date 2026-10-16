import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { LEVEL_LABEL, type Level } from '../content/types.ts';
import { Icon } from './Icon.tsx';

/** Renders `like this` spans in plain-text titles as <code>. */
export function InlineText({ text }: { text: string }) {
  const parts = text.split('`');
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>,
      )}
    </>
  );
}

export function LevelChip({ level }: { level: Level }) {
  return (
    <span className="level-chip" data-level={level}>
      {LEVEL_LABEL[level]}
    </span>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max === 0 ? 0 : (value / max) * 100;
  return (
    <div className="progress-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Native <dialog> as a modal: free focus trapping, Escape to close, inert
 * background and correct top-layer stacking. The effect is the legitimate kind:
 * it synchronizes React state with an imperative DOM API.
 */
export function Dialog({
  open,
  onClose,
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop (the dialog element itself, outside its content box) closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}

interface BoundaryProps {
  children: ReactNode;
  onRetry?: () => void;
}

/** Error boundaries are still class components in React 19. */
export class ErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Answer failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="inline-error" role="alert">
        <p>This answer didn't load. Check your connection, then try again.</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            this.props.onRetry?.();
            this.setState({ error: null });
          }}
        >
          <Icon name="refresh" size={16} /> Try again
        </button>
      </div>
    );
  }
}
