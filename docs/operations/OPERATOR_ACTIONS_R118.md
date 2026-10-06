# Operator Actions — R118 (the ordered list)

> Status: CURRENT @ 2026-10-06 (R118; supply-chain + rotation follow-ups
> re-dated R119, 2026-10-07). Read this first.
> Every item carries its evidence anchor (`docs/inspection-r118/*`). Live
> truth this list was written against (verified R118, 2026-10-06;
> deployment state re-verified R119):
> production **LIVE** at https://subnation.ly (Contabo VM + Coolify +
> Traefik + Let's Encrypt at origin; Neon Postgres 17 us-east-1, pooled;
> Cloudflare DNS-only) · single admin `ahmadmedo` (username login + argon2,
> TOTP implemented but **not enrolled**) · sellable stock = **3 placeholder
> units** (inventory rows 79/80/81 — `extra_details` only, uploaded
> 2026-10-05) + 42 active products with zero stock · **`main` is now ahead
> again**: the R118 chain + the waves merge (966d70f) pushed 2026-10-06
> 17:23Z via the push-to-deploy webhook (live healthz ok, no SHA exposed
> externally — confirm the live `GIT_SHA` in the Coolify dashboard before
> ticking action 1) · www and apex both serve 200 (301 www→apex
> recommended).

**Launch blockers: actions 1–3.** The store cannot sell safely, and the
admin account is single-factor, until those three are done. 4–5 are
decisions to make this round; 6–9 are quick wins; 10 is
ready-when-you-are.

| # | Action | Sev | Effort | Anchor |
|---|---|---|---|---|
| 1 | Deploy `main` (live is behind) | 🔴 blocking | S | R118-A6 F-10 |
| 2 | Verify-or-delete stock rows 79/80/81, then load real stock | 🔴 blocking | M (data entry) | R118-A3 F1 |
| 3 | Enroll TOTP on `ahmadmedo` | 🔴 blocking | S (~10 min) | R118-A4 F-1 |
| 4 | Decide Neon region (us-east-1 → eu-central-1) | 🟠 decide | M | R118-A6 F-1 |
| 5 | Decide Cloudflare proxy re-enable | 🟠 decide | S (+header audit) | R118-A6 F-3 |
| 6 | `CREATE EXTENSION pg_stat_statements` | 🟡 quick win | S (one statement) | R118-A3 F7 |
| 7 | `DB_IDLE_TIMEOUT_MS=240000` | 🟡 quick win | S (env) | R118-A6 F-6 |
| 8 | www→apex 301 at Traefik | 🟡 quick win | S | `WWW_TO_APEX_301.md` |
| 9 | Mark all alerts read (after stock load) | 🟡 quick win | S | R118-A3 F6 |
| 10 | Encryption-key rotation readiness (read the pointer) | 🔵 when ready | S (reading) | R118-A4 F2 |

Recommended order: **1 → 2 → 3** (deploy the audited code before loading
stock, so the live process is the one the R118 findings describe).

---

## 🔴 1. Deploy `main` — the live build is older than the repo

- **What:** trigger a Coolify redeploy of the SubNation resource from git
  `main` (flow + checks: `docs/operations/CONTABO_COOLIFY_OPERATIONS.md` §4).
- **Why:** the live entry chunk is `index-DcWfE6PS.js` while `main` builds
  `index-BTNM_6lU.js` — production is running a build older than the
  R116→R118 chain (overhaul + OTP lockPool + reveal gate + decrypt honesty
  + warmup probe + this round's fixes). Everything audited in
  `docs/inspection-r118/` is code-at-`main`; action 2 below assumes it is
  live.
- **Verify after:** `curl -s https://subnation.ly/api/healthz` → 200 and
  `.version` equals the deployed `GIT_SHA`; then re-run the two-line
  latency census (`R118-A6-performance.md` §1) to re-baseline.
- **Where:** `docs/operations/CONTABO_COOLIFY_OPERATIONS.md` §4,
  `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md` if anything goes wrong.
- **Effort:** S. (Evidence: R118-A6 F-10.)

## 🔴 2. Stock: verify-or-delete rows 79/80/81, then load the real thing

- **What (two steps):**
  1. **Decide the fate of the 3 placeholder rows** — inventory ids
     **79/80/81** (product_ids 62/61/1 = cPanel / Lifetime Cloud Storage /
     Netflix Premium, one unit each). They were uploaded 2026-10-05
     14:35–14:38 UTC by `ahmadmedo` (audit_logs 29–31,
     `product.inventory.upload`) and carry **only `extra_details`** — no
     `account_email`, no `account_password`. If they are genuine
     code-style goods, keep them; if they are test placeholders, delete
     them **unsold-only**, scope-verified first:
     ```sql
     BEGIN;
     SELECT COUNT(*) FROM inventory
     WHERE id IN (79,80,81) AND is_sold = false;   -- expect exactly 3
     DELETE FROM inventory
     WHERE id IN (79,80,81) AND is_sold = false;
     COMMIT;   -- or ROLLBACK if the count surprised you
     ```
     (The §5 rollback shape from
     `docs/operations/FINAL_INVENTORY_LOADING.md`; the A3 operator-actions
     wording.)
  2. **Load real stock** per
     `docs/operations/FINAL_INVENTORY_LOADING.md` §2 — per-product admin
     upload (المنتجات → «رفع مخزون»), generic pool, ≤500 rows/batch,
     duplicates skipped + reported.
- **Why:** the store can sell only 3 of 45 active products, and those 3
  would deliver **only whatever the note contains** — the R93-DATA gate
  passes any row with ≥1 credential field, so a buyer of Netflix
  «شهر واحد» (79.80 LYD) or cPanel «مدى الحياة» (5,980 LYD) would receive
  just the `extra_details` text (R118-A3 F1). Never load credentials over
  chat/email — admin UI over HTTPS or psql on the VM only (§6 of the
  runbook).
- **Verify after:** `https://subnation.ly/api/catalog/stats` — today it
  reads `available_products: 3, total_units: 6`; after a real load the
  availability flips per product (§7 of the runbook). The §4(b) SQL is the
  truth, not any doc's static count.
- **Where:** `docs/operations/FINAL_INVENTORY_LOADING.md` (mechanics
  re-verified R118; ignore its §8 r112-era counts).
- **Effort:** M (operator data entry; no code change). (Evidence: R118-A3
  F1 + operator-actions #1.)

## 🔴 3. Enroll TOTP on the admin account (10 minutes)

- **What:** run the enrollment journey in
  `docs/operations/FINAL_ADMIN_TOTP_SETUP.md` §2 — settings («الإعدادات»)
  → security («الأمان») → «إعداد المصادقة الثنائية» → scan QR → enter
  code → log out/in to prove it. There are **no backup codes** — store the
  shown secret in the password manager at scan time (§2.6); the §4 recovery
  SQL is the lost-device path.
- **Why:** `ahmadmedo` holds `permissions: ["all"]` (money mint: topup
  approvals, refunds, pricing, coupons, admin creation) behind a single
  password. The feature is fully implemented and verified; only the
  enrollment is missing — the weekly `admin:no-totp` advisory keeps firing
  until done (R118-A4 F-1; A7 §3b: the runbook is accurate as written).
- **Effort:** S, ~10 minutes, no code change. 5 wrong codes lock the 2FA
  step 15 min (doubling).

## 🟠 4. Decide: move Neon to eu-central-1 (Frankfurt)

- **What:** create an eu-central-1 branch in the Neon project, copy the
  data (it is tiny: 59 products / 263 variants / 12 MB), repoint
  `DATABASE_URL` in the Coolify resource env, redeploy.
- **Why:** the DB is in us-east-1 while the origin (Contabo) is in the EU —
  ~100 ms RTT on **every sequential DB stage**: product detail ≈ 3 stages
  (+300 ms per cache miss), catalog ≈ 2. Frankfurt cuts RTT to ~5–10 ms =
  10–20× — the single largest systemic latency win available (R118-A6
  F-1). It does **not** remove cold-start (that is Neon suspend, region-
  independent — `docs/operations/NEON_COLD_START_RUNBOOK.md`).
- **Where:** `R118-A6-performance.md` F-1 (numbers + sketch);
  `docs/NEON_MCP_SETUP.md` (project/endpoint context); test the new
  endpoint before flipping (both are one env change + redeploy away).
- **Effort:** M (a data copy + env change, no code).

## 🟠 5. Decide: re-enable the Cloudflare proxy (orange cloud)?

- **What:** flip the zone/hostname records from DNS-only (grey) to proxied
  (orange) in the Cloudflare dashboard — a DNS toggle.
- **Why (for):** the edge would then serve the `s-maxage=60` catalog +
  sitemap and `immutable` assets — most anonymous cold traffic never
  reaches Neon (zero extra DB cost; also absorbs the Neon cold-start first
  visitor, R118-A6 F-3a).
- **Why (careful):** the live path today has Let's Encrypt at origin and
  **no** Cloudflare TLS/WAF. Re-proxing changes TLS termination — the
  proxied setup (Full strict, WS, cache rules) is described in
  `docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md` §1–§4. And the loop
  lesson: **do not re-proxy until you have verified there is no
  hostname-rewriting redirect at any layer** — if you are also doing
  action 8, do 8 first, then re-verify one www URL end-to-end
  (`docs/operations/WWW_TO_APEX_301.md` §6, `docs/operations/
  NEON_COLD_START_RUNBOOK.md` §6).
- **Effort:** S (toggle) / M if combined with a full header audit.

## 🟡 6. `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`

- One statement against the production DB (Neon allows it — it is already
  in `shared_preload_libraries` but not installed; audit agents could not
  see top-query stats). After it, `pg_stat_statements` becomes queryable
  for evidence-based performance work. (Evidence: R118-A3 F7 + operator
  actions #2.) Effort: S.

## 🟡 7. Set `DB_IDLE_TIMEOUT_MS=240000` in the service env

- Raises the pg pool idle timeout from the 30 s default to 4 minutes (just
  under Neon's 5-min suspend) so low-traffic gaps stop re-paying the TLS
  handshake to us-east-1 (~0.3–0.5 s on exactly the cold requests). The
  code already reads the env (`shared/db/src/index.ts`); no code change.
  (Evidence: R118-A6 F-6; `docs/operations/NEON_COLD_START_RUNBOOK.md`
  §"Related env knob".) Effort: S.

## 🟡 8. www→apex 301 at Traefik

- The canonical-host decision is already made in the product (every sitemap/
  robots/og/canonical signal points at the apex); only the redirect is
  missing. Paste-able Traefik dynamic config + Coolify wiring + verification
  + rollback: **`docs/operations/WWW_TO_APEX_301.md`**. Never in-app
  (R116 loop lesson). (Evidence: R118-A7 F34(c); CLOUDFLARE_FINAL_CUTOVER
  §8.) Effort: S.

## 🟡 9. Mark all alerts read (after action 2)

- 103 unread admin alerts (87 `no_stock`) are expected noise while stock
  is ~zero; the flood collapses once real stock is loaded (R118-A3 F6).
  After the load, "mark all read" from the admin panel for a clean
  baseline. Effort: S.

## 🔵 10. Encryption-key rotation readiness (pointer only)

- R118 landed **key versioning** for credential encryption (v2 blobs +
  previous-key decrypt fallback) so a future `ENCRYPTION_KEY` rotation is a
  re-encrypt job, not a data-loss event (R118-A4 F2; previously rotating
  the key would orphan every stored credential — 10 inventory + 5 order
  rows at audit time). **No operator action is required now.** Before you
  ever rotate: read `backend/src/lib/encryption.ts` + the R118 entry in
  `CHANGELOG.md` — the rotation contract is **`ENCRYPTION_KEY_PREV`**
  (set it to the old key, redeploy, re-encrypt, then drop it; the exact
  procedure and the boot warnings are documented in the source).
