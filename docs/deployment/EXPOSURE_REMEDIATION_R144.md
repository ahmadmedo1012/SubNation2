# Exposure Remediation R144 — close Traefik :8080 + Reverb :6001 on the production VM

> Status: CURRENT @ 2026-10-14 (R144-D1, Task 144-D1).
> Scope: the OPERATOR runbook for closing two publicly-reachable ports on the
> Contabo production host (`169.58.100.161` / `subnation.ly`) that violate
> the documented firewall contract — everything here is VM/Coolify-panel
> work, **report-and-stop territory** per `.hermes.md` (the repo ships no
> Traefik or firewall config; nothing in this repository can close a port).
> Finding of record: `docs/engineering/R143/findings-L17.md` **L17-1 (P2)**;
> recon re-verified by R144-0 (2026-10-14, independent external vantage).
> Companions: `COOLIFY_FINAL_SETUP.md` §1 (the contract) + §4 (what runs on
> the VM) · `docs/operations/CONTABO_COOLIFY_OPERATIONS.md` §1/§5 (host +
> Traefik) · `OPERATIONS_RUNBOOK.md` §16 (the R144 ops section + the
> external uptime watchdog that now watches the edge).
> UI honesty (same rule as COOLIFY_FINAL_SETUP): Coolify's panels evolve —
> they are named by FUNCTION below; match by function if a label differs.

## 1. Current verified state (external probes, 2026-10-14)

All evidence from an **independent external vantage** (read-only HTTP/TLS
probes — never from the VM itself), recorded in L17-1 and re-confirmed by
R144-0:

| Probe (external) | Result (2026-10-14) | Contract says |
|---|---|---|
| `curl http://169.58.100.161:8080/` | `301` → `/dashboard/` | **must not answer at all** |
| `curl http://169.58.100.161:8080/api/version` | `200 {"Version":"3.6.25","Codename":"ramequin","startDate":"2026-10-05T02:19:21Z"}` | dark |
| `curl http://169.58.100.161:8080/dashboard/` | `200` — browsable dashboard | dark |
| `curl http://169.58.100.161:8080/api/http/routers` | `200` — full routing table (13 routers, `Host(subnation.ly)` rules, ACME, redirects) | dark |
| `curl http://169.58.100.161:8080/api/http/services` | `200` — 13 services incl. backend container names/URLs (L17-1) | dark |
| `curl http://169.58.100.161:6001/` | `404 "Not found."` — Reverb answering (R144-0: the WS handshake itself completes **publicly**: HTTP `101` + `pusher:error 4001 "Application does not exist"` — only the Pusher app-key gates access) | dark |
| `curl https://subnation.ly/` | `200` | stays 200 |
| `curl https://subnation.ly/api/healthz` | `200 {"status":"ok"}` | stays 200 |

The violated contract: `COOLIFY_FINAL_SETUP.md` §1 ("VM prep — firewall
contract (**public 22/80/443 only**)") and §2.1 ("Do NOT publish 8080 on the
host — Traefik owns 80/443"); the Oracle-era provisioning guide that carried
the enforcement steps was never re-applied after the 2026-10 Contabo cutover
(L17-1 root cause).

## 2. Why it matters

- **:8080 — the Traefik dashboard + API are UNAUTHENTICATED.** Anyone on the
  internet can read the **full edge topology**: every router + rule (which
  hosts route where), every service (backend container names/URLs), the
  entrypoints, the cert-resolver state, the exact Traefik version and its
  start date. It is read-only and carries no secrets/user data — but it is
  reconnaissance-grade intel handed to any scanner, and a version-targeted
  CVE surface (`3.6.25` is broadcast to the world). It also proves the host
  perimeter does not match the repo's stated contract.
- **:6001 — Coolify's realtime (Laravel Reverb) answers the public internet.**
  The WebSocket handshake completes for anonymous clients; the only gate is
  the Pusher app-key (`pusher:error 4001 "Application does not exist"`).
  Today that gate holds; an app-key leak or a Reverb/Coolify upgrade that
  changes the gating would expose the realtime bus. It is a listener beyond
  the contract, same class as 8080.

## 3. Remediation — in order of preference

Do **(1)** and **(2)** in Coolify first; **(3)** is the enforcement backstop
that makes the contract true at the perimeter regardless of what Coolify
publishes tomorrow. They compose: after any step, run §4's verification from
an external machine.

### 3.1 Option 1 — stop exposing the Traefik dashboard/API (Coolify proxy)

What serves :8080: Coolify's Traefik proxy container ships an entrypoint
named `traefik` bound to host port **8080**, with the `api@internal` router
on it — that router is the dashboard + the unauthenticated API.

- Coolify UI → your **Server** (the Contabo host) → **Proxy**:
  - If your Coolify version exposes a dashboard/API toggle (Proxy
    settings/configuration), **turn the dashboard option OFF**.
  - Otherwise (or additionally) edit the proxy's static configuration and
    remove the `traefik` entrypoint + its `8080:8080` port publication on
    the proxy container (`coolify-proxy`). On the VM the file lives under
    `/data/coolify/proxy/` (static config + the proxy's compose file);
    after editing, **restart the proxy** from the Coolify panel so the
    container is recreated without the publication.
- Prefer the panel-managed setting over hand-editing files: Coolify can
  regenerate proxy config on upgrades — a setting survives, a hand-edit can
  be overwritten (the same discipline as §13 of `OPERATIONS_RUNBOOK.md`:
  never leave a broken file in `dynamic/`, and prefer the managed path).
- Traefik routing on 80/443 is untouched — the app's routers, the ACME
  challenge, the www→apex and http→https redirects all keep working.
- Keep :8080 closed even if you later want the dashboard: the right shape
  is an SSH tunnel (`ssh -L 8080:127.0.0.1:8080 <vm>` with the entrypoint
  bound to localhost), never a public port.

### 3.2 Option 2 — the Reverb/realtime service (:6001)

**In-repo investigation (R144-D1, 2026-10-14): the application has NO
Reverb/Pusher consumer.** Evidence — a repo-wide search for
`reverb|pusher|6001|VITE_PUSHER|PUSHER_APP|ws://|wss://` over
`frontend/src`, `backend/src`, `frontend/.env.example`, `config/env.example`:

- **one literal hit only** — `backend/src/lib/helmet-config.ts:109`, a
  `wss://*.firebaseio.com` CSP `connectSrc` allowlist entry (Firebase RTDB
  over websockets — unrelated to Reverb/Pusher and to :6001); beyond it, no
  client, no env var, no app URL, no dependency reference. Conclusion
  unchanged: the application has zero realtime-service consumers.
- The app's realtime is **Socket.IO over the SAME ORIGIN on 443**
  (`frontend/src/lib/socket.ts:121` — `io(socketUrl || undefined)` where
  `socketUrl` derives from `VITE_SOCKET_URL || getApiBaseUrl()`,
  `frontend/src/lib/api-config.ts:25`; `COOLIFY_FINAL_SETUP.md` §2.2 pins
  `VITE_SOCKET_URL` EMPTY — the single-origin contract). It never touches
  :6001.
- The :6001 listener is **Coolify's own realtime service** (Laravel Reverb on
  current Coolify; `soketi`/`coolify-realtime` on older installs) —
  control-plane plumbing, not an app resource (`COOLIFY_FINAL_SETUP.md` §4
  note; `docs/architecture/PRODUCTION_ARCHITECTURE.md`'s memory table rows
  Coolify's containers — Traefik/Postgres/Redis/Soketi — under the
  control-plane budget, explicitly "NOT the app stack").

**Recommendation: remove/stop the realtime resource entirely** — Coolify UI →
Server → **Realtime** (function-named panel) → stop/disable the service.
Cost: Coolify's own UI realtime features (live terminal/log streaming in the
panel) degrade or fall back to polling — a control-plane convenience loss,
**zero application impact**. If you find yourself missing it, the safe shape
is the same as the dashboard: keep the container on the Coolify internal
network only, no host port publication, and reach it through an SSH tunnel
when needed.

*If a Reverb consumer ever appears in the app* (it does not exist today),
the correct exposure is Traefik-label routing on 443, never a published
6001: route `wss://subnation.ly/app/{key}` through the **https entrypoint**
(a router on the Coolify proxy with the app's domain Host rule + a PathPrefix
rule for `/app/`), bind the Reverb container port to the **Coolify internal
network only**, and let the proxy terminate TLS — the same single-origin
shape the app's own Socket.IO already uses.

### 3.3 Option 3 — Contabo firewall allowlist (the enforcement backstop)

Make the documented contract true at the perimeter: **inbound 22 / 80 / 443
only, everything else denied.** The always-available path is host netfilter
(the Oracle-era guide's pattern, `docs/deprecated/ORACLE_FINAL_SETUP.md` §6,
is the reference implementation — insert ACCEPTs for 22/80/443 **before**
any REJECT, `netfilter-persistent save`, ufw as the audit layer on top;
Contabo's own console also offers a firewall feature on some plans — if
yours has it, mirror the same allowlist there).

**⚠ Before enabling default-deny — never lock out management:**

1. **Confirm SSH works right now** (`ssh` into the VM in a second terminal
   and keep it open while applying rules) and that your key/auth path does
   not depend on any port you are about to close.
2. **Plan your Coolify UI access**: the panel is reached at
   `http://<VM>/coolify` or `:8000` (`OPERATIONS_RUNBOOK.md` §1) — under a
   22/80/443-only rule that path goes dark from the internet. Decide FIRST:
   SSH tunnel (`ssh -L 8000:127.0.0.1:8000 <vm>`) or an explicit temporary
   allowlist entry for your operator IP. :8000 staying open to the world is
   itself beyond the contract — prefer the tunnel.
3. **Leave 80 open** — Let's Encrypt ACME HTTP-01 renewals ride it (Traefik's
   internal ACME router keeps its max priority; `OPERATIONS_RUNBOOK.md` §13).
   443 covers HTTPS + WebSocket. Nothing else in the live stack needs
   inbound: the app's Postgres is Neon (external, outbound-only) and openwa
   has no public domain by design.
4. Then close 8080 + 6001 (and 8000, per #2) inbound, and verify §4 from an
   external machine **before** closing your management session.

## 4. Verification protocol (after the fix — from any external machine)

These are the L17-1 test requirements verbatim: the two exposures must FAIL
to connect while everything user-visible keeps answering.

**Must go dark (fail / timeout / connection refused):**

```bash
curl -m 5 http://169.58.100.161:8080/            # was 301 → /dashboard/
curl -m 5 http://169.58.100.161:8080/api/version # was 200 {"Version":"3.6.25"} — the Traefik version API probe
curl -m 5 http://169.58.100.161:8080/dashboard/  # was 200 (browsable)
curl -m 5 http://169.58.100.161:6001/            # was 404 "Not found." (Reverb answering)
# every one of these must exit non-zero / print 000 — an HTTP status means it is still open
```

**Must keep working (the live contract):**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -m 10 https://subnation.ly/        # 200
curl -sS -o /dev/null -w '%{http_code}\n' -m 10 https://subnation.ly/login   # 200 (SPA route through the edge)
curl -s -m 10 https://subnation.ly/api/healthz                                # {"status":"ok"}
curl -sI -m 10 https://www.subnation.ly/ | head -1                            # 301/308 → apex (§13 contract)
# the app's own realtime — Socket.IO same-origin on 443 (must stay 101):
curl -s -i -m 10 -N \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  'https://subnation.ly/socket.io/?EIO=4&transport=websocket' | head -1      # HTTP/2 101 (or 400 w/ a session error — but NOT a connect failure)
```

Then record the result in `docs/operations/CONTABO_COOLIFY_OPERATIONS.md` §1
(the L17-1 directive: re-verify the firewall contract on Contabo and write
it down) — and check the uptime watchdog's next runs stayed green throughout
(`OPERATIONS_RUNBOOK.md` §16): the probes in
`.github/workflows/uptime-monitor.yml` sample the 80/443 contract every 5
minutes from the same class of external vantage that found this exposure.

## 5. Rollback notes

- **Option 1** — re-enable the dashboard option / re-add the `traefik`
  entrypoint + `8080:8080` publication on the proxy container and restart
  the proxy from the Coolify panel. Nothing about app routing changed, so
  no app-level rollback exists; verify §4's "must keep working" block only.
- **Option 2** — start the realtime resource again from the Server →
  Realtime panel (or redeploy it if removed). Application-side: nothing to
  roll back — the app never consumed it.
- **Option 3** — re-insert the ACCEPT rules (or remove the deny) with the
  same iptables/ufw pattern, `netfilter-persistent save`, and re-run §4's
  "must keep working" block. If you locked yourself out of SSH: Contabo's
  customer console has a VM rescue/terminal path (VNC) — use it to revert
  the netfilter rules; this is exactly why §3.3 insists on the live second
  SSH session before enabling default-deny.
- All three options are VM/panel state — **no repo change is involved in
  any direction**, so no commit, deploy, or migration rollback applies.
