# Domain Runtime Architecture

How `https://subnation.ly` is resolved, served, and secured at runtime.
Subnation is canonically apex-only; `www.subnation.ly` 301-redirects to it.

## 1. DNS / TLS path

```
                ┌──────────────────────────────────────┐
   user ───►    │  DNS: subnation.ly A / AAAA / CNAME  │
                │  (managed in your registrar)         │
                └────────────────┬─────────────────────┘
                                 │
                                 ▼
                ┌──────────────────────────────────────┐
                │  Render edge (auto-provisioned       │
                │  Let's Encrypt certificate)          │
                │  - subnation.ly                      │
                │  - www.subnation.ly                  │
                └────────────────┬─────────────────────┘
                                 │ HTTP (Host preserved)
                                 ▼
              ┌──────────────────────────────────────────┐
              │  srv-d7vv91tckfvc73evnccg (web)          │
              │  app.set("trust proxy", 1)               │
              │                                          │
              │  Canonical-host redirect middleware:     │
              │   ─ host = subnation.ly      → continue  │
              │   ─ host = www.subnation.ly  → 301       │
              │   ─ /api/healthz/* SKIPPED (probe-safe)  │
              │                                          │
              │  CSP / CORS allow-list reads from        │
              │  process.env.APP_ORIGINS                 │
              └──────────────────────────────────────────┘
```

## 2. Sources of truth

| Layer | Source | Value |
|---|---|---|
| DNS | your registrar | A/AAAA/CNAME → Render edge |
| Render custom domains | Render dashboard | `subnation.ly`, `www.subnation.ly` |
| Backend canonical | `process.env.APP_URL` (set in Render env) | `https://subnation.ly` |
| CORS allow-list | `process.env.APP_ORIGINS` (comma-separated) | `https://subnation.ly,https://www.subnation.ly` |
| Frontend SPA absolute origin | `import.meta.env.VITE_APP_ORIGIN` (build-time-baked) | `https://subnation.ly` |
| Frontend API client base URL | `import.meta.env.VITE_API_URL` | empty → SPA uses relative `/api` paths (same-origin) |
| Backend Sentry release | `RENDER_GIT_COMMIT[:7]` | per-deploy commit SHA |
| Frontend Sentry trace propagation | hard-coded regex in `frontend/src/instrument.ts` | matches `*.subnation.ly` |

## 3. Request lifecycle on `subnation.ly`

1. **Edge**: TLS terminates at Render's edge with Let's Encrypt cert.
2. **trust proxy**: `app.set("trust proxy", 1)` so `req.ip` and `req.protocol` reflect the original client, not the proxy.
3. **Canonical-host redirect**: if `req.hostname === "www.subnation.ly"`, 301 to apex. Skipped for `/api/healthz/*`.
4. **Compression** (gzip).
5. **CORS** — `Origin` checked against `APP_ORIGINS` allow-list. Same-origin requests (no `Origin` header) pass.
6. **Helmet CSP / COOP** — `connect-src` and `frame-src` include the same allow-list as CORS.
7. **Correlation middleware** — UUID v4 from `x-request-id` or freshly minted.
8. **Pino HTTP** — log line carries the correlation id.
9. **Metrics middleware** — observes `http_request_duration_seconds`.
10. **CSRF Origin/Referer check** for state-changing requests (`POST/PUT/PATCH/DELETE`), validated against `APP_ORIGINS`. Skips `/api/auth`, `/api/cwv`, `/health`, `/api/webhook`.
11. **Rate limiters** — Redis-backed (`apiLimiter`, `authLimiter`, `otpPhoneLimiter`, `otpIpLimiter`).
12. **Route handlers** — `/api/*`, `/robots.txt`, `/sitemap.xml`, then SPA static fallback.
13. **Sentry `setupExpressErrorHandler(app)`** — captures 5xx with full request context.
14. **Custom error handler** — Arabic-text user-facing response.

## 4. Cookies

- All cookies set by the backend are **host-only** (no explicit `Domain`
  attribute). `subnation.ly` and `www.subnation.ly` therefore do NOT
  share cookies — but `www` redirects to apex before any cookie is read,
  so this is fine.
- Cookie attributes: `httpOnly: true`, `secure: true` (production),
  `sameSite: "lax"` for auth cookies.

## 5. Firebase auth

- Firebase Auth lives on `subnation-2571e.firebaseapp.com` (Firebase's
  hosted iframe). The popup window opens at
  `accounts.google.com/o/oauth2/...` and `postMessage`s back to the opener.
- For the popup to be allowed to message back to `subnation.ly`, the
  domain has been added to **Firebase Console → Authentication → Settings →
  Authorized domains**. Both `subnation.ly` and `www.subnation.ly` are
  authorized.
- COOP is `same-origin-allow-popups` so the popup can call
  `window.opener.postMessage` and `window.close()` without being blocked.
- CSP `frame-src` includes `https://*.firebaseapp.com` so the hidden auth
  iframe loads.

### Firebase Phone Auth (`signInWithPhoneNumber` + `RecaptchaVerifier`)

- The reCAPTCHA widget loads from `https://www.google.com/recaptcha/api.js`
  (with `https://www.recaptcha.net` as the regional fallback). Both are in
  the CSP `script-src` allow-list.
- The reCAPTCHA challenge iframe renders under `https://www.google.com/recaptcha/api2/`
  — both `www.google.com` and `www.recaptcha.net` are in `frame-src`.
- The OTP flow is implemented in `frontend/src/components/FirebasePhoneSignIn.tsx`:
  the `RecaptchaVerifier` is owned by a single `useRef` per component mount,
  rebuilt on `auth/captcha-check-failed` / `auth/code-expired` / expired-callback
  events, and `clear()`'d on unmount to avoid stale widgets stacking on the DOM.
- Invisible reCAPTCHA is the default (`size: "invisible"`); the challenge UI
  appears only when Google's risk model demands it.

## 6. Socket.IO

- Socket.IO server CORS reads from `APP_ORIGINS` (same env as Express
  CORS). Both apex and www are accepted.
- The Socket.IO Redis adapter is independent of the public origin — it
  connects to Redis Cloud regardless of which public host the user is on.
- WebSocket upgrade hits the same Render edge → same service. No
  configuration needed beyond CORS.

## 7. Sentry tracing

Frontend Sentry attaches `sentry-trace` + `baggage` headers on outgoing
requests whose URL matches `tracePropagationTargets`:

- `localhost`, `127.0.0.1`
- `*.subnation.ly`
- `VITE_APP_ORIGIN` (build-time)

Backend Sentry resumes the trace on the matching incoming request — single
distributed trace across the stack.

## 8. SEO

- Canonical URL — `MetaTags.tsx` emits `<link rel="canonical">` pointing to
  `subnation.ly` regardless of which host the request arrived on. This is
  what crawlers index.
- `<html lang>` / `<html dir>` — locked at App boot via `lib/direction.ts`
  to `lang="ar"` / `dir="rtl"`. Not managed by route-level Helmet.
- `og:url` and `twitter:url` — always `subnation.ly`.
- JSON-LD schema URLs — always `subnation.ly`.
- Dynamic `/sitemap.xml` lists every public route with `<xhtml:link rel="alternate" hreflang="ar|en|x-default">` siblings. Cached 60 s; invalidated on product create/update/delete via `bumpSitemapCache()`.

## 9. Observability impact

Production metrics labelled by `route, method, status` are unaffected by
the host (each request hits the apex). The 301 emitted for the
`www.subnation.ly` host appears as `http_requests_total{status="301"}`
in low single-digit volume — expected.

## 10. Rollback plan

If a future deploy regresses the domain handling, rollback is a single
env-var revert via Render MCP:

```
update_environment_variables serviceId=srv-d7vv91tckfvc73evnccg envVars=[
  {key:"APP_URL",         value:"https://subnation.ly"},
  {key:"APP_ORIGINS",     value:"https://subnation.ly,https://www.subnation.ly"},
  {key:"VITE_API_URL",    value:""},
  {key:"VITE_APP_ORIGIN", value:"https://subnation.ly"}
]
```

Then redeploy the previous known-good commit. Mean rollback time: 3–5
minutes.
