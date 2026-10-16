/**
 * Validates every content file and prints a summary. Runs in CI before the build
 * so a malformed question fails fast with a file:line message.
 *
 * Usage: node scripts/check-content.ts [--emit <file.json>]
 *
 * --emit writes the compiled sections + answer HTML as JSON. CI feeds that file
 * to the Go renderer's parity test (backend/catalog), which checks that both
 * renderers produce the same document for every answer.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContent, readContentDir } from '../build/content/compile.ts';
import { ContentError } from '../build/content/frontmatter.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const compiled = compileContent(readContentDir(join(root, 'content')));
  const { sections } = compiled;
  const emitAt = process.argv.indexOf('--emit');
  const emitPath = emitAt === -1 ? undefined : process.argv[emitAt + 1];
  if (emitPath) writeFileSync(emitPath, JSON.stringify(compiled));
  const rows = sections.map((section) => {
    const levels = { senior: 0, lead: 0, principal: 0 };
    for (const question of section.questions) levels[question.level] += 1;
    const minutes = section.questions.reduce((sum, q) => sum + q.minutes, 0);
    return { section: section.id, questions: section.questions.length, ...levels, minutes };
  });
  console.table(rows);
  const total = rows.reduce((sum, row) => sum + row.questions, 0);
  console.log(`OK: ${sections.length} sections, ${total} questions`);
} catch (error) {
  if (error instanceof ContentError) {
    console.error(`Content error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
