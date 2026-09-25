# Cloudflare Final Cutover — subnation.ly → the Oracle VM

> The DNS switch that moves subnation.ly from the old origin (Render) to the
> Oracle VM running Coolify. Everything before the switch is READ-ONLY — the
> actual record edit is a deliberate operator action, taken only after
> `scripts/dns-cutover-check.sh` prints READY.
>
> Prerequisites (both Coolify resources deployed and green):
> `COOLIFY_FINAL_SETUP.md`. VM prep: `ORACLE_FINAL_SETUP.md`. Rollback:
> `FINAL_ROLLBACK_RUNBOOK.md`. Phase-0 backup: `MIGRATION_RUNBOOK.md`.
>
> Scope: Cloudflare DASHBOARD settings only — no API automation is involved
> in the cutover (§7).

## 1. DNS records (final state)

| Record | Type | Value | Proxy | Purpose |
|---|---|---|---|---|
| `subnation.ly` | A | `<VM_IP>` | Proxied (orange) | apex → VM |
| `www` | CNAME | `subnation.ly` | Proxied (orange) | www alias of the apex |
| `coolify.subnation.ly` (optional) | A | `<VM_IP>` | Proxied (orange) + Cloudflare Access | Coolify dashboard, access-restricted |

- `<VM_IP>` = the VM's public IPv4, confirmed in the Oracle console (§5,
  first checklist item).
- The optional dashboard record is safe ONLY proxied and behind a
  Cloudflare Access policy (email/OTP allowlist) — the Coolify dashboard
  has no SSO of its own. Once it works through the domain, close port 8000
  in the firewall (the 80/443-only contract in `ORACLE_FINAL_SETUP.md`).
- IPv6/AAAA records: out of scope — `dns-cutover-check.sh` is v4-only.

## 2. A vs CNAME vs proxied — why these records

- **Apex must be an A record.** `subnation.ly` is the zone apex; plain DNS
  forbids a CNAME there (it would coexist with the SOA/NS records).
  Cloudflare's CNAME flattening can emulate an apex CNAME, but a plain A
  record to the static VM IP is the zero-magic choice for this stack.
- **www is a CNAME → apex.** One source of truth: www resolves through the
  apex to the same VM IP; moving the apex record moves both hosts.
- **Orange cloud (proxied):** Cloudflare terminates TLS at the edge, fronts
  the VM with DDoS/WAF shielding, and hides the VM IP from the public DNS.
  Traffic still reaches Traefik on 443 with a real certificate (§3).
- **Grey cloud (DNS-only):** direct exposure of the VM. Used only
  temporarily for Let's Encrypt pre-issuance (§5 note) or as the fallback
  if Cloudflare itself has an incident.

## 3. SSL/TLS mode: Full (strict) — REQUIRED

The origin (Coolify's Traefik) serves a real Let's Encrypt certificate for
subnation.ly / www. Full (strict) validates that origin cert: both hops
(browser → Cloudflare, Cloudflare → VM) are encrypted with valid
certificates on each side.

**Flexible is FORBIDDEN.** With Flexible, Cloudflare speaks plaintext HTTP
to the origin; the app redirects HTTP → HTTPS; Cloudflare requests again
over HTTP → infinite redirect loop — and every request rides the
CF → VM hop in the clear (a downgrade in both availability and
confidentiality). Keep Full (strict) before AND after the cutover — the
old origin also had a valid cert, so nothing changes at the edge.

## 4. Edge settings

- **WebSockets: ON.** Socket.IO upgrades `/socket.io/` from long-polling to
  a WebSocket; the proxied record must allow WS or admin realtime silently
  degrades to polling. (The cutover script proves the polling handshake;
  verify the live upgrade in the browser Network tab: `101 Switching
  Protocols`.)
- **Caching: no broad API rules.** Cache ONLY static assets — the SPA's
  content-hashed `/assets/*`. `/api/*` must be bypassed: dynamic,
  cookie-bearing, and the app already sets its own `Cache-Control` on its
  public GETs. Do NOT add a "cache everything" page rule.
- **Rocket Loader: OFF (known-risk toggle).** It rewrites script loading
  and can break the SPA's ES modules/PWA. If it was enabled and the SPA
  misbehaves, this is the first switch to flip off.
- **Minimum TLS version: 1.2.** Do not lower it.

## 5. Cutover checklist (exact order)

Preconditions: old origin still alive (the rollback path), Phase-0 Neon
backup taken (`MIGRATION_RUNBOOK.md`), both Coolify resources green
(`COOLIFY_FINAL_SETUP.md` §8).

- [ ] VM IP confirmed (Oracle console — not from memory or stale DNS)
- [ ] VM reachable on 80/443 — Oracle Security List AND host iptables AND
      ufw (all three layers; the classic Oracle trap)
- [ ] `./scripts/dns-cutover-check.sh subnation.ly <VM_IP>` → **READY**
      (NOT READY = fix first; no DNS edits while anything is red)
- [ ] TTL lowered (300 s or less) BEFORE the switch — on the CURRENT
      records (it matters while DNS-only; proxied records re-resolve at
      Cloudflare's edge quickly). Keep it low through the soak for a fast
      rollback path.
- [ ] Coolify TLS ready — the script's certificate check proves it (see
      the pre-issuance note below)
- [ ] application smoke-tested via `--resolve` (the script does this:
      healthz + SPA + socket.io handshake with the production Host pinned
      to the VM IP — e.g. `curl --resolve subnation.ly:443:<VM_IP>
      https://subnation.ly/api/healthz`)
- [ ] ONLY THEN switch the A record in Cloudflare (apex A → `<VM_IP>`,
      proxied/orange; the `www` CNAME is unchanged — it follows the apex)
- [ ] verify `https://subnation.ly/api/healthz` → 200, plus a login and a
      catalog page (products render with images)
- [ ] watch logs 30 min (Coolify: subnation + openwa log panes; error
      rate, OTP sends, socket handshakes)

**Pre-issuance note (how TLS is green BEFORE the switch):** Let's Encrypt
HTTP-01 validation must reach the VM, so the hostname has to resolve to the
VM at least once before the certificate exists. Cleanest sequence: flip the
apex A record to `<VM_IP>` **DNS-only (grey)** → watch the Coolify/Traefik
logs until the LE certificate issues (~1 min) → re-run dns-cutover-check
(READY) → then enable the orange proxy. Alternative: switch straight to
orange and accept a ~1-2 min 526 window while Traefik issues through the
proxy. The test-domain rehearsal (`MIGRATION_RUNBOOK.md` Phase 4) proves
the ACME path beforehand without touching the production record.

## 6. Rollback

- Point the A record back to the old origin (the value recorded in
  Phase 0). The delay is TTL-bounded: at 300 s, most resolvers follow
  within ≤5 minutes; Cloudflare's own edge applies the change immediately.
- **NEVER run two origins serving the same Host simultaneously** — one A
  record, one live origin at a time. The old Render services stay
  suspended (user-suspended, not deleted) through the soak window so this
  flip stays possible; the WhatsApp gateway pair carries the additional
  one-linked-device rule — full choreography in
  `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md`.
- After a clean soak (≥1 week per the runbook), raise the TTL again
  (e.g. 3600 s) and delete the old-origin records per Phase 6.

## 7. Cloudflare API — not used by this stack

This stack NEVER touches the Cloudflare API automatically: no component of
SubNation2, openwa, or the Coolify configuration in `COOLIFY_FINAL_SETUP.md`
calls Cloudflare, and `scripts/dns-cutover-check.sh` is read-only
(dig/curl/openssl). **No Cloudflare API token is required for the cutover —
dashboard edits only.** Optional, later: a narrowly-scoped token
(Zone → DNS → Read) only if the operator wants API-driven checks (e.g. an
automated record/TTL auditor). Never commit it; Coolify's DNS-01
certificate integration (if ever adopted) is a separate, explicit operator
decision — not needed for this cutover.
