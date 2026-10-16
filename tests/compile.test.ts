import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContent, readContentDir, splitQuestions, type SourceFile } from '../build/content/compile.ts';
import { ContentError } from '../build/content/frontmatter.ts';

const answer = (extra = '') => `<!--
id: q-one
level: senior
tags: react, effects
minutes: 10
-->

> [!TLDR]
> A short summary with **bold** and \`code\`.

### Details

${'Some body text that is long enough to pass the length check. '.repeat(4)}
${extra}`;

const file = (body: string, id = 'sec'): SourceFile => ({
  path: `content/${id}.md`,
  source: `---\nid: ${id}\ntitle: Section\ndescription: A section.\n---\n\n${body}`,
});

describe('splitQuestions', () => {
  it('ignores ## headings inside fenced code', () => {
    const parts = splitQuestions('## First\ntext\n```md\n## not a question\n```\n## Second\nmore\n');
    assert.deepEqual(
      parts.map((p) => p.title),
      ['First', 'Second'],
    );
  });
});

describe('compileContent', () => {
  it('compiles a valid section and extracts the summary', () => {
    const { sections, answers } = compileContent([file(`## What is it?\n${answer()}`)]);
    const question = sections[0]?.questions[0];
    assert.equal(question?.id, 'q-one');
    assert.equal(question?.summary, 'A short summary with bold and code.');
    assert.deepEqual(question?.tags, ['react', 'effects']);
    assert.match(answers.sec?.['q-one'] ?? '', /callout-tldr/);
  });

  it('escapes raw HTML in answers', () => {
    const { answers } = compileContent([file(`## Q?\n${answer('<script>alert(1)</script>')}`)]);
    const html = answers.sec?.['q-one'] ?? '';
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('drops javascript: links but keeps their text', () => {
    const { answers } = compileContent([file(`## Q?\n${answer('[click](javascript:alert(1)) and [ok](https://example.com)')}`)]);
    const html = answers.sec?.['q-one'] ?? '';
    assert.ok(!html.includes('javascript:'));
    assert.match(html, /href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/);
  });

  it('highlights code and adds a copy button', () => {
    const { answers } = compileContent([file(`## Q?\n${answer('```ts\nconst x: number = 1;\n```')}`)]);
    assert.match(answers.sec?.['q-one'] ?? '', /data-copy-code[\s\S]*hljs-keyword/);
  });

  it('rejects missing TL;DR, bad levels, unknown languages and duplicate ids', () => {
    assert.throws(() => compileContent([file(`## Q?\n${answer().replace('[!TLDR]', '[!NOTE]')}`)]), ContentError);
    assert.throws(() => compileContent([file(`## Q?\n${answer().replace('level: senior', 'level: junior')}`)]), ContentError);
    assert.throws(() => compileContent([file(`## Q?\n${answer('```cobol\nx\n```')}`)]), ContentError);
    assert.throws(() => compileContent([file(`## A?\n${answer()}\n## B?\n${answer()}`)]), /Duplicate id/);
    assert.throws(() => compileContent([file(`## A?\n${answer()}`, 'q-one')]), /Duplicate id/);
  });

  it('compiles the real content folder', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const { sections } = compileContent(readContentDir(join(root, 'content')));
    assert.ok(sections.length >= 10);
    const total = sections.reduce((sum, s) => sum + s.questions.length, 0);
    assert.ok(total >= 80, `expected a substantial question bank, got ${total}`);
  });
});
