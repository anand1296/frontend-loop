/**
 * In-memory search over ~100 questions. No library needed at this size:
 * a weighted substring match finishes in well under a millisecond.
 *
 * Every query token must match somewhere (AND semantics). Matches in the
 * title outrank tags, which outrank the TL;DR, which outranks body text.
 * If the bank grows to thousands of questions, swap this for a prebuilt
 * inverted index (MiniSearch/FlexSearch) generated at build time.
 */
import type { SectionMeta } from '../content/types.ts';

export interface SearchDoc {
  id: string;
  sectionId: string;
  order: number;
  title: string;
  tags: string[];
  summary: string;
  body: string;
}

export interface SearchHit {
  id: string;
  score: number;
}

export function buildSearchIndex(sections: SectionMeta[]): SearchDoc[] {
  let order = 0;
  return sections.flatMap((section) =>
    section.questions.map((question) => ({
      id: question.id,
      sectionId: section.id,
      order: order++,
      title: ` ${question.title.replace(/`/g, '').toLowerCase()}`,
      tags: question.tags,
      summary: question.summary.toLowerCase(),
      body: `${section.title.toLowerCase()} ${question.searchText}`,
    })),
  );
}

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function scoreToken(doc: SearchDoc, token: string): number {
  let score = 0;
  if (doc.title.includes(` ${token}`)) score += 12;
  else if (doc.title.includes(token)) score += 8;
  if (doc.tags.some((tag) => tag.startsWith(token))) score += 6;
  else if (doc.tags.some((tag) => tag.includes(token))) score += 3;
  if (doc.summary.includes(token)) score += 3;
  if (doc.body.includes(token)) score += 1;
  return score;
}

export function searchQuestions(index: SearchDoc[], query: string, limit = 30): SearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const hits: Array<SearchHit & { order: number }> = [];
  for (const doc of index) {
    let total = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const score = scoreToken(doc, token);
      if (score === 0) {
        matchedAll = false;
        break;
      }
      total += score;
    }
    if (matchedAll) hits.push({ id: doc.id, score: total, order: doc.order });
  }
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.slice(0, limit).map(({ id, score }) => ({ id, score }));
}
