/**
 * Content compiler: content/*.md -> { sections metadata, answer HTML per section }.
 *
 * Pure function of its inputs (no fs access here) so it can be unit tested and
 * reused by any bundler adapter: the Vite plugin, the esbuild single-file build
 * and the content checker all call compileContent().
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Marked, Token } from 'marked';
import { isLevel, LEVELS, type QuestionMeta, type SectionAnswers, type SectionMeta } from '../../src/content/types.ts';
import { ContentError, parseKeyValueBlock, requireField, splitFrontmatter } from './frontmatter.ts';
import { createMarkdownRenderer, toPlainText } from './markdown.ts';
import { expandFrameworkBlocks } from './frameworks.ts';

export interface SourceFile {
  path: string;
  source: string;
}

export interface CompiledContent {
  sections: SectionMeta[];
  answers: Record<string, SectionAnswers>;
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEARCH_BODY_LIMIT = 700;

interface RawQuestion {
  title: string;
  markdown: string;
  line: number;
}

/** Split a section body on `## ` headings, ignoring headings inside fenced code. */
export function splitQuestions(body: string): RawQuestion[] {
  const lines = body.split('\n');
  const questions: RawQuestion[] = [];
  let current: RawQuestion | null = null;
  let fence: string | null = null;

  lines.forEach((line, index) => {
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
    }
    const heading = fence === null ? /^##\s+(.+?)\s*$/.exec(line) : null;
    if (heading) {
      current = { title: heading[1] ?? '', markdown: '', line: index + 1 };
      questions.push(current);
      return;
    }
    if (current) current.markdown += `${line}\n`;
  });

  return questions;
}

function collectText(tokens: Token[], out: string[]): void {
  for (const token of tokens) {
    if (token.type === 'code' || token.type === 'html') continue;
    if ('tokens' in token && Array.isArray(token.tokens)) {
      collectText(token.tokens, out);
    } else if (token.type === 'list') {
      for (const item of token.items) collectText(item.tokens, out);
    } else if ('text' in token && typeof token.text === 'string') {
      out.push(token.text);
    }
  }
}

function findSummary(tokens: Token[]): string | null {
  for (const token of tokens) {
    if (token.type === 'blockquote' && token.text.trimStart().startsWith('[!TLDR]')) {
      return toPlainText(token.text.replace('[!TLDR]', ''));
    }
  }
  return null;
}

function compileQuestion(
  raw: RawQuestion,
  sectionId: string,
  file: string,
  marked: Marked,
  setWhere: (where: string) => void,
): { meta: QuestionMeta; html: string } {
  const where = `${file}:${raw.line} "${raw.title}"`;
  setWhere(where);
  const trimmed = raw.markdown.trimStart();
  if (!trimmed.startsWith('<!--')) {
    throw new ContentError(`${where}: question must start with a <!-- meta --> comment (id, level, tags, minutes)`);
  }
  const close = trimmed.indexOf('-->');
  if (close === -1) throw new ContentError(`${where}: meta comment is not closed with -->`);
  const meta = parseKeyValueBlock(trimmed.slice(4, close), `${where} (meta)`);
  const answerMarkdown = trimmed.slice(close + 3).trim();

  const id = requireField(meta, 'id', where);
  if (!ID_PATTERN.test(id)) throw new ContentError(`${where}: id "${id}" must be kebab-case`);

  const level = requireField(meta, 'level', where);
  if (!isLevel(level)) throw new ContentError(`${where}: level "${level}" must be one of ${LEVELS.join(', ')}`);

  const minutes = Number(requireField(meta, 'minutes', where));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
    throw new ContentError(`${where}: minutes must be an integer between 1 and 120`);
  }

  const tags = requireField(meta, 'tags', where)
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag !== '');
  if (tags.length === 0) throw new ContentError(`${where}: at least one tag is required`);

  if (answerMarkdown.length < 200) throw new ContentError(`${where}: answer is suspiciously short`);

  const tokens = marked.lexer(expandFrameworkBlocks(answerMarkdown, where));
  const summary = findSummary(tokens);
  if (!summary) throw new ContentError(`${where}: answer must include a > [!TLDR] callout`);

  const texts: string[] = [];
  collectText(tokens, texts);
  const searchText = toPlainText(texts.join(' ')).slice(0, SEARCH_BODY_LIMIT).toLowerCase();

  const html = marked.parser(tokens);
  return {
    meta: { id, sectionId, title: raw.title, level, tags, minutes, summary, searchText },
    html,
  };
}

export function compileContent(files: SourceFile[]): CompiledContent {
  let where = '';
  const marked = createMarkdownRenderer(() => where);
  const setWhere = (next: string): void => {
    where = next;
  };

  const sections: SectionMeta[] = [];
  const answers: Record<string, SectionAnswers> = {};
  const seenIds = new Map<string, string>();

  const claim = (id: string, owner: string): void => {
    const existing = seenIds.get(id);
    if (existing) throw new ContentError(`Duplicate id "${id}" used by ${existing} and ${owner}`);
    seenIds.set(id, owner);
  };

  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of ordered) {
    const { data, body } = splitFrontmatter(file.source, file.path);
    const sectionId = requireField(data, 'id', file.path);
    if (!ID_PATTERN.test(sectionId)) throw new ContentError(`${file.path}: section id must be kebab-case`);
    claim(sectionId, file.path);

    const sectionAnswers: SectionAnswers = {};
    const questions = splitQuestions(body).map((raw) => {
      const compiled = compileQuestion(raw, sectionId, file.path, marked, setWhere);
      claim(compiled.meta.id, `${file.path} "${raw.title}"`);
      sectionAnswers[compiled.meta.id] = compiled.html;
      return compiled.meta;
    });
    if (questions.length === 0) throw new ContentError(`${file.path}: section has no questions`);

    sections.push({
      id: sectionId,
      title: requireField(data, 'title', file.path),
      description: requireField(data, 'description', file.path),
      questions,
    });
    answers[sectionId] = sectionAnswers;
  }

  return { sections, answers };
}

export function readContentDir(dir: string): SourceFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ path: `content/${name}`, source: readFileSync(join(dir, name), 'utf8') }));
}
