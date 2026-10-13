# Lane O — Documentation Truth Audit (R142)

Task ID: 142-O1 · read-only audit @ `a9f5e83` · charter: **docs truth lane** — still-relevant claims
in the 232-file docs inventory (~38.6K lines: `docs/history/**` 166 · `docs/deprecated/**` 17 ·
`docs/deployment/**` 10 · `docs/operations/**` 8 · `docs/architecture/**` 2 · project-graph/state/plan/loyalty/pricing/pending/ux/root docs).
Root docs are lane A's (cross-referenced, not re-audited). `docs/FINAL_MONEY_INVARIANTS.md` is lane
G's (cross-ref only). Zero source edits.

**Method:** Tier 1 = full reads of every deployment/operations/architecture/DR/UX doc + the docs
index + project-state records (47 deep-read records). Tier 2 = binding-claim scans
(PERMANENT/INVARIANT/LAW/FOREVER/ban/standing-order markers) over all 166 history files, with the
25 strongest claims sample-verified in code (plus money M1–M17 cross-ref lane G, UX tokens
cross-ref lane J). Tier 3 = structural: deprecated banners, inbound-link/orphan census, bucket
arithmetic. Historical reports describing PAST state were not flagged — only claims presenting
themselves as current truth.

**Verdict up front:** this docs tree is unusually honest — dated banners, LEGACY markers,
"live wins" reconciliation ledgers, and 37/37 spot-verified operational references. The rot is
concentrated in exactly four places: (1) the two CURRENT architecture docs' migration-chain rows
are 10 boot-stages / 8 drizzle files behind the code; (2) the rollback runbook contradicts itself
on GitHub Actions state; (3) 21+ references to R122-moved docs still use bare filenames — worst
case the rollback runbook pointing at `RENDER_LEGACY_FALLBACK.md` which now lives in
`docs/history/`; (4) a three-doc family still describes Telegram-ops/Sentry env as "absent/off"
when they went LIVE at R121-B/R121. No P0/P1. 4×P3, 4×P4. All fixes are 1–3 line doc edits.

---

## Findings (ranked)

### O-1 · P3 · The two CURRENT architecture docs state a migration chain that is 10 stages / 8 mirror files behind the code

- **Where (doc):** `docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md:79-84` (§3 data path:
  "boot reconciler V1-M6…V1-M23; drizzle mirror chain **0015 applied live — 0016 (R118) has
  landed**, in merge `966d70f`") · `docs/architecture/PRODUCTION_ARCHITECTURE.md:146-158` (§3:
  "labeled stages **V1-M6 … V1-M23 — the current chain**" / "Drizzle chain … **0000–0015** …
  0015 … are the latest re-emits") · `docs/project-graph/02-runtime.mmd:8`
  ("V1-M9..M23 reconcile stages").
- **Reality (code, verified this round):** `backend/src/migrate.ts` (4,368 lines) carries stages
  **V1-M6…V1-M34** (28 stages — M24 R120-B6, M25–M30 R123, M34 R135 confirmed by the progress
  log's own R123/R135 entries); `shared/db/drizzle/` holds **0000–0023** (24 files). Lane G's
  M15 row independently locates the V1-M25/M26/M28/M29 blocks at `migrate.ts:1490-1837`.
- **Why it matters:** TOPOLOGY is the declared "single-page architecture truth" and both docs are
  stamped CURRENT in the docs index; a rollback officer reading §3 would believe the schema
  surface is 10 stages narrower than it is (the §4 same-migration-state gate in the rollback
  runbook leans on knowing this surface). House rule #4 ("the change that invalidates a CURRENT
  doc must touch its status line") was violated by the R120/R123/R135 schema waves.
- **Minimal fix:** one line each: TOPOLOGY §3 → "boot reconciler V1-M6…V1-M34; drizzle mirror
  0000–0023"; PRODUCTION_ARCHITECTURE §3 → same two numbers; 02-runtime.mmd → "V1-M9..M34".
- **If skipped:** every future migration round re-flags this; an operator sizing a rollback
  window from the topology doc under-counts the schema delta.

### O-2 · P3 · The rollback runbook contradicts itself on GitHub Actions state — §2's "currently disabled" is stale

- **Where (doc):** `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md:36-39` (§1 gate: "the repo is
  public and **Actions runs on every push since R119** — the R115-era 'Actions disabled
  (billing)' state is history") **vs** `:72-75` (§2: "SubNation2's workflow is manual-dispatch /
  v*-tag only (metered minutes) **AND Actions is currently disabled** — NO subnation2 GHCR image
  exists for any commit") · same stale clause at `docs/deployment/COOLIFY_FINAL_SETUP.md:147-152`
  ("PENDING (r113): … **GitHub Actions is currently billing-suspended**").
- **Reality (code/config, verified):** `.github/workflows/ci.yml:8-11` — `push: branches:
  [main]` + PR triggers: Actions **is live on every push** (§1 is right, §2 is wrong).
  `.github/workflows/docker.yml:46-58` carries the honest, current STATUS banner: manual/tag-only
  triggers, "**NO completed publish is on record**", an anonymous 2026-10-09 registry probe
  "could neither confirm nor deny the package (403 … private-or-absent)", operator step = dispatch
  once before relying on §2's image path.
- **Case:** an incident officer reads §2, concludes the CI-green gate can't exist either (it does
  — §1 sends them to it) and that the GHCR fallback is impossible "because Actions is disabled"
  (wrong reason; right conclusion — the fallback is unavailable because the workflow was never
  dispatched).
- **Minimal fix:** in both docs replace "Actions is currently disabled / billing-suspended" with
  the docker.yml STATUS framing: "Actions is live on push (R119+); the docker publisher is
  dispatch/tag-only and has never completed a publish — verify GHCR after one dispatch
  (docker.yml STATUS)". Actionable content unchanged; the false premise removed.
- **If skipped:** the doc keeps teaching a wrong infra fact that a future round will have to
  re-litigate (this exact contradiction already survived one truth pass).

### O-3 · P3 · 21+ references to R122-moved docs still use bare filenames — including the rollback runbook's pointer to `RENDER_LEGACY_FALLBACK.md` (now in `docs/history/`)

- **Where (doc), by target:**
  - `RENDER_LEGACY_FALLBACK.md` — `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md:7` (listed as a
    "Companion" as if co-located) and `:90` ("Truth + options: `RENDER_LEGACY_FALLBACK.md` §2")
    — the file lives at `docs/history/RENDER_LEGACY_FALLBACK.md` (moved R122; the R135 sweep
    never repointed these two).
  - `MIGRATION_RUNBOOK.md` (now `docs/deprecated/`) — 7 bare sites:
    `COOLIFY_FINAL_SETUP.md:226,261`, `FINAL_ROLLBACK_RUNBOOK.md:174`,
    `CLOUDFLARE_FINAL_CUTOVER.md:16,93,133`, `CONTABO_COOLIFY_OPERATIONS.md:80`.
  - `ORACLE_FINAL_SETUP.md` (now `docs/deprecated/`) — 11 bare sites:
    `DISASTER_RECOVERY.md:146,195`, `COOLIFY_FINAL_SETUP.md:18`, `FINAL_ROLLBACK_RUNBOOK.md:214`,
    `CLOUDFLARE_FINAL_CUTOVER.md:15,42`, `FINAL_PRODUCTION_TOPOLOGY.md:53,117,139,152`,
    `PRODUCTION_ARCHITECTURE.md:39`.
  - `COOLIFY_ORACLE_MIGRATION.md` (now `docs/deprecated/`) — 1 bare site:
    `DISASTER_RECOVERY.md:216`.
- **Case:** mid-incident (DNS rollback §3), the officer is told "Truth + options:
  RENDER_LEGACY_FALLBACK.md §2" — a filename search inside `docs/deployment/` returns nothing;
  the file is two buckets away under a different root with an ARCHIVED banner. Same shape for
  every ORACLE/MIGRATION §-pointer above. Contrast: `FINAL_COMMAND_BOOK.md:54` and
  `FINAL_MONITORING.md:5` already carry the correct `docs/deprecated/` prefix — the R135
  repoint was simply partial (it covered CHANGELOG/progress-log/runbook/READMEs/PERFORMANCE/
  OPERATOR_ACTIONS only).
- **Minimal fix:** one mechanical commit prefixing all ~21 sites with `docs/deprecated/` (or
  `docs/history/` for RENDER_LEGACY_FALLBACK). No prose changes needed — the "Oracle-era guide,
  adapt" framing around them is already honest.
- **If skipped:** the repo's own R135 posture ("live surfaces repointed at the new homes") is
  only half-true, and every incident-time doc chase pays the search tax.

### O-4 · P3 · Three docs still claim Telegram-ops env and Sentry DSN are "absent/off" — both went LIVE at R121/R121-B (2026-10-07)

- **Where (doc):** `docs/project-state/external-integrations-final.md:34` ("Sentry … **Off
  (never had values)**") and its Telegram row (`:126` "Optional: … Sentry DSNs, Telegram
  alert-bot pair") · `docs/project-graph/11-environment-secrets.mmd` (TG + SENTRY nodes under
  "**Absent today** = feature off") · `docs/project-graph/10-external-integrations.mmd`
  ("Telegram … **alert bot env unset** = degraded channel · approval webhook disabled (env
  unset)" / "Sentry — SENTRY_DSN + VITE_SENTRY_DSN unset"). All three are dated 2026-10-05
  (pre-R121) but sit in the CURRENT bucket per the docs index.
- **Contradicted by (current truth, four surfaces):** `docs/project-state/source-of-truth.md:25`
  (Monitoring row: "**Sentry LIVE both sides since R121-B** … **Telegram ops channel LIVE since
  R121**") · `OPERATIONS_RUNBOOK.md` §11 ("Sentry — … LIVE since R121-B, 2026-10-07") + §12
  ("Telegram ops channel — … LIVE since R121") · `docs/README.md` header (same two LIVE stamps).
- **Case:** an operator following external-integrations-final's "Operator-only actions
  remaining" list re-supplies a Telegram pair that is already configured (harmless but
  confusing), or — worse — "cleans up" the `TELEGRAM_*` env vars believing they're unused,
  which source-of-truth's own Caution row says kills ops alerts + topup approvals.
- **Minimal fix:** one R121-B banner/row-correction in each of the three docs (Sentry row →
  "LIVE since R121-B"; Telegram rows → "LIVE since R121"; keep GA/GSC/Firebase-service-account
  rows — those are still honestly unset). House rule #4 demands exactly this touch.
- **If skipped:** the repo's designated "integrations status record" teaches the opposite of the
  live state for its two most operationally-loaded integrations.

### O-5 · P4 · project-graph internal contradictions: app id, VM shape, Coolify port

- **Where (doc):** `docs/project-graph/00-system-overview.mmd` says "Coolify app uuid
  kjxqu3ytcnwb1btmlw56la5r (**applicationId=2** 'subnation')" — `source-of-truth.md:12` says the
  same uuid is **applicationId 3** (id 2 was the deleted pre-Wave-1 dockerimage app). Same map
  asserts the VM is "(x86_64, **4c/8G**)" while `CONTABO_COOLIFY_OPERATIONS.md:23-25` and
  `FINAL_PRODUCTION_TOPOLOGY.md:170-173` both say the **VM shape is unknown to the repo**
  ("record it here when known") and `PRODUCTION_ARCHITECTURE.md` §6 still budgets a "12 GB
  envelope" (Oracle-design-era). `docs/project-graph/12-source-of-truth.mmd` puts Coolify at
  "**169.58.100.161:8000**" while `FINAL_PRODUCTION_TOPOLOGY.md:101` says port 8000 is
  **TEMPORARY** — "Coolify first-boot wizard — closed in both layers after setup".
- **Case:** three CURRENT docs give three different answers to "what VM are we on" (4c/8G /
  unknown / 12 GB design), two different answers to the app id, and the truth map sends readers
  to a dashboard port the topology doc says is closed. None is deployment-breaking; all are
  exactly the class the "if this map drifts, live wins" headers exist for.
- **Minimal fix:** id → 3 (follow source-of-truth, the designated authority); either delete the
  4c/8G claim or land it in the two "unknown" docs as the recorded shape (one of them must
  move); drop `:8000` or footnote it as the install-time wizard port.

### O-6 · P4 · LOGGING doc's OTP-logger claim drifted: "exactly two logger calls (lines 304 and 596)"

- **Where (doc):** `docs/operations/LOGGING_AND_RETENTION_FINAL.md:47-51` — "whatsapp-otp.service.ts
  has exactly two logger calls (lines 304 and 596)".
- **Reality (code, verified):** the file now has **4** logger sites (`:357` daily-cap error,
  `:508` insert-retry warn, `:796` auth-activity warn, plus the block at `:347`'s announcement
  path) — lines and count drifted since the ef3d0c3 re-verify. **The safety property still
  HOLDS:** every site was read this round; all carry only category/error/cap fields — the OTP
  code is never passed to any log call (hash-only storage stands).
- **Minimal fix:** reword to "a handful of warn/error logger calls (see the file); none carries
  the code" or re-stamp the count+lines. One sentence.

### O-7 · P4 · OTP_HMAC_KEY guidance contradiction between the two env-authority docs

- **Where (doc):** `docs/deployment/ENVIRONMENT_MATRIX.md:52` ("explicit key recommended in
  prod") **vs** `docs/deployment/FINAL_PRODUCTION_ENV.md:80` ("Leave unset (derivation is the
  default)") and `SECRET_HANDLING_FINAL.md:26` ("Default derives from SESSION_SECRET — leave
  unset"). `config/env.example:563` is neutral ("`>=32 chars; default derives`").
- **Case:** an operator preparing the env can't tell which authority wins; the newer, more
  thoroughly reconciled doc (FINAL_PRODUCTION_ENV, re-verified R115/R118-A7) says leave-unset,
  and SECRET_HANDLING agrees. ENVIRONMENT_MATRIX is the r108-era straggler.
- **Minimal fix:** change the one matrix cell to "unset = derives from SESSION_SECRET; explicit
  override supported" (matches code at `whatsapp-otp.service.ts:63`).

### O-8 · P4 · Eight project-graph maps are strict orphans (referenced nowhere by name) — and one of them carries the O-1 stale stage range

- **Where (doc):** orphan census (below) shows `02-runtime, 04-data-model, 05-authentication,
  06-commerce-flow, 07-whatsapp-flow, 08-provider-flow, 09-admin-capabilities,
  10-external-integrations` (.mmd) are each referenced by **zero** files anywhere in the repo —
  not by the docs index (which only names 00/03/12), not by code, not by other docs. They are
  only reachable by browsing the directory. `02-runtime.mmd` carries the O-1 stale
  "V1-M9..M23" range; `10-external-integrations.mmd` carries the O-4 stale Telegram/Sentry
  "unset" claims; `06/08` carry Wave-0 stock figures ("45 live, 3 available" / "6 available
  units / 13 total") superseded by the OPERATOR_ACTIONS header.
- **REPORT ONLY (no moves — charter):** candidates for the deprecated/ graveyard **after** the
  O-1/O-4 content fixes, or for a one-line "see 03/00/12 for the live chain" header each. The
  series 00–12 gives them implicit context, so deleting the stale trio (02/10/11 have
  superseding truth elsewhere) is the leaner option if the operator prefers.

---

## Invariant claims census (binding claims found in history/ + CURRENT docs; sample-verified)

| # | Claim (round/source) | Doc location | Code location | Status |
|---|---|---|---|---|
| 1–17 | Money M1–M17 (single-tx checkout, topup atomicity/dedup, M3 payment_reference, M9 non-negative, M10 frozen price, M11 single-writer inventory, M16 events-after-commit, M17 one LYD idiom) | `docs/FINAL_MONEY_INVARIANTS.md` (lane G's) | `topup.service.ts`, `checkout.service.ts`, `routes/wallet.ts`, `refund.service.ts`, … | **HOLDS** — all 17 VERIFIED by lane G at HEAD (M17 one P4 residual G-6); cross-ref only this round |
| 18 | Tag-sequence ban — no comment in index.html may contain a literal head open/close tag sequence (R141) | history: R141 record; enforced comment in `index.html` | `frontend/src/lib/__tests__/shell-head-anchors.test.ts:224-236` ("enforces it forever" gate, runs in push CI) | **HOLDS** (verified: ban test + live-anchor test both present) |
| 19 | 11px Arabic readability floor — no sub-11px text (R120-B1) | `docs/ux/FINAL_UX_SYSTEM.md:34-38` | `index.css` `--text-2xs/--text-3xs = 11px`; sole sanctioned exception recharts `fontSize:10` | **HOLDS** (lane J token table) |
| 20 | Loaded font weights only 400/600/700 — `font-medium`/`font-black` banned | `docs/ux/FINAL_UX_SYSTEM.md:34` | grep: zero `font-medium`/`font-black` in `frontend/src` | **HOLDS** (lane J) |
| 21 | z-layer registry 10/30/40/45/50/60/100 — inline zIndex must map, never invent | `docs/ux/FINAL_UX_SYSTEM.md:46-52` | census honored; sole undocumented literal z-999 scoped inside forced z-0 context (`index.css:1059-1071`) | **HOLDS** (one contained exception, lane J) |
| 22 | min-h-11 (44px) storefront tap floor; admin edge ≥24px | `docs/ux/FINAL_UX_SYSTEM.md:107` | `.touch-target` + `min-h-11` sites | **HOLDS** with one money-path admin violation (J-1 `RejectModal.tsx:95` h-9) — code-side finding, doc truthful |
| 23 | No gradient text / heavy GPU filters (r1xx visual family "closed") | `docs/ux/FINAL_UX_SYSTEM.md:45` | `.text-gradient`/`.cta-glow` deleted (comments only, `index.css:812/905`) | **HOLDS** (lane J) |
| 24 | Single-writer inventory: set-count only decreases; copilot delta>0 refused; NO tool adds stock | `docs/operations/FINAL_INVENTORY_LOADING.md:72-82` | `admin-direct.ts:586-593` (delta>0 refused, ≤-1000 cap); `admin/products.ts:560+` (surplus-only delete); read tools stock-readonly | **HOLDS** (verified) |
| 25 | One-gateway-per-credential — never two openwa on one WhatsApp session; stop old before new | `FINAL_ROLLBACK_RUNBOOK.md:11-24` (§0) | documented rule (runtime lives in the separate openwa repo — repo-side verification = the rule + `WHATSAPP_OTP_*` single-session config) | **HOLDS** (documented; binding) |
| 26 | SINGLE_INSTANCE_MODE ⇒ exactly ONE replica (double-run law) | `NEON_IDLE_ECONOMICS.md:73-83`; ENVIRONMENT_MATRIX row | `web-scheduler.ts:133,301-315,333-341` synthetic in-process leadership verified; preflight §C | **HOLDS** (verified) |
| 27 | No keep-alive / self-ping traffic — ever | `FINAL_MONITORING.md:110-126` | `jobs/cron.ts:257` grave marker (job 8 deleted) | **HOLDS** (verified) |
| 28 | Neon never rolls back; never two origins live for one Host; never restore over production | `FINAL_ROLLBACK_RUNBOOK.md:100-105,§6`; `CLOUDFLARE_FINAL_CUTOVER.md:141-146`; `FINAL_RESTORE_DRILL.md:8-20` | policy + `restore-drill-check.sh:36-44` name-guard (exit 64 unless drill/scratch/restore/test) | **HOLDS** (guard verified to exist) |
| 29 | Rollback floors: never pre-r108 (V1-M20 FK drop is a live-DB fact); never pre-R115 (V1-M21/M22); `6caa63b`/`3a2e2e1` never targets | `FINAL_ROLLBACK_RUNBOOK.md:114-167` (§4) | `migrate.ts` V1-M20 stage (G's M12) + R115 stages present | **HOLDS** (dated floors, code stages verified) |
| 30 | VITE_API_BASE_URL / VITE_SOCKET_URL / VITE_API_URL stay EMPTY (single-origin contract) | `FINAL_PRODUCTION_ENV.md:177-179` (hard rule 5) | `frontend/src/lib/api-config.ts:19-25` (empty → relative/same-origin) | **HOLDS** (verified) |
| 31 | Secret shape/equality laws: ENCRYPTION_KEY 64-hex; OPENWA_API_KEY == WHATSAPP_OTP_API_KEY (the one parity); family pairwise distinct | `FINAL_PRODUCTION_ENV.md:169-183` (§9) | `lib/encryption.ts:23-25,141-152` boot asserts; `validate-production-env.ts` | **HOLDS** (verified) |
| 32 | Northflank fully rolled back — never to return (standing order) | `PRODUCTION_ARCHITECTURE.md:233-234` | grep: zero northflank refs in code | **HOLDS** (policy) |
| 33 | Agent never modifies the admin account/TOTP state; agent never modifies inventory; WhatsApp/OpenWA session logic untouched (standing orders) | `FINAL_ADMIN_TOTP_SETUP.md:130-132`; `FINAL_INVENTORY_LOADING.md:159-160`; history round reports | policy — respected by all R142 lanes (worklog records) | **HOLDS** (policy, honored) |
| 34 | OTP codes never logged (hash-only storage) | `LOGGING_AND_RETENTION_FINAL.md:46-51` | 4 logger sites read this round — none carries the code; hash-only at `whatsapp-otp.service.ts` | **HOLDS** (doc's "exactly two calls (304/596)" line-cite stale → O-6) |
| 35 | Loyalty constants: 100 pts/LYD · 50/referral · 5 LYD welcome · tiers 500/2,000/5,000; frontend hardcodes NO monetary constant | `FINAL_LOYALTY_POLICY.md:7-14`; `FINAL_UX_SYSTEM.md:73-75` | `lib/loyalty-policy.ts:46-49` — exact match | **HOLDS** (verified) |
| 36 | No `db:push` in any workflow; never against production | `docs/ONBOARDING.md:50-55` | `package.json:11` has the dev script but no workflow/CI invokes it (grep) | **HOLDS** |
| 37 | www→apex redirect NEVER in-app (R116 loop lesson); one-hop only | `WWW_TO_APEX_301.md:42-48` | in-app redirect removed at `f10bb9b`; canonical link only in `index.html` | **HOLDS** |

History-file binding language beyond these (Northflank, inventory/WhatsApp standing orders,
"pre-r108 law", V1-M21 floors, `keep-with-reason forever` items in R126-A4) was scanned across
all 166 files; the 20+ hits found are either the claims above restated at audit time, or
bug-description prose ("permanently active" etc.), not additional binding rules. No BROKEN
invariant was found; the two soft violations are code-side findings already filed by lanes J/G
(J-1 destructive-confirm AA bypass, G-6 formatting residual), not doc lies.

## Orphan docs list (REPORT ONLY — no moves made)

Strict orphans (zero inbound references by filename anywhere in md/ts/tsx/sh/yml/json/mjs/css/html,
excluding this audit's own outputs and the file itself):

1. `docs/project-graph/02-runtime.mmd` (also O-1 stale range)
2. `docs/project-graph/04-data-model.mmd`
3. `docs/project-graph/05-authentication.mmd`
4. `docs/project-graph/06-commerce-flow.mmd`
5. `docs/project-graph/07-whatsapp-flow.mmd`
6. `docs/project-graph/08-provider-flow.mmd`
7. `docs/project-graph/09-admin-capabilities.mmd`
8. `docs/project-graph/10-external-integrations.mmd` (also O-4 stale claims)

Referenced only from the `docs/README.md` index (weak orphans, keep): every other CURRENT doc —
the index names them all; the operational docs cross-link densely (no additional weak orphans
found beyond the index-only set: none — all non-graph CURRENT docs have ≥1 non-index inbound
reference). `docs/pending/README.md` and `embronic-adapter-design.md` are referenced (pending
README → design; source-of-truth + external-integrations → Embronic track).

## Contradiction pairs (two docs, same mechanism, different claims)

| # | Mechanism | Doc A (claims) | Doc B (claims) | Verdict |
|---|---|---|---|---|
| 1 | GitHub Actions state | `FINAL_ROLLBACK_RUNBOOK.md:36-39` — live on every push since R119 | `FINAL_ROLLBACK_RUNBOOK.md:72-75` + `COOLIFY_FINAL_SETUP.md:147-152` — "currently disabled/billing-suspended" | B stale → **O-2** (ci.yml:8-11 settles it) |
| 2 | Migration chain | `FINAL_PRODUCTION_TOPOLOGY.md:79-84` / `PRODUCTION_ARCHITECTURE.md:146-158` — V1-M23 / drizzle 0015-0016 | `backend/src/migrate.ts` / `shared/db/drizzle/` — V1-M34 / 0023 | docs stale → **O-1** |
| 3 | Sentry status | `external-integrations-final.md:34` — "Off (never had values)" | `source-of-truth.md:25` + `OPERATIONS_RUNBOOK.md §11` + `docs/README.md` header — LIVE since R121-B | A stale → **O-4** |
| 4 | Telegram ops env | `project-graph/11-environment-secrets.mmd` + `10-external-integrations.mmd` — "absent/unset" | `source-of-truth.md:18,25` + runbook §12 — set in Coolify, LIVE since R121 | A stale → **O-4** |
| 5 | Coolify application id | `project-graph/00-system-overview.mmd` — applicationId=2 | `source-of-truth.md:12` — applicationId 3 | graph wrong → **O-5** |
| 6 | VM shape | `00-system-overview.mmd` — x86_64 4c/8G | `CONTABO_COOLIFY_OPERATIONS.md:23` + `TOPOLOGY §8` — "unknown to the repo" (and `PRODUCTION_ARCHITECTURE §6` — 12 GB design envelope) | unresolved → **O-5** |
| 7 | Coolify dashboard port | `project-graph/12-source-of-truth.mmd` — `169.58.100.161:8000` | `TOPOLOGY §4` — port 8000 TEMPORARY, closed after setup | graph stale → **O-5** |
| 8 | OTP_HMAC_KEY guidance | `ENVIRONMENT_MATRIX.md:52` — "explicit key recommended in prod" | `FINAL_PRODUCTION_ENV.md:80` + `SECRET_HANDLING_FINAL.md:26` — leave unset (derivation default) | matrix is the outlier → **O-7** |

**Mechanisms checked and found CONSISTENT (no pair):** user session TTL (30d everywhere —
`API.md:12` ↔ `jwt.ts:106` ↔ `COMPLIANCE.md §3`); admin session TTL (8h everywhere); catalog
cache TTL (s-maxage=60 + in-process 60s in NEON_COLD_START ↔ FINAL_INVENTORY_LOADING ↔ products
route); healthz summary cache (15s everywhere); openwa gateway retry (8 s × 3 attempts +
`Retry-After: 30` + frontend auto-retry — WHATSAPP_OPERATIONS ↔ R118-A1 record ↔ code); drain
budgets (25 s app / 40 s compose / openwa 4 s / 15 s compose — COOLIFY_FINAL_SETUP §4 ↔
ENVIRONMENT_MATRIX ↔ `server.ts:48-50` ↔ compose `stop_grace_period`); rate limits (600/1200/min
+ 10-per-15-min — API.md ↔ `rate-limits.ts:84-151`); backup schedule (03:15 UTC keep-14 — one
documented line everywhere); SINGLE_INSTANCE scaling law; single-gateway rule.

## Duty-1 spot-verification ledger (37 references checked; 35 hold, 2 stale-path)

Scripts/paths/ports/env verified to exist and behave as documented: `scripts/src/validate-production-env.ts`,
`final-cutover-preflight.sh`, `generate-production-secrets.sh`, `backup-cron.sh`,
`backup-preflight.sh`, `restore-drill-check.sh` (name-guard lines), `dns-cutover-check.sh`,
`docker-verify.sh`, `check-openapi-routes.ts`, `src/backup-db.ts`, `deploy/env.compose.example`,
`config/env.example` (OTP_HMAC_KEY row read), `docker-compose.yml` (ports 8080/2785, host binds
127.0.0.1:3000/3001, healthchecks 150 s/10 s start_period, log rotation 10m×3, restart
unless-stopped, stop_grace 40 s/15 s), `render.yaml`+`vercel.json` REMOVED as every doc claims,
`web-scheduler.ts` single-instance block, `cron.ts` slot map (00:00/00:05/02:15/03:30/03:35/
03:50/04:00/04:30/05:00 + hourly + OTP :15), `health.ts` route family + admin gating,
`encryption.ts` 64-hex asserts, `jwt.ts` 30d/8h, `rate-limits.ts` 600/1200/10, `loyalty-policy.ts`
constants, `server.ts` 25 s drain, `shared/db/index.ts` lockPool 2-conn + pool defaults,
`vite.config.ts` GSC empty-meta emission + `index.html:19-23` comment, `ci.yml` push triggers,
`docker.yml` dispatch/v* + STATUS, copilot stock guard, set-count surplus-only, OTP logger
sites, `idempotency-retention.ts` 48 h, `api-config.ts` empty-VITE fallback, `OPERATIONS_RUNBOOK.md`
§13 anchor, root `package.json` db:push. Retired-platform hunt: zero current docs instruct
active Vercel/Render use (all mentions LEGACY/DO-NOT-SET framed; WHATSAPP_OPERATIONS marks the
old gateway «موقوفة نهائيًا»). Stale-path misses: `RENDER_LEGACY_FALLBACK.md` (O-3) and the
migration-chain rows (O-1).

## UX system contract verdict (FINAL_UX_SYSTEM.md — process/status claims)

"Status: CURRENT @ 2026-10-13 (R140)" is truthful for content: lane J's independent token audit
reproduced the r140 contrast sweep exactly (25/26 pairs; the one FAIL is the J-1 code-side
bypass, not a doc lie), the font/z-floor/gradient-ban/status-token claims all verify at HEAD,
and R141 (the only round after the stamp) touched `index.html` head-injection only — no token
surface. Two soft notes: (a) §2's "ONE focus system … never introduce competing ring styles" is
a contract the code does not fully meet (J-2: five ring recipes in primitives) — the doc states
the rule, the drift is a code finding; (b) §7's tracked-debt census (~232 raw-palette hits / 23
files) is R128-dated and lane J did not re-count it (recorded, not re-flagged). "Closed" round
claims (r138/r139 family closed, R140 maturity layers pinned) match the pin suites' presence.

## Not checked / out of lane

- Root docs (README/OPERATIONS_RUNBOOK/CHANGELOG/CONTRIBUTING/SECURITY/.hermes) — lane A's;
  used here only as cross-reference anchors (§11/§12/§13 verified to exist and say what
  current docs claim they say).
- `docs/FINAL_MONEY_INVARIANTS.md` — lane G's; cross-ref table only.
- History-file bodies beyond the binding-claim scans (166 files / ~31K lines) — skim-claims mode
  recorded honestly in coverage; the R96–R141 FINAL-report family was grepped for
  PERMANENT/INVARIANT/LAW/FOREVER/ban/standing-order markers, and the 25 strongest claims were
  code-verified (census above); prose descriptions of past state were not line-read.
- The separate openwa repo (`ghcr.io/ahmadmedo1012/openwa`) — gateway-side claims (timing-safe
  key compare, 4 s drain, maskDigits cites) are documented against that repo and were not
  verifiable from this tree; the repo-side configs that encode the same contracts were verified.
- Live probes (healthz, www→apex 301, GHCR package presence) — network-verified by prior rounds'
  records and re-stamped in worklogs; this lane re-verified the in-repo evidence chain only.
- JPEG evidence banks under docs/history (39 files) and docs/assets — not docs-truth material.
