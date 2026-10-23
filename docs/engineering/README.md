# Engineering — Round Records Index (R142+)

> Status: CURRENT @ 2026-10-22 (R185 — the ponytail full-power lean
> round: the R185 row + folder count 40→**41**; prior status R184 — the
> final organization round: the R184 row + folder count 39→**40**; the
> R183 round-index truth pass: the four missing rows added (R177–R180),
> the folder count corrected 36→38→39, the header and rows re-synced to
> the shipped state). The ENGINEERING bucket: the working
> records of the R142+ rounds. The round **ledger** is
> [`CHANGELOG.md`](../../CHANGELOG.md) (one entry per round, newest first —
> the authoritative summary of every round); the folders below hold the
> **evidence** (round-close reports, ADRs, findings ledgers, lane
> records). Pre-R142 inspection evidence lives in the HISTORY bucket:
> `docs/history/inspection-r###/` (the r94–r130 + r134 archives, moved
> there by the R122/R135 sweeps — dated records, append-only).

## The round index

**41 folders covering the R142→R185 span** (R155/R159/R180 have no
folder — see the gaps section; R177–R179's docs commits never touched
this index, their rows added by R183). Newest first, matching the CHANGELOG's
order; each row links the round's primary record and names the CHANGELOG entry
(`## Round R###` header) that summarizes it.

| Round | Date | Title (from the CHANGELOG entry) | Folder contents (measured shape) |
|---|---|---|---|
| R185 | 2026-10-22 | The ponytail full-power lean round (the dead-surface harvest — the audit ladder run end-to-end over all 691 non-test source files: the orphaned `ui/switch` component + its own test deleted, the dead test hook + the dead `resumeAlerting` API deleted, 21 dead exports un-exported across 10 files, the orphaned @radix-ui/react-switch dependency removed, −98 lines + −46 lockfile lines, zero behavior change by construction) | [`round-close.md`](./R185/round-close.md) |
| R184 | 2026-10-22 | The final organization round (the R183 review's F4 teardown gap closed for every `admin-*` query root; the README/state re-stamped to the live truth — the retired payment_reference wording, the R165-frozen counts, the R163-era rounds list; the owner's Arabic study guide `docs/PROJECT_GUIDE.html`) | [`round-close.md`](./R184/round-close.md) |
| R183 | 2026-10-22 | The precision & truth round (the money-contract truth pass — M3's retirement recorded; the nine-family guard-surface sweep; the latent scope gates + the 401-expiry scope reset; four money behavioral pins with two real latent defects closed; the R172–R182 docs-truth reconciliation) | [`round-close.md`](./R183/round-close.md) |
| R182 | 2026-10-22 | The whole-product reliability & operational-truth round (the Firecrawl runtime finding classified honestly — not reproducible; the purchasable-floor catalog truth; the enrichment status diagnostic contract; the admin scope-blind 403s + 7 storefront a11y residuals closed; 5,445 tests; **shipped green** — the PAT landed in-session: push fast-forward, CI 7/7, Coolify rotation + all probes green, ship record `72e287b7`) | [`round-close.md`](./R182/round-close.md) |
| R181 | 2026-10-21 | The permanent feature-removal round (AI Admin Copilot + admin calculator — deleted across UI/API/DB/generated contracts, V1-M36 + chain 0027, the LLM transport relocated for enrichment, the real pricing system preserved and regression-pinned) | [`round-close.md`](./R181/round-close.md) |
| R180 | 2026-10-21 | The frontend toolchain modernization round (vite 8 + Oxc/Rolldown, vitest 5, jsdom 30, jest-dom 7, the codeSplitting priority ladder) | **no folder — CHANGELOG-only** (the round shipped feat-only via `10b3e0ee`; retroactive entry recorded by R183) |
| R179 | 2026-10-21 | The deprecated-registry retirement + the upstream-unfixable ledger (prom-client → @prometheus-io/client executed, reversing the R169 adjudication; the 4-finding floor; react 19.3.1 rejected with numbers) | [`round-close.md`](./R179/round-close.md) |
| R178 | 2026-10-21 | The theme-adaptive transparent art round (the two-family contract `/products/*.webp` transparent + `/products-og/*.webp` opaque; the measured polarity block; three defective R176 tiles fixed) | [`round-close.md`](./R178/round-close.md) |
| R177 | 2026-10-20 | The customer-experience perfection round (12 verified findings: the PDP `/me`-failure money fabrication, the 640–1024px coupon desert, the twin-drift class, money-honesty completion `-0`/non-finite/12 retired `?? 0` coercions, the de-hardcoded guest referral policy) | [`round-close.md`](./R177/round-close.md) |
| R176 | 2026-10-20 | The real-source art round (the brands' official logos replace the AI families — pearl/charcoal system, 9.5 KB avg, zero AI) | [`round-close.md`](./R176/round-close.md) |
| R175 | 2026-10-20 | The product-art attraction round (the cinematic showcase family, pipeline committed, motion 14.4.0) | [`round-close.md`](./R175/round-close.md) |
| R174 | 2026-10-20 | The product-art excellence round (45 regenerated 1024² tiles + the freshness contract) | [`round-close.md`](./R174/round-close.md) |
| R173 | 2026-10-20 | The final comprehensive inspection, purification & perfection sweep (audit 10 → 4 at the no-fix floor, pg 8.23.1, argon2 aligned) | [`round-close.md`](./R173/round-close.md) |
| R172 | 2026-10-19 | The final modernization sweep (zod 4, pino 10, redis 6, recharts 3, web-vitals 6, PWA 2, lucide 1) | [`round-close.md`](./R172/round-close.md) |
| R171 | 2026-10-19 | The deployment-mechanism discovery + the dispatch-sequencing law | [`round-close.md`](./R171/round-close.md) |
| R170 | 2026-10-19 | The e2e heartbeat + secret-scan restoration round | [`round-close.md`](./R170/round-close.md) |
| R169 | 2026-10-19 | The comprehensive health round (dependency modernization, CVE sweep, lint-zero, e2e restoration) | [`round-close.md`](./R169/round-close.md) |
| R168 | 2026-10-19 | The measurable-growth round (GA4 ecommerce funnel, catalog-truth tooling, conversion honesty) | [`round-close.md`](./R168/round-close.md) |
| R167 | 2026-10-18 | The deeper structural round (the R166 deferred backlog closed) | [`round-close.md`](./R167/round-close.md) |
| R166 | 2026-10-18 | The comprehensive improvement & organization round | [`round-close.md`](./R166/round-close.md) |
| R165 | 2026-10-18 | The multi-order money lane (the R162 ADR, implemented) | [`round-close.md`](./R165/round-close.md) |
| R164 | 2026-10-18 | The Google Analytics activation round | [`round-close.md`](./R164/round-close.md) |
| R163 | 2026-10-18 | The end-to-end SEO & search-visibility completion round | [`round-close.md`](./R163/round-close.md) |
| R162 | 2026-10-18 | The catalog-truth, SEO-integrity & e2e-reliability round | [`round-close.md`](./R162/round-close.md) + [`adr-order-batch.md`](./R162/adr-order-batch.md) + 5 verification docs ([authed-responsive](./R162/authed-responsive-verification.md) · [catalog-content-review](./R162/catalog-content-review.md) · [commercial-truth-verification](./R162/commercial-truth-verification.md) · [e2e-heartbeat-verification](./R162/e2e-heartbeat-verification.md) · [seo-source-review](./R162/seo-source-review.md)) |
| R161 | 2026-10-18 | The Arabic-first discovery & semantic localization round | [`round-close.md`](./R161/round-close.md) |
| R160 | 2026-10-17 | The funnel-integrity & affordance round | [`round-close.md`](./R160/round-close.md) |
| R159 | 2026-10-17 | The ledger-closure round | **no folder — CHANGELOG-only** (retroactive entry) |
| R158 | 2026-10-17 | The organization & precision round | [`round-close.md`](./R158/round-close.md) |
| R157 | 2026-10-17 | The visual & experience excellence round | [`round-close.md`](./R157/round-close.md) |
| R156 | 2026-10-17 | The Telegram OIDC production login fix | [`round-close.md`](./R156/round-close.md) |
| R155 | 2026-10-17 | The Telegram OIDC production-failure diagnosability round | **no folder — CHANGELOG-only** |
| R154 | 2026-10-17 | Wallet transfer correction, Telegram OIDC, provider-aware identity & notification gaps | [`round-close.md`](./R154/round-close.md) |
| R153 | 2026-10-17 | Telegram approval recovery + notification excellence | [`round-close.md`](./R153/round-close.md) |
| R152 | 2026-10-16 | Type-safety unification + lint-debt retirement | [`round-close.md`](./R152/round-close.md) |
| R151 | 2026-10-16 | Customer-journey parity + operational visibility + the independent close-out | [`round-close.md`](./R151/round-close.md) |
| R150 | 2026-10-15 | WhatsApp OTP reliability completion + the Cloud API decommission | [`round-close.md`](./R150/round-close.md) |
| R149 | 2026-10-15 | WhatsApp delivery engineering: the retry-contract fix + the transport decision | [`round-close.md`](./R149/round-close.md) |
| R148 | 2026-10-15 | Exposure self-verification + Embronic Phase A honesty + the error-copy closure | [`round-close.md`](./R148/round-close.md) |
| R147 | 2026-10-15 | The honest-availability round | [`round-close.md`](./R147/round-close.md) |
| R146 | 2026-10-14 | The ponytail round: the whole repo audited by the lazy-senior-dev method, 23 should-fix defects closed, five duplication families consolidated | [`round-close.md`](./R146/round-close.md) + 6 `audit-*.md` + 7 `fix-notes-*.md` + `review-r146.md` |
| R145 | 2026-10-14 | The visual transformation round | [`defect-map.md`](./R145/defect-map.md) (pre-convention shape — no round-close) |
| R144 | 2026-10-14 | The reconciliation round: the migrate.ts monolith decomposed, every R143 open item closed or honestly handed off | [`findings-ledger.md`](./R144/findings-ledger.md) (pre-convention shape — no round-close) |
| R143 | 2026-10-14 | The evidence-driven hardening round: 18 lanes, the mirror-chain SQL fix, the deep-link head-start | `findings-L1..L18.md` + [`findings-ledger.md`](./R143/findings-ledger.md) + [`impl-D.md`](./R143/impl-D.md) (pre-convention shape — no round-close) |
| R142 | 2026-10-14 | Full-repository engineering assurance round | [`findings-ledger.md`](./R142/findings-ledger.md) + `lanes/` (A–I lane coverage/inventory `.jsonl` records) + `coverage-manifest.jsonl` (pre-convention shape — no round-close) |

## Conventions and known gaps

- **`round-close.md` is the round-record convention since R146.** Every
  R146+ folder carries exactly one; it is the report the CHANGELOG entry
  links to. **R142–R145 predate the convention** and carry their era's
  shape instead: R142 = findings ledger + per-lane `.jsonl` evidence,
  R143 = per-lane findings files (`findings-L1..L18.md`) + an impl-lane
  record, R144 = findings ledger, R145 = defect map. Those are records,
  not gaps to backfill — no fabricated round-closes.
- **R155, R159, and R180 have no folders.** R155 (the Telegram OIDC
  production-failure diagnosability round) shipped its evidence inside
  the CHANGELOG entry itself; R159 (the ledger-closure round) is
  explicitly marked a **retroactive entry** — the R158 deferrals closed
  or verdict-confirmed, ledgered after the fact; R180 (the toolchain
  modernization) shipped feat-only via `10b3e0ee` — its docs commit
  never landed, so the R183-recorded retroactive CHANGELOG entry is its
  record (the same gap class as R177's missing CHANGELOG entry, also
  closed by R183). The CHANGELOG entries are the records; no history
  fabrication.
- **Pre-R142 rounds:** the inspection-era evidence (r94–r130 + r134) is
  archived under `docs/history/inspection-r###/` (15 directories — see
  [`docs/history/README.md`](../history/README.md), the move map).
  Rounds R131–R141 predate the engineering-folder convention entirely —
  their CHANGELOG entries are the record.
- **Do not move these folders to `docs/history/`** — 60+
  CHANGELOG→round-close links point here. This index (added R166) is the
  navigation surface the area was missing; archiving, if ever wanted, is
  a separate docs round with link repointing (the R135 sweep is the
  template).
- Dated records keep their original citations (append-only posture);
  corrections land as bracketed notes in the current round — never
  rewrites, never deletions.

Current index: [`docs/README.md`](../README.md).
