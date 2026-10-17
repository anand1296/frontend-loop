---
id: how-its-built
title: How "How it's built" is built
summary: The walkthroughs you're reading quote live source code and link to exact lines on GitHub at the commit you're running, and the build fails if a link goes stale. A small compiler on top of the content pipeline makes that possible.
order: 7
minutes: 8
tags: build tooling, documentation, vite, typescript
---

> [!TLDR]
> Walkthroughs are Markdown files in [walkthroughs/](repo:walkthroughs/) with two extensions. `[text](repo:path#Symbol)` becomes a GitHub link to the line where `Symbol` is declared, at the **exact commit being built**. A fence like ` ```go excerpt=path#Symbol ` is filled with that declaration's **real source** at build time. Every file and symbol must exist, so renaming a function without updating its walkthrough fails `npm run check` and CI with a precise message. Documentation that can't silently drift from the code.

### The problem with docs about code

Architecture docs rot. Someone renames `ClaimDue` to `ClaimDueReminders`, the doc still says `ClaimDue`, and nobody notices for a year. Copy-pasted snippets are worse: they look authoritative and are quietly wrong. Two rules fix that here:

1. **Never paste code into a walkthrough; quote it by name.** The build inserts the current source.
2. **Never link to a line number by hand; link to a symbol.** The build finds the line.

### Writing a walkthrough

````text
---
id: email-reminders
title: Email reminders, end to end
summary: …
order: 2
minutes: 14
tags: go, postgres
---

The claim happens in [`ClaimDueReminders`](repo:backend/store/reminders.go#ClaimDueReminders):

```go excerpt=backend/store/reminders.go#ClaimDueReminders
```
````

That's all. The compiler does the rest.

### Finding a symbol

```ts excerpt=build/walkthroughs/compile.ts#findSymbolLine
```

It's deliberately a line-based heuristic, not a parser per language: a declaration keyword plus the name, Go methods (`func (s *Store) Name(`), SQL tables, JSON/YAML keys and Markdown headings. That covers every file type the walkthroughs quote, in thirty lines, and the tests pin down each case ([walkthroughs.test.ts](repo:tests/walkthroughs.test.ts)).

[`extractBlock`](repo:build/walkthroughs/compile.ts#extractBlock) then takes the comment above the declaration (the "why" usually lives there) and follows brackets until the declaration closes, ignoring brackets inside strings and comments. Excerpts are capped at 90 lines; longer ones must name an explicit range, which is a nudge to quote the interesting part.

### Pinning links to a commit

```ts excerpt=build/walkthroughs/compile.ts#currentCommit
```

Vercel and GitHub Actions both expose the commit being built, so every link in a deployed walkthrough points at **the code that is actually running**, not at whatever `main` looks like today. Line numbers can't go stale because the commit can't change. The page header shows the short SHA and links to it.

### Validation is the feature

```ts excerpt=build/walkthroughs/compile.ts#resolveRepoRef
```

Every `repo:` link and excerpt is checked: the file exists (and stays inside the repository, so `../` tricks don't work), the symbol is found, a line range is inside the file. [check-content.ts](repo:scripts/check-content.ts) compiles every walkthrough, so `npm run check` locally and the `web` job in CI both fail on the first broken reference, naming the walkthrough, the file and the symbol.

### Shipping it

The compiled walkthroughs are served as two virtual modules, the same pattern as the question bank ([vite-plugin-content.ts](repo:build/vite-plugin-content.ts), and the esbuild adapter in [build-single-file.ts](repo:scripts/build-single-file.ts)):

```ts excerpt=build/walkthroughs/compile.ts#walkthroughsIndexCode
```

- `virtual:walkthroughs`: titles, summaries and file lists, in the main bundle (a few KB).
- `virtual:walkthroughs/content`: the HTML, one lazy chunk, fetched when you open the first walkthrough or hover one in the list.

The page is [HowItsBuilt.tsx](repo:src/features/howItsBuilt/HowItsBuilt.tsx#HowItsBuiltPage): an index, and a reader with the list of files involved, the body, and previous/next links. It reuses the answer styles and the copy-code handler, so code blocks look and behave like the ones in the questions. Routes are `#how-its-built` and `#how-its-built/<id>`, and the whole section sits under **Behind the scenes** in the sidebar, behind the `howItsBuilt` feature flag.

> [!NOTE]
> Why render on the build machine rather than fetching files from GitHub at runtime? No rate limits, no network dependency, it works in the offline single-file build, and, most importantly, a broken reference is a **build error you see before shipping**, not a blank box a reader sees after.

### Adding a walkthrough

1. Create `walkthroughs/NN-topic.md` with the front matter above.
2. Link with `repo:` and quote with `excerpt=`; never paste code.
3. Run `npm run check`. Fix whatever it names.
4. Keep the shape the others use: what it does, a diagram, the code in the order a request flows, the decisions and their trade-offs, how it's tested, and interview angles.
