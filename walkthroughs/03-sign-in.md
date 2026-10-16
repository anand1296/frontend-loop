---
id: sign-in-and-invites
title: Sign-in, sessions and invites
summary: GitHub OAuth without a library, opaque session tokens stored as hashes, CSRF defence in depth, and invite links that can't be used twice. How the app knows who you are and keeps everyone else out.
order: 3
minutes: 13
tags: security, oauth, go, postgres, cookies
---

> [!TLDR]
> "Sign in with GitHub" is a hand-written OAuth code flow (state cookie, code exchange, profile + verified email). On success the server creates a random 256-bit token, stores only its **SHA-256 hash** in Postgres, and sets the raw token as an `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookie. Every request resolves that cookie to a user; every state-changing request must also carry a custom header and come from the same origin. New people get in only through an invite link (or when the owner opens sign-ups); the owner is whoever `OWNER_GITHUB_LOGIN` names.

### The flow

```text
"Sign in with GitHub"
  └─▶ GET /api/auth/github/start?invite=…&next=#…
        • random state → short-lived fl_oauth cookie (also carries invite + return route)
        • 302 → github.com/login/oauth/authorize?scope=user:email&state=…
  GitHub ──▶ GET /api/auth/github/callback?code=…&state=…
        • state must equal the cookie's (constant-time compare)
        • exchange code → access token → /user + /user/emails
        • store.SignIn: find-or-create user, apply invite / owner rules (one transaction)
        • startSession: random token → hash in sessions table → __Host-fl_session cookie
        • 302 → /#<where you were>
Every later request: cookie → hash → sessions JOIN users → user on the request context
```

### Why not JWTs, and why not an auth library?

A session here is a **random opaque token**, looked up in Postgres on each request. Compared with a JWT that means one indexed query per request, in exchange for **instant revocation** (sign out, disable a user, delete an account: the row is gone, the cookie is dead) and nothing sensitive inside the cookie. For an app with dozens of users that's an easy trade ([ADR-014](repo:docs/DECISIONS.md#ADR-014)).

The OAuth client is ~150 lines in [auth.go](repo:backend/auth/auth.go) on `net/http`. Writing it by hand is a learning goal of the project, and the surface is small: one provider, one flow, no refresh tokens (we only use the GitHub token once, during sign-in, and never store it).

### Tokens: generate long, store the hash

```go excerpt=backend/auth/auth.go#NewToken
```

```go excerpt=backend/auth/auth.go#Hash
```

The same two functions protect sessions, invite links and OAuth state. If the database leaks, the attacker has hashes of 256-bit random values, which are useless: unlike passwords there's no dictionary to try, which is why a fast hash is fine here and bcrypt/argon2 would be wasted work.

### Starting the dance

```go excerpt=backend/server/session.go#githubStart
```

Things to notice:

- **The state value is bound to the browser** through the `fl_oauth` cookie, and checked in constant time in [`githubCallback`](repo:backend/server/session.go#githubCallback). That's what stops a login-CSRF where an attacker makes you sign in to *their* account.
- **No open redirect.** Where to go after sign-in comes from the client, so it's validated against [`safeNext`](repo:backend/server/session.go#safeNext): only an in-app `#route`, never a URL.
- **Rate limited** per IP, because sign-in is the one endpoint an anonymous visitor can hammer.

### The sign-in policy, in one transaction

[`SignIn`](repo:backend/store/users.go#SignIn) decides who you are and whether you may come in. It locks the user row (or the invite row) `FOR UPDATE`, so two tabs racing through sign-in, or two people racing for a single-use invite, can't both win:

- The login in `OWNER_GITHUB_LOGIN` always becomes, and stays, the **owner** (super admin). That's how the very first person gets in on a fresh database.
- Anyone else who's new needs a valid invite (not revoked, not expired, uses left), unless the owner switched registration to "open".
- GitHub logins can be renamed, so users are keyed by GitHub's numeric id, and an old login someone else used is freed.
- Joining is written to the audit log.

[`completeSignIn`](repo:backend/server/session.go#completeSignIn) maps the outcomes to friendly error codes that the sign-in screen turns into sentences ([`AUTH_ERRORS`](repo:src/platform/backend.ts#AUTH_ERRORS)).

### The cookie

```go excerpt=backend/server/session.go#sessionCookieName
```

```go excerpt=backend/server/session.go#setCookie
```

- `HttpOnly`: JavaScript (including any injected script) can't read it.
- `Secure` + the `__Host-` prefix: the browser only accepts it over HTTPS, for this exact host, on `/`. A compromised sibling subdomain can't plant a session cookie for us.
- `SameSite=Lax`: not sent on cross-site POSTs, the first CSRF layer.

### Resolving the user on every request

```go excerpt=backend/server/session.go#withSession
```

Handlers then declare what they need with two tiny wrappers, [`signedIn`](repo:backend/server/session.go#signedIn) and [`adminOnly`](repo:backend/server/session.go#adminOnly), so authorization is visible right where routes are registered in [`routes`](repo:backend/server/server.go#routes).

### CSRF: three independent layers

`SameSite=Lax` alone isn't enough (older browsers, same-site subdomains). [`withCSRF`](repo:backend/server/server.go#withCSRF) also requires a custom header on every non-GET request, `X-Requested-With: frontend-loop`, which a cross-site HTML form can't send and a cross-site `fetch` can't send without a CORS preflight we never approve, and it rejects requests whose `Sec-Fetch-Site`/`Origin` say they came from another site. The client adds the header in one place, [api.ts](repo:src/platform/api.ts#apiFetch). Background: [ADR-015](repo:docs/DECISIONS.md#ADR-015).

### Members-only by default

A fresh deployment is private: content access is "members" and registration is "invite" ([ADR-022](repo:docs/DECISIONS.md#ADR-022)). The server enforces it, not the UI:

```go excerpt=backend/server/public.go#canRead
```

When `canRead` says no, [`bootstrap`](repo:backend/server/public.go#bootstrap) answers `locked: true` with no content, and the app shows the full-page [`SignInScreen`](repo:src/features/account/Gate.tsx#SignInScreen). Hiding a button isn't access control; withholding the data is.

### Invites

Admins create invite links in the console ([`createInvite`](repo:backend/server/admin.go#createInvite)): a role (only the owner can mint admin invites), a number of uses, an expiry. The link carries a random token; the database stores its hash. Opening the link shows who invited you and as what, then the token rides through the OAuth `state` cookie and is consumed inside `SignIn`'s transaction.

### How it's tested

[server_test.go](repo:backend/server/server_test.go) runs the real handler against a real Postgres: the OAuth flow against a fake GitHub ([`TestGitHubOAuthFlow`](repo:backend/server/server_test.go#TestGitHubOAuthFlow)), CSRF rejections, private-by-default ([`TestPrivateByDefault`](repo:backend/server/server_test.go#TestPrivateByDefault)), a single-use invite raced by a dozen concurrent sign-ins ([`TestSingleUseInviteUnderConcurrency`](repo:backend/server/server_test.go#TestSingleUseInviteUnderConcurrency)), invites that expire, run out or get revoked, and disabled users losing their sessions. The browser flow (sign-in screen → invite → console) runs in Playwright: [server.spec.ts](repo:e2e/server.spec.ts).

### If you're asked about this in an interview

- **"Sessions or JWTs?"** Opaque sessions when you control the backend and need revocation; JWTs when many services must verify identity without a shared store, paired with short lifetimes and a revocation strategy.
- **"How do you store API tokens?"** Like sessions: show once, store a hash, compare in constant time.
- **"What does `SameSite=Lax` not protect against?"** Same-site attackers (other subdomains), top-level GET navigations, and older browsers, hence the custom header and Origin checks.
