/**
 * Turns compiled content into ES module source code. Bundler adapters (Vite,
 * esbuild) serve these strings as "virtual modules":
 *
 *   virtual:content                 -> { sections, loaders }   (eager, small)
 *   virtual:content/section/<id>    -> answer HTML for a section (lazy chunk)
 *
 * The index stays small so first paint is fast; each section's answers are a
 * separate chunk fetched the first time that section is opened.
 */
import type { SectionAnswers } from '../../src/content/types.ts';
import type { CompiledContent } from './compile.ts';

export const INDEX_MODULE_ID = 'virtual:content';
export const SECTION_MODULE_PREFIX = 'virtual:content/section/';

export function indexModuleCode(content: CompiledContent): string {
  const loaders = content.sections
    .map((section) => `  ${JSON.stringify(section.id)}: () => import(${JSON.stringify(SECTION_MODULE_PREFIX + section.id)})`)
    .join(',\n');
  return `export const sections = ${JSON.stringify(content.sections)};\nexport const loaders = {\n${loaders}\n};\n`;
}

export function sectionModuleCode(answers: SectionAnswers | undefined): string {
  return `export default ${JSON.stringify(answers ?? {})};\n`;
}
