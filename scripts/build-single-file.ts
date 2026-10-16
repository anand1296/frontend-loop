/**
 * Single-file build: bundles the whole app (JS, CSS, all content) into one
 * self-contained HTML file using esbuild and the same content compiler as Vite.
 *
 * Outputs:
 *   dist-single/frontend-loop.html  a complete document; open it from disk or host anywhere
 *   dist-single/artifact.html       the same app as body content only, for hosts that
 *                                   wrap pages in their own <html>/<head> (claude.ai Artifacts)
 *
 *   dist-web/                       (--web only) index.html + assets/app.{js,css}: a
 *                                   multi-file, CSP-friendly build with backend detection
 *                                   on, for serving next to the Go API without Vite
 *                                   (`go run ./cmd/server -static dist-web`)
 *
 * Usage: node scripts/build-single-file.ts [--web]
 */
import { build, type Plugin } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContent, readContentDir, type CompiledContent } from '../build/content/compile.ts';
import { INDEX_MODULE_ID, indexModuleCode, SECTION_MODULE_PREFIX, sectionModuleCode } from '../build/content/codegen.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-single');

function contentPlugin(content: CompiledContent): Plugin {
  return {
    name: 'frontend-loop:content',
    setup(builder) {
      builder.onResolve({ filter: /^virtual:content/ }, (args) => ({ path: args.path, namespace: 'virtual-content' }));
      builder.onLoad({ filter: /.*/, namespace: 'virtual-content' }, (args) => {
        if (args.path === INDEX_MODULE_ID) return { contents: indexModuleCode(content), loader: 'js' };
        const sectionId = args.path.slice(SECTION_MODULE_PREFIX.length);
        return { contents: sectionModuleCode(content.answers[sectionId]), loader: 'js' };
      });
    },
  };
}

const started = performance.now();
const content = compileContent(readContentDir(join(root, 'content')));

const result = await build({
  entryPoints: [join(root, 'src/main.tsx')],
  bundle: true,
  write: false,
  outdir: outDir,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"', __BACKEND__: 'false' },
  plugins: [contentPlugin(content)],
  logLevel: 'warning',
});

const js = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';
const css = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
if (!js) throw new Error('esbuild produced no JavaScript');

// Inline scripts must not contain a literal "</script" or the HTML parser ends the tag early.
const safeJs = js.replace(/<\/script/gi, '<\\/script');
// Parse the small, script-free template ONCE, then assemble outputs by concatenation.
// Never pass bundle text as a String.prototype.replace replacement string: "$&", "$'",
// "$`" and "$$" inside minified code are replacement patterns and silently corrupt it
// (this once injected a stray "</body>" into the bundle and truncated the hosted page).
const template = readFileSync(join(root, 'index.html'), 'utf8').replace(
  /\s*<script type="module" src="\/src\/main.tsx"><\/script>/,
  '',
);
const headInner = /<head>([\s\S]*?)<\/head>/.exec(template)?.[1] ?? '';
const bodyInner = /<body>([\s\S]*?)<\/body>/.exec(template)?.[1] ?? '';
const styleTag = `<style>${css}</style>`;
const scriptTag = `<script>${safeJs}</script>`;

const fullDocument = [
  '<!doctype html>\n<html lang="en">\n  <head>',
  headInner.trimEnd(),
  `    ${styleTag}`,
  '  </head>\n  <body>',
  bodyInner.trimEnd(),
  `    ${scriptTag}`,
  '  </body>\n</html>\n',
].join('\n');

// Artifact variant: the host provides <html>/<head>/<body>, charset and viewport.
const artifactHead = headInner
  .replace(/\s*<meta charset="UTF-8" \/>/, '')
  .replace(/\s*<meta name="viewport"[^>]*\/>/, '')
  .replace(/\s*<link rel="icon"[^>]*\/>/, '')
  .trim();
const artifact = [artifactHead, styleTag, bodyInner.trim(), scriptTag, ''].join('\n');

// Integrity checks: the bundle must survive byte-for-byte in both outputs.
for (const [name, output] of [['frontend-loop.html', fullDocument], ['artifact.html', artifact]] as const) {
  const start = output.indexOf(scriptTag);
  if (start === -1 || output.indexOf(scriptTag, start + 1) !== -1) {
    throw new Error(`${name}: inline bundle is missing, duplicated or altered`);
  }
  if (/<\/body>|<\/html>/i.test(safeJs)) throw new Error('bundle contains a document-closing tag');
}
if (!artifact.trimEnd().endsWith('</script>')) throw new Error('artifact.html must end with the app script');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'frontend-loop.html'), fullDocument);
writeFileSync(join(outDir, 'artifact.html'), artifact);

if (process.argv.includes('--web')) {
  const web = await build({
    entryPoints: [join(root, 'src/main.tsx')],
    bundle: true,
    write: false,
    outdir: join(root, 'dist-web/assets'),
    entryNames: 'app',
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    minify: true,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"', __BACKEND__: 'true' },
    plugins: [contentPlugin(content)],
    logLevel: 'warning',
  });
  const webDir = join(root, 'dist-web');
  mkdirSync(join(webDir, 'assets'), { recursive: true });
  for (const file of web.outputFiles) writeFileSync(file.path, file.contents);
  const page = [
    '<!doctype html>\n<html lang="en">\n  <head>',
    headInner.trimEnd(),
    '    <link rel="stylesheet" href="assets/app.css" />',
    '    <script defer src="assets/app.js"></script>',
    '  </head>\n  <body>',
    bodyInner.trimEnd(),
    '  </body>\n</html>\n',
  ].join('\n');
  writeFileSync(join(webDir, 'index.html'), page);
  console.log('  -> dist-web/ (multi-file build with backend detection)');
}

const questions = content.sections.reduce((sum, section) => sum + section.questions.length, 0);
const kb = (text: string): string => `${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`;
console.log(
  `Built ${content.sections.length} sections, ${questions} questions in ${Math.round(performance.now() - started)} ms\n` +
    `  JS ${kb(js)} · CSS ${kb(css)} · HTML ${kb(fullDocument)}\n` +
    `  -> dist-single/frontend-loop.html, dist-single/artifact.html`,
);
