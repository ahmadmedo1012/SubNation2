# R166 — Round close: the comprehensive improvement & organization round

**Date:** 2026-10-18 · **Commit:** `943af68a` (+ this docs commit) · **Base:** `93537905` (R165)
**Directive:** the owner, while the indexing activation (GSC + IndexNow) runs in parallel: «enter another round of comprehensive improvement, development, and organization of all project content, and work with a number of agents and all possible skills».

---

## 1. Round shape — the multi-agent model

Ten agents: **4 read-only Explore audits** (evidence-only, file:line-verified) → coordinator triage → **6 file-disjoint full-stack implementation lanes** + a coordinator lane → central gates → one shipped round.

| Audit agent | Domain | Findings |
|---|---|---|
| R166-A | frontend/src (content, copy, a11y, organization) | 19 (1×P1, 4×P2, 14×P3) |
| R166-B | backend/src (dead code, error-code registry, route surface) | 15 (5×P2, 9×P3; TODO/FIXME inventory verified clean) |
| R166-C | docs/ tree (392 files, 53,996 md-LOC, 362 cross-refs checked) | 19 (2×P1, 7×P2, 10×P3) |
| R166-D | SEO surfaces + catalog content source-of-truth | 8 (1×P2, 7×P3) |

Audit reports: `tool-results/R166-{A,B,C,D}-*.md` (session artifacts) with worklog entries by each agent. Every finding carried file:line + exact fix + pin-impact; the coordinator deferred 9 structural items (§6).

## 2. What shipped (61 findings → 52 implemented, 9 deferred, 2 no-action)

### 2.1 Frontend — honesty first

- **F01 (P1) — the order-detail chip told the truth only for multi-unit buyers.** R165 minted the group token on every confirm (no unit-count gate; the ADR's own §5 matrix says single-item → no grouping UI), so every single-unit cart receipt carried «جزء من عملية شراء متعددة» — false for the majority flow, and its link dead-ended on /orders (run-of-1 renders no divider). **Fix:** neutral «ضمن عملية شراء واحدة» (true for run-of-1 AND multi; reuses the /orders divider vocabulary — one mental model), + the missing test case (single order with group id), + `ArrowLeft` for the forward affordance (the app's RTL icon law: right = back).
- **F02/F16 — the Arabic dual-form grammar is now a named registry:** `ORDER_COUNT_FORMS_SUBJECT` («طلبان» — standalone counts/chips) / `ORDER_COUNT_FORMS_OBJECT` («طلبين» — post-verb objects) beside `formatCount`, adopted at 8 sites. Checkout's pinned toast stays byte-identical (the OBJECT variant, proven by the green pin).
- **F04** telegram-callback joins auth-callback's `role=status/alert` + `aria-live=polite` contract. **F05** the role-less `aria-label` dropped from the cluster divider.
- **F07** 11 dead exports unexported (grep-verified zero refs, incl. R165's own speculative `checkoutGroupFingerprint`). **F08/F06** the last 9 physical→logical CSS tokens + CopilotPanel's border to the content-facing edge. **F09** intent-envelope docblock → the five-consumer map. **F10** group-token corrupt-JSON/empty-fingerprint branch tests + the filter-split clustering case.

### 2.2 Backend — contract truth

- **Error-code registry reconciled both directions** (B10+B11): `PRODUCT_STALE`/`VARIANT_STALE` (riding user-facing checkout 409s) + 3 `COPILOT_*` loop codes — added to registry + openapi + the Arabic error map («تغيّر سعر المنتج أو تفاصيله — راجع السلة ثم أعد المحاولة»…). 10 provably-unthrowable codes retired after per-code emission re-verification. **55 → 50 codes**; parity gates green both directions; orval regen drift-free. Note for the record: the checkout 409 route envelope today stamps `CONFLICT` + its own Arabic message while the service-level stable code is `PRODUCT_STALE` — the new map entry is the truthful code-only-body fallback.
- **The 2,296-LOC production-dead inspection island moved to `scripts/`** (B1) with history preserved (git renames 97-100%). Scripts vitest repaired first (a missing vitest link in the re-provisioned container — `pnpm install --filter @workspace/scripts`); the 53 island tests run green there (6 files / 59 tests). Backend loses 5 test files / 53 tests with **zero test loss** (they live on in scripts). `scripts/inspect.ts` reference re-pointed.
- **Loyalty single-source** (B2): the convert-points route's hand-duplicated predicate proven term-by-term identical to `isConvertibleBundle()` (incl. 0/negative edges) → the route now calls it; `roundLyd` credit kept; the divergent `toFixed(2)` dead twin (`conversionCreditLyd`) deleted — a trap, not a helper.
- **15 dead exports unexported** via `__test` seams (B4-B8: logger, alerting, telegram-oidc, risk-metrics, cache) — public surface = production consumers + test seams.
- **12 routes with zero SPA consumers documented** as operator/curl surface in `docs/API.md` (B12-B15: the products alias pair, the risk config/rules/synth family with its test-data-injection note, observability/sentry probes, `POST /admin/alerts/test`).

### 2.3 SEO surface — closes the gaps the indexing work will exercise

- **F1 (P2) — the enrichment-publish IndexNow gap:** `publishDraft` writes description/descriptionLong/faq (the heaviest PDP content) but never pinged. `notifyProductChanged` now fires **after** the transaction commits (captured slug/category; never inside the tx — a rollback must not ping). Pinned by a 9-test suite (called-on-success; silent on rollback/failure/not-found/wrong-state/bad-faq). This goes live the moment the owner's `INDEXNOW_KEY` lands — no code change needed then.
- **F4 — the home crawler shell now carries structured data:** new `backend/src/lib/shell-website-ld.ts` mirrors the hydrated page's Organization + WebSite graph (same `@id`s `${origin}/#organization`/`#website` → WRS merges; `inLanguage: "ar"`; SearchAction; Libya `areaServed`). Injected only on `/` via `SpaShellMeta.jsonLd` (now `string | string[]`). Non-rendering engines stop seeing an empty home. **Verified live post-deploy** (§5).
- **F2/F3 — Product LD Offer gains `seller` (Organization, SubNation) + `category`** (raw slug) at BOTH surfaces — the shell and the hydrated builder, field-mirrored per the R163 @id-merge contract.
- **F5** the unfurler OG card canonicalizes to the slug URL (numeric shares stop claiming `/product/10`). **F6** sitemap null-slug rows filtered (honest omission — the fallback minted `/product/product-<id>`, a URL the shell itself 404s). **F8** the two hand-synced noindex registries (`SHELL_NOINDEX_RES` ≡ `NOINDEX_ROUTES`) now carry a source-parsing parity test. **F7** `/forgot-password` belt comments (retired route kept as defense-in-depth).

### 2.4 Docs organization — findability + truth

- **D1/D9/D11/D12 (P1 + the P2s) — the engineering record was invisible:** NEW **`docs/engineering/README.md`** indexes all round folders R142→R165 (folder · date · title · shape · CHANGELOG anchor; the R155/R159 CHANGELOG-only gap noted; pre-R142 → `history/inspection-r###/`; "round-close.md since R146" convention). docs/README gains the ENGINEERING bucket + the four recounted buckets + the amended house rule; ONBOARDING §6 rewritten from the pre-R142 `inspection-r###/` world.
- **D2/D8/D10 — truth corrections in live docs:** `FINAL_MONEY_INVARIANTS` 2,103 → **2,659 across 286 files** (bracketed; the by-directory partial disclosed) + the 47-file suite index; R165 round-close §5 errata line; `source-of-truth` reconciliation entry #13 + the #9 repoint; progress-log :82-83 bracketed repoints. The CHANGELOG errata rides the R166 entry (this round's, per the no-rewrite policy).
- **D3/D4/D6/D19 — the operator chain:** `INDEXNOW_KEY` added to ENVIRONMENT_MATRIX + FINAL_PRODUCTION_ENV + COOLIFY §2.3 (it was absent from every operator env doc — the exact var the indexing activation needs); `VITE_GA_TRACKING_ID` rows restamped to the R164 bake/override semantics; runbook §14 owner-actions current through R166 (INDEXNOW_KEY, GA4 spot-check, GSC sitemap, the 24 catalog fixes); OPERATOR_ACTIONS header pointer; the D19 canonical split (COOLIFY §2.3 owns the *where*, env.example the *what*).
- **D5/D7/D13/D16/D17 — README/CONTRIBUTING restamped** at R165/R166 numbers, the archive-policy fiction amended (round records live in `engineering/`, indexed — not moved; moving would break 60+ CHANGELOG links for nothing), the dead `VITE_FIREBASE_MEASUREMENT_ID` deleted from env.example, the stale R115 SHA examples refreshed.

## 3. Catalog content — the 24 R162 fixes stay owner actions (verified, not re-litigated)

The R166-D audit confirmed with evidence: catalog content is **purely production-DB content** (born from the 2026-09-20 live embrionic.com crawl; `seed.ts` is a 6-sample dev bootstrap; migrations 0000-0026 are DDL-only; `SEO_PRODUCTS.json` is an explicitly-labeled snapshot). A repo-side scripted apply is mechanically feasible (extending the importer pattern to `description`/`features`/`plan_label` with the zod caps) but requires an owner-supplied production `DATABASE_URL` or admin session — both owner-gated. **The 24 fixes remain the documented admin-UI action** exactly as R163/R164/R165 recorded; no script was written (no credential to run it).

## 4. Gates (the combined tree, centrally re-run)

| Gate | Result |
|---|---|
| typecheck ×3 (backend / frontend / scripts) | CLEAN |
| error-code sync | **50 codes, both directions agree** |
| route parity / header-params | 86 enforced ops / 7-of-7 |
| backend suite (by directory) | **284 files / 2,633 green** (routes 920 · services 455 · lib+jobs 1,025 · root 233) |
| frontend suite | **286 files / 2,664 green** (1 stale visual pin updated with in-line rationale) |
| scripts suite | 6 files / **59 green** (incl. the 53 moved island tests) |
| lint | 0 errors both workspaces (warnings baseline-identical; 1 pre-existing R165 warning untouched) |
| vite build | green — **eager 146,851 B gz** (+41 vs R165's 146,810; budget 150 KiB warn / 160 KiB fail) |
| size gates | spa-shell 1,038 ≤ 1,039 (comment compression offset the +13 wiring) · alerting 1,081 ≤ register (2 comments compressed after the `__test` additions briefly pushed it 3 over) |
| secrets scan on the full diff | clean |

**Round cost:** 94 files, +1,486 / −425 (the −425 includes the unexports' keyword removals and comment compressions; the island's 2,296 LOC moved, not deleted).

## 5. Production verification (post-deploy, this session)

- CI run **#39150265335** on `943af68a`: **success**. Coolify webhook deployed it.
- `healthz` 200.
- **Home shell carries the Organization + WebSite ld+json pair** (`#organization` / `#website`, `inLanguage: "ar"`) — F4 live.
- **PDP shell Product LD carries `category: streaming` + `seller: {Organization, SubNation}`** — F2/F3 live.
- **e2e `seo.spec.ts` against production: 21/21 passed** (7 tests × 3 projects) — the 18 contract runs + the new R166 home-shell structured-data test, which skipped pre-deploy (deploy-race-safe per the R161 idiom) and **passes live**.
- GA4 id still live in the deployed bundle; sitemap 200.

## 6. Deferred (with rationale — for future rounds, not lost)

| Item | Why deferred |
|---|---|
| F11 orders.tsx extract (~180-line row card) | Round-scale structural move; needs its own decomposition pin round (the R136/R137 idiom) |
| F12 order-detail.tsx extracts | Same class as F11 |
| F13 Navbar (876) / NotificationBell (635) decomposition | Layout round |
| F14 hook filename unification (kebab→camel) | 34-file blast radius incl. every `vi.mock` path — dedicated mechanical round |
| F15 network-error copy centralization (10 sites) | Would collide with the error-map file this round (C1 lane owned it); trivial follow-up |
| F17 brand glyph extraction (Telegram ×3, Google ×2) | Low value vs SVG-move churn |
| F18/F19 TopupWaitingModal + auth family co-location | Wide-radius mechanical moves, own lanes |
| B3 catalog tier-price validator wiring | Product decision needed (block vs warn vs UI surface on admin writes) — R162 itself deferred it to "a later round"; documented, not forgotten |
| F16-note `admin/topups.tsx:554/634` dual-form sites | Outside every lane this round; candidate micro-round |

## 7. Owner actions (unchanged in substance, now fully documented where the operator actually looks)

1. **`INDEXNOW_KEY`** in the Coolify env (`openssl rand -hex 16` → set → restart) — now documented in COOLIFY §2.3 + ENVIRONMENT_MATRIX + FINAL_PRODUCTION_ENV + runbook §14. The enrichment-publish ping (§2.3 F1) activates with it.
2. **GSC** sitemap submission + URL inspection (the session has no authenticated session).
3. **The 24 catalog fixes** — the documented admin-UI action (§3).
4. GA4 Realtime spot-check (optional — the bundle proof stands from R165; the id remains live).

## 8. Indexing-activation interaction (the parallel work)

Nothing in this round touches the activation path the owner is running: the key-file route stays gated on `INDEXNOW_KEY` (unset on production at round start — re-verified: `/<key>.txt` still serves the SPA fallback), robots/sitemap shapes unchanged (only the null-slug defensive filter — 0 live URLs affected), GSC untouched. The round only **prepares** for it: the enrichment→IndexNow notify gap closed, home/PDP structured data strengthened — the surfaces the indexing will crawl.
