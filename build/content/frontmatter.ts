/**
 * A deliberately tiny "key: value" parser used for section front matter and
 * per-question meta comments. We don't need YAML's power (anchors, nesting,
 * types), and a 30-line parser with good error messages is easier to reason
 * about than a dependency.
 */

export class ContentError extends Error {
  override name = 'ContentError';
}

export function parseKeyValueBlock(block: string, where: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;
    const colon = line.indexOf(':');
    if (colon <= 0) {
      throw new ContentError(`${where}: line ${index + 1} is not "key: value" -> ${JSON.stringify(rawLine)}`);
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key in result) {
      throw new ContentError(`${where}: duplicate key "${key}"`);
    }
    result[key] = value;
  });
  return result;
}

export interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

export function splitFrontmatter(source: string, where: string): Frontmatter {
  const normalized = source.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new ContentError(`${where}: file must start with a --- front matter block`);
  }
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) {
    throw new ContentError(`${where}: front matter block is not closed with ---`);
  }
  const data = parseKeyValueBlock(normalized.slice(4, end), `${where} (front matter)`);
  const afterClose = normalized.indexOf('\n', end + 1);
  const body = afterClose === -1 ? '' : normalized.slice(afterClose + 1);
  return { data, body };
}

export function requireField(data: Record<string, string>, key: string, where: string): string {
  const value = data[key];
  if (value === undefined || value === '') {
    throw new ContentError(`${where}: missing required field "${key}"`);
  }
  return value;
}
