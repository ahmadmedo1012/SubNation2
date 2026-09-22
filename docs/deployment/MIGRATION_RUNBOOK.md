# Migration Runbook — Render/Vercel → Oracle ARM64 + Coolify

> Executable checklist. Someone who has never touched this codebase should be
> able to follow it top to bottom. Companion doc (why/architecture/details):
> `docs/deployment/COOLIFY_ORACLE_MIGRATION.md`. Environment reference:
> `docs/deployment/ENVIRONMENT_MATRIX.md`.
>
> **Verification legend:** ☐ = todo · [x] done here = evidence exists ·
> items marked ⚠️ could not be verified in the r107 sandbox (no Docker / no
> infra) and must be executed by the operator.

## Phase 0 — Pre-migration checks (on current production)

- [ ] Confirm current prod is the r104+ build (admin → System shows the
      release SHA via the R108 neutral identity chain, or Render dashboard
      shows the last deploy ≥ `6f4b715`). All r107+R108 fixes are in `main`
      after this round.
- [ ] Take a fresh Neon backup NOW (before anything changes):
      `pnpm run db:backup` (needs `pg_dump` + `DATABASE_URL` in env — see
      `scripts/src/backup-db.ts`; or Neon dashboard → Backup/PITR point).
      Verify the dump file is non-empty and downloadable.
- [ ] Record current secrets inventory (Render dashboard → Environment):
      DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY, ADMIN_JWT_SECRET,
      WHATSAPP_OTP_API_KEY, TELEGRAM_*, SENTRY_DSN, COPILOT_*, etc.
      Store encrypted OUTSIDE the VM (age/gpg/manager of choice).
- [ ] Note the Render/OpenWA gateway URLs — they stay alive as the rollback
      path until Phase 6 completes.

## Phase 1 — Artifact verification (any machine with Docker)

- [ ] `cd SubNation2 && ./scripts/docker-verify.sh` — native build + boot +
      health gate + single-origin SPA + graceful drain (exit 0).
      ⚠️ BLOCKED in r107 sandbox (no Docker) — this run IS the verification.
- [ ] `./scripts/docker-verify.sh --arm64` — QEMU cross-build for
      linux/arm64 (proves the pnpm/argon2/sharp toolchain on the Oracle CPU).
- [ ] (Optional, public repo) Actions → openwa → "Docker Image (multi-arch)"
      → Run workflow. Confirm a green run and a `ghcr.io/ahmadmedo1012/openwa`
      package. ⚠️ NOT YET VERIFIED in r107.
- [ ] (Optional, private repo) Same for SubNation2's workflow — mindful of
      metered minutes. ⚠️ NOT YET VERIFIED.

## Phase 2 — Oracle VM provisioning

- [ ] Create VM.Standard.A1.Flex (2 OCPU / 12 GB / Ubuntu 22.04+ / ≥50 GB),
      upload SSH key, note public IP.
- [ ] OS hardening: `apt update && upgrade`, key-only SSH, `fail2ban`.
- [ ] Firewall BOTH layers (the Oracle trap):
      - [ ] Cloud Security List / NSG: allow 22, 80, 443, 8000 (temp) tcp.
      - [ ] Host iptables insert-before-REJECT rules + `netfilter-persistent save`.
      - [ ] ufw: 22, 80, 443, 8000 (temp).
- [ ] Install Docker (Coolify bundles it, but verify `docker ps` works).
- [ ] Install Coolify: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`,
      complete the wizard on `:8000`, set a strong password.
- [ ] Restrict/close 8000 after the wizard (or put the dashboard on a
      subdomain with direct DNS).

## Phase 3 — Secrets + data plane

- [ ] Generate any NEW secrets only if rotating (recommended at migration):
      `SESSION_SECRET=$(openssl rand -base64 64|tr -d '\n')`,
      `ADMIN_JWT_SECRET=$(openssl rand -base64 64|tr -d '\n')` (must differ),
      `ENCRYPTION_KEY=$(openssl rand -hex 32)` (64 hex — rotating this makes
      existing encrypted inventory unreadable — **do NOT rotate if unsure**),
      `OPENWA_CREDENTIALS_KEY=$(openssl rand -hex 32)` (if the gateway has
      never had one, setting it now is safe — legacy blobs re-encrypt on
      first read; if one is ALREADY set on Render, copy it).
- [ ] Scheduler mode (R108): `SINGLE_INSTANCE_MODE=true` is now the default
      in `deploy/env.compose.example` — schedulers run ungated in-process,
      zero periodic Neon coordination queries, idle Neon autosuspend
      preserved. The old "pick a lease cadence" trade (25 s/60 s keeps Neon
      awake 24/7) is GONE — do not re-enable lease tuning unless you deploy
      multiple replicas (then unset SINGLE_INSTANCE_MODE and see migration
      doc §9).
- [ ] Validate the filled env file BEFORE any deploy minutes are spent
      (R108): `pnpm --filter @workspace/scripts run validate:env -- --file
      .env --strict` — catches placeholder secrets that pass boot rules,
      missing vars, origin inconsistencies, and the WHATSAPP_OTP_API_KEY ↔
      OPENWA_API_KEY parity requirement. Exit 0 = proceed.
- [ ] Neon: confirm `DATABASE_URL` allows connections from the VM's IP
      (Neon IP-allow-list if configured) — test:
      `docker run --rm postgres:16-alpine pg_isready -d "<DATABASE_URL>"` or
      a quick `psql` from the VM.

## Phase 4 — Deploy the stack on Coolify

- [ ] Coolify → + New → Docker Compose → Git → `ahmadmedo1012/SubNation2`
      @ `main` (add the GitHub token/provider first).
- [ ] Environment: paste `deploy/env.compose.example` filled with Phase-3
      values. Double-check:
  - [ ] `VITE_API_BASE_URL` / `VITE_SOCKET_URL` / `VITE_API_URL` are EMPTY
        (single-origin contract — the #1 migration trap).
  - [ ] `AUTH_COOKIE_SAMESITE=lax` (same-origin now).
  - [ ] `WHATSAPP_OTP_API_KEY` == `OPENWA_API_KEY`.
  - [ ] `WHATSAPP_OTP_BASE_URL=http://<openwa-service>:2785` (internal).
- [ ] openwa service: swap `build:` for an IMMUTABLE image tag
      `ghcr.io/ahmadmedo1012/openwa:sha-<short>` (pin the sha tag from the
      Actions run or `docker manifest inspect`; `:latest`/`:main` float and
      are dev-only — R108)
      (or deploy openwa as its own Coolify application from its repo and
      remove the service from the stack — see migration doc §5).
- [ ] Deploy. Watch: build ~2-4 min (first time), then container logs:
  - [ ] `[boot]` migration lines complete (incl. V1-M20), gate opens,
        `GET /api/healthz` → 200 on the VM:
        `curl -s http://127.0.0.1:3000/api/healthz` (if compose ports kept).
  - [ ] Deployed-SHA gate (R108): the running build must be the one you
        intended — `curl -s http://127.0.0.1:3000/api/healthz | jq -r .version`
        returns the 7-char GIT_SHA; compare against `git rev-parse --short
        HEAD` (or the sha- tag you pinned). Mismatch = investigate before
        attaching any domain.
- [ ] Attach a TEST domain first (e.g. `test.subnation.ly` → subnation
      service, Cloudflare DNS-only/grey initially) — do NOT touch the
      production record yet.

## Phase 5 — Validation gates on the test domain

All must pass BEFORE the DNS cutover:

- [ ] `GET /api/healthz` → 200 `{"status":"ok"}`.
- [ ] `GET /api/healthz/summary` → 200. No-Redis reads `ok` (single-tier
      note) since R108 — `failing` is not acceptable.
- [ ] SPA loads (Arabic RTL, admin login page reachable).
- [ ] User auth: Telegram + Google + WhatsApp OTP login flows.
- [ ] Socket.IO: admin panel → the bell/order pages live-update
      (Network tab: `socket.io/?...EIO=4` handshake succeeds — polling first,
      then `101 Switching Protocols`). This exercises the r107 same-origin
      handshake fix.
- [ ] Catalog: home page products render with images (45 active WebP).
- [ ] Checkout end-to-end: add to cart → checkout → order created → wallet
      balance/order list correct.
- [ ] Admin: login, dashboard, products/orders/topups pages, WhatsApp page.
- [ ] WhatsApp OTP: send a test OTP end-to-end (gateway session restored —
      watch gateway logs for the boot auto-restore of `subnation-otp`).
- [ ] Graceful drain: Coolify → Redeploy (or `docker stop`) during light
      traffic; container exits 0 within ~25 s, no 502 burst.
- [ ] Restart persistence: reboot the gateway container; WhatsApp session
      auto-restores from Neon (no QR re-scan needed).
- [ ] Scheduler: after 2 min, admin → observability shows mode `single`
      (SINGLE_INSTANCE_MODE) with active=true — the R108 shape. The old
      leader=true (PG-lease) reading applies only to the multi-instance
      election mode.
- [ ] WhatsApp gateway collision guard (R108): after the Oracle gateway
      passes its E2E OTP test, manually SUSPEND the Render `openwa-gateway`
      service (user-suspend, not billing-suspend — user-suspends are NOT
      auto-resumed at the free-hours reset). Two live gateways restoring the
      same `openwa_sessions` credentials = WhatsApp one-linked-device
      conflict = OTP breaks on BOTH paths during the soak window.

## Phase 6 — Production cutover (operator decision — do it yourself)

- [ ] Cloudflare → `subnation.ly` A/AAAA record → VM public IP (proxied/orange
      for the apex+www; `www` CNAME unchanged). SSL mode stays Full (strict).
- [ ] Wait for propagation; run Phase-5 gates again on the production domain.
- [ ] Update `VITE_OPENWA_DOCS_URL` build arg if the gateway now has a new
      domain (or leave the Render gateway link until it migrates too).
- [ ] Soak: keep Render + Vercel running for ≥1 week as the rollback path.
- [ ] After soak: delete the Render services (`subnation`, `openwa-gateway`)
      and the Vercel project. Revoke any platform tokens you no longer need.

## Rollback (at any point before Phase 6 deletion)

- [ ] DNS: point `subnation.ly` back to the old origin (1-minute change).
- [ ] App: nothing else needed — Neon was shared, no data fork happened
      (the new stack wrote to the same DB; if you want to be strict, restore
      the Phase-0 backup into a fresh Neon branch and point Render at it).
- [ ] Gateway: `WHATSAPP_OTP_BASE_URL` back to
      `https://openwa-gateway-7aaa.onrender.com` (Render env) — the persisted
      session table is shared, the old gateway picks it up on boot. RESUME
      the manually-suspended Render `openwa-gateway` FIRST and stop the
      Oracle gateway container BEFORE the DNS flip when rolling back the
      gateway too — never run both live (WhatsApp one-linked-device rule,
      see the Phase-5 guard).
