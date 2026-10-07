> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r111/f1-ux-states.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R111-F1 — UX State Completeness Survey (10 High-Traffic Surfaces)

> Round 111 · READ-ONLY frontend audit · base `217de91` (r110) · 2026-09-23
> Scope: loading / empty / error / failure-preserves-input on home, product, cart,
> checkout, wallet, order-detail, login (WhatsApp OTP), profile, admin/orders,
> admin/topups + 5 cross-cutting questions. Grep-first; ~21 tool calls.
> Sibling findings (CONSOLIDATED-FINDINGS.md) NOT re-reported. F4 = perf
> (cart re-render), T2 = test coverage, B5-2 = backend OTP-verdict mapping —
> orthogonal to this survey. The FE side of B5-2 already renders settling/
> waking honestly whenever the backend sends that verdict
> (WhatsAppPhoneSignIn.tsx:244-283, 463-484) — the gap lives in the backend map.

## 1. The 10×4 matrix

Legend: ✅ complete · ⚠️ partial gap (numbered F1-G*) · N/A not applicable

| Surface | (a) Loading | (b) Empty | (c) Error | (d) Failure preserves input |
|---|---|---|---|---|
| **home** | ✅ 8-card skeleton grid (home.tsx:898-903, `ProductSkeleton`:148); auth-hero skeleton with `userError` break-out so a failed `/me` can't shimmer forever (:376-383). ⚠️ **F1-G2/F1-G3**: stats + recent-orders side-widgets have NO loading skeleton — silent pop-in | ✅ "لا توجد منتجات تطابق بحثك" + hint + **مسح جميع الفلاتر CTA** (:923-938); error deliberately never fakes this state (:904-907 comment) | ✅ distinct error card, Arabic copy, **إعادة المحاولة** retry (:908-922); `/me` failure degrades to guest hero — honest, browsable (:376-383). ⚠️ stats/orders widgets fail silently (G2/G3) | N/A (no user input); filters live in URL → survive reload |
| **product** | ✅ full-page layout-matched skeleton (image block + title bars + CTA) (:688-705) | ✅ 404 → "المنتج غير موجود" + العودة للكتالوج CTA (:734-748); recommendations section hides itself when empty (:1630) — no blank stub | ✅ non-404 error explicitly split from 404 since R94-A1 (:707-732) — retry + back-to-catalog, Arabic | ✅ coupon input kept + inline error persists until next keystroke (:429, :545); buy failure → inline error block (:1066), variant selection never reset by failure |
| **cart** | ✅ `CartSkeleton` 3-row shimmer behind `!isLoaded` (:122-129) | ✅ "سلتك فارغة" + **متابعة التسوق CTA** (:169-187) | N/A — page is local-first; server DELETE is fire-and-forget best-effort (:114-119) | ✅✅ local cart; every removal carries 6s **تراجع undo** (:71-81); clear behind destructive `useConfirm` (:95-104) |
| **checkout** | ⚠️ **F1-G1**: no `!isLoaded` guard — first paint renders the "سلتك فارغة" empty branch before the localStorage cart hydrates (cart.tsx guards this; checkout.tsx does not — `isLoaded` only used in the quote effect, :600/:688). `!token → null` blank while redirect effect runs (:1113) — **F1-G6** | ✅ "سلتك فارغة" + CTA (:1325-1329); dropped-line notices hoisted ABOVE the empty branch so an emptied cart still explains why (:1297-1301) | ✅✅ best-in-repo: persistent in-page banner «لم يتم خصم أي مبلغ…» (:1441-1443); balance-probe failure = warning + fail-open (:1163-1170); coupon notices retryable (:740-764); partial-success bookkeeping (:1063-1067); other-tab-completion outcome (:1068-1077) | ✅✅ exemplary: cart shrinks ONLY for units actually charged (:1028-1043); network-failure path skips cart-sync so a retry replays instead of re-charging; stable per-unit Idempotency-Keys; coupon auto-removal guidance on mid-loop death (:1013-1019) |
| **wallet** | ✅ h-36 shimmer balance card (:843-844) | ✅ "لا توجد طلبات شحن بعد" (:1537-1548) — Arabic copy but **no CTA button** (form is on-page; **F1-G5**, minor) | ✅ balance card error + retry (:845-866, R93 fix — silent-vanish fixed); ledger error + retry (:1516-1536, outage ≠ "never topped up" since R93) | ✅ inline submit errors per form (:1296, :1449); MAX_PENDING=3 guard blocks triple-submit (:665); sessionStorage intent key (:504); `TopupWaitingModal` polls in background |
| **order-detail** | ✅ 3-block layout skeleton (:188-198) | ✅ 404/empty → "الطلب غير موجود" + العودة للطلبات CTA (:232-247) | ✅ error card + retry + support escalation copy (:200-230); refunded/failed orders render an honest status card, not a fake error (:434-439) | N/A (read-only receipt page); `!token → null` + login redirect (:183-186) — same G6 pattern |
| **login (WhatsApp OTP)** | ✅ button-level spinners + disabled logic throughout (WhatsAppPhoneSignIn.tsx:499-528, 601-608); no page skeleton needed (static provider buttons render instantly) | N/A | ✅✅ single error funnel, Arabic, no raw `data.error` leaks (:111-133, :693-698); settling/waking 503s styled as honest WAIT (role=status, muted) with auto-retry budget then manual CTA (:55-57, :244-283, :661-693); cooldown honesty «إعادة الإرسال (N ث)» (:523-528, :637); Google fallback offered when channel dead (:463-484) | ✅ phone retained across errors; OTP TTL countdown (:169-177); resend honors 60s cooldown; paste extraction converts Arabic-Indic digits (:360-361) |
| **profile** | ✅ h-36 shimmer identity card (:191-192) | ✅ no-linked-providers → inline link CTA (:438-465) | ✅ linked-accounts error card + retry — R94-A1 #8 fixed the fifth error-as-empty site (:414-431) | ✅ unlink behind `useConfirm` (:139-157), failure toasts Arabic (:164-165) |
| **admin/orders** | ✅ shared `TableSkeleton` (SharedTableSkeleton, orders.tsx:884-885) — column shapes passed per page | ✅ shared `EmptyState` + **مسح الفلاتر CTA** (:907-922) | ✅✅ two-tier: with-data sticky banner + retry (:866-882) AND empty+error full card + retry (:886-905) — an outage never reads as "no orders"; stale cached data stays visible | ✅ refund/bulk-status behind `useConfirm` showing TOTAL LYD (:256-273); 207 partial-failure parsed per-order (:322-334); 401 mid-work not mislabeled retryable (:290-292); infinite-scroll guard (:1221) |
| **admin/topups** | ✅ `TopupCardSkeleton` grid ×8 (:977-981) — card-shaped by design (shared TableSkeleton docblock :21-22) | ✅ shared `EmptyState` (:1004-1005) | ✅✅ same two-tier banner/card + retry (:961-1002); per-item approve/reject failure reasons in one summary toast (:694-699, :778-791) | ✅✅ money-grade: approve confirm shows amount + user + sender + transfer-ref (:583-600); one Idempotency-Key per click, survives React-Query retry (:592-599); reject = note dialog (inherent confirm); single-entry re-click guard (:723) |

**Score: 38/40 cells ✅ or N/A-clean. Two ⚠️ clusters: checkout hydration edge (G1) and home's secondary widgets (G2/G3).**

## 2. Cross-cutting answers

### 2.1 ErrorBoundary — exists, wraps both switches
`components/ErrorBoundary.tsx`: class boundary, Arabic full-screen «حدث خطأ غير متوقع»,
**إعادة التحميل** + **الرئيسية** buttons, collapsible dev-details, Sentry lazily
imported only on the error path (:52-59), `resetKey=location` (98-F7) resets a
crashed route on navigation. Wraps the **public Switch** (App.tsx:388) and the
**admin Switch** (App.tsx:494) — one boundary per switch, no per-page boundaries
(deliberate: a crashed 900-1500-line page shows the error screen either way,
App.tsx:377-383). No in-place retry — recovery is a full reload (**F1-G7**, P4).

### 2.2 Shared empty-state vs ad-hoc
**Admin: yes.** `components/admin/EmptyState.tsx` (icon+title+description+action,
Arabic) is the canonical card — used by 10 pages (orders:908, topups:1005,
products:961, users:897, coupons:549, referrals:444, enrichment:132, whatsapp:357,
security:325, risk:260); `TableSkeleton.tsx` is its loading twin. **Storefront:
no shared component** — 8+ hand-rolled near-identical blocks (home:924, cart:170,
wallet:1538, checkout:1326, product:736, order-detail:237) follow the same visual
idiom but duplicate markup; `CopilotPanel.tsx:1100` carries its own local
`EmptyState` function (**F1-G4**, P3 — extraction, not a bug).

### 2.3 useConfirm on destructive actions — complete
14 consuming files: cart clear, profile unlink, SessionManager destructive
actions, ProductVariantsDialog, and admin orders (bulk incl. refund, with total),
topups (approve, with amount+user+ref), coupons delete, products archive,
promotions, users, referrals, pricing, whatsapp session delete, admins.
**Zero `window.confirm`/`window.prompt` remain** — enforced by regression test
`pages/admin/__tests__/no-native-confirm.test.ts:43` (per-file assertion).
Reject flows use note dialogs (topups, enrichment) = inherent confirmation step;
bulk money loops use `BulkConfirmModal`. No unguarded destructive handler found
in any of the 10 surveyed surfaces.

### 2.4 lazyWithRetry + 404 — full coverage
**100% of routes** (31 route components, App.tsx:26-82) ride `lazyWithRetry`:
chunk-load errors trigger ONE self-reload per pathname (sessionStorage flag),
then bubble to the ErrorBoundary (lib/lazy-with-retry.ts:45-96, all 6 browser
error signatures). Catch-all `<Route component={NotFound}/>` exists in **both**
switches (App.tsx:409 public, :522 admin); `not-found.tsx` is Arabic with
home/back CTAs + 4 quick links, soft-404 mitigated via `noindex,follow` +
canonical. Suspense fallback is the **RouteSkeleton shape map** — layout-matched
skeletons per route (CLS-safe content-fill swap, order-sensitive for
`/orders/:code`, App.tsx:84-152).

### 2.5 React Query staleTime/gcTime per key family
**Defaults** (App.tsx:188-190): `staleTime 60s`, `gcTime 5min`; retry policy
(98-F7, :213-236): TypeError/5xx retried, **4xx never** (correct verdict
semantics). Per family:
- products (home :261, category :151, head-start seed App.tsx:311): **3 min**
- catalog stats (home :290): **10 min** · product recommendations (product:1626): **5 min**
- /me, referrals, navbar: **60 s** · status page: 240 s + 5-min poll
- admin polls (all `refetchIntervalInBackground:false`): alerts 20 s, risk 30 s,
  system 60 s, products 60 s, orders/topups/users/dashboard/layout **300 s**
  — socket-event invalidation demotes them (SocketInitializer:64)
- TopupWaitingModal: background poll ON (deliberate — money wait),
  FlashSaleBanner: conditional 60 s/600 s, hidden tabs never poll.

## 3. Findings by severity (new, this audit)

| ID | Sev | Location | Scenario | Fix |
|---|---|---|---|---|
| F1-G1 | **P3** | checkout.tsx:471,719,1325 | Shopper with a full cart deep-links /checkout → first paint shows «سلتك فارغة» until the localStorage hydration effect flips `isLoaded` (cart.tsx has the guard; checkout only uses `isLoaded` in the quote effect) | `if (!isLoaded) return <CartSkeleton/>` — mirror cart.tsx:122 |
| F1-G2 | **P3** | home.tsx:287-292, 609, 669 | `/catalog-stats` failure = stats strip silently absent (no error, no retry); late success pops the strip in below/inside the hero → CLS | skeleton placeholder row + error-degrade choice (hide is acceptable if deliberate — document it) |
| F1-G3 | **P3** | home.tsx:320-327, 438 | Recent-orders strip: no loading skeleton, no error state; pop-in CLS in the authenticated hero; an outage reads as "no orders" | 4-row mini-skeleton behind `token && pending`; hide-or-retry on error |
| F1-G4 | **P3** | storefront-wide (8 sites) + CopilotPanel.tsx:1100 | No shared storefront EmptyState — 8 hand-rolled variants will drift (admin already extracted its twin in 93-C7) | extract `components/ui/empty-state.tsx` from the wallet/cart idiom |
| F1-G5 | P4 | wallet.tsx:1537-1548 | Topups empty state = copy only, no CTA button (form sits above; impact minimal) | optional CTA that scroll-focuses the topup form |
| F1-G6 | P4 | checkout.tsx:1113, order-detail.tsx:186 | `!token → return null` renders a blank frame for one tick while the redirect effect fires on deep links | render the page skeleton instead of null during the redirect tick |
| F1-G7 | P4 | ErrorBoundary.tsx:114-120 | Only recovery is `window.location.reload()` — a render crash on a filled form page loses all unsaved input | optional in-place "إعادة المحاولة" (reset boundary state without reload) |

**Totals: 0 P0 · 0 P1 · 0 P2 · 4 P3 · 3 P4.** The state-completeness
discipline across these 10 surfaces is genuinely strong — error≠empty
separation, Arabic retry copy, idempotency-preserving failure flows, and
money-action confirms are applied uniformly; residual gaps cluster in
(a) one cart-hydration edge on checkout and (b) home's secondary widgets.

## 4. Top-5 gaps (fix order)
1. **F1-G1** checkout empty-state flash — one-line guard, money-page false signal.
2. **F1-G2** home stats widget silent failure + CLS pop-in.
3. **F1-G3** home recent-orders strip silent failure + CLS pop-in.
4. **F1-G4** extract the shared storefront EmptyState (drift prevention).
5. **F1-G6** skeleton-instead-of-null during auth redirects on checkout/order-detail.
