# Contributing to Whetstone

Thanks for helping! There are two ways to contribute, and both are reviewed by the owner ([@anand1296](https://github.com/anand1296)) before anything goes live.

## 1. Share a question from your interviews

The question bank is most useful when it reflects what people are really asked.

- **Members of the hosted app:** open **Behind the scenes → Contribute** in the sidebar and use the form. You get a live preview, your submission waits in the owner's review queue, and you get an email when it's been reviewed. If it's accepted it's added to the bank, credited to your GitHub handle if you ticked that box.
- **Everyone else:** open a [question proposal](https://github.com/anand1296/frontend-loop/issues/new?template=question.yml) issue.

What makes a good question:

- It was (or plausibly would be) asked in a **senior, lead or principal** frontend loop.
- The answer starts with a **60-second version** (the `> [!TLDR]` callout), then goes deeper: how it works, trade-offs, a small code example, the follow-ups an interviewer would ask.
- **Nothing confidential**: no company secrets, NDA material or names.

The format is described in [docs/CONTENT_GUIDE.md](docs/CONTENT_GUIDE.md).

## 2. Improve the code with a pull request

### Before you start

- For anything bigger than a small fix, **open an issue first** so we can agree on the approach.
- Read **How it's built** inside the app (or the Markdown in [`walkthroughs/`](walkthroughs/)) and [docs/SPEC.md](docs/SPEC.md). They explain the architecture and why things are the way they are.

### Set up

```bash
git clone https://github.com/<you>/frontend-loop.git
cd frontend-loop
npm install
npm run dev                  # frontend only, local-only mode: http://localhost:5173
```

Full stack (Go 1.24+, Docker for Postgres):

```bash
cp .env.example .env
docker compose up -d db
npm run dev:api              # Go API on :8080
npm run dev                  # proxies /api
```

### Before you open the pull request

```bash
npm run check                # content + walkthrough links, types, unit tests
go test ./...                # backend; set TEST_DATABASE_URL to a throwaway database for integration tests
npm run test:e2e             # optional locally, CI runs it
```

- Keep pull requests **small and focused**: one change, one PR.
- Follow the existing style: strict TypeScript, no new runtime dependencies without discussing it first, standard library first in Go, `gofmt`.
- If you change behaviour, update the docs: [docs/SPEC.md](docs/SPEC.md), and the relevant walkthrough in [`walkthroughs/`](walkthroughs/). Walkthroughs quote real code by symbol name, so if you rename a function a walkthrough refers to, `npm run check` tells you exactly which link to fix.
- Fill in the pull request template.

### How review works

- `main` is protected. Every pull request needs **the owner's approval** (they're the code owner for every file) and **green CI** (`web`, `go`, `e2e-server`) before it can merge. Nobody else can merge.
- CI for a first-time contributor's pull request starts after the owner approves running it.
- The owner may ask for changes, push small fixes to your branch, or close a PR that doesn't fit the direction of the project, always with a reason.

## Reporting bugs and security issues

- Bugs and ideas: [open an issue](https://github.com/anand1296/frontend-loop/issues/new/choose).
- Security problems: please **don't** open a public issue; see [SECURITY.md](SECURITY.md).

## Code of conduct

Be kind and assume good intent. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
