# Cloudflare Final Cutover — subnation.ly → the Oracle VM

> **Historical record — the cutover EXECUTED 2026-10-01/02** (see
> `FINAL_SIGNOFF.md`); §1–§7 below are the r112 plan as written, §8 is the
> post-cutover truth (DNS-only zone + the Traefik-301 recommendation).
> *(Banner added R118, 2026-10-06.)*

> The DNS switch that moves subnation.ly from the old origin (Render) to the
> Oracle VM running Coolify (as planned at r112 — the live host is a Contabo
> VPS, R117 observed). Everything before the switch is READ-ONLY — the
> actual record edit is a deliberate operator action, taken only after
> `scripts/dns-cutover-check.sh` prints READY.
>
> Prerequisites (both Coolify resources deployed and green):
> `COOLIFY_FINAL_SETUP.md`. VM prep: `ORACLE_FINAL_SETUP.md`. Rollback:
> `FINAL_ROLLBACK_RUNBOOK.md`. Phase-0 backup: `MIGRATION_RUNBOOK.md`.
>
> Scope: Cloudflare DASHBOARD settings only — no API automation is involved
> in the cutover (§7).

## 1. DNS records (final state — as DESIGNED at r112)

> **⚠ OBSERVED LIVE (R117+, re-confirmed 2026-10-06):** the records are
> **DNS-only (grey)** — apex + www A records straight to the VM, Let's
> Encrypt cert at origin, NO Cloudflare proxy/edge in the live path. The
> table below is the r112 design, never enacted — see the §8 addendum for
> the observed state + the open `www → apex` 301 recommendation before
> "re-fixing" anything here.

| Record | Type | Value | Proxy | Purpose |
|---|---|---|---|---|
| `subnation.ly` | A | `<VM_IP>` | Proxied (orange) — **designed; live = DNS-only (grey)** | apex → VM |
| `www` | CNAME | `subnation.ly` | Proxied (orange) — **designed; live = DNS-only (grey)** | www alias of the apex |
| `coolify.subnation.ly` (optional) | A | `<VM_IP>` | Proxied (orange) + Cloudflare Access | Coolify dashboard, access-restricted |

- `<VM_IP>` = the VM's public IPv4 (live host: the Contabo VM, R117 observed
  — the original runbook said "confirmed in the Oracle console", §5,
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

## 5. Cutover sequence (exact order — the safe two-stage TLS path)

Preconditions: old origin still alive (the rollback path), Phase-0 Neon
backup taken (`MIGRATION_RUNBOOK.md`), both Coolify resources green
(`COOLIFY_FINAL_SETUP.md` §8).

The order exists because of one hard dependency: **Let's Encrypt must issue
the origin certificate BEFORE Cloudflare's Full (strict) validates it**, and
HTTP-01 validation requires the hostname to actually resolve to this VM.
Hence grey-cloud first, orange second:

- [ ] 1. VM IP confirmed (Oracle console — not from memory or stale DNS)
- [ ] 2. VM reachable on 80/443 — Oracle Security List AND host iptables AND
      ufw (all three layers; the classic Oracle trap)
- [ ] 3. `./scripts/dns-cutover-check.sh subnation.ly <VM_IP>` → **READY**
      (NOT READY = fix first; no DNS edits while anything is red)
- [ ] 4. TTL lowered (300 s or less) on the CURRENT records — keep it low
      through the soak for a fast rollback path
- [ ] 5. **Stage 1 — grey cloud for certificate issuance:** flip the apex A
      record to `<VM_IP>` **DNS-only (grey)**. Watch the Coolify/Traefik
      logs until the Let's Encrypt certificate issues (~1 min); re-run
      `dns-cutover-check.sh` → **READY** (it verifies origin TLS with the
      production Host pinned to the VM IP — `curl --resolve` proves the
      app answers healthz + SPA + the socket.io handshake on the new origin)
- [ ] 6. **Stage 2 — enable the proxy:** switch the A record to
      **proxied (orange)**; `www` CNAME → apex stays proxied/orange
- [ ] 7. Cloudflare SSL mode = **Full (strict)** (it must never be set to
      Flexible — §3); verify `https://subnation.ly` serves with no browser
      warnings on both apex and www
- [ ] 8. Verify the full surface through Cloudflare:
      WebSocket upgrade in the browser Network tab (`101 Switching
      Protocols` on `/socket.io/`), a login + a catalog page (products
      render with images), AND no accidental API caching:
      `curl -sI https://subnation.ly/api/products | grep -i cf-cache-status`
      → expect `DYNAMIC` (anything else = a bad cache rule — fix before
      continuing; §4). Then watch logs 30 min (Coolify: subnation + openwa
      log panes; error rate, OTP sends, socket handshakes)

**The alternative (one-step, orange immediately)** trades safety for speed:
you skip stage 1 and accept a ~1-2 min window of Cloudflare **526** errors
while Traefik issues the certificate through the proxy. It is acceptable
only for a zero-traffic maintenance moment; the two-stage path above is the
default because it never serves a hard error. The test-domain rehearsal
(`MIGRATION_RUNBOOK.md` Phase 4) proves the ACME path beforehand without
touching the production record.

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

## 8. R117 canonical-host addendum (observed 2026-10-05)

> **2026-10-07 (R121) update — the recommendation below is EXECUTED:**
> www→apex is LIVE as a **308** at the Traefik file-provider layer
> (`/data/coolify/proxy/dynamic/www-redirect.yml`, priority 1000; the
> dead v2-syntax `subnation.yml` + 4 backups quarantined to
> `dynamic-archive/`). Design/rollback record:
> `docs/operations/WWW_TO_APEX_301.md`; operator summary:
> `OPERATIONS_RUNBOOK.md` §13. The observations below are the dated
> R117 record (pre-redirect) — kept verbatim.

Observed live reality, recorded by the R117 smoke audit — it differs from
what §1–§2 above describe and from the `f10bb9b` commit's premise:

- **The zone is DNS-only (grey cloud).** No `cf-ray` / `server: cloudflare` /
  `cf-cache-status` headers appear on any response; TLS is a Let's Encrypt
  cert terminated at origin. No Cloudflare proxy rule (redirect or otherwise)
  exists in the live path.
- **No hostname redirect exists at ANY layer.** `https://subnation.ly/` and
  `https://www.subnation.ly/` both answer `200` with byte-identical bodies;
  the only redirects are scheme-only (`http→https`, hostname-preserving).
  The `f10bb9b` premise — that the external proxy already issues a
  non-www→www 307 — is **not currently true**; the R116 Cloudflare redirect
  loop is "broken" only in the sense that nothing redirects at all.
- **Every canonical signal points at the apex:** sitemap (all 56 `<loc>`),
  robots (`Sitemap:`), og:image/og URLs, and the runtime `<link
  rel=canonical>` all use `https://subnation.ly` (a static canonical link is
  also baked into `index.html` as of R117).

**Recommended operator action:** add a single **www→apex 301** at the
**Traefik/Coolify layer** (where both Host rules already exist) — **NOT
in-app**. The R116 Cloudflare-loop incident is exactly why the in-app
redirect was removed; re-adding it at the app layer would recreate the
loop class. With the 301 at the proxy, the two live origins collapse into
one canonical host (apex) and the SEO surfaces become consistent end-to-end.
