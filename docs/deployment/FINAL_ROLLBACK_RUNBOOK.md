# Final Rollback Runbook — SubNation + OpenWA (R115)

> THE rollback choreography for the self-hosted VM + Coolify production stack
> (originally written for the Oracle VM; live host since 2026-10 = Contabo —
> R117 live probe; the choreography is host-neutral). Companions:
> `COOLIFY_FINAL_SETUP.md` (deploy shape) · `CLOUDFLARE_FINAL_CUTOVER.md` (DNS)
> · `RENDER_LEGACY_FALLBACK.md` (the old origin) · `docs/DISASTER_RECOVERY.md`
> (data loss is NOT a rollback). Neon Postgres is the source of truth and
> **never rolls back** — everything else here is reversible in minutes.

## 0. THE WHATSAPP SINGLE-GATEWAY RULE (read before ANY openwa action)

**NEVER run two openwa instances against the same WhatsApp credential/session
simultaneously.** Baileys multi-file auth state cannot be shared: two live
gateways restoring the same `openwa_sessions` credentials = session eviction
war + possible WhatsApp device logout (one-linked-device rule) — OTP breaks on
BOTH paths while they fight.

During ANY migration, rollback, or image swap involving openwa: **stop the old
container FIRST, then start the new one** (`docker stop` → deploy). The ~15 s
gap costs nothing (SubNation answers `503 gateway_waking` + `Retry-After: 30`
and the frontend auto-retries); a session eviction war costs a QR re-pair.
**This rule overrides every speed consideration.** Render-era corollary: the
legacy `openwa-gateway` service must be suspended before the VM-hosted one pairs.

## 1. Application rollback — SubNation (Coolify Git resource)

The release identity of SubNation is the **commit** it builds from: Coolify
supplies `GIT_SHA` as a build arg; it lands in `/api/healthz` `.version`, logs,
and the Sentry release tag. Rollback = point the resource at an older commit
and deploy — there is no magic, only the Git history.

Pre-rollback gates (all three, in order):

1. **CI green on the target commit** — GitHub → Actions on that exact SHA.
   A commit whose CI is red is not a rollback target, it is a second incident.
   **While Actions is disabled on SubNation2 (billing — still true at R115,
   2026-10-01): substitute the local gate run** —
   `docs/deployment/FINAL_COMMAND_BOOK.md` §LOCAL on the target SHA (the
   exact CI commands). Do NOT skip this gate because GitHub shows nothing.
2. **Migration compatibility** — the target commit must share the same
   migration state as what is live (§4). `git diff <live-sha> <target-sha> --
   backend/src/migrate.ts shared/db/src/schema/` — empty diff = inside the
   safe window; any migration-stage change = STOP and read §4.
3. **You know the previous-good SHA** — `curl -s https://subnation.ly/api/healthz
   | jq -r .version` (the live one) vs the target. Record both.

Then: Coolify → SubNation resource → set the deployment commit to the target
SHA (panels are named by function — commit / redeploy-an-older-deploy; see
`COOLIFY_FINAL_SETUP.md` §7) → set the matching `GIT_SHA` build arg → Deploy.
Verify the deployed-SHA gate: healthz `.version` == the SHA you rolled back
to, then one login + one catalog page. RTO ≈ one build (2–4 min).

## 2. Image rollback (emergency — both services)

When the Coolify Git builder itself is broken, or you need out of a release
faster than a build: GHCR publishes **immutable `sha-<short>` tags per commit**
and never retro-fits them. The pinning rule: **never `:latest` / `:main`** —
they float; a rollback that can drift is not a rollback.

```bash
docker pull ghcr.io/ahmadmedo1012/openwa:sha-<short>       # public image
docker pull ghcr.io/ahmadmedo1012/subnation2:sha-<short>   # PRIVATE package —
# one-time: docker login ghcr.io with a read:packages PAT
```

Availability honesty (re-verified 2026-10-01): openwa's workflow publishes a
`sha-<short>` tag on every push to `main` — `sha-ba6a843` is verified
PRESENT on GHCR as a multi-arch index (linux/amd64 + linux/arm64) and CI is
green for it. **SubNation2's workflow is manual-dispatch / `v*`-tag only**
(metered minutes) AND Actions is currently disabled — **NO
`subnation2` GHCR image exists for any commit**. §2 is therefore NOT
available as a SubNation rollback path until Actions is restored and the
workflow is dispatched once (`FINAL_OPERATOR_INPUTS.md` §account-level
cleanup). For openwa, image rollback works today. In Coolify: switch the
resource from Git build to the registry image, pin the exact tag, redeploy
(`COOLIFY_FINAL_SETUP.md` §2.3 emergency path).
§4's migration gate applies to image rollbacks identically.

## 3. DNS rollback — the Cloudflare A record

Rolls users back to the PREVIOUS ORIGIN, not to older code on this VM.

- **Precondition: the previous origin is actually serving.** One A record, one
  live origin — NEVER two origins live for the same Host simultaneously. The
  old Render origin (`subnation.ly` → Render) exists only while the legacy
  stack is still deployed AND un-suspended — as of the r111 record it is
  **billing-suspended (503)**, so a DNS rollback to Render is NOT currently
  available. Truth + options: `RENDER_LEGACY_FALLBACK.md` §2.
- Steps: Cloudflare dashboard → `subnation.ly` A record → the previous value
  recorded in Migration Phase 0 (proxied/orange; `www` CNAME follows the
  apex). Delay is TTL-bounded: at 300 s most resolvers follow within ≤5 min;
  Cloudflare's edge applies the change immediately (`CLOUDFLARE_FINAL_CUTOVER.md`
  §6). Keep TTL ≤300 s through any soak.
- If the previous origin is gone, DNS "rollback" is meaningless — the real
  action is fixing forward on the VM (§1/§2) or, for a full-stack loss,
  `docs/DISASTER_RECOVERY.md`.

## 4. Neon compatibility truth for rollbacks (READ BEFORE §1/§2)

`backend/src/migrate.ts` is **probe-based and append-mostly**: every stage is
a DO-block existence probe or `IF NOT EXISTS`, re-runs are no-ops, and the v2
fingerprint fast-path (codeHash + schemaHash vs `system_settings`) skips the
whole replay when the corpus is unchanged. **Rolling FORWARD is always safe.**

Rolling code BACKWARD after a new migration ran is where schema drift lives:
the live schema is a superset of an older binary's expectations. The rule:
**the safe rollback window is commits that share the same migration state** —
no changes to `backend/src/migrate.ts` or `shared/db/src/schema/` between the
live SHA and the target SHA (the §1 gate-2 diff). Inside the window, the old
binary boots against the live schema and its boot migrations no-op.

Hard floor — **NEVER roll back to a pre-r108 commit** (V1-M20 landed in r108,
commit `39bedf4`; `SINGLE_INSTANCE_MODE` in `1bca23d`):

- **V1-M20 (the `idempotency_keys` FK drop) is a live-DB FACT.** The
  `orders(id)` FK is gone from production Neon and stays gone. Pre-r108 code
  carries no M20 drop, its V1-M12 creates the table WITH the FK whenever the
  table is (re)created — fresh DB, a pre-M20 Neon-branch restore, or a
  drizzle push from the old mirror (which still declares `.references()`) —
  and any r104+ topup claim then writes a `wallet_topups.id` into the
  polymorphic `order_id` → SQLSTATE 23503 → the whole submission transaction
  rolls back → **topup 500s (the historical FK 500)**. Older code re-adding
  the FK re-arms a proven money-path break.
- **The Neon-killer comes back with it.** `SINGLE_INSTANCE_MODE` did not exist
  before r108 — pre-r108 code ALWAYS runs the 25 s PG-lease heartbeat against
  Neon (144 q/h ≈ 720 awake-h/mo ≈ 180 CU-h, vs the 100 CU-h/project/month
  Free allowance; B6-01 proved it
  live at 92.4% of all UPDATEs). That is the exact economics the migration
  exists to escape.

R115 floor — **once the R115 stages have run, NEVER roll back to a
pre-R115 binary** (R115 = `6f14bc3`; stages landed in `6caa63b`,
boot-abort P0 fixed in `6f14bc3`):

> **r115-db STATUS (2026-10-01T02:50Z): the R115 stages (V1-M18…M22) are
> APPLIED to canonical Neon — THIS FLOOR IS IN FORCE FROM NOW ON.** The
> only pre-R115 recovery point is the verified backup
> `subnation_preR115_20261001T024634Z.sql.gz` (sha256 `3680136b…4d73`,
> restore drill PASS); restoring it means recreating the database — it is
> a disaster-recovery artifact, NOT a rollback tool (Neon never rolls
> back; fix-forward is the only supported direction — §1).

- **V1-M21 (points_ledger + `users.loyalty_points >= 0` CHECK +
  `welcome_bonus_granted`) is a live-DB FACT after the first R115 boot.**
  A pre-R115 binary boots against the wider schema (additive columns are
  tolerated) but its loyalty writes BYPASS the ledger — balances mutate
  with no ledger rows, breaking the economics-integrity invariant the R115
  audit built — and legacy negative-deduction paths can violate the
  non-negativity CHECK (SQLSTATE 23514 → failed writes). Welcome policy
  also re-diverges (signup-credit vs policy-B first-topup-credit:
  double-grant/lie risk). This is exactly the "application version
  incompatible with the applied R115 migrations" case — prefer fix-forward.
- **V1-M22 (orders refund columns + wallet_ledger backfill)** is additive
  and harmless to an old binary by itself — but it never travels without
  M21; treat the pair as one floor.
- **Within R115, the ONLY safe same-migration-state target is `6f14bc3`
  itself.** `6caa63b` and `3a2e2e1` carry the pre-fix V1-M21
  opening-balance backfill that ABORTS BOOT for zero-point users (every
  never-earned signup trips `chk_points_ledger_delta_nonzero` → SQLSTATE
  23514 → critical → exit; reproduced by the R115-R1 reviewer in pglite
  against the exact DDL). They are never deploy targets, forward or
  backward.
- **`DISABLE_BOOT_MIGRATIONS=true` does not create compatibility** — it
  only stops an old binary from running its corpus. Use it solely to boot
  a known-compatible binary while fixing forward.

Emergency hatch: `DISABLE_BOOT_MIGRATIONS=true` skips `runMigrations()` at
boot — it stops an old binary from running its corpus, but does NOT make that
binary compatible with a newer schema. Use only to boot a known-compatible
previous binary while fixing forward; unset immediately after
(`ENVIRONMENT_MATRIX.md`). When in doubt about a specific stage, read the
stage's probe in `migrate.ts` + `MIGRATION_RUNBOOK.md` before touching anything.

## 5. OpenWA rollback (image pin + session survival)

1. Pick the previous `sha-<short>` tag (Actions run summary or the GHCR
   package page — the workflow publishes one per commit).
2. **Stop the running container FIRST** (§0): `docker stop <openwa-container>`
   (or Coolify stop) — the SIGTERM handler flushes sessions within its 4 s
   budget (`stop_grace_period: 15s` covers it).
3. Point the resource at `ghcr.io/ahmadmedo1012/openwa:sha-<short>` (exact
   tag — never `:latest`/`:main`) → deploy.
4. Watch the boot: the gateway auto-restores the `subnation-otp` session from
   Neon (`[persist] credentials restored from DB`) — then one E2E OTP test.

**Session state survives image rollback by design**: the `/data` volume keeps
the hot Baileys auth folder (defense-in-depth, faster restores) and
`PERSISTENCE_URL` blobs in `openwa_sessions` are the source of truth — an
image swap changes neither. `OPENWA_CREDENTIALS_KEY` must stay the SAME value
(restore-verbatim; a different key silently orphans every session —
`SECRET_HANDLING_FINAL.md` §6). Missing volume only = slower boot, not a
QR re-pair.

## 6. Full-stack rollback order (when in doubt)

1. **DNS first** — stop new users from hitting the bad stack (§3; if there is
   no live previous origin, use a Cloudflare maintenance block instead).
2. **App image** — subnation rollback (§1 Git, else §2 image).
3. **OpenWA** — stop-then-start with the previous tag (§5, §0).
4. **Neon — never.** It is the source of truth and does not roll back; data
   problems go to `docs/DISASTER_RECOVERY.md`, not to a redeploy.

## 7. Rollback decision matrix

| Symptom | Action |
|---|---|
| Bad release (error spike / regression right after deploy) | App rollback §1 (Git commit) — §2 only if the builder is broken |
| OTP dead (no WhatsApp codes; gateway errors/evictions) | OpenWA stop/start §5 — verify SINGLE gateway live (§0); image pin only if a bad openwa release is proven |
| DB gone weird (queries failing, healthz `neon` failing/degraded) | **STOP — Neon is NEVER rolled back.** Move to `docs/DISASTER_RECOVERY.md` (Scenario A/B); do not redeploy anything that writes |
| Bad data (bug wrote wrong rows) | Targeted restore via the drill path — `docs/DISASTER_RECOVERY.md` Scenario A + restore-drill procedure; fix forward in code |
| TLS broken (browser cert warnings/loops) | Cloudflare settings, not code: Full (strict) / WebSockets ON / Rocket Loader off — `CLOUDFLARE_FINAL_CUTOVER.md` §3–4 |
| VM dead (whole stack unreachable) | Not a rollback — re-provision VM + Coolify + redeploy + restore from backup: `ORACLE_FINAL_SETUP.md` + `COOLIFY_FINAL_SETUP.md` + `docs/DISASTER_RECOVERY.md` |

## 8. After ANY rollback

- [ ] healthz 200 + `.version` == the intended SHA (subnation); `/healthz` green (openwa)
- [ ] one login, one catalog page, one E2E OTP send
- [ ] admin → observability: scheduler mode `single`, active=true
- [ ] logs watched 30 min; incident note recorded (what rolled back, why, SHA pair)
- [ ] fix-forward branch opened from the bad commit — a rollback buys time, it is not the fix
