/** Modules generated at build time by build/content (see codegen.ts). */
declare module 'virtual:content' {
  export const sections: import('./types.ts').SectionMeta[];
  export const loaders: Record<string, () => Promise<{ default: import('./types.ts').SectionAnswers }>>;
}
