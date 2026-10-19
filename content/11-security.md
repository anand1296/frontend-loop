---
id: security
title: Frontend Security
description: XSS in React apps, CSP and Trusted Types, token storage and the BFF pattern, CSRF with SameSite cookies, OAuth with PKCE, and supply-chain risk.
---

## XSS in React apps: where React protects you, where it doesn't, and how to sanitize
<!--
id: xss-react
level: senior
tags: xss, react, sanitization, dompurify, security
minutes: 15
-->

> [!PROMPT]
> A product manager wants rich-text comments with links and images. Security review asks how React protects you from XSS and where it doesn't. Walk through the design.
>
> **Cover**
> - What React escapes by default and the unsafe sinks: `dangerouslySetInnerHTML`, `javascript:` URLs, `href`/`src`, third-party widgets.
> - Sanitizing with DOMPurify (allowlists, hooks, when to sanitize: input or output), and Markdown pipelines.
> - Defense in depth: CSP, Trusted Types, and testing with payloads.

> [!TLDR]
> React escapes strings rendered as text and attribute values, which stops most injection. It does **not** protect `dangerouslySetInnerHTML`, `href`/`src` with `javascript:` URLs (React warns but older versions allowed them), direct DOM APIs (`innerHTML`, `insertAdjacentHTML`), third-party widgets, server-rendered state embedded in `<script>` tags, or `eval`-like sinks. Sanitize HTML with DOMPurify (or render Markdown to a safe subset), validate URL schemes, serialize SSR state safely, and add CSP as defense in depth.

### The sinks

```tsx
// Safe: text is escaped.
<p>{comment.body}</p>

// Dangerous: raw HTML from users.
<div dangerouslySetInnerHTML={{ __html: comment.html }} />

// Dangerous: user-controlled URL.
<a href={profile.website}>Website</a>   // "javascript:alert(document.cookie)"

// Dangerous: SSR state injection.
<script dangerouslySetInnerHTML={{ __html: `window.__STATE__ = ${JSON.stringify(state)}` }} />
// state containing "</script><script>alert(1)</script>" breaks out of the tag
```

### Fixes

```ts
import DOMPurify from 'dompurify';

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote'],
    ALLOWED_ATTR: ['href', 'title'],
  });
}

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function safeUrl(input: string, base = window.location.origin): string | undefined {
  try {
    const url = new URL(input, base);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// SSR state: escape characters that can end the script or start HTML parsing.
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/ /g, '\\u2028').replace(/ /g, '\\u2029');
}
```

Better still: put SSR state in `<script type="application/json" id="state">` and read it with `JSON.parse(el.textContent)`.

### Markdown and rich text

Render Markdown with raw HTML **disabled**, or sanitize the output. Rich-text editors should store a structured document (ProseMirror/Lexical JSON) and render it through known node types, not stored HTML.

> [!NOTE]
> This app renders answer Markdown at build time with raw HTML escaped and links restricted to http(s)/relative URLs. That's why it can inject the result without a runtime sanitizer: the content can never contain markup the compiler didn't produce.

### Other XSS sources teams miss

- `postMessage` handlers that write `event.data` into the DOM without checking `event.origin`.
- URL fragments/query params rendered via `innerHTML` in non-React code (DOM-based XSS).
- Third-party scripts (tag managers) with access to everything: a supply-chain XSS.
- SVG uploads rendered inline (SVG can contain scripts); serve them from a separate domain or as `<img>`.

### References

- [OWASP: XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [React: dangerouslySetInnerHTML](https://react.dev/reference/react-dom/components/common#dangerously-setting-the-inner-html)

## Content Security Policy with nonces and Trusted Types: rolling it out without breaking production
<!--
id: csp-trusted-types
level: lead
tags: csp, content security policy, trusted types, nonces, security headers
minutes: 15
-->

> [!PROMPT]
> Security wants a strict Content Security Policy. Your app has inline scripts, third-party tags and several teams shipping independently. Roll it out without breaking production.
>
> **Cover**
> - A nonce-based `strict-dynamic` policy versus allowlists, and what inline scripts and `eval` need.
> - Report-only first, collecting and triaging violation reports, and a rollout plan.
> - Trusted Types for DOM sinks, and how you keep the policy from eroding over time.

> [!TLDR]
> CSP tells the browser which scripts may execute. A **strict CSP** uses per-response **nonces** (or hashes) plus `'strict-dynamic'`, so only scripts you emitted (and scripts they load) run, and injected `<script>` tags or inline handlers don't. Trusted Types (`require-trusted-types-for 'script'`) makes DOM XSS sinks like `innerHTML` reject plain strings, forcing sanitization through a named policy. Roll out with `Content-Security-Policy-Report-Only`, collect violation reports, fix, then enforce.

### A strict policy

```http
Content-Security-Policy:
  script-src 'nonce-r4nd0mB64' 'strict-dynamic' https: 'unsafe-inline';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'self';
  require-trusted-types-for 'script';
  report-to csp-endpoint
```

(`https:` and `'unsafe-inline'` are ignored by browsers that support nonces/`strict-dynamic`; they're fallbacks for very old browsers.)

```html
<script nonce="r4nd0mB64" src="/assets/app.3f9a.js"></script>
```

The nonce must be **unpredictable and unique per response**, so pages with nonces can't be served from a static cache as-is (generate at the edge, or use hashes for static HTML).

### Trusted Types policy

```ts
const policy = window.trustedTypes?.createPolicy('app-html', {
  createHTML: (input) => DOMPurify.sanitize(input),
});

element.innerHTML = policy ? policy.createHTML(userHtml) : DOMPurify.sanitize(userHtml);
```

With enforcement on, `element.innerHTML = someString` throws, so every sink is forced through a reviewed policy, and the set of policies is small enough to audit.

### Rollout plan

1. Inventory scripts: your bundles, inline scripts, analytics, tag managers, A/B tools, chat widgets.
2. Ship **Report-Only** with a reporting endpoint; sample reports.
3. Remove inline handlers (`onclick=""`), move inline scripts to nonced or external files, configure frameworks to pass nonces (Next.js middleware, styled-components/emotion nonce support).
4. Negotiate with third parties (tag managers are the hardest; restrict what marketing can inject).
5. Enforce on one route or a percentage of traffic, watch reports and errors, expand.
6. Keep Report-Only for the next stricter step (Trusted Types) while enforcing the current one.

### Other headers worth mentioning

`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (disable camera/geolocation if unused), `Cross-Origin-Opener-Policy` (isolate from popups).

### References

- [web.dev: Mitigate XSS with a strict CSP](https://web.dev/articles/strict-csp)
- [web.dev: Trusted Types](https://web.dev/articles/trusted-types)
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)

## Where should a single-page app keep auth tokens? Cookies vs memory vs storage, and the BFF pattern
<!--
id: auth-token-storage-bff
level: lead
tags: authentication, tokens, cookies, bff, security, oauth
minutes: 15
-->

> [!PROMPT]
> You are reviewing a SPA that stores access and refresh tokens in `localStorage`. A security engineer says this is an XSS time bomb. Decide where tokens should live.
>
> **Cover**
> - Options (localStorage, memory, `HttpOnly` cookies) with the threats each handles.
> - The BFF pattern: how it works, what it costs and when it is worth it.
> - Refresh handling, logout, token expiry, and the CSRF implications of cookies.

> [!TLDR]
> Anything JavaScript can read, an XSS can steal. Tokens in `localStorage` are exfiltratable and long-lived; tokens in memory are better (lost on reload, so you need a silent refresh) but still usable by an XSS while the page is open. The most robust option for browser apps is the **Backend-for-Frontend (BFF)**: the server does the OAuth flow, keeps tokens server-side, and gives the browser an `HttpOnly; Secure; SameSite` session cookie. The SPA calls its BFF, which attaches tokens to upstream API calls. No token ever reaches JavaScript.

### Comparison

| Storage | XSS can read? | Survives reload | CSRF exposure | Notes |
| --- | --- | --- | --- | --- |
| `localStorage` | Yes | Yes | No | Easiest, weakest; long-lived theft |
| In-memory (JS variable) | Yes (while open) | No | No | Needs refresh flow (often a cookie anyway) |
| `HttpOnly` cookie (direct to API) | No | Yes | Yes (mitigate with SameSite + tokens) | API must be same-site or CORS with credentials |
| BFF session cookie | No | Yes | Mitigated by SameSite + CSRF token | Extra hop; server state/infrastructure |

### BFF flow

```text
Browser ──(HttpOnly session cookie)──▶ BFF (same site as the app)
                                        │ holds access/refresh tokens per session
                                        ▼
                                     APIs (Authorization: Bearer <access token>)
```

- The BFF handles login redirects (authorization code + PKCE), token refresh and logout.
- Cookie: `__Host-session=...; Path=/; Secure; HttpOnly; SameSite=Lax` (`__Host-` prefix forbids `Domain`, binding it to the exact host).
- Add CSRF protection for state-changing requests (SameSite helps; a CSRF token or custom header check closes the gap).

### Important nuance for interviews

`HttpOnly` doesn't make XSS harmless: an attacker running script in your page can still make authenticated requests **through** the user's browser. It prevents **exfiltration** (using the token elsewhere, later). XSS prevention (escaping, sanitization, CSP) is still the primary defense.

### If you must keep tokens in the SPA

- Short-lived access tokens in memory only; refresh via rotating refresh tokens with reuse detection.
- Never in `localStorage`; never in URLs (they leak through history, logs, referrers).
- Sender-constrained tokens (DPoP) reduce the value of stolen tokens.

### References

- [IETF: OAuth 2.0 for Browser-Based Applications](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)
- [OWASP: Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [MDN: Set-Cookie (prefixes, SameSite)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)

## CSRF today: SameSite cookies, tokens, and when you still need both
<!--
id: csrf-samesite
level: senior
tags: csrf, samesite, cookies, security
minutes: 10
-->

> [!PROMPT]
> Your API uses cookie sessions. A pen tester forges a cross-site `POST` that changes a user's email. You are told `SameSite=Lax` is the default, so is CSRF solved?
>
> **Cover**
> - How CSRF works and what `SameSite` Strict, Lax and None change (and the gaps: subdomains, GET side effects, older browsers).
> - Defenses that still matter: CSRF tokens, custom headers, origin checks and `Sec-Fetch-Site`.
> - How CSRF differs from XSS and CORS, and how you'd test for it.

> [!TLDR]
> CSRF works when a browser automatically attaches cookies to a request a malicious site triggers. `SameSite=Lax` (the default in modern browsers) blocks cookies on cross-site subresource requests and cross-site POSTs, which stops most CSRF. You still want explicit protection because: `Lax` allows top-level GET navigations (so never mutate on GET), "same-site" includes sibling subdomains (a compromised `blog.acme.com` is same-site with `app.acme.com`), and older browsers or `SameSite=None` cookies exist. Add a CSRF token (synchronizer or double-submit) or require a custom header and check `Origin`.

### Layers of defense

1. **Never change state on GET.**
2. **Cookies**: `SameSite=Lax` or `Strict` for session cookies; `__Host-` prefix.
3. **Origin/`Sec-Fetch-Site` checks** on the server for unsafe methods: reject `Sec-Fetch-Site: cross-site` unless the endpoint is meant to be cross-site.
4. **CSRF token** for cookie-authenticated, state-changing requests:

```ts
// Double-submit: server sets a non-HttpOnly csrf cookie; client echoes it in a header.
async function apiPost(path: string, body: unknown) {
  const token = document.cookie.match(/(?:^|; )csrf=([^;]+)/)?.[1] ?? '';
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(token) },
    body: JSON.stringify(body),
  });
}
// Server: compare header to cookie (ideally an HMAC-signed token bound to the session).
```

A JSON `Content-Type` or custom header also forces a CORS preflight for cross-origin requests, which an attacker's page can't pass, adding another layer.

### Where CSRF doesn't apply

APIs authenticated only by an `Authorization` header that JavaScript sets (not cookies) aren't vulnerable to classic CSRF, because the browser doesn't attach the header automatically. (They're exposed to XSS instead.)

### References

- [OWASP: CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [web.dev: SameSite cookies explained](https://web.dev/articles/samesite-cookies-explained)
- [web.dev: Protect your resources with Fetch Metadata](https://web.dev/articles/fetch-metadata)

## OAuth 2.1 with PKCE for browser apps, step by step
<!--
id: oauth-pkce-flow
level: lead
tags: oauth, pkce, oidc, authentication, security
minutes: 12
-->

> [!PROMPT]
> Implement login with a third-party identity provider in a pure SPA. Walk through OAuth authorization code flow with PKCE end to end, and say what the attacks are that each step prevents.
>
> **Cover**
> - The sequence: `code_verifier`, `code_challenge`, `state`, redirect, code exchange, tokens.
> - Why the implicit flow was dropped, and what `state` and PKCE protect against.
> - Where tokens end up, refresh strategy, logout, and common implementation mistakes.

> [!TLDR]
> Browser apps use the **authorization code flow with PKCE** (the implicit flow is deprecated). The app creates a random `code_verifier`, sends its SHA-256 hash (`code_challenge`) with the authorization redirect, receives a one-time `code` back on the redirect URI, and exchanges `code + code_verifier` for tokens. PKCE ensures a stolen code is useless without the verifier. Add `state` (CSRF for the login flow) and `nonce` (OIDC ID token replay). Ideally the exchange happens in a BFF so tokens never touch the browser.

### The steps

```ts
function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function startLogin() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));

  sessionStorage.setItem('pkce', JSON.stringify({ verifier, state, returnTo: location.pathname }));

  const url = new URL('https://auth.acme.com/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: 'web-app',
    redirect_uri: `${location.origin}/callback`,
    scope: 'openid profile email',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();
  location.assign(url);
}

export async function handleCallback() {
  const params = new URLSearchParams(location.search);
  const saved: unknown = JSON.parse(sessionStorage.getItem('pkce') ?? 'null');
  sessionStorage.removeItem('pkce');
  if (!isPkceState(saved) || params.get('state') !== saved.state) throw new Error('Invalid login state');

  const response = await fetch('https://auth.acme.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.get('code') ?? '',
      redirect_uri: `${location.origin}/callback`,
      client_id: 'web-app',
      code_verifier: saved.verifier,
    }),
  });
  if (!response.ok) throw new Error('Token exchange failed');
  history.replaceState(null, '', saved.returnTo); // remove ?code from the URL
  return response.json(); // keep tokens in memory, or better: do this exchange in a BFF
}

function isPkceState(value: unknown): value is { verifier: string; state: string; returnTo: string } {
  return (
    typeof value === 'object' && value !== null &&
    'verifier' in value && typeof value.verifier === 'string' &&
    'state' in value && typeof value.state === 'string' &&
    'returnTo' in value && typeof value.returnTo === 'string'
  );
}
```

### What to mention

- Use a certified library (oidc-client-ts, Auth0/Okta/Azure SDKs) in production; hand-rolled flows miss edge cases (clock skew, ID token validation, silent renew, logout).
- **Refresh tokens** in browsers must be rotating with reuse detection, or avoided in favor of a BFF session.
- **Silent renew via hidden iframes** broke with third-party cookie restrictions; refresh tokens or BFF replace it.
- **Logout**: clear local state, revoke tokens, and call the provider's end-session endpoint.

### References

- [RFC 7636: PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [OAuth 2.1 draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
- [oauth.net: PKCE](https://oauth.net/2/pkce/)

## Frontend supply-chain security: dependencies, lockfiles, SRI and third-party scripts
<!--
id: frontend-supply-chain
level: lead
tags: supply chain, dependencies, npm, sri, third-party scripts, security
minutes: 12
-->

> [!PROMPT]
> A popular npm package you depend on is compromised, and a post-install script runs in your CI. Describe how you reduce the likelihood and blast radius of supply-chain attacks.
>
> **Cover**
> - Dependency hygiene: lockfiles, pinning, `npm ci`, install scripts, provenance and auditing.
> - Third-party scripts: Subresource Integrity, CSP, sandboxed iframes, a tag-manager policy.
> - Detection and response: monitoring advisories, automated updates with review, and an incident playbook.

> [!TLDR]
> Your bundle contains hundreds of packages you didn't write, and every one of them runs with full access to your users' sessions. Reduce exposure (fewer, well-maintained dependencies), pin and review (lockfiles, `npm ci`, review lockfile diffs), detect (automated advisories, Socket/Snyk-style behavior analysis for install scripts and new network access), contain (disable install scripts where possible, CSP, Trusted Types), and govern third-party tags (allowlist, SRI for static CDN files, loading through your own domain). Have an incident playbook for "a dependency was compromised".

### Practices

- **Lockfiles committed**; CI uses `npm ci`/`pnpm install --frozen-lockfile`. Review lockfile diffs in PRs (new transitive packages are a signal).
- **Delay new versions** (e.g. only adopt versions older than a few days via Renovate `minimumReleaseAge`), so most malicious releases are pulled before you install them.
- **Disable lifecycle scripts** by default (`npm config set ignore-scripts true`, pnpm's `onlyBuiltDependencies` allowlist).
- **Provenance**: prefer packages published with npm provenance/attestations; publish your own packages with provenance from CI.
- **Least privilege CI**: tokens scoped and short-lived; publish from protected workflows only.
- **SRI** for third-party static assets:

```html
<script src="https://cdn.example.com/lib@4.2.1/lib.min.js"
        integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"
        crossorigin="anonymous"></script>
```

(SRI doesn't work for scripts that change content at the same URL, like most tag managers.)

### Third-party scripts

- Inventory and owners for every tag; remove unused ones.
- Load via a tag manager with restricted permissions and change review, or server-side tagging.
- Sandbox where possible (iframes, Partytown/workers), and constrain with CSP.
- Monitor for unexpected script sources and outbound requests in production (CSP reports, RUM).

### When an advisory hits

1. Determine reachability (is the vulnerable code path used? is it dev-only?).
2. Patch or override the transitive version (`overrides`/`resolutions`), redeploy.
3. For compromised packages: rotate secrets that CI or developer machines might have exposed, check build logs, and audit what shipped to users.

### References

- [OWASP: npm Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html)
- [MDN: Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
- [npm: Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements)
- [SLSA framework](https://slsa.dev/)
