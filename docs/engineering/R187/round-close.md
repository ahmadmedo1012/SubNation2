# R187 — Round Close: The Continuation Detail-Perfection Round (12-squad audit + 9-squad fix wave)

**Date:** 2026-10-25 · **Round:** R187 · **Starting SHA:** `6e0da9c7` (the R186 ship record — CI runs 40135992058 + 40136874859 both green on it; the owner pushed nothing after R186) · **Baseline:** clean working tree on `main`, CHANGELOG newest entry R186 · **Production:** `https://subnation.ly` live and healthy at round start.

**Scope (owner's directive — continue what's left; keep improving/organizing/developing/upgrading, with squads per aspect, hunting the finest details on every page):** run as **21 agent invocations + the central desk** — 12 read-only audit squads → central triage (every P2 claim independently re-verified with byte checks before dispatch) → 9 fix squads on disjoint file scopes.

---

## 1. The round design

- **Wave 1 — the audit (12 parallel Explore squads, read-only):** A (storefront buyer journey: 6 pages + render trees), B (storefront account/auxiliary), C (the auth flow end-to-end across its full stack — 7 journeys walked branch-by-branch), D (admin core: 7 pages), E (admin long-tail: 14 pages), F (backend HTTP surface: 42 route files + middlewares vs spec vs error-code registry), G (backend services/jobs/lib/migrations), H (frontend infrastructure), **I (the NEW cross-layer contract lens: spec ↔ implementation ↔ generated client ↔ consumers, endpoint family by family)**, **J (the NEW test-quality lens: tautology/always-green/mutation-sensitivity/mock hygiene)**, K (docs truth incl. **the NEW commit-message-vs-diff sweep**), L (cross-page UX/a11y/SEO/copy consistency).
- **Result: 91 verified findings — 16×P2, 75×P3, 0×P0/P1.** All 16 P2 claims independently byte-verified by the central desk before dispatch (all held).
- **Wave 2 — the fix (9 squads on disjoint scopes + central-desk finishes):** 1 (backend services), 2 (backend routes/auth/notify/crypto-tests), 3 (OpenAPI spec truth + orval regen — the round's sole owner of the spec), 4 (frontend auth/session/socket), 5 (buyer journey + SEO), 6 (account pages), 7 (admin core), 8 (admin long-tail), 9 (docs truth + comment truth). Three squads hit agent deadlines after completing their edits — the central desk verified their trees byte-wise, finished the five remaining items, and re-ran every touched suite.
- **A workspace-reset round:** the sandbox was rolled back before start (the repo re-cloned, pnpm re-provisioned, PAT re-stored); and a NEW environment constraint was discovered and recorded — **the sandbox now kills ALL background processes between tool calls** (proven empirically), so every suite ran in foreground CHUNKS (backend by directory ×5, frontend by directory ×6) and squads ran targeted suites only.

## 2. The sixteen P2s (each verified pre-dispatch, fixed, pinned)

| # | Finding | The defect | The fix |
|---|---|---|---|
| A-F1 | PDP recommendations flash-sale price | The rec rail's DTO carried the raw product price (no `computeFlashSalePrice`) while the list loader, PDP, and stats caption all discount — every cross-sell card showed a HIGHER price during any active sale | `loadProductRecommendations` fetches the active sale + emits the list loader's exact idiom (`catalog.service.ts`; extended `product-recommendations.test.ts`) |
| B-F1 | order-updated invalidation gap | A refund emits `order-updated` after crediting wallet/ledger/points — but the handler invalidated ONLY the orders family (the topup twin carries the exact contract) | The topup twin's invalidations mirrored (wallet + me + ledger; `useSocket.ts`; socket test) |
| C-F1 | The last unbounded auth fetches | firebase-auth's session-mint + refresh had NO AbortSignal — every sibling gained 20s budgets; a black-holed connection spins Google login to the ~300s TCP timeout and burns rate-limit slots | `AbortSignal.timeout(20_000)` on both (`firebase-auth.ts`; fake-timers pin) |
| D-F1 | step="0.5" money inputs | The products price + users wallet amount inputs (the ONLY two 0.5 sites) blocked server-legal 2-decimal values with an English native bubble; a variant-priced product (79.8) pre-failed validation | Both → `step="0.01"` (+ the money-input-step pin) |
| D-F2 | The destructive confirm lies | Promotions' «حذف نهائي… لا يمكن التراجع» against a backend that soft-deactivates (the row stays, reactivatable) | The honest «إيقاف وأرشفة العرض؟ … يبقى في السجل ويمكن إعادة تفعيله» copy |
| D-F3 | No error state on the dashboard KPI fold | The stats query destructured only {data, isLoading} — a failed query rendered an unexplained void above the fold | The scope-banner warning-token idiom + retry (isError + refetch destructured) |
| E-F1 | The referrals credit confirm reads «سيتم قيد 0 نقطة» | Backend sends `points_earned: 0` for pending rows (the credit button renders only there) — the money-adjacent confirm misstated the amount by 100% at the decision point | `POINTS_PER_REFERRAL` from the documented mirror (`referral-policy`); the fixture re-seeded to the real shape |
| E-F2 | The alerts TYPE_META covers 6 of 11 backend types | inventory_corrupt + refunded_live_credentials (SEVERE) rendered as the generic «نظام» info chip with no filter chip | TYPE_META + union + FILTERS extended to the full backend set (+ risk); chips derive from the map |
| H-F1 | The runtime viewport rewrite strips the keyboard fix | MetaTags re-upserts the viewport meta WITHOUT `interactive-widget=resizes-content` on every route — and mounts unconditionally while Navbar's guard is storefront-gated → every /admin/* boot loses the R96 Android keyboard fix | ONE line: the upsert string now byte-identical to the static shell (+ the metatags-viewport pin) |
| H-F2 | The only unbounded auth request on the admin path | The admin session-guard fetch used only TanStack's unmount signal — a black-holed connection left the whole admin console on a forever-skeleton | `AbortSignal.any([signal, AbortSignal.timeout(10_000)])` with the degrade-safe fallback |
| I-F4 | POST /orders missing the 503 arm | The implemented INVENTORY_CORRUPT → 503 (nothing-charged, retryable — the user-critical arm) was never in the spec | The "503" response block added (+ the spec-truth pin) |
| J-F1 | crypto.test.ts claimed protection it did not deliver | The "legacy SHA-256" test never constructed a legacy hash — the resetRequired:true arm (the R98 crackable-fallback removal) had ZERO behavioral coverage on the admin-login gate | The legacy-hash + weak-params legs + retitle (J-F4's parameter pin rides along) |
| K-F1 | README:84 "the balance is derived, never a mutable number" | FALSE — `users.wallet_balance` is a stored column (CHECK ≥ 0) updated in-tx with its ledger row (M1's CAS) | The study guide's truth wording (the G2-F2 fix missed the English twin) |
| K-F2 | ONBOARDING:49 lists the retired payment_reference guard | M3/R154 retired it — a second live trace of the retired requirement | The duplicate-risk operator-review-signal wording |
| K-F3/F4 | The R186 commit overclaims | 2d51a254's message claimed "source-of-truth entry #28" and f2cffa97's claimed "header extended" — NEITHER touched the file (drafted, never committed) | Entry #28 appended with the full R186 durable facts + the honest errata naming both overclaims (the no-history-rewrite rule) |

## 3. The 75 P3s (grouped)

- **Storefront buyer (A-F2..F6, L-F3/F5):** the suggestion rows' undiscounted price during a sale; the rec rail's GA4-invisible `select_item`; `begin_checkout` firing pre-coupon-adoption (wrong value) and on aborted attempts; the cart page's duplicated `toFixed` total vs the context's `totalLYD`; the spec's price_from "active" vs the code's "buyable"; the PDP coupon input's missing `dir="ltr"`; the cart/checkout «المجموع»/«الإجمالي» label drift.
- **Storefront account (B-F2..F7, L-F2):** the masked-phone RTL flip (dir="ltr"); the topup-history count chip presenting page-1's count as the total over a 200-row cap (+ the referrals twin); the link-more block not gated on providersError; the below-minimum remainder's missing one/two plural forms; orders+notifications blanking rendered lists on background-refetch failure (the referrals stale-keep idiom); the wallet error banners' `role="alert"` + `aria-live="polite"` assertive downgrade; the phantom orval comment.
- **Auth flow (C-F2..F10):** the query-fallback forwarding our `redirect` param into the Telegram HMAC (guaranteed bad_signature); the module-local `readRedirectTargetFromUrl` fork (the canonical `sanitizeInternalPath` adopted); the docblock documenting the deleted token-in-URL transport; the error legs dropping the return path (frontend + backend threading); the stale error banner persisting across attempts; `autoComplete="tel"`; the dead `adminToken` prop on the 2FA setup; the auth `role="alert"`+polite combos; the configured-Apple no-op button.
- **Admin core (D-F4..F11, L-F1 core sites):** the ⌘S synthetic submit bypassing native validation (a nameless product was creatable — `requestSubmit` now); the single-id busy models on coupons/promotions (Set idiom + the overlap harness); the promotions silent stale refetch; the coupon form's server-bound parity (maxLength 40/200 + the field-specific Arabic guards for min-order/max-uses); the stats toggle's missing `aria-expanded`; the topups bulk scope mismatch (the loop now sends the CONFIRMED pending∩selected scope — the stale-selection pin survived a vacuous first draft, reworked to await loop completion); the selection checkbox's sub-family hit-area; 13 core-file count-form sites converted to `formatCount`.
- **Admin long-tail (E-F3..F6, L-F1 long-tail sites, L-F4):** the pricing preview surviving its own save (setDryRun(null) in onSuccess); the tickets docblock's phantom 25 s poll; the [SET] secret placeholder unreachable dead code; the delete-read confirm understating the destructive scope (the table-wide readTotal); 9 long-tail count-form sites + the «تعذّر جلب»→«تعذّر تحميل» verb drift ×4.
- **Backend routes (F-F1..F9):** the intParam digit-exact class's last 4 sites (risk ×3 + forecast — two were WRITES acting on the wrong resource); the inventory email's missing varchar(255) bound; the referral_code cap on the firebase mint; the support + admin ticket REPLY two-autocommit (one-tx now — the R186 E-F6 class's remaining sibling); the logout auth-activity log unguarded post-revocation; the logger.error-before-classification on both firebase routes; the failure-leg return-path threading (backend).
- **Backend services (G-F1..G-F6):** `alerts_dispatched_total` counting would-dispatch/skipped AS rate-limited (the production shape's every dispatch permanently mislabeled); the only unwrapped Redis command (`risk_agg_del`); the risk-config subscriber's unbounded subscribe + racy flag + leaked duplicate (bounded + shared-promise + drain-wired); the forecast hollow-success (the enrichment sibling's all-failed guard mirrored); the topup post-commit reads unguarded (the false-failure class); the ALERT_RULES threshold strings lying about their own triggers ("> 20%" was a count; "per IP or global" was global-only).
- **Spec truth (F-F2..F4, I-F1..F8, A-F6, E-F2's spec part):** /wallet/topups' idempotency contract (header + 200 replay + the three 409s) + /loyalty/convert-points' 409 body; /notifications' paged envelope; /admin/users PATCH's pre-R115 description; whatsapp_status' enum (the real 8-value lifecycle domain); start-OTP's 503 reasons + 500/502; verify-OTP's 429; /loyalty's dead 404; the support ticket's retired fallback description + the 4000 cap; both 423s' hard-block flavor; AdminAlert.type's 5 missing members; price_from's "buyable" truth. All + orval regen (query keys byte-stable, DO-NOT-EDIT headers intact).
- **Docs truth (K-F5..F15, H-F3/F4):** README's e2e counts (15 files/3 projects); CONTRIBUTING's suite counts; the R186 size-gate units errata (auth 1024/1026; alerting 1083-at-ceiling); R185's −98→−92 errata (4 records, 3 editable); the shortcut-ledger honest 6 (not 4); the +96 attribution (+95 round pins + the owner's PR #12 test); the study-guide 8→9 errata; WHATSAPP_OPERATIONS' phantom QR auto-refresh; ONBOARDING's pointer to the deleted switch-rtl suite; the three remaining App.tsx pointers; PERFORMANCE.md unfrozen (Rolldown mechanisms + the live eager floor); the boot-head-start/app-shell comment pointers; the utils statusLabel parity comment truth; the users.ts docblock's pre-R115 story.

## 4. The consciously-skipped items (named, per the ponytail discipline)

- **F-F5 (OpenWA 200-with-error-body):** the standing R186 evidence-first deferral — unchanged.
- **C-F5's auth-callback.tsx:51 leg:** the `auth_error` param is frontend-only defensive code (NO backend route produces `/auth/callback?auth_error=…` — rg-verified); the two REAL flows (telegram-callback frontend + the backend loginErrorRedirect) are fixed.
- **I's unused-client-surface residue:** `adminDiagnosticsInventoryHealth` (documented ops/curl surface) + `telegramWebhook` (inherently non-browser) — intentional.
- **E's risk-rules admin-UI absence:** documented deferral (route docblock) — a feature request, not a defect.
- **B's referral-link two-source derivation** (both valid links), **support list's 200-cap** (far tail), **C's useKeyboardVisibility rAF-after-unmount** (no-op in React 18+), **H's scheduleIdle rIC-timeout consolidation** (future-round candidate), **A's ShelfRail select_item absence** (decorative brand rail, no prices) — examined and not filed.
- **K's R186 E-F5-vs-I-F7 finding-ID typo:** unresolvable from the tree (the audit reports lived in the rolled-back workspace) — errata note only.

## 5. Gates (all green, on the round's final tree)

| Gate | Result |
|---|---|
| `pnpm run lint` | **0 errors / 0 warnings** (the two squad-leftover unused-vars fixed in-round) |
| `pnpm run typecheck` (libs + backend + frontend + scripts) | **clean ×4** |
| Backend suite | **306 test files / 2,739 tests** (was 298/2,696 — +8 files/+43 tests; the count method = vitest over all backend test paths, matching R186's `backend/**/*.test.ts` census) |
| Frontend suite | **317 / 2,889** (was 307/2,802 — +10 files/+87 tests) |
| Scripts suite | **8 / 74** (was 7/62 — +1 file/+12 tests: the openapi-spec-truth suite) |
| **Combined** | **5,702** (was 5,560 — **+142 tests, every one a named finding's pin or an extended-suite leg**) |
| OpenAPI ↔ Express parity | **79 enforced implemented ops in sync** (the scripts suite green incl. the new spec-truth pins) |
| ErrorCode sync | **26 codes**, both directions |
| Header-param survival | **9/9** (7 + the two new Idempotency-Key spec params, ledgered in the gate's KNOWN_DROPPED per its own contract) |
| Drizzle drift | **clean** (`generate` → no diff) |
| Orval drift | **consistent** (the regen committed together with the spec) |
| Production build | **green — eager 149,029 B gz** (+108 B vs R186; the 150/160 KiB gates hold), 164 emitted JS chunks |
| R181 residue regression | **clean** — 164 chunks swept, 1 hit = the documented `COPILOT_API_KEY` env-name keep in the enrichment chunk |
| Size gates | alerting.service.ts **1083 (gate count) = its 1083 register max** (the round's fixes rode to 1091 then compacted back via comment-only hygiene); routes/admin/auth.ts 1023 ≤ 1026 |

## 6. Two harness lessons recorded for every future round

1. **The sequential-loop count-race:** the D-F10 pin's first draft passed VACUOUSLY under mutation — `toHaveBeenCalledTimes(1)` polled between the loop's first and second calls. Rule: count-assertions on sequential async loops must await loop COMPLETION (the summary toast / the busy-flag clear), never the first call.
2. **The pinned-wording contract:** the E-F4 comment fix initially failed its own pre-written pin because the correction reworded the sentence the pin byte-matched, then AGAIN because the explaining comment quoted the banned literal. Rule: when a squad dies mid-flight, read its pins FIRST and land the fix in the pinned shape; never quote the banned bytes inside the correction's own rationale.

## 7. Errata for the record (the no-history-rewrite rule)

- **R186's ledger (carried by this round's docs squad):** the size-gate units (auth 1024 not 1026; alerting 1083 at ceiling); R185's −98 → −92; the shortcut count 4 → 6; the +96 attribution (+95 + the owner's PR #12 test); the study-guide 8 → 9. All bracketed in-place where the record is editable; the two commit messages stay immutable.
- **The R186 source-of-truth entry #28 overclaim:** repaired by THIS round's K-F3 — the entry now exists, with the errata naming both overclaiming commits.

## 8. Ship record — CLOSED GREEN

**Push:** fast-forward, no force-push, remote HEAD re-verified after the push (the conventional commits + the SHA recorded at push time in the round's worklog).

**CI:** the run + result recorded at push time. **Coolify rotation:** verified live within ~10 min of CI (the entry hash rotated).

**Read-only production probes (all green on the rotated tree):** healthz 200; the purchasable floor; the admin-family 401 gates; the live entry's residue sweep (zero copilot/calculator bytes beyond the documented keep); a fresh browser session with zero page/console errors.

## 9. Definition-of-done scorecard

- [x] 12-squad audit of every page family, every route family, every service, every integration surface, every doc, the contract chain, and the tests themselves — 91 findings, all triaged
- [x] 16/16 P2s fixed + pinned (every one independently re-verified pre-dispatch)
- [x] 75/75 P3s fixed or consciously-skipped-with-reason (the skips named in §4)
- [x] +142 tests; combined suite 5,560 → **5,702**; every squad's pins mutation-verified (the five desk-finished items included)
- [x] All gates green on the final tree (lint 0/0 · typecheck ×4 · three suites · parity/error-codes/headers 9/9 · drizzle + orval drift · build 149,029 B · residue clean · size registers)
- [x] The owner's study guide re-stamped (R187 chip · 5,702 tests · 149,029 B)
