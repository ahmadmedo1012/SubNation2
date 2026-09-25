# FINAL COMMAND BOOK — every command, by phase (R112)

> Copy/paste-only book. Every command corresponds to a real file in this
> repository (or a standard Ubuntu/Cloudflare action). Run them in phase
> order. Nothing here invents placeholders that hide missing work — where a
> step needs YOUR value it says `<OPERATOR_INPUT>` explicitly.

## LOCAL (engineering laptop — already executed in R112, repeatable anytime)

```bash
git clone https://github.com/ahmadmedo1012/SubNation2 && cd SubNation2
pnpm install --frozen-lockfile

# full source gates (all green at R112 HEAD)
pnpm run typecheck                                    # exit 0
pnpm run lint                                         # 0 errors (85 warnings baseline)
pnpm --filter @workspace/api-server exec vitest run   # 157 files / 1447 tests
pnpm --filter @workspace/subnation run test:run       # 92 files / 635 tests

# contract + drift + env gates
pnpm --filter @workspace/scripts exec tsx ../scripts/check-openapi-routes.ts
pnpm --filter @workspace/db exec drizzle-kit generate && git diff --exit-code -- shared/db

# production build (API + SPA + PWA)
pnpm --filter @workspace/api-server run build

# secret scan (same engine/version CI pins)
# gitleaks 8.27.2, config .gitleaks.toml — 0 findings at R112 HEAD

# environment validator (negative control: the example file FAILS with 9
# placeholder errors and exit 1; your filled .env must exit 0).
# NOTE: paths resolve relative to the scripts package (pnpm exec runs there)
# — hence the ../ prefix, or pass an absolute path:
pnpm --filter @workspace/scripts exec tsx src/validate-production-env.ts \
  --file ../deploy/env.compose.example --profile compose --strict   # → 9 errors, exit 1
pnpm --filter @workspace/scripts exec tsx src/validate-production-env.ts \
  --file ../.env --profile compose --strict                         # your filled file → exit 0
```

## ORACLE (the VM — first boot)

```bash
ssh ubuntu@<OPERATOR_INPUT_VM_IP>
sudo apt update && sudo apt full-upgrade -y
# …then follow: docs/deployment/ORACLE_FINAL_SETUP.md §2-§11 (sshd hardening,
#    swap, docker, the TWO-layer firewall contract, fail2ban, Coolify install,
#    AND §9 host tooling: Node.js + Corepack/pnpm + postgresql-client-17 —
#    required later by the backup chain and docker-verify)

# phase health checks (§10 of the same doc):
uname -m            # aarch64
free -h && df -h && swapon --show
docker run --rm hello-world          # arm64 pull works
sudo systemctl is-active docker fail2ban
ss -tlnp             # only 22/80/443/8000(coolify setup) + docker bridge listeners
```

## DOCKER (verify the images on the VM — BEFORE any DNS change)

```bash
# repo convention on the VM (docs/DISASTER_RECOVERY.md §Automated backups):
# a plain clone under the ubuntu home — any path works, just stay consistent.
git clone https://github.com/ahmadmedo1012/SubNation2 /home/ubuntu/SubNation2
cd /home/ubuntu/SubNation2
git pull --ff-only

# fill the runtime env (never committed):
cp deploy/env.compose.example .env
vi .env                   # paste real values; secrets only ever via this file
./scripts/generate-production-secrets.sh   # generates the five (see SECRET_HANDLING_FINAL.md)

# THE verification harness (10 gates: build, boot, healthz, SPA, Socket.IO,
# inspect, compose config, openwa, restart, graceful drain). It loads .env
# itself (values never printed) and fails loudly if a required variable is
# missing — never pass secrets on the command line or via shell history:
./scripts/docker-verify.sh --arm64
# → must print: ARM64 VERIFIED  AND  ALL §15 GATES PASSED

# the full preflight (sections A-I; exit 0 = clear):
./scripts/final-cutover-preflight.sh .env
```

## COOLIFY (resource creation)

Follow `docs/deployment/COOLIFY_FINAL_SETUP.md` end-to-end (SubNation =
Git+Docker resource with `GIT_SHA` build arg; OpenWA =
`ghcr.io/ahmadmedo1012/openwa:sha-<short>`; env per
`docs/deployment/FINAL_PRODUCTION_ENV.md`). No shell commands belong to this
phase — it is UI work with a copy/paste checklist at the doc's end.

## NEON (database ops — read-only except drills)

```bash
# one real backup (also the nightly cron's exact command):
pnpm --filter @workspace/scripts run backup --keep 14
# → expect "✓ gzip integrity verified …" then "✓ backup complete: subnation-<ISO>.sql.gz"

# backup preflight:
./scripts/backup-preflight.sh .env

# install the nightly backup cron (docs/DISASTER_RECOVERY.md §Automated backups —
# THE one documented schedule: 03:15 UTC, ubuntu's crontab):
crontab -e
# 15 3 * * * /home/ubuntu/SubNation2/scripts/backup-cron.sh /home/ubuntu/SubNation2 >> /var/log/subnation-backup.log 2>&1

# restore drill (scratch DB only — NEVER production):
# full procedure: docs/deployment/FINAL_RESTORE_DRILL.md
gunzip -c backups/subnation-<ISO>.sql.gz > /tmp/restore.sql
psql "<scratch-db-url>" -f /tmp/restore.sql
./scripts/restore-drill-check.sh "<scratch-db-url>"     # refuses non-scratch names
```

## CLOUDFLARE (DNS cutover — dashboard, by hand)

```bash
# readiness gate (from anywhere; read-only, never modifies DNS):
./scripts/dns-cutover-check.sh subnation.ly <OPERATOR_INPUT_VM_IP>
# → must print READY before you touch the dashboard

# then the records — exact table + order:
#   docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md
#   (A subnation.ly → VM_IP proxied · CNAME www → subnation.ly proxied ·
#    SSL mode Full (strict) · WebSockets ON · cache only /assets/*)
```

## BACKUP (after cutover)

```bash
./scripts/backup-preflight.sh .env          # still clear
pnpm --filter @workspace/scripts run backup --keep 14   # one manual run day-1
tail -5 /var/log/subnation-backup.log       # the nightly ledger line appears
```

## ROLLBACK (if anything breaks)

Follow `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md` — decision matrix first
(symptom → action), then: app rollback = redeploy older commit in Coolify;
OpenWA = stop old, start pinned older sha image (**never two gateways on one
WhatsApp session**); DNS rollback = Cloudflare A record back (TTL-bounded);
**Neon never rolls back** (restore = DR procedure). Never roll back past
the r108 migration state (V1-M20 / Neon-killer regression law).
