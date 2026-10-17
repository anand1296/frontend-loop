/** Modules generated at build time by build/content (see codegen.ts). */
declare module 'virtual:content' {
  export const sections: import('./types.ts').SectionMeta[];
  export const loaders: Record<string, () => Promise<{ default: import('./types.ts').SectionAnswers }>>;
}

/** "How it's built" walkthroughs, compiled by build/walkthroughs/compile.ts. */
declare module 'virtual:walkthroughs' {
  export interface WalkthroughMeta {
    id: string;
    title: string;
    summary: string;
    order: number;
    minutes: number;
    tags: string[];
    files: string[];
  }
  export const walkthroughs: WalkthroughMeta[];
  /** The commit the code links point at (a SHA, or "main" when unknown). */
  export const commit: string;
  export const repoUrl: string;
  export const loadWalkthroughs: () => Promise<{ default: Record<string, string> }>;
}
