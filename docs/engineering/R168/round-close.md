# R168 — Round close: the measurable-growth round (GA4 ecommerce funnel, catalog-truth tooling, conversion honesty)

> **Round card.** Start `0b5fdbba` (R167 docs close) → code head `c27b7ae5` on
> `origin/main` (3 commits: `3183dbe1` the round, `f5b636e5` the gitleaks-safe
> slot rename, `c27b7ae5` the e2e EM-shape pin) → this docs commit. Dates:
> 2026-10-18/19. Scope per the owner brief: GA4 end-to-end verification, the
> Google-recommended ecommerce event funnel, the R167 §5 deferred operational
> work (whole-catalog tier-price checker + admin surfacing), search-visibility
> adjudication (GSC + IndexNow), and evidence-ranked conversion fixes —
> implementation-first, no new auditing, no mega-report (this file is the
> whole report).

## 1. What shipped (the three lanes, evidence in the commits)

### L1 — the GA4 ecommerce funnel (`frontend/src/lib/analytics-events.ts` + 15-test suite + e2e)

The typed, guarded event layer on top of the R164 deferred loader: `view_item_list`
(home/catalog/category/flash-sales/PDP recommendations), `view_item` (PDP load),
`select_item` (grid card → PDP hop, `item_list_id` threaded), `search` (both
commit paths, module-deduped), `add_to_cart` (the true addItem paths),
`begin_checkout` (confirm start, coupon-adjusted value), `purchase` — **only**
after `created.push(order)` on a confirmed order. The money/PII fence:
`transaction_id = order_code` (the stable server-minted identity; the R165
group token stays informational-only — a multi-order checkout emits one
purchase per confirmed unit-order), one purchase per `order_code` ever
(in-memory Set + the `subnation_ga4_sent` localStorage sent-set, 100-code
bound, corrupt→reset), eligibility = `pending|completed` + non-empty code +
finite amount (never failed/refunded, never a non-2xx path), and the mappers
structurally cannot name `delivered_*`/user fields. **No manual `page_view`
exists anywhere** — SPA navigation rides Enhanced Measurement's history
listener, so duplication is impossible by construction (e2e-pinned). The
deferred-loader privacy posture is untouched: one GA id, idle-loaded off the
LCP path, `anonymize_ip`, beacon transport; the entry bundle carries exactly
ONE `G-RKRV3ZC3MF` occurrence (grep-verified against the live asset).

### L2 — the R167 §5 deferred operational work, closed

1. **`GET /api/admin/products/tier-price-sweep`** — the whole-catalog
   READ-ONLY twin of the R167 write-path guard: every active non-archived
   product × one `inArray` pass over active variants, `findTierPriceAnomalies`
   per matrix, findings = product identity + kind + the verbatim
   `tierPriceWarningMessage` copy (one registry) + active-variant evidence
   rows; envelope `{checked_at, products_scanned, variants_scanned, scan_cap,
   products_with_findings, findings}`. OpenAPI + orval/zod regen landed;
   parity gates green at **87 enforced ops** (was 86).
2. **Admin surfacing** — `ProductVariantsDialog` rides the success body's
   `warnings` as non-blocking 'warning' toasts (the first production consumer
   of the toast warning variant), and the products page gains the
   `TierPriceAuditPanel` (summary counts, per-finding rows with kind badge +
   Arabic message + variant evidence + open-variants affordance, invalidated
   alongside variant writes so a fix disappears immediately). The checker
   never writes — price/stock changes stay on the authorized variant
   mutation paths.
3. **Shell price truth** — the SPA shell's Product-LD `Offer` price now rides
   the cheapest-AVAILABLE-variant projection (the hydrated page's
   `displayBase`), closing the drift case where the shell advertised a stale
   lower price than the page; the spa-shell register pin held (1,038 ≤ 1,039).

### L3 — conversion honesty (evidence-ranked, no redesign)

Cart wallet-shortfall warning at the decision moment (quiet line + topup link
with return-path), guest-PDP payment-model line, the topup-approval SLA
sentence on both insufficient-balance surfaces, support recourse on the
checkout complete-failure banner, per-month equivalent on duration pills
(`parseDurationMonths`, fail-safe hidden), and multi-variant stock honesty
(no numeric product-level count on multi-variant products — the verified
over-claim case). 42 new tests pin the lane.

## 2. The verification record (live evidence, re-taken 2026-10-19 after the workspace reset)

The implementation session shipped and verified the lanes (its evidence is
the three commit messages + the e2e runs recorded in `c27b7ae5`). This closing
session — a fresh environment — independently re-verified the deployed
behavior read-only:

### 2.1 Deployment identity

- `/api/healthz` → **200**.
- The live `analytics-events-Za8FNPAr.js` chunk embeds Sentry release id
  **`c27b7ae`** → production is running the R168 code head exactly.
- The tier-price-sweep route is live: `GET /api/admin/products/tier-price-sweep`
  → **401** (route mounted, admin-gated — existence proof without credentials).
- Entry bundle greps: `subnation_ga4_sent` ✓, all five event names ✓, exactly
  one `G-RKRV3ZC3MF` ✓ (no second tag).

### 2.2 GA4 funnel — live browser probe (read-only, no money path touched)

dataLayer on production, this session's own probes:

| Observation | Evidence |
|---|---|
| Loader + id | `gtag/js?id=G-RKRV3ZC3MF` → 200; `["config","G-RKRV3ZC3MF"]` entry |
| `view_item_list` | home grid load (×1) + PDP recommendations (×1) |
| `select_item` | grid card click → `{items:[{item_id:"3", item_name:"Disney+", price:79.8, quantity:1, item_category:"streaming"}], item_list_id:"catalog"}` |
| `view_item` | PDP load → `{currency:"LYD", value:79.8, items:[{item_id:"60", item_name:"Grammarly Pro", price:79.8, quantity:1, item_category:"software", item_variant:"شهر واحد"}]}` |
| `search` | committed term → `{search_term:"netflix"}`; re-submit same term → still 1 event (dedupe contract) |
| SPA navigation | object-form `gtm.historyChange-v2` entries (+ `gtm.scrollDepth`); **zero array-form `page_view` entries on any screen** — no duplication by construction |
| PII | none in any observed payload (identity = ids/names/category/variant/price only) |
| `add_to_cart`/`begin_checkout`/`purchase` | not browser-probed (need login/money-path actions — out of the read-only mandate); pinned by the 15-test unit suite (mappers, eligibility, sent-set, payload sweeps) |

**The beacon caveat, honestly stated:** `google-analytics.com/g/collect`
hits cannot be observed from an automated browser — `navigator.webdriver`
is true and gtag.js suppresses collection in automation contexts (proven
with a vanilla local repro in the implementation session; re-confirmed this
session — patching the flag post-load does not resurrect hits). The
verifiable chain from the agent side is script-200 → config entry → correct
event stream. The last hop (real-visitor hits arriving in GA4) is a 30-second
owner check (Realtime report, any normal browser) — see §6. On the "new
property shows no data" question: the property is days old; GA4 standard
reports lag 24–48h for new properties, so "No data received yet" within that
window is expected latency, NOT evidence of collection failure — the
structural chain above rules out a collection-side defect.

### 2.3 IndexNow — the historical contradiction, adjudicated

- **R164 (Oct 17):** key file route unmounted (any `/<x>.txt` served the SPA
  fallback — `INDEXNOW_KEY` unset); a real test submission to
  `api.indexnow.org` returned **HTTP 202** (= received, key validation
  pending — the expected response with no key file).
- **R167 (Oct 18):** re-verified unset (same probe).
- **Owner (after R167):** set `INDEXNOW_KEY` in Coolify; manual submission
  returned **HTTP 200** (= submitted successfully — the engine accepted the
  submission after key validation; the 403 class is what a missing/mismatched
  key file produces).
- **Verdict:** no contradiction — a timeline. The key was unset through
  R167, then set by the owner; the 202→200 transition is exactly the API's
  documented observable for a key file going live and validating. The
  enrichment→IndexNow notify path (R166 F1) is now armed.
- **What the agent side cannot do:** fetch `https://subnation.ly/<key>.txt`
  directly — the key value is owner-held by design (never in the repo, the
  secret-scan discipline holds). No key was generated, replaced, or rotated
  this round (per the brief). The one-glance owner confirmation, if wanted:
  the key file URL in a browser shows the bare key as text/plain.

### 2.4 GSC — evidence and the exact limitation

Fresh browser, zero Google cookies → `search.google.com/search-console`
lands on the Google sign-in wall. **No authenticated GSC session exists in
this workspace** (recorded identically by R163's source-of-truth ledger #11c:
GSC/BWT are owner-only). Therefore the brief's 28-day vs 3-month comparison
and the high-exposure/low-CTR page prioritization are **owner-side reads**
(not agent-executable) and did not block anything else in this round. The
repo-side surfaces those reads depend on are verified live: canonical URL
architecture, the dynamic sitemap (56 URLs at R163), Product/Offer JSON-LD
(now with the L2 available-price projection), robots/noindex design, and
the R163 crawler-shell fix — unchanged this round except the Offer-price
truth gain.

### 2.5 Catalog truth — the R162 corrections vs live data (read-only re-verification)

Method: the R162 census's own verification loop — public `by-slug` pulls,
verbatim marker comparison per finding (a disposable session script held the
marker table; the method is what persists, per the R162 closing section's
step 4). **All 24 authorized mechanical
findings remain valid AND unapplied** — 38/38 verbatim markers across
description/`description_long`/faq/features/variants still carry the
defective text (spot-checked against live payloads; e.g. `tidal`
description still reads «للمحبيين», faq still «فلاتر Master Authenticated»).
No corrections were applied this round: application requires the authorized
admin surfaces (product form / variants dialog / enrichment panel) and the
agent environment holds no production admin credentials — the repo rule
(no direct production SQL, no forced imports) and the money-field fence
both hold. The R162 document's per-finding «(c) Proposed corrected text»
remains the apply-ready source, with its three one-glance confirmations
(Brain.fm lifetime, Hulu 75→95+, ExpressVPN 105→113).

## 3. Gates

| Gate | Result |
|---|---|
| CI on `c27b7ae5` (head) | **passing** — secret-scan + CVE audit + lint/typecheck/drift + both unit suites + build (badge + runs verified) |
| backend suite | **2,677 green / 288 files** (commit-recorded, 4 chunks) |
| frontend suite | **2,762 green / 297 files** (+8 files/+65 tests vs R167 — reconciles with the three lanes) |
| scripts suite | 6 files / 59 green |
| lint / typecheck | 0 errors (16 baseline warnings) / CLEAN ×4 |
| parity / error-code / header-params | **87 enforced ops** (was 86) / 50 / 7-of-7 |
| vite build | green — **eager 147,185 B gz** (+73 vs R167; warn 150 KiB / fail 160 KiB) |
| e2e vs production | `analytics.spec.ts` **6/6** + `seo.spec.ts` **21/21** (re-run on `c27b7ae5`, incl. the PDP Offer-matches-API test now validating the shell price projection) |
| secrets scan | clean (the `subnation_ga4_sent` rename closed gitleaks' one entropy finding on CI run 39177677690; the two `plainpass` test-fixture hits are the established pre-existing convention) |

`docker.yml` remains red (the known pre-existing manual-dispatch workflow;
not Coolify-coupled — deployment is verified behaviorally, §2.1).

## 4. Deferred this round (documented, not lost)

| Item | Rationale |
|---|---|
| `features[]` admin write surface | Pre-existing gap (R162 closing note): four correction bullets ride `features[]`; needs a small admin lane, not a hotfix |
| The 12 R162 business decisions | Owner-dependent by definition (Netflix tier, Pandora dialect, Ahrefs price, Funimation archive, …) — the decision table stands |
| GSC quantitative analysis | No authenticated session (§2.4) — owner-side read |
| GA4 Realtime/DebugView confirmation | The automation-suppressed last hop (§2.2) — 30-second owner check |

## 5. Owner actions — only the truly unavoidable

1. **~~Re-provide the GitHub PAT~~ — closed in-round**: the owner re-supplied
   the credential during the closing session and this very report pushed with
   it (docs-only, CI's ~2-minute light path). The remaining items are the
   genuinely owner-side checks.
2. **GA4 Realtime check** (~30 seconds): GA4 → Reports → Realtime → open
   subnation.ly in a normal browser → expect page_view + the ecommerce
   events to appear within ~30s. This is the one hop automated browsers
   cannot verify (§2.2). Note: standard reports for the new property lag
   24–48h — "no data" there within that window is normal.
3. **The 24 catalog mechanical corrections** — apply per the R162 document's
   «(c)» column through the three admin surfaces (its closing section maps
   every finding to its click-path); today's re-verification (§2.5) confirms
   all 24 still-valid and unapplied. The 12 business decisions ride the same
   document.
4. **GSC reads** (owner console): the 28-day vs 3-month comparison and the
   high-exposure/low-CTR page list — the surfaces those reads act on are
   verified live (§2.4).

IndexNow needs **no** owner action — the key is set and validated (§2.3);
do not regenerate or rotate it.
