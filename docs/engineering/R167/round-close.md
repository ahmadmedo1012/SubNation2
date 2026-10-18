# R167 — Round close: the deeper structural round (the R166 §6 backlog closed)

**Date:** 2026-10-18 · **Commit:** `35ff7bf2` · **Base:** `b5086472` (R166)
**Directive:** the owner: «كمل المؤجل وادخل مباشرة في جولة تالية اعمق واشمل واقوى، لا حاجة للتدقيق المتكرر انت دققت بما فيه الكفاية اعمل فعليا بعدد وكلاء ومهارات وارفع كفاءة المشروع ليكون عالمي بكل المقاييس» — complete the deferred work and enter directly a deeper/broader/stronger round; no repeat auditing (R166's audits stand); ACT with multiple agents; raise the project to world-class by all standards.

---

## 1. Round shape — implementation-first, zero new auditing

Per the directive, R167 ran **no audit phase**: the round is the execution of the **9 structural items R166 §6 documented with rationale** (plus their adjacent completions), in **2 waves of file-disjoint lanes + a coordinator mechanical sweep** — 7 execution units:

| Lane | Scope (R166 finding) | Outcome |
|---|---|---|
| R167-A (wave 1) | Orders family decomposition, safe cuts (F11/F12) | 4 extracts + 2 pins; orders 706→633, order-detail 791→733; headline cuts honestly deferred to wave 2 (pin re-point prerequisite) |
| R167-B (wave 1) | Layout decomposition (F13) | Navbar 876→527 + NotificationBell 635→171 under `layout/navbar/` ×7 + `layout/bell/` ×4; r167 pin (15 tests). Agent hit the execution deadline POST-implementation — the coordinator verified its tree centrally (tsc clean, 65/65 across the 9-file layout family) and recorded its entry; nothing needed repair |
| R167-C (wave 1) | Auth co-location (F18/F19) + brand glyphs (F17) | 5 git-mv renames (100% similarity where pure), 23 importer/mock/source-scan updates, `components/brand/` glyphs deduped at **6** sites (the audit's "×5" undercounted — provider-card's Telegram twin included), `renderToStaticMarkup` byte-identity proven |
| R167-D (wave 1) | Backend B3 — tier-price validator wiring | `findTierPriceAnomalies` wired into BOTH admin variant write paths, **warn-first** (additive `warnings` on the 2xx body + one warn log; never a rejection — operators must be able to fix bad rows); 5 new tests incl. the validator-throw-degrades-to-log case |
| R167-E (wave 1) | Network-error copy (F15) + dual forms (F16-note) | `NETWORK_ERROR_DESCRIPTION` in lib/errors; 9 of 10 sites swapped; both topups toasts → `ORDER_COUNT_FORMS_OBJECT.two`; the 12 intentional micro-variants documented and left |
| R167-A2 (wave 2) | Orders headline cuts + the pin re-point prerequisite | OrderRow + OrderCredentialsCard + OrderTerminalCard extracted; **6 source-scan suites re-pointed to page ∪ extract BEFORE the moves** (the R146/R158 precedent); orders 633→**436**, order-detail 733→**469**; rendered-DOM byte-identity machine-proven across 12 pinned states (twice) |
| Coordinator | The B3 openapi formalization + the F14 sweep + gates/ship | `AdminProductVariantWriteResult` (+ orval regen, parity green); ProductOutageCard — the audit-missed **11th** exact F15 site; F14 hook unification (9 kebab→camel modules, ~216 references re-pointed via a lookahead-safe script) |

## 2. What shipped

### 2.1 Frontend — decomposition closes the last big files

- **The orders family exists** (`components/orders/` ×7): OrderRow (213 — the full row card with StatusIcon/statusAccentBorder/STAGGER as module-private atoms), OrderCredentialsCard (216 — the receipt/decrypt-failure/prep region + RECEIPT_ROW), OrderTerminalCard (104 — the failed/refunded terminal), StatusSteps (57), OrderGroupChip (37), OrderClusterDivider (39), OrdersEmptyResults (110). **orders.tsx 706→436, order-detail.tsx 791→469** — both now inside the R137-era page-size norms, pinned (ceilings 470/500 with was-at titles).
- **The layout giants are gone**: Navbar 876→527 (`layout/navbar/`: AuthedDrawer, GuestDrawer, DesktopCategoriesMenu, DesktopUserActions, DrawerCategoriesSection, MobileWalletChip, drawer-data), NotificationBell 635→171 (`layout/bell/`: NotificationPanel, NotificationRow, PanelFooter, type-config) — behind the new layout pin; the r158 bell decomposition pin preserved intact.
- **The domain folders are complete**: the auth family (AuthErrorBanner, AuthProviders, TelegramLoginButton, WhatsAppPhoneSignIn) → `components/auth/`; TopupWaitingModal → `components/wallet/`; brand glyphs → `components/brand/` (TelegramGlyph + GoogleGlyph, aria-hidden opt-in preserving each site's exact pre-extraction attributes).
- **Hook filenames unified kebab→camel** (F14): useConfirm, useSocket, useToast, useDirtyGuard, useKeyboardVisibility, useOnScreen, usePublicAuthProviders, useTelegramWebAppAutoLogin, useAdminHeaders — matching the newer modules' convention; every importer/vi.mock/source-scan path re-pointed (the perl sweep is boundary-safe: `use-socket-orders-connection`-class names cannot be corrupted).
- **Copy registries**: the generic network-error copy now lives in ONE constant (10/10 canonical sites incl. the audit-missed 11th in ProductOutageCard; the 12 byte-different intentional variants documented and untouched); the topups dual-form sites ride `ORDER_COUNT_FORMS_OBJECT` (oblique position, plural-engine simulation across 9 counts byte-identical).

### 2.2 Backend — the commercial-truth guard goes live (B3, the P2 that survived 5 rounds)

`findTierPriceAnomalies` (R162 Lane D, wired into nothing since) now guards the admin variant write path: after a committed POST/PATCH, the route re-runs the validator over the product's ACTIVE variant matrix and maps findings to an **additive `warnings` field** on the 2xx body (kind: `equalized`/`inverted` + operator-facing Arabic copy) + exactly one warn log. **The write ALWAYS succeeds** — the audit's own risk note (blocking operator fixes) is the documented product decision; deactivating the offending variant is the silencer. The whole sweep is try/caught: a validator failure degrades to a log line, never a 5xx on a committed write. DELETE provably needs no wiring (a delete can only shrink the matrix). Formalized end-to-end: `docs/API.md` + `AdminProductVariantWriteResult` in openapi + orval regen (parity gates green both directions).

### 2.3 What the decomposition discipline bought

231 files changed (+4,108/−1,989) with **zero behavior change**: byte-identity machine-proven where it matters (12-state page renders ×2, per-site glyph renders), every pre-existing render contract green, and the pin discipline extended (3 new/rewritten pin families + 6 re-pointed source-scan suites + anti-drift guards so the pages cannot re-grow the moved blocks).

## 3. Gates (centrally re-run on the combined tree)

| Gate | Result |
|---|---|
| typecheck (libs + backend + frontend + scripts) | CLEAN |
| error-code sync | **50 codes, both directions** |
| route parity / header-params | 86 enforced ops / 7-of-7 |
| backend suite (by directory) | **285 files / 2,638 green** (routes 925 · services 455 · lib+jobs 1,025 · root 233) |
| frontend suite | **289 files / 2,697 green** (storefront 1,209 · admin 554 · components+lib+hooks 932 · root 2) |
| scripts suite | 6 files / **59 green** |
| lint | 0 errors (16 warnings — all verified pre-existing baselines or import-line line-shifts) |
| vite build | green — **eager 147,112 B gz** (+261 vs R166; warn 150 KiB / fail 160 KiB) |
| secrets scan (full diff + untracked) | clean |

## 4. Production verification (post-deploy)

Recorded in the coordinator worklog at ship time: CI on `35ff7bf2` + the Coolify webhook deploy, then `/api/healthz` 200 JSON, the home-shell Organization+WebSite pair, a PDP shell spot-check, and the e2e `seo.spec.ts` contract runs against production. (The bare `/healthz` path serves the SPA shell by design — the Render-era legacy path; the canonical probe is `/api/healthz`.)

## 5. Deferred this round (documented, not lost)

| Item | Rationale |
|---|---|
| The orders filter-chips data extract | State-coupled data machine (reads the memoized page buckets) — a relocation, not a presentational cut; page-owned by the R158 design |
| Auth test-file co-location into `auth/__tests__` | Outside the move lanes' owned-file lists; candidate micro-round |
| Hook test-file names (still kebab, e.g. `use-toast-severity.test.ts`) | Descriptors, not import graph; renaming adds doc-drift for zero contract value |
| A `scripts/src` whole-catalog live sweep (B3's natural next consumer) + an admin-UI toast surfacing `warnings` | Follow-ups; the API contract is live and documented |
| The 12 intentional network-error micro-variants | By design (different wording, different surfaces) — listed in the R167-E worklog entry |

## 6. Owner actions (unchanged in substance — R166 §7 stands)

1. **`INDEXNOW_KEY`** in the Coolify env (unset on production — re-verified this round: the key-file path still serves the SPA fallback). The enrichment→IndexNow notify (R166 F1) activates with it.
2. **GSC** sitemap submission + URL inspection (no authenticated session available to this workspace).
3. **The 24 catalog fixes** — the documented admin-UI action (R162/R163/R166 records).
