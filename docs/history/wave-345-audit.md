> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/project-state/wave-345-audit.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# Wave 3 + 4 + 5 Audit Results (evidence-based, 2026-10-05)

Full file:line audit performed by a read-only agent over the real tree at main (post-Wave-1).
Key: findings below are VERIFIED facts, not claims.

## Wave 3 — Provider architecture: COHERENT, keep and mature

- `FulfillmentProvider` interface verified exactly as designed (types.ts:95-127): required
  `fulfill()` idempotent per `(provider, provider_order_id)`; optional `syncCatalog`,
  `queryStatus`, `release`.
- Checkout integration verified in the single transaction (checkout.service.ts:403-418,
  556-562). Failed purchase ⇒ no provider_fulfillments row (test-pinned). The
  `UNIQUE(provider, provider_order_id)` anchor is live.
- Registry fail-safe verified: unknown `FULFILLMENT_PROVIDER` → warn-once + `manual`
  (registry.ts:25-39). Operator typo cannot break checkout.
- Secrecy verified: 19 forbidden vocabulary keys + raw-value probes on public catalog routes;
  public variant SELECT excludes cost_price/sku (products.ts:107-115); OpenAPI public Product
  schema clean, admin-only fields gated behind requireAdmin + inventory scope.
- **Nothing to clean up.** No provider logic unrelated to the boundary exists. Embronic
  preparation = `docs/project-state/embronic-adapter-design.md`.

## Wave 4 — Admin simplification: NO dangerous manual-provider surface exists

- The fulfillment provider is env-driven only; NO admin UI for provider selection/credentials
  exists anywhere in `frontend/` (grep-verified). The mission's "remove manual provider ops"
  is already satisfied at the code level.
- Manual inventory upload (`admin/products.ts:435,509` + `InventoryUploadDialog.tsx`) is the
  DESIGNED supply model until Embronic sync exists — it stays, now labeled:
  inventory-for-provider-backed-products is explicitly a stopgap, not a second source of truth
  (see embronic-adapter-design.md mapping model).
- Manual variant `cost_price`/`sku` entry is admin-scoped (inventory permission) and provably
  absent from public surfaces (catalog-security tests). No action.
- Merchandising surfaces (visibility, ordering, SEO copy, pricing policy, flash sales, coupons)
  are legitimate and remain.
- Operator-runbook note added: when provider sync lands, the inventory upload dialog must be
  restricted to non-provider-backed products only (tracked in the design doc's test list).

## Wave 5 — Google/Firebase/tracking audit: verified states

| Integration | State | Evidence |
| --- | --- | --- |
| Google login (Firebase) | OFF in production — needs operator creds (service-account JSON + VITE_FIREBASE_* set) | Live probe 503 "Firebase غير مهيأة"; firebase-admin gated on FIREBASE_AUTH_ENABLED (firebase-admin.ts:107-108) |
| Google button hide/show | Frontend hides when unconfigured; backend-off + frontend-on = click-time Arabic error (documented mismatch, acceptable until creds land) | AuthProviders.tsx:93-97,143-153 |
| Telegram | LIVE (DB-config via system_settings) | /api/auth/providers returns bot; HMAC verify layer live |
| Firebase Phone/OTP | Permanently retired; backend hard-rejects phone tokens | auth.ts:520-530; zero RecaptchaVerifier refs in frontend |
| GA4 | OFF (VITE_GA_TRACKING_ID unset at build); CSP ready | analytics.ts:53-54; app.ts:185,221-223 |
| Search Console | OFF (VITE_GSC_VERIFICATION unset); injection mechanism verified | vite.config.ts:79-102 |
| reCAPTCHA | CSP entries dormant (no code refs); removal deferred until Firebase SDK internals verified — low value | app.ts:178-180,234-244 |
| Sentry | OFF both ends; CSP ready | env matrix |

Removable-dead code identified (safe, zero behavior change — deferred to a hygiene commit):
- `AuthProviders.tsx:89` client_id field (never consumed) + `VITE_GOOGLE_CLIENT_ID` declarations.
- Backend `GOOGLE_CLIENT_ID` env fallback (auth-settings.ts:221-224) — can only produce a
  button that errors on click when Firebase is off.
- Dormant `oauth_redirect` branch (AuthProviders.tsx:138-141) — keep-or-remove design call.
