# 02 — Target State

> **Status: ACHIEVED 2026-10-05** (Waves 0–10 executed — see `10-progress-log.md`). Wave-0-era target
> snapshot, superseded where contradicted by the merge (`966d70f`); see
> `docs/project-state/source-of-truth.md`. One execution note: the git source is the public HTTPS
> URL `https://github.com/ahmadmedo1012/SubNation2.git#main` (no deploy key needed — repo is public).

## Production topology (final)

```
Internet → subnation.ly (Cloudflare DNS-only)
         → Traefik (Coolify proxy, Let's Encrypt, www→apex 301 at this layer)
         → SubNation container (SPA + API + Socket.IO + schedulers, single instance, :3000)
             → Neon PostgreSQL (all business truth)
             → OpenWA container (:2785, internal) → WhatsApp → OTP delivery
             → FulfillmentProvider boundary → Embronic (when official API + creds arrive)
```

## Deployment authority (final)

- GitHub main → Coolify git source (deploy key, `git@github.com:ahmadmedo1012/SubNation2.git#main`)
  → dockerfile build (repo-root Dockerfile, `GIT_SHA` build arg) → container recreate →
  healthcheck `/api/healthz` → Traefik → live.
- Live SHA verified from OUTSIDE (healthz/bundle) and INSIDE (container env) and equals a named
  commit on main. No manual image pushes. No direct Coolify DB writes. Generated compose untouched.
- Rollback = redeploy previous Coolify deployment (migrations expand-first; DB never rolls back).

## Platform capabilities (final)

- Storefront: catalog, product, wallet, checkout, orders, support, loyalty, referrals — Arabic RTL,
  dark/light, PWA.
- Auth: Google (Firebase) + Telegram + WhatsApp OTP all functional; admin argon2+TOTP.
- Admin `/admin/*`: dashboard, orders, finance (topups w/ reviewed_by), users, products
  (merchandising only for provider-backed items), pricing, promotions, security, alerts, system,
  WhatsApp gateway manager, provider monitoring, reconciliation.
- Provider: `FulfillmentProvider` boundary with Embronic adapter slot — catalog discovery, mapping,
  pricing/cost, availability, provisioning, order submit, status reconcile, release/refund — all
  behind the interface with secrets server-side and zero provider leakage to public surfaces.
- Security: semgrep/trivy/osv/gitleaks passes green; authz/IDOR/CSRF/CORS/rate-limit reviewed.
- QA: Playwright green across desktop/mobile/iPhone/RTL/dark-light on money + auth + admin paths.
- Docs: `docs/project-*` truth maps + runbooks match reality; the repo files `render.yaml` /
  `vercel.json` / `deploy.yml` were removed 2026-10-05 (`62ee976`) — preserved in git history only.
