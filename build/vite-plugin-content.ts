/**
 * Vite adapter for the content compiler.
 *
 * - Serves `virtual:content` and `virtual:content/section/<id>`, plus the
 *   "How it's built" walkthroughs as `virtual:walkthroughs` (+ `/content`).
 * - Watches content/*.md in dev and triggers a full reload on change
 *   (content edits are rare and a full reload keeps the logic trivial).
 * - Fails `vite build` with a precise message if any content is invalid.
 */
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { compileContent, readContentDir, type CompiledContent } from './content/compile.ts';
import { INDEX_MODULE_ID, indexModuleCode, SECTION_MODULE_PREFIX, sectionModuleCode } from './content/codegen.ts';
import {
  compileWalkthroughs,
  currentCommit,
  readWalkthroughDir,
  WALKTHROUGHS_CONTENT_ID,
  WALKTHROUGHS_INDEX_ID,
  walkthroughsContentCode,
  walkthroughsIndexCode,
  type CompiledWalkthroughs,
} from './walkthroughs/compile.ts';

const RESOLVED_PREFIX = '\0';

export function contentPlugin(options: { dir?: string } = {}): Plugin {
  const dir = resolve(options.dir ?? 'content');
  let cache: CompiledContent | null = null;
  const compiled = (): CompiledContent => (cache ??= compileContent(readContentDir(dir)));
  const root = resolve('.');
  const walkDir = resolve('walkthroughs');
  let walkCache: CompiledWalkthroughs | null = null;
  const walkthroughs = (): CompiledWalkthroughs =>
    (walkCache ??= compileWalkthroughs(readWalkthroughDir(walkDir), { root, commit: currentCommit(root) }));

  return {
    name: 'whetstone:content',
    resolveId(id) {
      if (id === INDEX_MODULE_ID || id.startsWith(SECTION_MODULE_PREFIX)) return RESOLVED_PREFIX + id;
      if (id === WALKTHROUGHS_INDEX_ID || id === WALKTHROUGHS_CONTENT_ID) return RESOLVED_PREFIX + id;
      return null;
    },
    load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return null;
      const virtualId = id.slice(RESOLVED_PREFIX.length);
      if (virtualId === INDEX_MODULE_ID) return indexModuleCode(compiled());
      if (virtualId === WALKTHROUGHS_INDEX_ID) return walkthroughsIndexCode(walkthroughs());
      if (virtualId === WALKTHROUGHS_CONTENT_ID) return walkthroughsContentCode(walkthroughs());
      if (virtualId.startsWith(SECTION_MODULE_PREFIX)) {
        const sectionId = virtualId.slice(SECTION_MODULE_PREFIX.length);
        return sectionModuleCode(compiled().answers[sectionId]);
      }
      return null;
    },
    configureServer(server) {
      server.watcher.add(dir);
      server.watcher.add(walkDir);
      server.watcher.on('change', (file) => {
        // Walkthroughs quote source files, so any change may alter them.
        walkCache = null;
        if (file.startsWith(walkDir)) {
          for (const mod of server.moduleGraph.idToModuleMap.values()) {
            if (mod.id?.startsWith(RESOLVED_PREFIX + WALKTHROUGHS_INDEX_ID)) server.moduleGraph.invalidateModule(mod);
          }
          server.ws.send({ type: 'full-reload' });
          return;
        }
        if (!file.startsWith(dir) || !file.endsWith('.md')) return;
        cache = null;
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.id?.startsWith(RESOLVED_PREFIX + INDEX_MODULE_ID)) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}
