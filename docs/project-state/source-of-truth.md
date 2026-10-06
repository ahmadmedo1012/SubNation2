# Source of Truth — SubNation2

Status: **verified against live production and VPS on 2026-10-05** (mission recovery Wave 0).
Rule: when any document contradicts the live environment, the live environment wins and the
discrepancy gets recorded here and in the progress log.

## Canonical pointers

| Domain | Single authoritative source | Notes / eliminated contradictions |
| --- | --- | --- |
| Code & history | GitHub `ahmadmedo1012/SubNation2`, branch `main` (private) | Local clone is a working copy only. The old `origin` remote (`root@169.58.100.161:/data/SubNation2`) is **dead** — that path is a plain directory, not a git repo. Removed from consideration; use remote `github`. |
| Deployment authority | Coolify on the Contabo VPS `169.58.100.161` (v4.3.23), app id=2 `subnation` | Pre-Wave-1 reality: app is `source_type=dockerimage` pulling `ghcr.io/ahmadmedo1012/subnation2:coolify-latest` pushed by hand, with a fake deployment-queue row created by direct DB writes. Wave 1 converts it to a Git-source dockerfile build; from then on Coolify is the only deployer and GitHub main is the only build input. |
| Deployed release identity | `GIT_SHA` / `SOURCE_COMMIT` env inside the running container, cross-checked against `https://subnation.ly/api/healthz` and the Coolify deployment record | Manual `docker exec` SHA checks before Wave 1; after Wave 1 both outside (healthz headers/bundle) and inside must agree with `main` HEAD. |
| Products, variants, pricing policy | Neon `products` / `product_variants` (+ `system_settings` `pricing.usd_to_lyd`, `pricing.markup_percent`) | Sellable supply for provider-backed products will move to provider sync (Embronic) — local rows become cache/mapping. Manual admin edits remain limited to merchandising (visibility, copy, markup, categories). |
| Inventory (sellable units) | Neon `inventory` (single-writer claims, M11) | Today: manual admin upload is the designed model (6 units available). After Embronic: provider truth → local snapshot/reservation; manual injection for provider-backed products must be removed (Wave 4/6). |
| Orders & money | Neon `orders`, `wallet_ledger`, `wallet_topups`, `idempotency_keys` | `orders.amount` frozen (M10). Money invariants M1–M14 in `docs/FINAL_MONEY_INVARIANTS.md` are law. Never weaken to make a test pass. |
| Users & auth identities | Neon `users`, `user_auth_identities`, `sessions`, `admin_users`, `admin_sessions` | Passwordless (Stage-C dropped password columns). |
| Auth provider configuration (Telegram etc.) | Neon `system_settings` keys `auth.*` (admin-editable via `/admin/settings`) | NOT env. This is why Telegram login works with no `TELEGRAM_*` env vars. Google login additionally needs env (`FIREBASE_*`) — currently absent → feature off. |
| WhatsApp sessions | Neon `openwa_sessions` (creds BYTEA via gateway `PERSISTENCE_URL`) + volume `openwa-data:/data` as defense-in-depth | Exactly ONE OpenWA instance per WhatsApp credential (never-two-gateways rule). |
| Environment (runtime) | Coolify app env table (migrated from VPS `/data/coolify/applications/wbgj7cszizukrlrblncq8by5/.env` in Wave 1) | `.env` file on disk is an artifact of the manual era; after Wave 1 the Coolify DB is authoritative, the file stays as a backup only. |
| Environment (build args) | Coolify build-time envs (become Dockerfile `ARG`s) | `VITE_API_BASE_URL` / `VITE_SOCKET_URL` / `VITE_API_URL` **must stay EMPTY** (single-origin contract). Redis deliberately unset (in-memory fallbacks by design). |
| Secrets | VPS-side stores only (Coolify env, `.env` backup). Never in repo, chat, logs, or client bundles | Firebase service-account JSON / Telegram alert bot tokens / Sentry DSNs are operator-supplied when enabling those features. |
| Migrations | `backend/src/migrate.ts` boot reconciler (idempotent, fingerprinted in `system_settings`) | The `shared/db/drizzle/*.sql` chain is a **mirror** for fresh installs + CI drift gate — it must stay in sync (that sync was re-established in R117 `0015_smart_bruce_banner`). No `db:push`, ever. Neon never rolls back. |
| DNS / Cloudflare | Cloudflare dashboard (operator-only; no automation by design) | DNS-only mode (no proxy) per R117 measurement; SSL handled by Traefik Let's Encrypt on the VPS. Canonical host recommendation: single www→apex 301 at Traefik layer (NOT in-app). |
| Monitoring | `/api/healthz*` (public liveness/summary), admin-gated subsystem checks, Socket.IO admin feed | Post-R117 the Neon cold-resume flap is warmup-probed; `degraded` on warm = real. Sentry optional/off. |
| Rollback | Coolify previous deployment + GHCR `coolify-latest` image (until superseded) + the never-deploy list (`6caa63b`, `3a2e2e1`) | Rollback floor: migrations are expand-first; DB never rolls back. |
| Backups | VPS `/data/backups` + `scripts/backup-*.sh` (operator-run drills; last recorded PASS in r115-db docs) | DR runbook host references still say Oracle — reconcile (P3, R117 finding; Wave 10). |

## Known contradictions resolved by this file

1. **README "production is offline / cutover pending" (2026-09-23)** — FALSE today. Production is live on Coolify/Contabo. README was updated by R117 to point at the round reports; treat `docs/r116-round-report.md` + `docs/r117-round-report.md` + this file as current.
2. **Oracle A1 ARM64 topology docs** — the migration was redirected to Contabo x86_64 in practice. `pnpm-workspace.yaml` multi-arch note and `docs/deployment/ORACLE_*.md` describe a path that is not the live one. DR/backup runbooks still reference it — to reconcile in Wave 10.
3. **`PLATFORM.md` / `PROJECT_OVERVIEW.md` / `OPERATIONS_RUNBOOK.md`** — dated snapshots (2026-08/09). Historical only; do not operate from them.
4. **`.hermes.md` mentions `whatsapp-service/` workspace** — stale; OpenWA lives in a separate repo/image (`ghcr.io/ahmadmedo1012/openwa`), not in this monorepo.
5. **`render.yaml` / `vercel.json`** — frozen legacy rollback references, never apply (`.hermes.md` contract). CI's `deploy.yml` Render hook is kill-switched OFF. The failing Vercel GitHub App integration is an operator disconnect task.
6. **Local `refs/remotes/origin/main`** — legacy ref from the dead VPS path; harmless, but all pushes/fetches go to/from `github`.
