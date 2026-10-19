import { use, useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { loadAnswers } from '../../content/index.ts';
import { splitPrompt } from './prompt.ts';

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

function Html({ html }: { html: string }) {
  return (
    <div
      className="prose"
      onClick={(event) => void handleCopyClick(event)}
      // Safe: produced at build time by build/content/markdown.ts, which escapes raw HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** The answer itself. When the reader just asked for it, focus moves here so keyboard and screen-reader users land on it. */
function RevealedAnswer({ html, focus }: { html: string; focus: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <div ref={ref} className="answer-reveal" role="group" aria-label="Answer" tabIndex={-1}>
      <Html html={html} />
    </div>
  );
}

/**
 * Suspends until the section's answer chunk is loaded (React 19 `use`). The full question is always
 * shown; until `revealed`, `gate` (the "Reveal answer" panel) stands in for the answer.
 */
export function Answer({
  sectionId,
  questionId,
  revealed,
  gate,
  focusOnReveal = false,
}: {
  sectionId: string;
  questionId: string;
  revealed: boolean;
  gate: ReactNode;
  focusOnReveal?: boolean;
}) {
  const answers = use(loadAnswers(sectionId));
  const html = answers[questionId] ?? '<p>Answer not found.</p>';
  const { prompt, rest } = splitPrompt(html);
  return (
    <>
      {prompt ? <Html html={prompt} /> : null}
      {revealed ? rest ? <RevealedAnswer html={rest} focus={focusOnReveal} /> : null : gate}
    </>
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
