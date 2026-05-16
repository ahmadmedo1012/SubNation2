# Domain Migration Report — `subnation2.onrender.com` → `subnation.ly`

**Date:** 2026-05-16
**Strategy:** Two-stage migration. Stage 1 (this commit): `subnation.ly`
becomes the canonical domain everywhere; the legacy `subnation2.onrender.com`
host stays in the CORS allow-list and receives a 301 redirect to the new
canonical so existing links / indexed search results never break. Stage 2
(future, ~30 days): remove `subnation2.onrender.com` from the CORS allow-
list once analytics confirm zero traffic on the legacy domain.

## 1. What changed in this commit

### Code
| File | Change |
|---|---|
| `backend/src/app.ts` | New canonical-host redirect middleware: 301s `subnation2.onrender.com` and `www.subnation.ly` → `https://subnation.ly`. Skips `/api/healthz/*` so Render's health probes never redirect. Production-only. |
| `backend/src/routes/seo.ts` | `APP_ORIGIN` fallback → `https://subnation.ly` |
| `backend/src/services/alerting.service.ts` | runbook URL fallback → `https://subnation.ly` |
| `frontend/src/components/seo/MetaTags.tsx` | `getAppOrigin()` fallback → `https://subnation.ly` |
| `frontend/src/lib/seo-builders.ts` | `DEFAULT_ORIGIN` → `https://subnation.ly` |
| `frontend/src/instrument.ts` | Sentry `tracePropagationTargets` now matches both `*.subnation.ly` and the legacy `*.subnation2.onrender.com` for stitched traces during transition |
| `frontend/public/robots.txt` | Sitemap line → `https://subnation.ly/sitemap.xml` |
| `frontend/public/sitemap.xml` | static fallback URLs → `subnation.ly` (the dynamic `/sitemap.xml` from backend remains primary) |
| `scripts/validate.ts` | validation suite default origin → `https://subnation.ly` |

### Config
| File | Change |
|---|---|
| `render.yaml` | `APP_URL=https://subnation.ly`, `APP_ORIGINS=https://subnation.ly,https://www.subnation.ly,https://subnation2.onrender.com` (legacy kept during transition), `VITE_API_URL=https://subnation.ly`, **new** `VITE_APP_ORIGIN=https://subnation.ly` |
| `config/env.example` | documents the new vars |
| Operator-facing docs (`OBSERVABILITY_SETUP.md`, `OPERATIONS_RUNBOOK.md`, `REDIS_SETUP.md`, `SEO_AND_CWV_REPORT.md`, `SENTRY_BACKEND_SETUP.md`, `METRICS_AND_MONITORING.md`, `FINAL_RUNTIME_STATE.md`, `docs/API.md`, `README.md`) | curl examples + base URLs updated |

### Render environment (set via Render MCP `update_environment_variables` after the push)

| Var | New value | Was |
|---|---|---|
| `APP_URL` | `https://subnation.ly` | `https://subnation2.onrender.com` |
| `APP_ORIGINS` | `https://subnation.ly,https://www.subnation.ly,https://subnation2.onrender.com` | `https://subnation2.onrender.com` |
| `VITE_API_URL` | `https://subnation.ly` | `https://subnation2.onrender.com` |
| `VITE_APP_ORIGIN` | `https://subnation.ly` | (unset) |

The legacy `subnation2.onrender.com` is intentionally kept in `APP_ORIGINS`
for two reasons:
1. Old browser tabs / cached SPA bundles still send requests with that
   `Origin` header — CORS would block them otherwise.
2. Search engines and external sites still link to the old origin until the
   301 redirect propagates and the index is rebuilt.

## 2. What you must do (owner-action items I cannot perform)

### A. Firebase Console — authorized domains (BLOCKING for Google Sign-In on subnation.ly)

Firebase Auth's popup flow only completes if the calling origin is in the
project's authorized-domains list. The Firebase Admin SDK can read this
list but cannot mutate it (only the Console / `gcloud` can).

1. Open https://console.firebase.google.com/project/subnation-2571e/authentication/settings
2. Scroll to **Authorized domains**.
3. Add **both**:
   - `subnation.ly`
   - `www.subnation.ly`
4. Keep `subnation2.onrender.com` in the list during transition.

If skipped: every Google Sign-In popup on `subnation.ly` will return
`auth/unauthorized-domain`.

### B. Google Cloud Console — OAuth client redirect URIs (only if you have a separate Google OAuth client outside Firebase)

If `VITE_GOOGLE_CLIENT_ID` is set (it currently isn't — empty string in
`render.yaml`), you'd also need to add `https://subnation.ly/auth/callback`
(and the `www.` variant) under **APIs & Services → Credentials → OAuth 2.0
Client IDs → Authorized redirect URIs**.

Today this is a no-op because Firebase handles all OAuth and you don't have
a stand-alone Google OAuth client. Skip unless you decide to enable
non-Firebase Google Sign-In later.

### C. Render dashboard — confirm both custom domains are added

You said the custom domain has been verified. Make sure **both**
`subnation.ly` and `www.subnation.ly` are added on the Render service →
Settings → Custom Domains:

- `subnation.ly` — primary
- `www.subnation.ly` — apex redirect target

Render auto-provisions Let's Encrypt certificates for both. The
canonical-host middleware in `backend/src/app.ts` 301-redirects www to apex.

## 3. Stage 2 cleanup (~30 days from now)

Once analytics confirm zero traffic on `subnation2.onrender.com`:

```yaml
# render.yaml
- key: APP_ORIGINS
  value: "https://subnation.ly,https://www.subnation.ly"  # drop onrender
```

Optional once stage 2 is in place: also remove the redirect branch in
`backend/src/app.ts` that handles `subnation2.onrender.com`. Keep the
`www.subnation.ly` redirect indefinitely.

## 4. Cookies & sessions

Currently the app sets cookies host-only (no explicit `Domain` attribute on
JWT cookies). After the 301 redirect, browsers seamlessly establish new
host-only cookies on `subnation.ly` — no migration step needed. Existing
sessions on `subnation2.onrender.com` lose their cookie when redirected
(host-only cookies don't traverse), so users have to re-login. Acceptable
trade-off; alternative is to set `Domain=.subnation.ly` and accept slightly
broader cookie scope, which we don't need.

## 5. Validation plan (post-deploy)

```bash
# 1. Canonical resolves
curl -sI https://subnation.ly/api/healthz | head -5
# expect: HTTP/2 200

# 2. Legacy host 301s
curl -sI https://subnation2.onrender.com/login | head -5
# expect: HTTP/2 301, Location: https://subnation.ly/login

# 3. www → apex
curl -sI https://www.subnation.ly/ | head -5
# expect: HTTP/2 301, Location: https://subnation.ly/

# 4. Health probe never redirects (would break Render's health check)
curl -sI https://subnation2.onrender.com/api/healthz
# expect: HTTP/2 200, {"status":"ok"}

# 5. /sitemap.xml uses canonical
curl -s https://subnation.ly/sitemap.xml | grep '<loc>' | head -3
# expect: <loc>https://subnation.ly/...</loc>

# 6. CSP allows subnation.ly + legacy
curl -sI https://subnation.ly/ | grep -i content-security-policy
# expect: connect-src includes both subnation.ly and subnation2.onrender.com

# 7. Firebase popup auth works on subnation.ly
# (manual — requires Firebase authorized-domain change above)
```

## 6. Remaining risks

| Risk | Mitigation |
|---|---|
| Firebase Console authorized-domains not updated | popup auth fails; fix is one click |
| User has a deep-linked SPA bundle from `subnation2.onrender.com` already loaded | works because legacy origin is still in `APP_ORIGINS`; new requests they make redirect transparently |
| Sentry events tagged with old release URL | minor — `release` tag is the commit SHA, not the host |
| Search-engine de-indexing of legacy host before subnation.ly is indexed | mitigated by 301 + canonical link tags pointing to subnation.ly |
| Cached HSTS preload on browser tied to subnation2.onrender.com | irrelevant — HSTS is per-host and doesn't carry across hosts |
