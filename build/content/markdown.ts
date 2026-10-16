/**
 * Markdown -> HTML at build time.
 *
 * Why build time: the browser never downloads a markdown parser or a syntax
 * highlighter, answers render instantly, and every content error fails the
 * build instead of reaching a reader.
 *
 * Security: content is first-party, but we still treat it as untrusted input.
 * Raw HTML in markdown is escaped, links are restricted to http(s)/relative/#,
 * and code is highlighted into escaped spans. The output is therefore safe to
 * inject with dangerouslySetInnerHTML without a runtime sanitizer.
 */
import { Marked, type Tokens } from 'marked';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import diff from 'highlight.js/lib/languages/diff';
import yaml from 'highlight.js/lib/languages/yaml';
import graphql from 'highlight.js/lib/languages/graphql';
import go from 'highlight.js/lib/languages/go';
import sql from 'highlight.js/lib/languages/sql';
import python from 'highlight.js/lib/languages/python';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import protobuf from 'highlight.js/lib/languages/protobuf';
import ini from 'highlight.js/lib/languages/ini';
import { ContentError } from './frontmatter.ts';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('graphql', graphql);
hljs.registerLanguage('go', go);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('python', python);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('protobuf', protobuf);
hljs.registerLanguage('ini', ini);

interface LanguageDef {
  grammar: string | null;
  label: string;
}

const LANGUAGES: Record<string, LanguageDef> = {
  ts: { grammar: 'typescript', label: 'TypeScript' },
  typescript: { grammar: 'typescript', label: 'TypeScript' },
  tsx: { grammar: 'typescript', label: 'TSX' },
  js: { grammar: 'javascript', label: 'JavaScript' },
  javascript: { grammar: 'javascript', label: 'JavaScript' },
  jsx: { grammar: 'javascript', label: 'JSX' },
  html: { grammar: 'xml', label: 'HTML' },
  xml: { grammar: 'xml', label: 'XML' },
  css: { grammar: 'css', label: 'CSS' },
  bash: { grammar: 'bash', label: 'Shell' },
  sh: { grammar: 'bash', label: 'Shell' },
  shell: { grammar: 'bash', label: 'Shell' },
  json: { grammar: 'json', label: 'JSON' },
  diff: { grammar: 'diff', label: 'Diff' },
  yaml: { grammar: 'yaml', label: 'YAML' },
  yml: { grammar: 'yaml', label: 'YAML' },
  graphql: { grammar: 'graphql', label: 'GraphQL' },
  // Backend, cloud and data (for full-stack rounds). Keep in sync with backend/markdown/highlight.go.
  go: { grammar: 'go', label: 'Go' },
  golang: { grammar: 'go', label: 'Go' },
  sql: { grammar: 'sql', label: 'SQL' },
  python: { grammar: 'python', label: 'Python' },
  py: { grammar: 'python', label: 'Python' },
  dockerfile: { grammar: 'dockerfile', label: 'Dockerfile' },
  docker: { grammar: 'dockerfile', label: 'Dockerfile' },
  proto: { grammar: 'protobuf', label: 'Protobuf' },
  protobuf: { grammar: 'protobuf', label: 'Protobuf' },
  toml: { grammar: 'ini', label: 'TOML' },
  ini: { grammar: 'ini', label: 'INI' },
  // highlight.js has no HCL grammar; Terraform renders as plain text here and highlighted by the Go renderer.
  hcl: { grammar: null, label: 'Terraform' },
  terraform: { grammar: null, label: 'Terraform' },
  tf: { grammar: null, label: 'Terraform' },
  http: { grammar: null, label: 'HTTP' },
  text: { grammar: null, label: 'Text' },
  txt: { grammar: null, label: 'Text' },
  '': { grammar: null, label: 'Text' },
};

/** Callout kinds, written GitHub-alert style: `> [!TIP]`. */
export const CALLOUTS: Record<string, string> = {
  TLDR: 'The 60-second answer',
  NOTE: 'Note',
  TIP: 'Tip',
  WARNING: 'Common mistake',
  IMPORTANT: 'Important',
  PRINCIPAL: 'Principal-level depth',
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_HREF = /^(https?:\/\/|#|\/(?!\/))/i;

export function createMarkdownRenderer(where: () => string): Marked {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      code({ text, lang }: Tokens.Code): string {
        const key = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        const def = LANGUAGES[key];
        if (!def) {
          throw new ContentError(`${where()}: unsupported code fence language "${key}". Add it to build/content/markdown.ts.`);
        }
        const body = def.grammar
          ? hljs.highlight(text, { language: def.grammar, ignoreIllegals: true }).value
          : escapeHtml(text);
        return (
          `<figure class="code"><figcaption><span>${def.label}</span>` +
          `<button type="button" class="copy-code" data-copy-code>Copy</button></figcaption>` +
          `<pre><code class="hljs">${body}</code></pre></figure>\n`
        );
      },
      blockquote({ tokens }: Tokens.Blockquote): string {
        const inner = this.parser.parse(tokens);
        const match = /^<p>\[!([A-Z]+)\]\s*/.exec(inner);
        if (!match) return `<blockquote>${inner}</blockquote>\n`;
        const kind = match[1] ?? '';
        const label = CALLOUTS[kind];
        if (!label) {
          throw new ContentError(`${where()}: unknown callout [!${kind}]. Known: ${Object.keys(CALLOUTS).join(', ')}`);
        }
        const body = inner.replace(match[0], '<p>').replace(/^<p>\s*<\/p>\n?/, '');
        return `<aside class="callout callout-${kind.toLowerCase()}"><p class="callout-label">${label}</p>${body}</aside>\n`;
      },
      html({ text }: Tokens.HTML | Tokens.Tag): string {
        // Raw HTML is never trusted, even from our own content.
        return escapeHtml(text);
      },
      link({ href, title, tokens }: Tokens.Link): string {
        const text = this.parser.parseInline(tokens);
        if (!SAFE_HREF.test(href)) return text;
        const external = /^https?:/i.test(href);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escapeHtml(href)}"${titleAttr}${rel}>${text}</a>`;
      },
      image({ text }: Tokens.Image): string {
        return escapeHtml(text);
      },
      table(token: Tokens.Table): string {
        const head = token.header
          .map((cell) => `<th${cell.align ? ` style="text-align:${cell.align}"` : ''}>${this.parser.parseInline(cell.tokens)}</th>`)
          .join('');
        const rows = token.rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell) => `<td${cell.align ? ` style="text-align:${cell.align}"` : ''}>${this.parser.parseInline(cell.tokens)}</td>`)
                .join('')}</tr>`,
          )
          .join('\n');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  return marked;
}

/** Markdown inline syntax -> plain text, for summaries and search. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[![A-Z]+\]/g, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\*\*|__|~~|[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
