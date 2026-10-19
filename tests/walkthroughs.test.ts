import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentError } from '../build/content/frontmatter.ts';
import { compileWalkthroughs, extractBlock, findSymbolLine } from '../build/walkthroughs/compile.ts';

const GO = `package store

// MaxThings caps things.
const MaxThings = 5

// ClaimDue picks rows nobody else is sending.
// It runs in one statement.
func (s *Store) ClaimDue(ctx context.Context, limit int) ([]Row, error) {
	rows, err := s.db.QueryContext(ctx, \`SELECT id FROM t WHERE "}" = '{'\`, limit)
	if err != nil {
		return nil, err
	}
	return scan(rows)
}

func after() {}
`;

const TS = `export const KEYS = ['a', 'b'] as const;

/** Parse a thing. */
export function parse(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value;
}
`;

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'walk-'));
  mkdirSync(join(root, 'backend/store'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'backend/store/things.go'), GO);
  writeFileSync(join(root, 'src/parse.ts'), TS);
  return root;
}

const doc = (body: string, id = 'demo') => ({
  path: `walkthroughs/${id}.md`,
  source: `---\nid: ${id}\ntitle: Demo\nsummary: A demo.\norder: 1\nminutes: 5\ntags: go, react\n---\n\n${body}\n`,
});

const ctx = (root: string) => ({ root, commit: 'abc123' });

describe('findSymbolLine / extractBlock', () => {
  const lines = GO.split('\n');
  it('finds Go methods, functions and consts', () => {
    assert.equal(findSymbolLine(lines, 'ClaimDue'), 8);
    assert.equal(findSymbolLine(lines, 'MaxThings'), 4);
    assert.equal(findSymbolLine(lines, 'nope'), -1);
  });
  it('takes the comment above and stops at the closing brace', () => {
    assert.deepEqual(extractBlock(lines, 8), { from: 6, to: 14 });
    assert.deepEqual(extractBlock(lines, 4), { from: 3, to: 4 });
  });
  it('handles TypeScript declarations', () => {
    const ts = TS.split('\n');
    assert.deepEqual(extractBlock(ts, findSymbolLine(ts, 'KEYS')), { from: 1, to: 1 });
    assert.deepEqual(extractBlock(ts, findSymbolLine(ts, 'parse')), { from: 3, to: 7 });
  });
});

describe('compileWalkthroughs', () => {
  it('turns repo: links into GitHub links at the commit, with symbol lines', () => {
    const root = repo();
    const out = compileWalkthroughs(
      [doc('See [the claim](repo:backend/store/things.go#ClaimDue), [a range](repo:src/parse.ts#L1-L2) and [the folder](repo:backend/store/).')],
      ctx(root),
    );
    const html = out.html.demo ?? '';
    assert.match(html, /href="https:\/\/github.com\/anand1296\/whetstone\/blob\/abc123\/backend\/store\/things.go#L8"/);
    assert.match(html, /blob\/abc123\/src\/parse.ts#L1-L2/);
    assert.match(html, /tree\/abc123\/backend\/store"/);
    assert.deepEqual(out.items[0]?.files, ['backend/store/things.go', 'src/parse.ts', 'backend/store/']);
    assert.deepEqual(out.items[0]?.tags, ['go', 'react']);
  });

  it('fills excerpt fences with live source and a caption', () => {
    const root = repo();
    const out = compileWalkthroughs([doc('```go excerpt=backend/store/things.go#ClaimDue\n```\n\n```ts excerpt=src/parse.ts lines=1-1\n```')], ctx(root));
    const html = out.html.demo ?? '';
    assert.match(html, /ClaimDue picks rows/);
    assert.match(html, /return<\/span> scan\(rows\)/);
    assert.doesNotMatch(html, /func after/);
    assert.match(html, /things.go#L6-L14/);
    assert.match(html, /parse.ts · lines 1–1/);
  });

  it('fails on a missing file, symbol or bad range', () => {
    const root = repo();
    assert.throws(() => compileWalkthroughs([doc('[x](repo:nope.go)')], ctx(root)), ContentError);
    assert.throws(() => compileWalkthroughs([doc('[x](repo:src/parse.ts#Gone)')], ctx(root)), /symbol "Gone" not found/);
    assert.throws(() => compileWalkthroughs([doc('[x](repo:src/parse.ts#L1-L999)')], ctx(root)), /past the end/);
    assert.throws(() => compileWalkthroughs([doc('```go excerpt=src/parse.ts\n```')], ctx(root)), /needs #Symbol/);
    assert.throws(() => compileWalkthroughs([doc('[x](repo:../etc/passwd)')], ctx(root)), /does not exist/);
  });

  it('leaves inline code and ordinary fences alone', () => {
    const root = repo();
    const body = 'Write `[x](repo:nope.go)` like this.\n\n````text\n```go excerpt=nope.go#X\n```\n[y](repo:nope.go)\n````\n\nReal: [z](repo:src/parse.ts#parse)';
    const out = compileWalkthroughs([doc(body)], ctx(root));
    const html = out.html.demo ?? '';
    assert.match(html, /<code>\[x\]\(repo:nope.go\)<\/code>/);
    assert.match(html, /excerpt=nope.go#X/);
    assert.match(html, /parse.ts#L4"/);
    assert.deepEqual(out.items[0]?.files, ['src/parse.ts']);
  });

  it('does not check plain .github links on Vercel, whose checkout omits that folder', () => {
    const root = repo();
    const body = '[ci](repo:.github/workflows/ci.yml) and [forms](repo:.github/ISSUE_TEMPLATE/)';
    assert.throws(() => compileWalkthroughs([doc(body)], ctx(root)), /does not exist/);
    const before = process.env.VERCEL;
    process.env.VERCEL = '1';
    try {
      const html = compileWalkthroughs([doc(body)], ctx(root)).html.demo ?? '';
      assert.match(html, /blob\/abc123\/.github\/workflows\/ci.yml"/);
      assert.match(html, /tree\/abc123\/.github\/ISSUE_TEMPLATE"/);
      assert.throws(() => compileWalkthroughs([doc('[x](repo:.github/ci.yml#Gone)')], ctx(root)), /does not exist/);
    } finally {
      if (before === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = before;
    }
  });

  it('falls back to a plain link for symbols in vercel.json on Vercel, which rewrites that file', () => {
    const root = repo();
    writeFileSync(join(root, 'vercel.json'), '{}\n');
    const body = '[r](repo:vercel.json#rewrites)';
    assert.throws(() => compileWalkthroughs([doc(body)], ctx(root)), /symbol "rewrites" not found/);
    const before = process.env.VERCEL;
    process.env.VERCEL = '1';
    try {
      assert.match(compileWalkthroughs([doc(body)], ctx(root)).html.demo ?? '', /blob\/abc123\/vercel.json"/);
    } finally {
      if (before === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = before;
    }
  });

  it('sorts by order and rejects duplicate ids', () => {
    const root = repo();
    const second = { ...doc('Two', 'two'), source: doc('Two', 'two').source.replace('order: 1', 'order: 0') };
    const out = compileWalkthroughs([doc('One', 'one'), second], ctx(root));
    assert.deepEqual(
      out.items.map((i) => i.id),
      ['two', 'one'],
    );
    assert.throws(() => compileWalkthroughs([doc('a', 'x'), { ...doc('b', 'x'), path: 'walkthroughs/y.md' }], ctx(root)), /duplicate/);
  });
});
