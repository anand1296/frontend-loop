# Deployment

Three ways to run Whetstone, from zero setup to full stack.

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

1. vercel.com → **Add New… → Project** → import `anand1296/whetstone`.
2. Keep the detected settings (framework Vite; build and output come from `vercel.json`). **Deploy.**
3. Note the production URL, e.g. `https://whetstone.vercel.app`. Opening it now shows **"Almost there: connect the backend"**: a checklist of which settings are present (the API answers `503 not_configured`). Anyone can still click *Study offline for now*, but nothing syncs and there's no sign-in until the steps below are done.

### 1.2 Add a free Postgres database (Neon)

1. In the Vercel project: **Storage → Create Database → Neon (Serverless Postgres)** → free plan, region close to your Vercel functions (e.g. Washington D.C. `iad1`, or Mumbai if you moved functions there).
2. Connect it to the project for **Production** and **Preview**. Vercel adds `DATABASE_URL` (and `POSTGRES_URL` etc.) automatically.

The first request after deploy creates the schema and seeds the 112 questions from `content/*.md`.

What you'll see after each step: no database → setup checklist; database but no GitHub OAuth app → the sign-in screen says GitHub sign-in isn't switched on; everything set → the sign-in screen with **Continue with GitHub**. Sign in as `anand1296` and the sidebar shows **Admin · Super admin**; invite people from Admin → Invites.

### 1.3 Create a GitHub OAuth app

1. github.com → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. **Application name:** Whetstone. **Homepage URL:** your Vercel URL.
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

### 1.7 Email reminders (optional)

![A reminder email](screenshots/reminder-email.png)

People can opt in (Settings → Email reminders, off by default) to a daily, every-3-days or weekly email with their progress, what's due, the next question and a link back. The daily job is already scheduled in `vercel.json` (`/api/cron/reminders`, 03:30 UTC ≈ 09:00 IST). It needs an SMTP account and a cron secret.

**Easiest: your Gmail account (no domain needed, ~500 emails/day)**

1. Turn on **2-Step Verification** for the Google account (myaccount.google.com → Security). App passwords require it.
2. Open https://myaccount.google.com/apppasswords, name it `Whetstone`, click **Create** and copy the 16-character password (spaces don't matter).
3. In Vercel → Settings → Environment Variables (Production), add:

   | Key | Value |
   | --- | --- |
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USERNAME` | your Gmail address |
   | `SMTP_PASSWORD` | the app password (mark it Sensitive) |
   | `EMAIL_FROM` | `Whetstone <your Gmail address>` (must be the same address) |
   | `CRON_SECRET` | a long random string, e.g. from `openssl rand -hex 32` or a password manager (Sensitive) |

4. **Redeploy.** Vercel → Settings → **Cron Jobs** now lists `/api/cron/reminders`.
5. **Sign out and sign in again** once: GitHub asks you to share your email address (the app now requests the read-only `user:email` permission). Every user does this once.
6. Settings → **Email reminders** → switch on → **Send me a test email**. Check spam the first time and mark it "Not spam".

**With your own domain (better deliverability):** use Resend (`smtp.resend.com`, port 587, username `resend`, password = API key) or Brevo after verifying the domain there; `EMAIL_FROM` must use that domain.

To check the job by hand: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-app>/api/cron/reminders` → `{"claimed":…,"sent":…,"failed":…}` (it only sends what is due). Admins can switch the feature off for everyone in Features & settings.

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
docker compose exec db createdb -U postgres whetstone_test   # once
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/whetstone_test?sslmode=disable npm run test:go
npm run build && npm run test:e2e                 # static-mode E2E
# full stack E2E: fresh DB, server serving the build with DEV_LOGIN=1, then
E2E_SERVER_URL=http://localhost:8080 npm run test:e2e:server
```

The Go integration tests drop and recreate the `public` schema of the database you point them at: always use a separate test database like `whetstone_test`, never your development or production one.

---

## 3. Docker / binary anywhere

```bash
docker build -t whetstone .
docker run -p 8080:8080 \
  -e DATABASE_URL=postgres://… -e OWNER_GITHUB_LOGIN=anand1296 \
  -e GITHUB_CLIENT_ID=… -e GITHUB_CLIENT_SECRET=… -e APP_URL=https://your.domain \
  whetstone
```

The image is distroless, runs as non-root and contains one static binary plus the built frontend. Put it behind HTTPS (a load balancer or reverse proxy) and set `TRUST_PROXY=1` so forwarded headers are honored. The same image is the starting point for AWS ECS/Fargate (docs/SPEC.md §18).

---

## 4. Static only

`npm run build` → host `dist/` anywhere (Netlify, GitHub Pages via `.github/workflows/deploy-pages.yml`, S3). `npm run build:single` → one self-contained HTML file (`dist-single/whetstone.html`), and `artifact.html` for claude.ai Artifacts. No backend, no accounts; progress stays in the browser.
