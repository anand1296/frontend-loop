/**
 * Framework variants inside one answer.
 *
 * Authors wrap framework-specific material in a container:
 *
 *   :::angular
 *   ### Angular
 *   ...any markdown, including code fences...
 *   :::
 *
 * Everything outside a container is shared by all frameworks. The container
 * lines are rewritten to marker comments on their own lines; the renderers
 * (this file's twin is backend/markdown/frameworks.go) turn those markers
 * into <section class="fw" data-fw="angular">…</section>, and the UI shows
 * only the section matching the reader's chosen framework.
 */
import { ContentError } from './frontmatter.ts';

export const FRAMEWORKS = ['react', 'angular', 'vue'] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export function isFramework(value: string): value is Framework {
  return (FRAMEWORKS as readonly string[]).includes(value);
}

const OPEN = /^:::([a-z]+)\s*$/;
const CLOSE = /^:::\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Marker comments the renderers recognise; anything else stays escaped text. */
export const MARKER_OPEN = /^<!--fw:(react|angular|vue)-->$/;
export const MARKER_CLOSE = '<!--/fw-->';

/** Rewrites `:::framework` containers to marker comments. Throws ContentError on misuse. */
export function expandFrameworkBlocks(markdown: string, where: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let open: Framework | null = null;
  let openLine = 0;

  markdown.split(/\r?\n/).forEach((line, index) => {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      out.push(line);
      return;
    }
    if (fence !== null) {
      out.push(line);
      return;
    }
    const opening = OPEN.exec(line);
    if (opening) {
      const name = opening[1] ?? '';
      if (!isFramework(name)) {
        throw new ContentError(`${where}: line ${index + 1}: unknown framework ":::${name}". Known: ${FRAMEWORKS.join(', ')}`);
      }
      if (open) throw new ContentError(`${where}: line ${index + 1}: ":::${name}" inside ":::${open}" (opened on line ${openLine}); containers cannot nest`);
      open = name;
      openLine = index + 1;
      out.push('', `<!--fw:${name}-->`, '');
      return;
    }
    if (CLOSE.test(line)) {
      if (!open) throw new ContentError(`${where}: line ${index + 1}: ":::" closes nothing`);
      open = null;
      out.push('', MARKER_CLOSE, '');
      return;
    }
    out.push(line);
  });

  if (open) throw new ContentError(`${where}: ":::${open}" opened on line ${openLine} is never closed with ":::"`);
  return out.join('\n');
}
