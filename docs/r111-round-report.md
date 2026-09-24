# R111 Round Report — 2026-09-25

> The biggest round in project history, per the operator's directive: "stronger,
> deeper, more comprehensive, with the largest number of agents, using gstack at
> full power." **16 audit agents** (the R109 record was 22 across a two-round
> arc; this is the largest single-round audit fleet) + **6 fix agents** + the
> main agent as coordinator, harness surgeon, and Wave-B implementer.
> Base: SubNation2 `217de91` (r110) · openwa `d027199` → Final: SubNation2
> `249f744` (9 commits) · openwa `819b98f` (1 commit).

## The infrastructure fight

This round was executed against a hostile workspace: the sandbox reverted to a
stale snapshot **mid-round** (the 4th occurrence — r99/r105/r106 documented the
phenomenon). All 12 first-wave audit reports on disk were lost; every finding
was rebuilt from the agents' final reports into
`docs/inspection-r111/CONSOLIDATED-FINDINGS.md` and **pushed to GitHub within
the hour** — the round's knowledge survived in git from that point on. Agent
infrastructure also failed intermittently (context deadlines, a 200-turn cap, a
400-error burst); every failed scope was retried, trimmed, or absorbed by the
main agent. Nothing was dropped silently.

## Audit results (16 agents — counts by severity)

| Fleet | P0/P1 | P2/High-Med | P3/Low | Verdict |
|---|---|---|---|---|
| B1 auth/session/CSRF/IDOR | 0 | 1 | 4 | IDOR sweep fully clean; one login-CSRF gap |
| B2 injection/validation/SSRF | 0 | 0 | 4+3P4 | SQL/XSS/SSRF all clean; zod bounds → 500s |
| B3 SIM scheduler | 0 | 0 | 2+3INFO | **SIM topology sound** (203/203); Oct-1 resume gap is operational |
| B4 money final | 0 | 0 | 2+3P4 | **No double-charge constructible** (243/243); one dual-approval window |
| B5 WhatsApp contract | 0 | 2 | 5 | Warm-up latch + cold-boot honesty |
| B6 DB performance | 1(op) | 3 | 4 | Neon-killer lease PROVEN live (92.4% of all UPDATEs); catalog LRU self-DoS |
| O1 openwa security | 1 High | 4 Med | 6 Low | Rate-limit evasion ×2880 proven live |
| O2 openwa lifecycle | 0 | 5 | 7+4P4 | Interim-creds shadow = top stuck-state risk |
| T2 FE+openwa test quality | — | — | — | openwa 57% of lines untested (ALL send paths) |
| T3 live data | 0 | 0 | — | ALL money invariants PASS; exactly 4 pending migrations, all non-destructive |
| D2 SEO/structured data | 1 | 2 | 5 | Googlebot was eating share-cards — Product LD invisible to Google |
| F4 frontend perf | 0 | 1 | 5+5P4 | Entry 36.2KB gz; cart re-render storm |
| F1 UX states | 0 | 0 | 4+3P4 | 38/40 matrix cells clean |
| F2 Arabic copy | 0 | 4 | 8+3P4 | Terminology/digit/plural drift ledger |
| F3 accessibility | 0 | 8 | 6 | **Fails WCAG 2.2 AA** (money-path layer) |
| T1 backend test quality | 0 | 0 | 3 | Money core genuinely strong; idempotency middleware had ZERO direct tests |

## Fixes shipped (Wave A + Wave B — all verified)

**openwa (819b98f, 103/103 tests, npm audit 0/0):** rate-limit path
normalization (O1-H1, proven-live ×2880 evasion) · stale-close guard (O2-F4,
credential-wipe path) · interim-creds DB-blob preference (O2-F1, permanent-stuck
on Oracle volumes) · version-fetch 3s timeout (O2-F3) · initializing wedge
(O2-F2) · delete/await-starting race (O1-M1) · boot name validation (O1-M2) ·
SIGTERM flush on a 3s-timeout dedicated client + 10s budget (O2-F5) · 413 for
oversized bodies (O2-F6) · qs/sharp bumps + CI audit gate (O1-M3) · TRUST_PROXY
knob (O1-M4) · devDep + floor hygiene (F11/F13).

**SubNation2 backend:** warm-up re-arm + gateway-boot honesty +
retryable-409 + watch-feed + Arabic-Indic fold (B5-1..6, +25 tests with
regression-validity proof) · Telegram-callback same-origin gate (B1-1) · zod
bounds sweep (B2-F1..F4 — no more 500s on the money path) ·
payment_reference required for mobile_transfer + creation-time
duplicate-receipt guard (B4-R1 — the last wallet-credit inflation window) ·
finance-scope tightening (B1-3) · liveness ownership predicate (B1-4) ·
single-query admin session check (B6-06) · crawler split — indexers get the
SPA, unfurlers get the card (D2-F1 **P1**) · LD availability from
is_available (D2-F2) · share-card WHERE isArchived (D2-F4) · catalog
search-skip + 12MB LRU byte budget (B6-02, two-layer) · login_attempts +
audit_logs retention jobs in the 05:00 slot + boot one-shots (B1-2/B6-05 —
the last two unbounded tables) · render.yaml SAMESITE=none→lax (B1-5).

**SubNation2 frontend:** cart context split (F4-F1, −60-120ms INP on the
money tap) · font-700 preload (−150-350ms LCP) · home-only catalog prefetch ·
WCAG 2.2 AA money-path fixes (F3-01..08: focus ring, keyboard row expansion,
dialog semantics, scroll-padding, light tokens, aria-pressed) · Arabic copy
ledger (unified «إتمام الطلب»/«استرداد»/«رمز التحويل», ٤٠٤→404, plurals,
lang=en spans, actionable error copy) · checkout hydration guard + home
widget skeletons/error rows (F1-G1..G3).

**Test debt (+207 tests total):** the idempotency middleware direct suite
(14 — deleting `EX` from either SET now fails CI) · catalog-cache harness
(8+byte-budget) · wallet money gates (8 — MAX_PENDING was dead under test) ·
loyalty convert journey (7 — the r102 intent-key pinned at last) · +25
whatsapp · +16 openwa hardening · +9 copy/UX · +24 a11y/perf stragglers ·
+27 SEO/bot-split.

## Final verification record (at 249f744)

- Backend: **157 files / 1447 tests / 0 failed** (r110: 1312 → +135)
- Frontend: **92 files / 635 tests / 0 failed** (r110: 579 → +56)
- openwa: **103 tests / 0 failed** (r110: 87 → +16)
- `pnpm run typecheck` exit 0 (all workspaces) · `pnpm run lint` **0 errors /
  85 warnings — exact r110 baseline parity** · `vite build` ✓
- Money integrity re-verified end-to-end by B4 + T3 independently.

## Residuals (documented, deliberate)

- B6-01: the Neon-killer lease heartbeat is fixed in HEAD but **production
  still runs the pre-r104 build** — deploy on renewal day is the fix.
- B6-03: admin list decrypts 600 AES-GCM fields per refresh (needs a
  credentials-on-demand endpoint — next round).
- F3-07: route-change focus management (SPA-level, needs a small router
  hook — next round with F4-F2 entry diet).
- T2 Wave-C: openwa FakeSocket seam + engineSend tests (the 57% coverage
  hole is mapped; the seam design is written in the T2 report).
- B6-07/B6-08: index additions/drops — DDL batches deferred to a migration
  round (live tables are tiny; zero urgency, live-confirmed by T3).
- D2-F3: 37/45 thin SEO descriptions — a data task, queued with the
  enrichment pipeline.

## Operator TODOs (cannot be done from this sandbox)

1. **October 1st (UTC) — Render renewal day:** the auto-resume boots the OLD
   pre-r108 build whose PG-lease refresher burns Neon 24/7 (~720h/mo). Run
   `render_go_live.py` (or the Oracle cutover) the same day. T3 confirmed
   exactly 4 non-destructive migrations await the first r111 boot, with
   V1-M20 **mandatory before the first topup** (the FK would 500 it).
2. TOTP on `ahmadmedo` (r5 flag, still open — sole active admin).
3. The 45-product shelf is empty (0 deliverable stock) — restock before
   traffic resumes; expected alert burst on resume is normal.
4. Decide the 6 unused services' fate before Oct-1 (750h budget math in the
   r106 worklog entry).
5. Record the first restore drill + install the backup crontab (r110 ledger).
