# R142 Implementation Wave — consolidated report

Lanes: FE (cut off mid-run; completed centrally), BE (cut off; completed by
BE2 + centrally), BUILD (landed), COV-close (landed), central orchestrator
completion. All fixes verified: lint 0 errors/49 warnings (baseline) ·
typecheck green · backend 260 files / 2,458 tests · frontend 247 files /
2,325 tests · production builds + PWA green · boot smoke OK on the built
shell (entry + CSS + registerSW outside comments; exactly 4 src'd scripts).

## Implemented (with regression pins where non-trivial)

| Finding | Fix | Files | Test |
|---|---|---|---|
| G-1 P2 | loyalty convert → generated client (20 s) | pages/loyalty.tsx | loyalty-error-state (real Response mocks), loyalty-convert-journey |
| J-1/D-5 P2 | destructive confirms → variant="destructive" + min-h-11 | hooks/use-confirm.tsx, admin/topups/RejectModal.tsx | existing pins survive |
| N-1 P2 | CI header-param survival gate + ledger | scripts/check-openapi-header-params.ts, ci.yml, scripts/package.json | gate runs in CI drift job |
| N-4/D-1 P3 | settings integrations rows: real 4-field contract + shape gate + adminFetch | pages/admin/settings.tsx, settings-page-meta.ts, TelegramStatusRows.tsx | settings-telegram-rows.test.tsx (NEW) |
| D-3 P3 | adminFetch/adminFetchJson 20 s timeout (SSE opt-out timeoutMs:0) | lib/admin-session.ts, CopilotPanel.tsx | partial-mock-proof SHARED_ADMIN_TIMEOUT_MS guard |
| C-1 P3 | PDP coupon + support → generated client + guarded parse | pages/product.tsx, support pages | product-coupon-variant-void (mock re-anchored) |
| G-2 P3 | wallet per-intent key: STABLE request object read at FETCH time; sync at every rotation + pre-mutate | pages/wallet.tsx | money-races-r140 pin re-anchored to the new contract |
| G-3 P3 | checkout late-remove: removeIfStillSameIntent guard (live-cart quantity identity) | pages/checkout.tsx | checkout-pricing-reconcile G-3 regression (NEW) |
| F1/I-4/J-3 P3 | truthful availability: hero aria, streaming copy (FE+BE parity), product-seo gate | GuestHero.tsx, categories.ts, spa-shell.ts, product-seo.ts | product-seo-availability.test.tsx (NEW), category parity suite |
| I-1 P3 | multi-word Arabic search: consecutive-token window | lib/arabic-search.ts, catalog.service.ts | arabic-search + products-arabic-search suites |
| I-2 P3 | duration modifiers: variant-label EXISTS branch | catalog.service.ts + seed | products-arabic-search |
| I-3 P3 | search edge-cache headers removed | routes/products.ts | header pin |
| E-1 P3 | copilot single-use: conditional claim (isNull) + harness tables | executor.ts, preview-store.ts, test/db.ts | executor-single-use.test.ts (NEW, mutation-verified) |
| K-1 P3 | title clamp word-boundary mirror | spa-shell.ts | spa-shell-rewrite suite |
| K-2 P3 | og:url/og:type rewrite arms | spa-shell.ts | spa-shell-rewrite suite |
| K-3 P3 | noindex wall pins ×7 families | spa-shell-rewrite.test.ts | it.each extension |
| B-1 P3 | GSC primary anchor comment-aware | lib/seo.ts | shell-head-anchors extension |
| B-2/M-1 P3 | budget gates scan comment-stripped HTML | vite.config.ts | bundle-budget-gate.test.ts (NEW) |
| M-2 P3 | push-time boot smoke in CI (proven: fails on sabotaged shell) | ci.yml | sabotage demonstration recorded |
| L-1 P3 | telegram dispatch retry tests | NEW telegram-dispatch-retry.test.ts | 7 tests, 3× mutation-verified |
| L-2 P3 | hung-run floor (10 min) + visible skip log | lib/opportunistic.ts | opportunistic suite |
| L-3 P3 | captureSchedulerFailure on 2 recurring triggers | copilot-reaper.ts, whatsapp-otp.service.ts | daily-cap mock completed |
| H-1 P3 | 4 cross-user money-read regression tests | NEW money-reads-horizontal-authz.test.ts | mutation-verified (dropped eq(userId) → RED) |
| F-2 P3 | harness prod-parity ×6 + copilot tables | test/db.ts | full suite green after 3 test-file de-duplications |
| E-2 P4 | bodyPreview → bodyLength (no raw credential slice) | body-parser-recovery.ts | NEW body-parser-recovery.test.ts |
| E-3 P4 | verify-2fa: DB errors → honest 500 | routes/admin/auth.ts | NEW admin-verify-2fa-internal-errors.test.ts |
| E-5 P4 | /api/auth/sessions LIMIT | routes/auth.ts | sessions suite |
| F-3 P4 | dead idx_users_referral_code creator deleted | migrate.ts | migrate suites |
| G-6 P4 | formatLyd grouping | routes/loyalty.ts | loyalty suites |
| I-5 P4 | available-only empty state honest copy | ProductsGrid.tsx | grid suites |
| O-1/O-2/O-4 P3 | docs: migration numbers, rollback runbook, Telegram/Sentry live | architecture + deployment + project-graph docs | doc edits |
| A-3/A-5/A-6/A-7/A-1(partial)/A-4/B-4/K-5 P4 | CHANGELOG SHAs, env.example ×6, rg guard, dead Render var, validate URL+phantom, README counts, favicon prose, og prose | docs + scripts | doc/script edits |
| J-2 P3 | ring-offset-background ×2 | ui/button.tsx, ProductCard.tsx | storefront-chrome (mock completed) |
| B-3 P3 | Sentry import .catch | ErrorBoundary.tsx | error-boundaries pin re-anchored |
| D-2 P3 | credentials fetch retry affordance | admin/orders.tsx + DesktopOrderRow | orders-credentials-retry.test.tsx (NEW) |
| H-4/C-2/J-4 P4/P3 | dead ?token= branch, threshold dedup, button a11y test | auth-callback.ts, ProductCard.tsx, NEW button-a11y.test.tsx | button-a11y (NEW) |

## Deferred (recorded decisions in findings-ledger.md)

N-2/N-3/N-5 (spec churn → regen risk), A-2/M-3 (thresholds need a measured
baseline), F-1 (chain-apply test — harness DDL parity landed instead),
H-2 (BuildKit secret — deploy contract change, operator-visible),
H-3 (upstream-blocked CVEs), plus the P4 debt list (43 items documented in
lane findings files).
