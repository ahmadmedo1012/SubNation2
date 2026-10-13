# R142 Findings Ledger — consolidated & deduplicated

Base: a9f5e83. Sources: 15 audit lanes (findings-{A..O}.md in lanes/) + orchestrator F1.
Severity: P0 critical / P1 core-journey broken / P2 material / P3 meaningful / P4 polish.
Disposition: FIX-R142 (this round) · DEFER (recorded decision + reason) · INFO (no action).

## FINAL STATUS (post-implementation)

All FIX-R142 dispositions above are IMPLEMENTED and verified green
(see lanes/IMPL-wave-report.md). Deferred items carry recorded decisions.
Full gates at the final tree: lint 0 errors/49 warnings (baseline) ·
typecheck green · backend 260 files / 2,458 tests · frontend 247 files /
2,325 tests · production builds + PWA green · boot smoke OK. Coverage
gate: 1,764 tracked files, 0 problems, 137 blobs re-validated post-fix.

## Headline

**Zero P0/P1 across the whole repository.** The production system is structurally
healthy: money invariants M1–M17 all verified in code, auth hardened, boot pipeline
clean, contracts synchronized, migrations sound. The findings below are quality
residuals — the strongest of them are UX-truthfulness, hang-class robustness, and
CI-seam gaps.

## P2 (3)

| ID | Finding | Disposition |
|----|---------|-------------|
| G-1 | loyalty convert POST: raw fetch, no timeout → money CTA can hang forever; retry contract unreachable | FIX-R142 (lane FE: customFetch) |
| J-1/D-5 | destructive confirm buttons ride raw `--destructive` → 4.00:1 AA fail (money confirm + ~13 admin sites) | FIX-R142 (lane FE: variant=destructive, 2 lines) |
| N-1 | orval client drops all 7 spec header params; Idempotency-Key rides untyped RequestInit escape | PARTIAL FIX-R142 (CI header-survival gate + doc; client regen deferred — churn risk) |

## P3 (39 → 36 after dedup)

| ID | Finding | Disposition |
|----|---------|-------------|
| F1 (orch) | GuestHero chips aria-label «ويندوز 10 — متوفر الآن» = brand-level claim from category-level stock | FIX-R142 (lane FE) |
| I-4 | streaming landing copy + hero chip advertise unstocked brands (Shahid VIP, Crunchyroll) — F1-class | FIX-R142 (lane FE) |
| J-3 | product-seo.ts fallback meta claims «متوفر…تسليم فوري» for OOS products — F1-class | FIX-R142 (lane FE) |
| N-4/D-1 | admin settings «التكاملات» TELEGRAM rows permanently «غير موجود» — LIVE UI BUG (raw fetch + wrong type) | FIX-R142 (lane FE) |
| D-3 | admin mutations: raw fetch, no timeout (G-1 class, operator side; adminFetch one-fix) | FIX-R142 (lane FE) |
| C-1 | PDP coupon + support create/reply: raw fetch, no timeout + unguarded r.json() | FIX-R142 (lane FE) |
| G-2 | wallet normalization: render-time key capture sends pre-normalization Idempotency-Key | FIX-R142 (lane FE: per-call key idiom) |
| G-3 | checkout mount re-quote can remove a RE-ADDED line (stale-closure) | FIX-R142 (lane FE: line-identity guard) |
| J-2 | ring-offset without ring-offset-background → 1px white halo on keyboard focus (dark) | FIX-R142 (lane FE) |
| B-3 | ErrorBoundary Sentry import has no .catch (unhandledrejection on crash screen) | FIX-R142 (lane FE: 1 line) |
| D-2 | failed order-credentials fetch sticky forever; toast tells operator to retry a no-op | FIX-R142 (lane FE) |
| I-1 | multi-word Arabic phrases break («اشتراك شات جي بي تي» → 0) | FIX-R142 (lane BE: token-window lookup) |
| I-2 | duration modifiers match zero live rows (durations live in variant labels) | FIX-R142 (lane BE: EXISTS branch) |
| I-3 | search ships edge-cache headers (B6-02 holds only in-process) | FIX-R142 (lane BE: 1 line + pin) |
| E-1 | copilot preview single-use = check-then-act; concurrent double-confirm double-executes | FIX-R142 (lane BE: conditional claim) |
| K-1 | shell title clamp = raw char cut vs claimed word-boundary mirror; live shards on 2 money pages | FIX-R142 (lane BE: copy clamp) |
| K-2 | no og:url/og:type rewrite arms; non-home shells self-contradict | FIX-R142 (lane BE) |
| B-1 | GSC injector PRIMARY anchor not comment-aware (R141 class residual) | FIX-R142 (lane BE) |
| L-3 | whatsapp-otp-prune + copilot-reaper fail log-only on their only recurring trigger | FIX-R142 (lane BE: captureSchedulerFailure) |
| L-2 | fireThrottledMaintenance: unbounded inFlight guard can silently disable a job | FIX-R142 (lane BE: bound + reset) |
| B-2/M-1 | bundle-budget gate scans RAW HTML incl. comments (found independently by 2 lanes) | FIX-R142 (lane BUILD: comment-strip) |
| M-2 | no push-time runtime boot guard (R141 shipped through green CI via this seam) | FIX-R142 (lane BUILD: boot smoke step) |
| F-2 | test/db.ts third-copy drift (6 spots) + no sequential chain-apply test | FIX-R142 (lane BE: harness corrections; chain test if small) |
| H-1 | no horizontal-authz regression tests on 4 money-read surfaces | FIX-R142 (lane BE: 4 pglite tests) |
| K-3 | SHELL_NOINDEX_RES unpinned for 7/15 route families | FIX-R142 (lane BE: extend it.each) |
| L-1 | telegram dispatch retry pipeline: zero failing tests | FIX-R142 (lane BE: 1 test file) |
| J-4 | button.tsx zero a11y behavior tests | FIX-R142 (lane FE: 1 test file) |
| O-1 | architecture docs: migration chain 10 stages / 8 files behind reality | FIX-R142 (lane DOCS) |
| O-2 | rollback runbook self-contradiction (Actions state) | FIX-R142 (lane DOCS) |
| O-4 | 3 docs claim Telegram-ops/Sentry env «absent» — both live since R121 | FIX-R142 (lane DOCS) |
| N-2 | spec omits idempotency contract on 2 user money mutations | DEFER (spec churn → regen risk; N-1 gate documents the contract meanwhile) |
| N-3 | /admin/pricing/calculate bare-object response → double cast | DEFER (spec churn; page-local type works today) |
| N-5 | GET /notifications dual-shape; spec documents only array arm | DEFER (spec churn; page bypass documented) |
| A-2/M-3 | coverage thresholds promised R137, never landed | DEFER (recorded decision: hard thresholds need a measured baseline first; report-only stays) |
| F-1 | runMigrations body never executed by any test | DEFER-ATTEMPT (lane BE tries minimal client.exec chain test; defer if it balloons) |

## P4 (45 — one-liners get fixed opportunistically by their lane; the rest recorded as debt)

Fixed this round where ≤3 lines & zero-risk: A-3 (CHANGELOG SHAs), A-5 (env.example
gaps), A-6 (rg guard), A-7 (dead Render fallback), B-4 (favicon prose), C-2
(low-stock dedup), E-2 (body redaction), E-3 (2fa catch-all), E-5 (sessions LIMIT),
F-3 (dead idx creator), G-6 (formatLyd), H-4 (dead ?token= branch), I-5 (empty copy),
K-5 (og prose), O-3 (worst bare-filename refs).
Recorded as debt (documented in lane files): A-1 (validate.ts phantom suite — URL
fix only), A-4 (README counts), C-3/C-4/C-5, D-4/D-6, E-4/E-6/E-7, F-4..F-7,
G-4/G-5, H-2 (BuildKit secret — deploy contract change, operator-visible), H-3
(upstream-blocked CVEs), H-5, I-6/I-7/I-8, J-5/J-6/J-7, K-4/K-6, L-4..L-7,
M-4, N-6..N-10, O-5..O-8.

## Coverage status after Wave A

1,704/1,704 tracked files have a lane assignment and a census disposition.
Deep-read: ~430 files (all lanes' tier-1/2). Structural/census-validated: the
remainder (incl. 205 co-located test files verified structurally + 24 generated
snapshots + 100 binaries). BLOCKED (not yet deep-read, queued for Wave B):
C-17 files (onboarding/terms + 15 lib modules), E-21 files (incl. lib/encryption.ts,
lib/account-link-consent.ts — both carry green suites).
