# Cloudflare Setup — SubNation Production

**Status:** preparation complete in code. Awaiting DNS propagation + operator-side Cloudflare dashboard configuration.

This document is the authoritative checklist for activating Cloudflare in front of `subnation.ly`. Every step is operator-side (Cloudflare dashboard or DNS) — no further code changes required.

---

## 1. Architecture (post-activation)

```
Browser                            Cloudflare                Render                 App
   │                                   │                       │                    │
   │── HTTPS request ────────────────▶│                       │                    │
   │                                   │── HTTPS request ────▶│                    │
   │                                   │  (with                │── HTTP forward ──▶│
   │                                   │   X-Forwarded-Proto: │                    │
   │                                   │   https,             │                    │
   │                                   │   X-Forwarded-For: <client_ip>,           │
   │                                   │   CF-Connecting-IP:  │                    │
   │                                   │   <client_ip>,       │                    │
   │                                   │   Host: subnation.ly)│                    │
```

**Two TLS terminations** (CF, Render). Origin SSL must be **Full (strict)** — see §3.

---

## 2. DNS configuration

Once propagation completes, in the Cloudflare dashboard:

| Record | Type | Value | Proxy status |
|---|---|---|---|
| `subnation.ly` | A or CNAME | Render's IP / `subnation2.onrender.com` | ☁️ **Proxied (orange cloud)** |
| `www.subnation.ly` | CNAME | `subnation.ly` | ☁️ Proxied |

**Verify:** `dig subnation.ly +short` returns Cloudflare IP (172.x.x.x or 104.x.x.x), not Render's.

---

## 3. SSL/TLS mode — **Full (strict)** (mandatory)

Dashboard → **SSL/TLS → Overview** → set encryption mode to **Full (strict)**.

| Mode | Effect | Use? |
|---|---|---|
| Off | No encryption. Public-facing HTTP. | ❌ never |
| Flexible | Browser↔CF encrypted, **CF↔origin plaintext**. | ❌ leaks plaintext to Render |
| Full | Encrypted both legs but no cert validation. | ❌ MITM-vulnerable |
| **Full (strict)** | Encrypted both legs + cert validation. | ✅ **Required** |

Render provisions a Let's Encrypt certificate automatically for `subnation.ly`. CF will validate it on every request. No certificate work needed on Render side.

**Verify after activation:** `curl -I https://subnation.ly` returns 200 with `cf-ray:` and `server: cloudflare` headers.

---

## 4. Page Rules / Cache Rules (mandatory)

Cloudflare's default cache behaviour is to cache static assets only. We need explicit rules to:
1. Bypass cache for auth + admin + websocket paths.
2. Aggressively cache `/assets/*` (immutable, 1y).

**Cache Rules** (Dashboard → **Caching → Cache Rules**):

| Order | Pattern | Action |
|---|---|---|
| 1 | `subnation.ly/api/auth/*` | **Bypass cache** |
| 2 | `subnation.ly/api/admin/*` | **Bypass cache** |
| 3 | `subnation.ly/api/cwv` | **Bypass cache** |
| 4 | `subnation.ly/socket.io/*` | **Bypass cache** |
| 5 | `subnation.ly/api/healthz*` | **Bypass cache** |
| 6 | `subnation.ly/assets/*` | **Cache eligible**, Edge TTL: **1 month** (overrideable by Origin) |

**Why:** the backend already sets correct `Cache-Control` headers (`max-age=1y, immutable` on `/assets/*`, `private`/`no-store` on auth/admin). The cache rules above are belt-and-suspenders — explicit instructions to CF that take precedence over heuristics.

The catalogue endpoints (`/api/products/*`, `/api/seo/*`) intentionally have `public, s-maxage=...` headers and SHOULD be cached at the edge — leave default behaviour for those.

---

## 5. Features to **disable** (mandatory — they break SPAs)

Dashboard → **Speed → Optimization**:

| Feature | Setting | Why |
|---|---|---|
| **Rocket Loader** | OFF | Asynchronously rewrites `<script>` tags. Breaks React's hydration timing + Sentry init order. |
| **Auto Minify (HTML)** | OFF | Vite already minifies; CF's HTML minifier strips meaningful whitespace + breaks scripts. |
| **Auto Minify (CSS)** | OFF (Vite handles this) | Same reason. |
| **Auto Minify (JS)** | OFF (Vite handles this) | Same reason. |
| **Mirage** | OFF | Image optimization that breaks responsive image semantics in some PWAs. |
| **Polish** | Lossless or OFF | `Lossy` compression can degrade product imagery. |

Dashboard → **Network**:

| Feature | Setting | Why |
|---|---|---|
| **WebSockets** | ON (default) | Required for Socket.IO realtime. Free plan includes it. |
| **HTTP/3 (with QUIC)** | ON (default) | Free perf gain — backend serves HTTP/2 to CF, CF serves HTTP/3 to clients. |
| **0-RTT Connection Resumption** | ON (default) | Free perf gain. Safe (idempotent only). |
| **gRPC** | OFF (we don't use gRPC) | — |

Dashboard → **SSL/TLS → Edge Certificates**:

| Feature | Setting | Why |
|---|---|---|
| **Always Use HTTPS** | ON | Redirects http→https at CF edge. No double-redirect because Render's HTTPS-only behavior never sees the http request. |
| **Automatic HTTPS Rewrites** | ON | Rewrites mixed-content `http://subnation.ly/...` references to `https://`. Defense-in-depth (we already use https everywhere). |
| **HSTS** | OFF (we set it at app layer) | Avoid double HSTS; helmet's HSTS is sufficient and operator-controlled. |
| **TLS 1.3** | ON (default) | — |
| **Minimum TLS Version** | **1.2** | Excludes legacy SSL/TLS 1.0/1.1. |

---

## 6. Firewall / Security (recommended — optional)

Dashboard → **Security → WAF**:

- **Bot Fight Mode**: ON (free, blocks obvious bots).
- **Security Level**: Medium.
- **Challenge Passage**: 30 minutes (default).

Dashboard → **Security → DDoS**:

- Default DDoS protection is on for all plans. No action.

**Optional — Origin lockdown** (recommended after CF is verified working):

To prevent attackers from bypassing CF and hitting Render directly with a forged `CF-Connecting-IP` header, restrict Render to accept traffic only from Cloudflare's IP ranges. Until this is done, the `cloudflareClientIp` middleware (`backend/src/middlewares/cloudflareClientIp.ts`) gracefully no-ops when no `CF-Connecting-IP` header is present, so this gap is non-breaking — but it IS a gap.

Render Dashboard → service → **Settings → Network → IP Allowlist** → paste Cloudflare's published IPv4 + IPv6 ranges from <https://www.cloudflare.com/ips/>.

After this is done, requests that bypass CF and hit Render directly will be rejected at Render's edge.

---

## 7. What was prepared in code (no operator action)

Already shipped in commits leading up to CF activation:

| Surface | Cloudflare-readiness | Where |
|---|---|---|
| **`req.ip` correctness** | `cloudflareClientIp` middleware overrides req.ip with `CF-Connecting-IP` header when present. Transparent for rate-limit-redis, audit logs, auth-activity, Sentry user context. | `backend/src/middlewares/cloudflareClientIp.ts` |
| **HTTPS detection** | `req.protocol = "https"` works because Render preserves CF's `X-Forwarded-Proto`. | `app.ts` `trust proxy = 1` |
| **Cookies** | `secure: true`, `sameSite: "strict"` (auth) / `"lax"` (OAuth callbacks). | `routes/auth.ts` |
| **Cache-Control** | `/assets/*` immutable + 1y. `/api/auth/me` private + 30s. `/api/products/*` public s-maxage=60. `/api/admin/observability/*` no-store. `/api/healthz/summary` public 15s. | distributed across routes |
| **CSP** | No CF-injected scripts to allowlist. Existing CSP works. | `app.ts` helmet config |
| **Canonical-host redirect** | Skips `/api/healthz/*` so Render's internal probes don't 301. CF preserves Host so app-level redirect remains correct. | `app.ts` |
| **Socket.IO** | Default config (polling+websocket, ping 25s, timeout 20s) — well under CF Free's 100s idle limit. Redis adapter survives instance scale-out. | `lib/socket.ts` |
| **SPA bundle hashing** | Vite emits `assets/[name]-[hash].js` (content-addressed, immutable). Perfect for CF caching. | `vite.config.ts` |

---

## 8. Verification checklist (run after activation completes)

Run these in order. Each step takes < 30 seconds.

### 8.1 DNS + TLS

```bash
# Should show Cloudflare IP (172.* or 104.*), not Render's
dig subnation.ly +short

# Should return 200 with cf-ray + server: cloudflare
curl -sI https://subnation.ly | grep -E '^(HTTP|server|cf-ray)'

# www should 301 to apex, served by CF
curl -sI https://www.subnation.ly | grep -E '^(HTTP|location)'
```

### 8.2 Static assets are CF-cached

```bash
# First request — origin pull (cf-cache-status: MISS or DYNAMIC)
curl -sI https://subnation.ly/assets/index-DUZYZe_7.js | grep -i cf-cache-status

# Second request — should be HIT
curl -sI https://subnation.ly/assets/index-DUZYZe_7.js | grep -i cf-cache-status
# Expect: cf-cache-status: HIT
```

(Asset hash will differ — grab the actual filename from `view-source:https://subnation.ly`.)

### 8.3 Auth endpoint NOT cached

```bash
# Should NOT be cached. cf-cache-status should be DYNAMIC or BYPASS.
curl -sI https://subnation.ly/api/auth/providers | grep -i cf-cache-status
# Expect: cf-cache-status: DYNAMIC  or  BYPASS
```

### 8.4 WebSocket upgrade works

Open the live site in DevTools → Network → WS tab. Sign in, then watch:

- A `socket.io` connection should appear with status 101 (Switching Protocols)
- Frames should flow in both directions when an order/topup status changes admin-side
- No fallback to long-polling under normal conditions (transports tab shows `websocket`)

### 8.5 Real client IP is captured

After a known sign-in:

```sql
-- In Neon
SELECT identifier, ip_address, user_agent, created_at
FROM auth_activity
ORDER BY created_at DESC
LIMIT 5;
```

The `ip_address` column should show real client IPs, NOT Cloudflare's edge IPs (`104.16.*` / `172.66.*`). If you see CF IPs, the `cloudflareClientIp` middleware isn't firing — verify the CF-Connecting-IP header reaches the origin.

### 8.6 No CSP violations

DevTools → Console on the live site. Browse: home, login, register, profile, admin (if you have access). Expect zero `Refused to load …` console errors. If a CF-injected script triggers CSP, disable Rocket Loader (per §5).

### 8.7 No redirect loops

```bash
# Single 301 to apex from www, no looping
curl -sIL https://www.subnation.ly | grep -c '^HTTP'
# Expect: 2 (the 301, then the 200 from apex)
```

### 8.8 Render edge probe still works

Render's internal health check pings `/api/healthz` on the onrender hostname (which bypasses CF). Should still return 200. Check Render dashboard → service → Events for any probe failures during the cutover window.

### 8.9 DNS resolution stability (debugging "ERR_NAME_NOT_RESOLVED for some clients")

DNS propagation is asynchronous and inconsistent across resolvers. Globally:
- Cloudflare's `1.1.1.1` resolves new records within minutes.
- Google's `8.8.8.8` typically within 1-15 minutes.
- ISP / mobile-carrier resolvers can lag **24-48 hours** with cached negative results.
- Some misconfigured corporate / ISP DNS still cache the old record's TTL.

If users report `ERR_NAME_NOT_RESOLVED` while others reach the site fine, this is propagation lag, not a Cloudflare bug.

**Verify DNS health:**

```bash
# Should return Cloudflare IPs from MULTIPLE public resolvers
dig +short subnation.ly @1.1.1.1
dig +short subnation.ly @8.8.8.8
dig +short subnation.ly @9.9.9.9

# AAAA (IPv6) record — should ALSO resolve to CF IPv6
dig +short AAAA subnation.ly @1.1.1.1

# DNSSEC chain — should be SECURE if you enabled it on CF
dig +dnssec subnation.ly @1.1.1.1 | grep -E '^(;; flags|;; ANSWER|RRSIG)'
```

**Cloudflare-side checks** (Dashboard → DNS):

| Setting | Required value |
|---|---|
| `subnation.ly` A record | Proxied (orange cloud) — CF will return CF anycast IPs |
| `subnation.ly` AAAA record | Should auto-exist if you set "AAAA records" mode to enabled |
| **CNAME flattening at apex** | ON (Cloudflare → DNS → Settings → "CNAME Flattening" → "Flatten all CNAMEs") — required because we're CNAMEing the apex to Render's onrender.com hostname |
| **DNSSEC** | Optional. If ON, you must publish the DS record at the registrar. If only PARTIALLY ON (CF says enabled but registrar hasn't published the DS), some validating resolvers will refuse to resolve. Either fully complete or fully disable. |
| **Record TTL** | Auto (CF manages, ~5 min) — DON'T set very long manual TTLs during propagation |

**Render-side** (only relevant if DNS is partial):

- Render dashboard → service → Custom Domains → both `subnation.ly` and `www.subnation.ly` should show "Verified" with a green checkmark.
- If "Awaiting DNS" → the apex CNAME flattening hasn't activated yet; wait or re-verify.

**If a specific client can't resolve:**

```bash
# From their machine:
nslookup subnation.ly                 # check their resolver result
nslookup subnation.ly 1.1.1.1         # check Cloudflare resolver result

# If the second one resolves but the first doesn't:
# → their ISP/corporate DNS is caching stale data. Will clear within 24-48h.
# → as a workaround, they can switch to 1.1.1.1 or 8.8.8.8.
```

**Don't:**
- Don't change the TTL repeatedly mid-propagation.
- Don't toggle CF proxied/grey-cloud during propagation — it just adds another wave of caching.
- Don't disable DNSSEC after registrar published the DS without removing the DS first; same for vice-versa.

---

## 9. Rollback (if anything is broken)

Cloudflare activation is **fully reversible at the DNS layer**:

1. Cloudflare dashboard → DNS → set the proxy status of `subnation.ly` to **DNS only (grey cloud)**.
2. Within ~60 seconds, traffic flows directly to Render again, bypassing CF entirely.
3. The `cloudflareClientIp` middleware no-ops automatically when CF isn't in the path.
4. No code change needed; no Render redeploy needed.

If only specific behaviour is broken (e.g. WS won't upgrade), prefer to disable the offending CF feature (e.g. Rocket Loader, Auto Minify) rather than disable the whole proxy.

---

## 10. Expected post-activation impact

Based on the May 2026 Loadster results (see `PLATFORM.md` § 9.0):

- **Bundle delivery** offloaded to CF edge. Run 3 already showed −23% bytes from browser cache; CF turns that into −95% bytes hitting the dyno because the FIRST visit per region also serves from edge.
- **Static asset latency** drops to local-edge RTT (typically < 50ms in MENA) instead of Render's Oregon → user.
- **DDoS / bot traffic** absorbed at CF, never reaches Render.
- **TLS handshake** offloaded.
- **HTTP/3** for clients that support it.

Re-run the same 25-VU Loadster test after activation. Expected:

- Peak `responseTimeP95`: < 10s (was 27.34s in Run 3)
- `navigation timeout` errors: < 5 (was 26)
- Origin bandwidth: ~1/10 of pre-CF traffic

---

*Document maintained by the SubNation engineering team. Update after each Cloudflare configuration change. Pair with `PLATFORM.md` § 9.0 for load-test evidence.*
