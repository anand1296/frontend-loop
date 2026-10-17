/**
 * "How it's built" walkthroughs: walkthroughs/*.md → HTML at build time.
 *
 * Two small extensions on top of the content Markdown make these documents
 * impossible to go stale silently:
 *
 * 1. Code links. `[text](repo:backend/store/reminders.go#ClaimDueReminders)`
 *    becomes a GitHub link to that file at the exact commit being built, with
 *    the line of the declaration (`#L97`). `repo:path` links the file,
 *    `repo:path#L10-L20` a range, `repo:dir/` a folder.
 *
 * 2. Live code excerpts. A fence like
 *        ```go excerpt=backend/store/reminders.go#ClaimDueReminders
 *        ```
 *    is filled with the real source of that declaration (plus the comment
 *    above it) and captioned with a link to it. `excerpt=path lines=10-40`
 *    takes a fixed range.
 *
 * Every referenced file and symbol must exist, so renaming a function without
 * updating its walkthrough fails CI with a precise message.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ContentError, parseKeyValueBlock, requireField, splitFrontmatter } from '../content/frontmatter.ts';
import { createMarkdownRenderer } from '../content/markdown.ts';

export const REPO_URL = 'https://github.com/anand1296/frontend-loop';

export interface WalkthroughMeta {
  id: string;
  title: string;
  summary: string;
  order: number;
  minutes: number;
  tags: string[];
  /** Repository files the walkthrough links to or quotes, in first-mention order. */
  files: string[];
}

export interface CompiledWalkthroughs {
  items: WalkthroughMeta[];
  html: Record<string, string>;
  commit: string;
  repoUrl: string;
}

export interface RepoContext {
  /** Absolute path of the repository root (where referenced files are read). */
  root: string;
  /** Commit (or branch) the links point at. */
  commit: string;
  repoUrl?: string;
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_EXCERPT_LINES = 90;

/** The commit being built: Vercel and GitHub Actions expose it; locally ask git; else "main". */
export function currentCommit(root: string): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'main';
  } catch {
    return 'main';
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DECLARATION = /^\s*(export\s+)?(default\s+)?(async\s+)?(func|function|const|let|var|type|interface|class|enum)\b/;

/**
 * 1-based line of the declaration of `symbol`. Go: also methods `func (r *T) Symbol(`.
 * SQL: `CREATE TABLE symbol`. JSON/YAML: a `"symbol":` / `symbol:` key. Markdown: a heading containing it.
 */
export function findSymbolLine(lines: string[], symbol: string, path = ''): number {
  const name = escapeRegExp(symbol);
  const word = new RegExp(`\\b${name}\\b`);
  const patterns: RegExp[] = [new RegExp(`^func \\([^)]*\\) ${name}\\b`), new RegExp(`^CREATE (TABLE|INDEX) ${name}\\b`, 'i')];
  if (path.endsWith('.json')) patterns.push(new RegExp(`^\\s*"${name}"\\s*:`));
  if (/\.ya?ml$/.test(path)) patterns.push(new RegExp(`^\\s*${name}:`));
  if (path.endsWith('.md')) patterns.push(new RegExp(`^#{1,6} .*${name}(?![\\w-])`));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (patterns.some((p) => p.test(line)) || (DECLARATION.test(line) && word.test(line))) return i + 1;
  }
  return -1;
}

/** Lines of the declaration starting at `start` (1-based), including the comment block above it. */
export function extractBlock(lines: string[], start: number, path = ''): { from: number; to: number } {
  const lineComment = path.endsWith('.sql') ? /--.*$/ : /\/\/.*$/;
  let from = start;
  while (from > 1 && /^\s*(\/\/|\/\*|\*|--|#)/.test(lines[from - 2] ?? '')) from--;
  let depth = 0;
  let opened = false;
  for (let i = start - 1; i < lines.length; i++) {
    const line = (lines[i] ?? '')
      .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""') // brackets inside one-line strings don't count
      .replace(lineComment, ''); // nor inside line comments
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') {
        depth++;
        opened = true;
      } else if (ch === '}' || ch === ')' || ch === ']') depth--;
    }
    if (opened && depth <= 0) return { from, to: i + 1 };
    if (!opened) {
      // A one-line declaration (`const Max = 5`), or a bracket-free one ending in `;`.
      if (/;\s*$/.test(line) || (i === start - 1 && !/[=,|&:]\s*$/.test(line))) return { from, to: i + 1 };
      if (line.trim() === '') return { from, to: i };
    }
  }
  return { from, to: lines.length };
}

function blobUrl(ctx: RepoContext, path: string, anchor = ''): string {
  return `${ctx.repoUrl ?? REPO_URL}/blob/${ctx.commit}/${path}${anchor}`;
}

function treeUrl(ctx: RepoContext, path: string): string {
  return `${ctx.repoUrl ?? REPO_URL}/tree/${ctx.commit}/${path.replace(/\/$/, '')}`;
}

function readLines(ctx: RepoContext, path: string, where: string): string[] {
  const full = join(ctx.root, path);
  if (path.includes('..') || !existsSync(full) || !statSync(full).isFile()) {
    throw new ContentError(`${where}: referenced file "${path}" does not exist`);
  }
  return readFileSync(full, 'utf8').split('\n');
}

/**
 * Plain links into `.github/` can't be checked on Vercel: its build checkout doesn't include that
 * folder, so a link that is verified in CI would fail the deploy. CI (a full checkout, no `VERCEL`
 * variable) still checks them; only links without a symbol or range qualify, since those need no content.
 */
function verifiedElsewhere(path: string, anchor: string | undefined): boolean {
  return !anchor && !!process.env.VERCEL && path.startsWith('.github/') && !path.includes('..');
}

/** Resolve `repo:` references to GitHub URLs; returns the URL and the referenced file. */
export function resolveRepoRef(ctx: RepoContext, ref: string, where: string): { url: string; file: string } {
  const [path = '', anchor] = ref.split('#', 2);
  if (verifiedElsewhere(path, anchor)) {
    return { url: path.endsWith('/') ? treeUrl(ctx, path) : blobUrl(ctx, path), file: path };
  }
  if (path.endsWith('/')) {
    const full = join(ctx.root, path);
    if (path.includes('..') || !existsSync(full) || !statSync(full).isDirectory()) {
      throw new ContentError(`${where}: referenced folder "${path}" does not exist`);
    }
    return { url: treeUrl(ctx, path), file: path };
  }
  const lines = readLines(ctx, path, where);
  if (!anchor) return { url: blobUrl(ctx, path), file: path };
  const range = /^L(\d+)(?:-L(\d+))?$/.exec(anchor);
  if (range) {
    const end = Number(range[2] ?? range[1]);
    if (end > lines.length) throw new ContentError(`${where}: "${ref}" is past the end of the file (${lines.length} lines)`);
    return { url: blobUrl(ctx, path, `#${anchor}`), file: path };
  }
  const line = findSymbolLine(lines, anchor, path);
  // Vercel rewrites vercel.json before the build runs (its keys are moved into the deployment config),
  // so symbols there can't be found; CI, with the real file, still verifies them.
  if (line < 0 && process.env.VERCEL && path === 'vercel.json') return { url: blobUrl(ctx, path), file: path };
  if (line < 0) throw new ContentError(`${where}: symbol "${anchor}" not found in ${path}`);
  return { url: blobUrl(ctx, path, `#L${line}`), file: path };
}

const EXCERPT_FENCE = /^```(\w+)\s+excerpt=(\S+?)(?:\s+lines=(\d+)-(\d+))?\s*$/;
const FENCE = /^(`{3,}|~{3,})/;
const REPO_LINK = /\]\(repo:([^)\s]+)\)/g;

/** Rewrite `](repo:…)` links in one line of prose, leaving inline code spans alone. */
function rewriteLinks(line: string, resolve: (ref: string) => string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf('`', i);
    const prose = tick === -1 ? line.slice(i) : line.slice(i, tick);
    out += prose.replace(REPO_LINK, (_whole, ref: string) => `](${resolve(ref)})`);
    if (tick === -1) break;
    // A code span opened by N backticks closes at the next run of exactly N.
    let n = 0;
    while (line[tick + n] === '`') n++;
    const closer = new RegExp(`(?<!\`)\`{${n}}(?!\`)`, 'g');
    closer.lastIndex = tick + n;
    const close = closer.exec(line);
    const endAt = close ? close.index + n : line.length;
    out += line.slice(tick, endAt);
    i = endAt;
  }
  return out;
}

/**
 * Expand excerpt fences and resolve repo: links in one fence-aware pass.
 * Ordinary fenced blocks (and inline code) are left untouched, so a walkthrough
 * can show the syntax itself; quoted source is never re-scanned.
 */
export function expandRepoRefs(markdown: string, ctx: RepoContext, where: string, files: Set<string>): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  const resolve = (ref: string): string => {
    const { url, file } = resolveRepoRef(ctx, ref, where);
    files.add(file);
    return url;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (fence) {
      out.push(line);
      if (line.trim().startsWith(fence) && /^[`~]+$/.test(line.trim()) && line.trim().length >= fence.length) fence = null;
      continue;
    }
    const match = EXCERPT_FENCE.exec(line);
    if (!match) {
      const open = FENCE.exec(line);
      if (open) {
        fence = open[1] ?? '```';
        out.push(line);
      } else {
        out.push(rewriteLinks(line, resolve));
      }
      continue;
    }
    const [, lang = '', ref = '', a, b] = match;
    // Skip the (normally empty) body up to the closing fence.
    let j = i + 1;
    while (j < lines.length && !/^```\s*$/.test(lines[j] ?? '')) j++;
    if (j >= lines.length) throw new ContentError(`${where}: excerpt fence for "${ref}" is not closed`);
    i = j;

    const [path = '', symbol] = ref.split('#', 2);
    const source = readLines(ctx, path, where);
    let from: number;
    let to: number;
    if (a && b) {
      from = Number(a);
      to = Number(b);
      if (from < 1 || to < from || to > source.length) throw new ContentError(`${where}: lines=${a}-${b} is outside ${path}`);
    } else if (symbol) {
      const start = findSymbolLine(source, symbol, path);
      if (start < 0) throw new ContentError(`${where}: symbol "${symbol}" not found in ${path}`);
      ({ from, to } = extractBlock(source, start, path));
    } else {
      throw new ContentError(`${where}: excerpt=${ref} needs #Symbol or lines=a-b`);
    }
    if (to - from + 1 > MAX_EXCERPT_LINES) {
      throw new ContentError(`${where}: excerpt ${ref} is ${to - from + 1} lines; quote at most ${MAX_EXCERPT_LINES} (use lines=a-b)`);
    }
    files.add(path);
    const code = source.slice(from - 1, to).join('\n').replace(/\s+$/, '');
    // A longer fence than any backtick run in the code, so quoted Markdown can't end it early.
    const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
    const marker = '`'.repeat(longest + 1);
    out.push(marker + lang, code, marker, '', `*Source: [${path} · lines ${from}–${to}](${blobUrl(ctx, path, `#L${from}-L${to}`)})*`);
  }
  return out.join('\n');
}

export function compileWalkthroughs(files: Array<{ path: string; source: string }>, ctx: RepoContext): CompiledWalkthroughs {
  let where = '';
  const marked = createMarkdownRenderer(() => where);
  const items: WalkthroughMeta[] = [];
  const html: Record<string, string> = {};
  const seen = new Set<string>();

  for (const file of [...files].sort((x, y) => x.path.localeCompare(y.path))) {
    where = file.path;
    const { data, body } = splitFrontmatter(file.source, file.path);
    const id = requireField(data, 'id', file.path);
    if (!ID_PATTERN.test(id)) throw new ContentError(`${file.path}: id must be kebab-case`);
    if (seen.has(id)) throw new ContentError(`${file.path}: duplicate walkthrough id "${id}"`);
    seen.add(id);
    const order = Number(requireField(data, 'order', file.path));
    const minutes = Number(requireField(data, 'minutes', file.path));
    if (!Number.isInteger(order) || !Number.isInteger(minutes) || minutes < 1) {
      throw new ContentError(`${file.path}: order and minutes must be whole numbers`);
    }

    const referenced = new Set<string>();
    const markdown = expandRepoRefs(body, ctx, file.path, referenced);

    html[id] = marked.parse(markdown, { async: false });
    items.push({
      id,
      title: requireField(data, 'title', file.path),
      summary: requireField(data, 'summary', file.path),
      order,
      minutes,
      tags: (data.tags ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      files: [...referenced],
    });
  }
  items.sort((x, y) => x.order - y.order);
  return { items, html, commit: ctx.commit, repoUrl: ctx.repoUrl ?? REPO_URL };
}

export function readWalkthroughDir(dir: string): Array<{ path: string; source: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ path: `walkthroughs/${name}`, source: readFileSync(join(dir, name), 'utf8') }));
}

export const WALKTHROUGHS_INDEX_ID = 'virtual:walkthroughs';
export const WALKTHROUGHS_CONTENT_ID = 'virtual:walkthroughs/content';

export function walkthroughsIndexCode(compiled: CompiledWalkthroughs): string {
  return (
    `export const walkthroughs = ${JSON.stringify(compiled.items)};\n` +
    `export const commit = ${JSON.stringify(compiled.commit)};\n` +
    `export const repoUrl = ${JSON.stringify(compiled.repoUrl)};\n` +
    `export const loadWalkthroughs = () => import(${JSON.stringify(WALKTHROUGHS_CONTENT_ID)});\n`
  );
}

export function walkthroughsContentCode(compiled: CompiledWalkthroughs): string {
  return `export default ${JSON.stringify(compiled.html)};\n`;
}

export { parseKeyValueBlock };
