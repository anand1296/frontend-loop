const PROMPT_OPEN = '<aside class="callout callout-prompt">';
const ASIDE_CLOSE = '</aside>';

/**
 * Splits the optional leading `> [!PROMPT]` callout (the full question) from the rest of an answer.
 * Both renderers emit it as the very first element and callouts don't nest, so the first `</aside>` closes it.
 */
export function splitPrompt(html: string): { prompt: string; rest: string } {
  if (!html.startsWith(PROMPT_OPEN)) return { prompt: '', rest: html };
  const end = html.indexOf(ASIDE_CLOSE);
  if (end === -1) return { prompt: '', rest: html };
  const cut = end + ASIDE_CLOSE.length;
  return { prompt: html.slice(0, cut), rest: html.slice(cut) };
}
