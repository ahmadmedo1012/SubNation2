> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/r117-round-report.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R117 Round Report — R116 Verification + Repair Round

> Trigger: the operator pushed a large external overhaul (R116: ca67360 +
> merge 7cee846 + www-redirect fix f10bb9b) and asked to verify it and
> continue. Baseline HEAD `f10bb9b` (clean), synced from origin/main.

## Method

Four parallel audit agents (READ-ONLY) re-verified every R116 claim
against the real tree, then the main agent implemented the repairs:

- **A1 backend regressions** — money/security paths of the R116 diff
  (18 claims VERIFIED-OK; 1 P2 + 5 P3 findings).
- **A2 frontend regressions** — full-suite run + build as evidence base
  (17 claim clusters VERIFIED-OK; 1 P1 + 2 P2 + 5 P3 findings; 3 report
  claims proven FALSE: mobile DOM byte-identical, keyboard-hide wiring,
  44px sweep completeness).
- **A3 merge/deploy/docs** — three-parent merge forensics (mechanically
  lossless: docs side and overhaul side preserved byte-exact, zero file
  overlap), deploy-chain cross-checks, money-invariant cite verification.
- **A4 live production smoke** — 31 endpoints + security headers + DB
  read-only probes against subnation.ly.

Audit reports: `docs/inspection-r117/*.md` (4 files).

## Verification verdict on R116

The overhaul is **substantially as reported**: credentials-on-demand
(the 600-decrypt list kill), finance scoping, no-store parity, LIKE
escaping, memoized key, throttled safeDecrypt, V1-M23, statusColor
retirement, sonner lazy+replay, whole-dinar topups, wallet socket
updates — all real at HEAD with line-cited evidence. The merge itself is
provably lossless. Three claims failed re-verification and are repaired
below (boot warn dead code, keyboard-hide dead wiring, DOM-order claim).

## Repairs implemented (this round)

**Backend — reliability & security hardening**
1. **Dedicated advisory-lock pool** (`shared/db` `lockPool`, max 2,
   2 s connect timeout, instrumented + drained on shutdown): the OTP
   start gate held a RUNTIME-pool client across the whole ~30 s
   WhatsApp send — 8 concurrent starts (distinct phones, one IP inside
   the 20/15 min limiter) could wedge OTP login AND starve the app's
   entire DB layer against the production pool of 8 (A1-P2, the round's
   only P2). Lock-pool saturation now answers the retryable
   busy verdict, never a 500.
2. **Advisory-lock leak killed**: a failed `pg_advisory_unlock` used to
   return a still-locked live session to the pool → that phone 429'd
   "cooldown" until process restart. Unlock failure now destroys the
   client so Postgres drops the session lock server-side (A1-P3).
3. **Credentials-reveal volume gate** (A1-P4): per-admin sliding window
   (60 reveals / 10 min, in-memory — the designed single-instance
   shape); over-budget answers 429 + Retry-After 300 and raises a
   deduped admin alert naming the admin. A compromised orders-scoped
   session can no longer sweep the credential DB at 600/min with audit
   rows as the only trace.
4. **`decrypt_failed: true`** (A1-P6): when the raw columns are
   populated but every GCM auth fails (ENCRYPTION_KEY mismatch), the
   reveal now says so — desktop row AND mobile card render
   «تعذّر فك التشفير — راجع مطابقة ENCRYPTION_KEY» instead of a
   misleading empty panel.
5. **A7-2 boot warn restored** (A1-P3/A3-P5): f10bb9b deleted the
   split-era-origin warn together with the www-redirect removal — the
   folding still happens in `getConfiguredOrigins()`, so the boot
   signal is back (one-line revert + rationale).
6. **Copilot path gate false-positive** (A1-P5): the `//`/`..`
   traversal checks now run on the URL-normalized PATHNAME only — the
   A7-4 re-check fed `pathname + search` through them, 400-ing legal
   queries like `?next=https://x//y`.
7. **Neon cold-resume health flap** (A4-P2, root-caused live): Neon
   auto-suspend made the first query on an idle store pay a 0.5-2 s
   resume penalty — `/healthz/summary` flapped "degraded" on every cold
   aggregate of an otherwise healthy store (measured: 5/5 degraded
   during an idle window; all-ok once warmed; admin /ready showed every
   check green, isolating the latency threshold). `checkNeonWith` now
   runs an UNMEASURED warmup probe first and measures steady-state;
   genuine outages keep escalating exactly as before.
8. **`/healthz` Cache-Control** (A4-P8): `public, max-age=5` — family
   consistency with /live and /summary.

**Frontend — mobile money-page + a11y**
9. **Buy-panel mobile gutters** (A2 F-1, P1): the desktop split
   dissolved the shared `p-5` container and compensated only the START
   column — variant selector, price box, usage, error, trust, coupon
   and CTA rendered full-bleed against the card border on every phone.
   Six blocks now carry `max-lg:px-5` / `max-lg:mx-5` (mx outside
   tinted boxes, px inside plain wrappers).
10. **FAQ DOM order fixed** (A2 F-3, P2 — WCAG 1.3.2/2.4.3): the FAQ
    block moved into the buy-panel column after the trust grid, making
    the mobile DOM/Tab/reading order match the visual order (it sat in
    DOM right after the features list while rendering visually after
    trust — keyboard users Tabbed across a distant jump).
11. **iOS keyboard hide actually wired** (A2 F-2, P2): the
    `useKeyboardVisibility` hook value existed since R116 but was never
    consumed — the sticky buy bar stayed under the keyboard. Now wired
    (+ the short-viewport `[@media(max-height:480px)]:hidden` CSS
    fallback) and the hook re-anchors on orientationchange (F-7: a
    tablet rotation used to latch "keyboard visible" forever).
12. **Legacy URL rewrite no longer steals focus** (A2 F-4, P3): the
    `/product/123 → /product/slug` replaceState re-fired ScrollToTop
    (scroll + focus) mid-read; a one-shot suppression flag
    (`lib/navigation-quiet.ts`) arms only when the path actually
    changes.
13. **RouteAnnouncer stale-title fix** (A2 F-5, P3): cold navigations
    announced the PREVIOUS page's title at 150 ms and then the real one
    — both paths now skip the pre-navigation title and announce the
    final title exactly once. Tests updated to pin the fixed behavior.
14. **Toast-shim option forwarding** (A2 F-6, P3): sonner options a
    caller passes beyond description/duration/action/id are forwarded
    instead of silently dropped. Coupon buttons raised to the 44 px
    floor (F-8).

**SEO / canonical**
15. **Static `<link rel="canonical">`** baked into the no-JS HTML
    baseline (A4-P3-4): both apex and www serve byte-identical 200s
    with NO redirect at any layer (f10bb9b's "Cloudflare/Traefik 307"
    premise measured false live — Cloudflare is DNS-only); non-JS
    crawlers now get the same consolidation signal the runtime emits.
    Verified present in the built `dist/public/index.html`.

**Schema / contract**
16. **Drizzle 0015 mirror re-emit** (A3-P2): V1-M23 (`wallet_topups.
    reviewed_by`) shipped to schema + runtime but the mirror chain
    never got its `0015` — the CI drift gate would have failed the
    moment Actions billing returns. Emitted (`0015_smart_bruce_banner.
    sql`: exactly the ADD COLUMN).
17. **OpenAPI + clients regenerated**: `decrypt_failed` + the 429
    volume-gate response documented; orval re-run for api-client-react
    and api-zod; contract gate 83/83 in sync.

**Docs truth batch (9 files)** — money-invariant cites re-verified
against the post-merge code (M3 `wallet.ts:365`, M2 `:429-470`),
PRODUCTION_ARCHITECTURE V1-M23/0000-0015, `.specify/feature.json`
invalid-JSON fix, README stale script reference, FINAL_PRODUCTION_ENV
render.yaml row, r116-report A4-05 wording, WHATSAPP_OPERATIONS
Render→Coolify operational rewrite, CLOUDFLARE_FINAL_CUTOVER canonical
addendum, dated Contabo-host observation note.

## Live production findings (operator actions)

- **P1 — zero sellable stock**: all 45 active products
  `is_available=false`; the only 3 unsold inventory units sit under
  archived test products. The store browses but cannot sell — loading
  inventory is the operator runbook
  (`docs/operations/FINAL_INVENTORY_LOADING.md`).
- **P2 — canonical host**: recommendation recorded in
  CLOUDFLARE_FINAL_CUTOVER.md §8: a single www→apex 301 at the
  Traefik/Coolify layer (NOT in-app — that is what caused the R116
  Cloudflare loop).
- **P3 — topology**: live origin is a Contabo VPS (169.58.100.161,
  Let's Encrypt), not the Oracle host the migration docs describe —
  dated observation note added; operator should reconcile DR/backup
  runbook host references.

## Verification record (final tree)

- Backend: **165 files / 1517 tests / 0 failed** (baseline 1511 → +6)
- Frontend: **109 files / 751 tests / 0 failed** (baseline 747 → +4)
- `pnpm run typecheck` exit 0 (all workspaces) · `pnpm run lint`
  **0 errors / 89 warnings** (baseline 90)
- Production build exit 0 — entry **27.12 KB gz**, PWA precache 10
  entries, canonical link present in build output
- Contract gate 83/83 · gitleaks-clean · Drizzle mirror re-emitted

## Deliberately NOT done

- No in-app www→apex redirect (the R116 Cloudflare-loop incident; the
  Traefik-layer 301 is the recommended operator action instead).
- TOTP on the sole admin remains an operator TODO (recommended).
- B6-07/08 index DDL batches, admin wallet-history tab — still
  deferred (live tables tiny / stretch scope).
