# Deployment

Three ways to run Frontend Loop, from zero setup to full stack.

| Mode | What you get | Needs |
| --- | --- | --- |
| Static (local-only) | Study app, progress in the browser | Any static host |
| Vercel + Neon (recommended) | Accounts, invites, admin console, synced progress, live content editing | Free Vercel, Neon and GitHub OAuth app |
| Docker / binary | Same as Vercel, on your own machine or cloud | Docker or Go, and Postgres |

The frontend detects the backend by itself (docs/SPEC.md §6.1): deploy the static site first, add the database later, nothing breaks in between.

---

## 1. Vercel + Neon (production)

The repository is already set up for Vercel: `vercel.json` builds the Vite frontend and deploys `api/index.go` as a Go serverless function, with `/api/*` routed to it.

### 1.1 Import the project (once)

1. vercel.com → **Add New… → Project** → import `anand1296/frontend-loop`.
2. Keep the detected settings (framework Vite; build and output come from `vercel.json`). **Deploy.**
3. Note the production URL, e.g. `https://frontend-loop.vercel.app`. At this point the app works in local-only mode (the API answers `503 not_configured`).

### 1.2 Add a free Postgres database (Neon)

1. In the Vercel project: **Storage → Create Database → Neon (Serverless Postgres)** → free plan, region close to your Vercel functions (e.g. Washington D.C. `iad1`, or Mumbai if you moved functions there).
2. Connect it to the project for **Production** and **Preview**. Vercel adds `DATABASE_URL` (and `POSTGRES_URL` etc.) automatically.

The first request after deploy creates the schema and seeds the 109 questions from `content/*.md`.

### 1.3 Create a GitHub OAuth app

1. github.com → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. **Application name:** Frontend Loop. **Homepage URL:** your Vercel URL.
3. **Authorization callback URL:** `https://<your-app>.vercel.app/api/auth/github/callback`
4. Register, then **Generate a new client secret**. Keep the page open.

Never paste the secret into chats, issues or commits; put it only into Vercel.

### 1.4 Environment variables

Vercel project → **Settings → Environment Variables** (Production; add Preview too if you want):

| Name | Value |
| --- | --- |
| `OWNER_GITHUB_LOGIN` | `anand1296` |
| `GITHUB_CLIENT_ID` | from the OAuth app |
| `GITHUB_CLIENT_SECRET` | from the OAuth app (mark as Sensitive) |
| `APP_URL` | `https://<your-app>.vercel.app` |
| `DATABASE_URL` | set by the Neon integration |

Then **Deployments → ⋯ → Redeploy** so the function picks them up.

### 1.5 Verify

- `https://<your-app>.vercel.app/api/health` → `{"ok":true,"database":true,"github":true,…}`
- Open the app → **Sign in** → Continue with GitHub → the sidebar shows **Admin · Super admin**.
- Admin → Invites → create a link → open it in a private window → sign in with another GitHub account.

### 1.6 Notes

- **Preview deployments** have different URLs; a GitHub OAuth app allows one callback URL, so sign-in works on production only (create a second OAuth app for previews if you need it).
- **Custom domain:** add it in Vercel, then update `APP_URL` and the OAuth app's URLs.
- **Region:** put the Neon database and Vercel functions in the same region (Project → Settings → Functions → Region) for the lowest latency.
- **Cold starts:** Neon's free tier sleeps after inactivity; the first request may take a second or two. The function retries its startup if the database is still waking up.
- **Migrations** run automatically on the first request after a deploy. They are additive; there's nothing to run by hand.

---

## 2. Local development

Requirements: Node 22.18+, Go 1.24+, Docker (or any Postgres 14+).

```bash
cp .env.example .env              # DEV_LOGIN=1, OWNER_GITHUB_LOGIN=anand1296
docker compose up -d db           # Postgres on :5432
npm install
npm run dev:api                   # Go API on :8080 (reads .env)
npm run dev                       # Vite on :5173, proxies /api → :8080
```

Open http://localhost:5173 → **Sign in** → *Developer sign-in* → type `anand1296` (owner) or any other name (needs an invite unless registration is open).

To test real GitHub sign-in locally, create a second OAuth app with callback `http://localhost:5173/api/auth/github/callback` and put its id/secret in `.env`.

### All in one container

```bash
docker compose up --build         # http://localhost:8080 (frontend + API + Postgres)
```

### Tests

```bash
npm run check                                     # content + types + TS unit tests
docker compose exec db createdb -U postgres frontend_loop_test   # once
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/frontend_loop_test?sslmode=disable npm run test:go
npm run build && npm run test:e2e                 # static-mode E2E
# full stack E2E: fresh DB, server serving the build with DEV_LOGIN=1, then
E2E_SERVER_URL=http://localhost:8080 npm run test:e2e:server
```

The Go integration tests drop and recreate the `public` schema of the database you point them at: always use a separate test database like `frontend_loop_test`, never your development or production one.

---

## 3. Docker / binary anywhere

```bash
docker build -t frontend-loop .
docker run -p 8080:8080 \
  -e DATABASE_URL=postgres://… -e OWNER_GITHUB_LOGIN=anand1296 \
  -e GITHUB_CLIENT_ID=… -e GITHUB_CLIENT_SECRET=… -e APP_URL=https://your.domain \
  frontend-loop
```

The image is distroless, runs as non-root and contains one static binary plus the built frontend. Put it behind HTTPS (a load balancer or reverse proxy) and set `TRUST_PROXY=1` so forwarded headers are honored. The same image is the starting point for AWS ECS/Fargate (docs/SPEC.md §18).

---

## 4. Static only

`npm run build` → host `dist/` anywhere (Netlify, GitHub Pages via `.github/workflows/deploy-pages.yml`, S3). `npm run build:single` → one self-contained HTML file (`dist-single/frontend-loop.html`), and `artifact.html` for claude.ai Artifacts. No backend, no accounts; progress stays in the browser.
