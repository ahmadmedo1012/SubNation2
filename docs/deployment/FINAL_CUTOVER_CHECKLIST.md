# FINAL CUTOVER CHECKLIST — executable, in order (R112)

> Print this. Every box is executable and verifiable. Do not reorder: each
> section's gates exist to protect the next section. Reference docs live
> beside each line.

## SECTION A — PRE-CUTOVER (engineering-ready proof)

- [ ] Source gates green at the release SHA: typecheck, lint 0 errors,
      **backend 1447 + frontend 635 + openwa 103 = 2185 tests**, OpenAPI
      route gate, migration drift, production build, gitleaks 0
      (all recorded at R112 HEAD; re-run via `docs/deployment/FINAL_COMMAND_BOOK.md` §LOCAL)
- [ ] Secrets generated on the VM: `scripts/generate-production-secrets.sh`;
      values in password manager + encrypted offline backup
      (`docs/deployment/SECRET_HANDLING_FINAL.md`)
- [ ] Filled `.env` passes `validate-production-env.ts --strict` (exit 0)
      and `scripts/final-cutover-preflight.sh .env` (exit 0)
- [ ] Oracle VM ready: `ORACLE_FINAL_SETUP.md` §10 VM READY checklist
      (aarch64, docker, 2-layer firewall 22/80/443-only, fail2ban, swap)
- [ ] Docker ready: `docker-verify.sh --arm64` printed
      **ARM64 VERIFIED** + all 10 gates passed
- [ ] Coolify ready: `COOLIFY_FINAL_SETUP.md` checklist complete
      (SubNation Git resource + OpenWA sha-pinned image, env entered,
      healthchecks green, domain attached, HTTPS/Let's Encrypt green)
- [ ] Neon reachable: healthz 200 through the domain via
      `dns-cutover-check.sh subnation.ly <VM_IP>` → **READY**
- [ ] Backup completed on the VM: one real run ended with
      "✓ gzip integrity verified" + "✓ backup complete"; nightly crontab
      installed (`FINAL_COMMAND_BOOK.md` §NEON)
- [ ] Restore drill completed on the VM: `restore-drill-check.sh` exit 0
      against a scratch DB (`docs/deployment/FINAL_RESTORE_DRILL.md`;
      the 2026-09-25 sandbox drill PASSED — this box is the VM-parity rerun)
- [ ] SubNation healthy: container health=healthy, `/api/healthz` 200
- [ ] OpenWA healthy: `/healthz` 200; WhatsApp session linked via QR
      (operator, in the gateway dashboard — never share the QR/code)

## SECTION B — PRIVATE SMOKE TEST (before DNS; via --resolve or the
Coolify preview URL — NO public traffic yet)

- [ ] SPA: home + catalog + one product page render (Arabic RTL intact)
- [ ] API: `/api/healthz` 200, `/api/healthz/summary` sane, catalog loads
- [ ] Auth: WhatsApp OTP request → message received → login succeeds
      (this proves the whole SubNation→openwa→WhatsApp chain)
- [ ] Catalog: product availability truthful vs admin inventory counts
- [ ] Checkout (e2e dry): with test stock loaded, a test purchase credits
      the order + decrements inventory + wallet math correct —
      then refund it in admin and verify
- [ ] Socket.IO: live order/wallet updates arrive in the browser session
- [ ] Admin: login + TOTP enrollment screen reachable + inventory upload
      dialog opens (`docs/operations/FINAL_ADMIN_TOTP_SETUP.md`)

## SECTION C — CUTOVER (the irreversible-feeling part; each step reversible)

- [ ] `scripts/dns-cutover-check.sh subnation.ly <VM_IP>` → **READY**
      (checked AGAIN, minutes before the switch)
- [ ] Cloudflare DNS switched: A `subnation.ly` → VM IP (proxied),
      `www` CNAME → apex (proxied); TTL ≤ 300 s beforehand
      (`docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md` §5 order)
- [ ] HTTPS green: `https://subnation.ly` serves the Coolify Let's Encrypt
      cert (Full strict end-to-end; no browser warnings)
- [ ] WebSocket green: a logged-in browser session receives live updates
- [ ] External health green: `https://subnation.ly/api/healthz` → 200
      from an external network (phone on mobile data)

## SECTION D — POST-CUTOVER (first 24 hours)

- [ ] Logs: `docker logs` both services — no error bursts, no restart loops
- [ ] Memory/CPU: `free -h`, `docker stats` — Node RSS stable (no leak climb)
- [ ] Neon behavior: compute graph active only under real traffic;
      **after 1 idle hour: zero lease/election loglines**
      (`docs/deployment/NEON_IDLE_ECONOMICS.md` §9)
- [ ] Scheduler: admin observability shows mode=single, active, all crons
      visible; the 05:00 UTC slot ran (next morning)
- [ ] OpenWA: OTP still working after a Neon idle period (gateway_waking
      path recovers; first OTP after idle may take ~40 s — documented normal)
- [ ] Backup cron: the nightly ledger line appears; artifact integrity
      verified in the log

## SECTION E — SECURITY (close the doors)

- [ ] Admin TOTP **enabled** on `ahmadmedo`
      (`docs/operations/FINAL_ADMIN_TOTP_SETUP.md` — the enrollment itself)
- [ ] Coolify access restricted: coolify subdomain behind Cloudflare Access
      (or IP allowlist), port 8000 closed, strong Coolify account password
- [ ] SSH locked down: key-only auth confirmed, fail2ban active, no extra
      users
- [ ] No unnecessary ports: `ss -tlnp` shows only 22/80/443 + docker bridge;
      the FINAL firewall contract
      (`docs/deployment/ORACLE_FINAL_SETUP.md` §the final firewall contract)
- [ ] Secrets exist ONLY in: Coolify env + password manager + encrypted
      offline backup (never in git, chat, or the repo)
- [ ] Render decision: leave the 6 unused services suspended
      (`docs/deployment/RENDER_LEGACY_FALLBACK.md` — decommission after
      2 stable weeks)

## SIGN-OFF

When every box above is checked, record the run in
`docs/deployment/FINAL_SIGNOFF.md` and the cutover is complete.
