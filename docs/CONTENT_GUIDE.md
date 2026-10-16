# Content Guide

All questions live in `content/*.md`, one file per round. Files are compiled at build time; `npm run content:check` validates everything and prints a summary table.

## File format

```markdown
---
id: browser-platform
title: Browser & Web Platform
description: One line shown on the overview.
---

## The question exactly as an interviewer would ask it
<!--
id: http-caching-spa
level: senior
tags: http caching, cdn
minutes: 15
-->

> [!TLDR]
> The answer you'd give in the first 60 seconds. Required.

### Mental model
...
```

| Field | Rules |
| --- | --- |
| Round `id` | kebab-case, unique across rounds **and** questions (both are URL tokens) |
| Question `id` | kebab-case, permanent: progress is keyed by it |
| `level` | `senior`, `lead` or `principal` |
| `tags` | comma-separated, lower-case; the first three show in the list |
| `minutes` | realistic study time, integer 1–120 |

Lines in these blocks are plain `key: value`; a line starting with `#` is a comment, but trailing comments on a value line are not supported.

- File names sort the rounds (`01-…`, `02-…`). Questions appear in file order, which should go from foundational to advanced.
- `##` starts a new question. Use `###`/`####` inside answers. `##` inside fenced code is ignored.
- **Ids are permanent.** Renaming a question's title is fine; changing its `id` resets everyone's progress for it.

## Callouts

| Syntax | Label shown | Use for |
| --- | --- | --- |
| `> [!TLDR]` | The 60-second answer | Required, first block of every answer |
| `> [!NOTE]` | Note | Clarifications, context |
| `> [!TIP]` | Tip | What strong candidates say |
| `> [!WARNING]` | Common mistake | Pitfalls, misconceptions |
| `> [!IMPORTANT]` | Important | Must-know constraints |
| `> [!PRINCIPAL]` | Principal-level depth | Org-scale and long-term angles |

## Code blocks

Supported fence languages: `ts`, `tsx`, `js`, `jsx`, `html`, `css`, `bash`/`sh`, `json`, `yaml`, `graphql`, `diff`, `http`, `text`. Anything else fails the build (add it in `build/content/markdown.ts`).

Code standards (same as the answers preach):
- TypeScript first, strict-mode correct, no unnecessary `as` assertions. If an assertion is genuinely needed, say why in a note.
- Small, complete examples over fragments; name things as you would in production.
- Include cleanup (abort, unsubscribe) wherever effects or listeners appear.

## Answer structure

Use the parts that fit; not every question needs all of them.

1. **TL;DR**: the spoken 60-second answer.
2. **Clarify / what they're testing**: requirements and assumptions to state up front.
3. **Mental model**: how it works, ideally with a small diagram in a `text` block.
4. **Implementation**: code, with complexity where relevant.
5. **Why this design** and alternatives considered.
6. **Edge cases, failure modes, accessibility, security, performance, testing.**
7. **Production vs interview**: what you'd change for real.
8. **Follow-ups**: realistic interviewer questions with short strong answers.
9. **Common mistakes** (`[!WARNING]`).
10. **References**: primary sources (specs, MDN, react.dev, web.dev, W3C APG, OWASP, RFCs).

## Safety rules enforced by the compiler

- Raw HTML in Markdown is escaped (shown as text).
- Links must be `http(s)://`, `/path` or `#anchor`; others render as plain text.
- Images render as their alt text.

## Adding a round

1. Create `content/16-your-round.md` with front matter.
2. Add questions.
3. `npm run content:check`, then `npm run dev` and review in the browser.
4. The new round appears in navigation, the overview ring, search and review automatically.
