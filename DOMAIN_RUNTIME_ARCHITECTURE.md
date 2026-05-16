# Domain Runtime Architecture

How `https://subnation.ly` is resolved, served, and secured at runtime.

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
                │  - subnation2.onrender.com (legacy)  │
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
              │   ─ host = subnation2.onrender.com → 301 │
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
| Render custom domains | Render dashboard | `subnation.ly`, `www.subnation.ly`, `subnation2.onrender.com` |
| Backend canonical | `process.env.APP_URL` (set in Render env) | `https://subnation.ly` |
| CORS allow-list | `process.env.APP_ORIGINS` (comma-separated) | `https://subnation.ly,https://www.subnation.ly,https://subnation2.onrender.com` |
| Frontend SPA absolute origin | `import.meta.env.VITE_APP_ORIGIN` (build-time-baked) | `https://subnation.ly` |
| Frontend API client base URL | `import.meta.env.VITE_API_URL` | `https://subnation.ly` (or empty for same-origin) |
| Backend Sentry release | `RENDER_GIT_COMMIT[:7]` | per-deploy commit SHA |
| Frontend Sentry trace propagation | hard-coded regex in `frontend/src/instrument.ts` | matches `*.subnation.ly` AND `*.subnation2.onrender.com` |

## 3. Request lifecycle on `subnation.ly`

1. **Edge**: TLS terminates at Render's edge with Let's Encrypt cert.
2. **trust proxy**: `app.set("trust proxy", 1)` so `req.ip` and `req.protocol` reflect the original client, not the proxy.
3. **Canonical-host redirect**: if `req.hostname` is the legacy host or `www.`, 301 to canonical. Skipped for `/api/healthz/*`.
4. **Compression** (gzip).
5. **CORS** — origin against `APP_ORIGINS` allow-list. Same-origin requests (no `Origin` header) pass.
6. **Helmet CSP / COOP** — connect-src and frame-src include the same allow-list as CORS.
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
  attribute). This means `subnation.ly` and `www.subnation.ly` do NOT share
  cookies — but that's fine because `www` redirects to apex before any
  cookie is read.
- Cookies set on the legacy `subnation2.onrender.com` do not transfer when
  the redirect fires (host-only). Users on the legacy domain re-authenticate
  on `subnation.ly`. Acceptable: the old domain is going away.
- Cookie attributes: `httpOnly: true`, `secure: true` (production),
  `sameSite: "lax"` for auth cookies.

## 5. Firebase auth

- Firebase Auth lives on `subnation-2571e.firebaseapp.com` (Firebase's
  hosted iframe). The popup window opens at
  `accounts.google.com/o/oauth2/...` and `postMessage`s back to the opener.
- For the popup to be allowed to message back to `subnation.ly`, the domain
  must be in **Firebase Console → Authentication → Settings → Authorized
  domains**. This is operator action — see
  `DOMAIN_MIGRATION_REPORT.md §2.A`.
- COOP is `same-origin-allow-popups` (preserved from prior config) so the
  popup can call `window.opener.postMessage` and `window.close()` without
  being blocked by COOP.
- CSP `frame-src` includes `https://*.firebaseapp.com` so the hidden auth
  iframe loads.

## 6. Socket.IO

- Socket.IO server CORS reads from `APP_ORIGINS` (same env var as Express
  CORS). Both apex and www are accepted; legacy onrender stays during
  transition.
- The Socket.IO Redis adapter is independent of the public origin — it
  connects to Redis Cloud (`spark-class-horn-...db.redis.io`) regardless
  of which public host the user is on.
- WebSocket upgrade hits the same Render edge → same service. No
  configuration needed beyond CORS.

## 7. Sentry tracing

Frontend Sentry attaches `sentry-trace` + `baggage` headers on outgoing
requests whose URL matches `tracePropagationTargets`:

- `localhost`, `127.0.0.1`
- `*.subnation.ly`
- `*.subnation2.onrender.com` (kept so legacy traffic during transition is still stitched)
- `VITE_APP_ORIGIN` (build-time)

Backend Sentry resumes the trace on the matching incoming request — single
distributed trace across the stack.

## 8. SEO

- Canonical URL — `MetaTags.tsx` emits `<link rel="canonical">` pointing to
  `subnation.ly` regardless of which host the request arrived on. This is
  what crawlers index.
- `<html lang>` / `<html dir>` — `MetaTags.tsx` sets `dir="rtl"` for Arabic
  routes, `ltr` for English. Independent of host.
- `og:url` and `twitter:url` — always `subnation.ly`.
- JSON-LD schema URLs — always `subnation.ly`.
- 301 redirects from legacy origin to canonical — preserves PageRank and
  search index transfer per Google's [Site Move guidance](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes).

## 9. Observability impact

After the migration, the following metrics will start including the new
host in their labels (if labelled by host) or remain unchanged (if not):

- `http_requests_total{route, method, status}` — unchanged labels; volume
  redistributes from legacy host (now mostly redirects = 301) to canonical.
- The 301 responses themselves will appear in metrics under
  `http_requests_total{status="301"}` — expected during transition; trends
  to zero as legacy traffic decays.

## 10. Rollback plan

If the migration causes incidents, rollback is a single env-var revert via
Render MCP:

```
update_environment_variables serviceId=srv-d7vv91tckfvc73evnccg envVars=[
  {key:"APP_URL",         value:"https://subnation2.onrender.com"},
  {key:"APP_ORIGINS",     value:"https://subnation2.onrender.com"},
  {key:"VITE_API_URL",    value:"https://subnation2.onrender.com"},
  {key:"VITE_APP_ORIGIN", value:"https://subnation2.onrender.com"}
]
```

Then redeploy the previous commit (`36042b8` for the pre-migration code, or
the commit just before the migration commit). The redirect middleware will
still 301 the new domain to old, but at least the platform serves traffic.
Mean rollback time: 3–5 minutes.
