import { use, type MouseEvent } from 'react';
import { loadAnswers } from '../../content/index.ts';

/**
 * Copy buttons are emitted by the build-time renderer, so we handle them with
 * one delegated listener instead of hydrating a component per code block.
 */
export async function handleCopyClick(event: MouseEvent<HTMLDivElement>): Promise<void> {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('[data-copy-code]');
  const code = button?.closest('figure')?.querySelector('code');
  if (!button || !code) return;
  const text = code.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    // Clipboard can be blocked (sandboxed frames, older browsers): select the code instead.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(code);
    selection?.removeAllRanges();
    selection?.addRange(range);
    button.textContent = 'Selected, press Ctrl+C';
  }
  window.setTimeout(() => {
    button.textContent = 'Copy';
  }, 1800);
}

/** Suspends until the section's answer chunk is loaded (React 19 `use`). */
export function Answer({ sectionId, questionId }: { sectionId: string; questionId: string }) {
  const answers = use(loadAnswers(sectionId));
  const html = answers[questionId] ?? '<p>Answer not found.</p>';
  return (
    <div
      className="prose"
      onClick={(event) => void handleCopyClick(event)}
      // Safe: produced at build time by build/content/markdown.ts, which escapes raw HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function AnswerSkeleton() {
  return (
    <div className="answer-skeleton" aria-busy="true" aria-label="Loading answer">
      <span />
      <span />
      <span />
    </div>
  );
}
