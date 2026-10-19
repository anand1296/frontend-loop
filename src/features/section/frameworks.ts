/** Framework variants in a rendered answer (see build/content/frameworks.ts for how they are authored). */
export const FRAMEWORKS = [
  { id: 'react', label: 'React' },
  { id: 'angular', label: 'Angular' },
  { id: 'vue', label: 'Vue' },
] as const;

export type FrameworkId = (typeof FRAMEWORKS)[number]['id'];

export function isFrameworkId(value: unknown): value is FrameworkId {
  return FRAMEWORKS.some((f) => f.id === value);
}

export function frameworkLabel(id: FrameworkId): string {
  return FRAMEWORKS.find((f) => f.id === id)?.label ?? id;
}

/** Frameworks that have a dedicated section in this answer, in display order. */
export function frameworksIn(html: string): FrameworkId[] {
  return FRAMEWORKS.filter((f) => html.includes(`data-fw="${f.id}"`)).map((f) => f.id);
}

/**
 * Which variant to show: the reader's choice when this answer has it, else React (the reference
 * implementation), else the first one that exists.
 */
export function pickFramework(available: FrameworkId[], preferred: FrameworkId): FrameworkId | null {
  if (available.length === 0) return null;
  if (available.includes(preferred)) return preferred;
  return available.includes('react') ? 'react' : (available[0] ?? null);
}
