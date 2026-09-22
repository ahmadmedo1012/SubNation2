# SubNation Production Architecture

> r107 canonical map of the FINAL architecture (self-hosted Oracle ARM64 +
> Coolify + Docker, external Neon). It describes what runs where, what is
> stateful, what can fail independently — the Render/Vercel split it replaces
> is documented as history at the bottom. Operations detail lives in
> `OPERATIONS_RUNBOOK.md`; migration steps in `docs/deployment/`.

## 1. Runtime topology (single server)

```
┌──────────────────────────── Oracle VM (ARM64 · 2 OCPU · 12 GB) ───────────────────────────┐
│                                                                                             │
│  Coolify (docker orchestration)                                                             │
│  ├── Traefik edge (Coolify-managed, LE certs)  :80/:443 → routes by Host header            │
│  │                                                                                          │
│  ├── subnation (this repo, ONE image, ONE container)                                        │
│  │    Express 5 :8080                                                                       │
│  │    ├── JSON API  /api/*  (auth, catalog, checkout, wallet, admin, copilot, SEO files)    │
│  │    ├── Socket.IO (same http server, /socket.io/, WS+polling)                             │
│  │    ├── SPA static  (frontend/dist/public — single origin, no split hosting)              │
│  │    ├── in-process schedulers: node-cron daily slots + PG-lease leader + 60 s alerting    │
│  │    └── in-memory fallbacks: rate-limit store, LRU caches, idempotency pass-through       │
│  │         (Redis ABSENT by design — everything degrades, nothing blocks)                   │
│  │                                                                                          │
│  └── openwa (github.com/ahmadmedo1012/openwa, ONE container)                                │
│       Baileys WhatsApp gateway :2785 (internal)                                             │
│       ├── REST /api/* behind X-API-Key (timing-safe compare) + sliding-window rate limits  │
│       ├── operator dashboard (cookie auth, disabled unless DASHBOARD_* set)                 │
│       └── /data volume (hot Baileys auth folder; DB is the source of truth)                 │
│                                                                                             │
└──────────────┬─────────────────────────────────────────────┬───────────────────────────────┘
               │                                              │
      Neon PostgreSQL (EXTERNAL)                     Cloudflare → subnation.ly
      ├── business schema (Drizzle, 12 migrations)   DNS proxy, WAF, WS passthrough
      ├── openwa_sessions (gateway-owned, AES-GCM)
      └── scheduler_leader_lease (single-row CAS)
```

External SaaS the runtime talks to (all optional, degrade cleanly):
Firebase Auth (Google/Telegram identity verification), Telegram Bot API
(ops alerts + approval gateway), Sentry (errors/traces), OpenAI-compatible
LLM (admin copilot + enrichment), Google Analytics (frontend, build-time).

## 2. What is stateful / stateless / external

| Piece | Nature | Where its state lives | Failure isolation |
|---|---|---|---|
| subnation container | stateless | Neon (+ ephemeral in-memory caches, bounded LRU) | restart-safe; boot re-runs idempotent migrations |
| Socket.IO connections | ephemeral | client reconnect backoff (r104: 10 attempts, 10 s cap) | users reconnect transparently |
| schedulers | process-local, lease-guarded | `scheduler_leader_lease` row in Neon | fail-closed demotion on DB error, 20 s re-acquire |
| openwa container | effectively stateless | Neon `openwa_sessions` + /data volume | restart → boot auto-restore from DB |
| Neon | external, THE database | its own infra | app answers 503 `starting`/failing; gateway runs on local folder until DB returns |
| Cloudflare | external edge | DNS only | grey-cloud fallback possible |
| Coolify/Traefik | infra on the VM | `/data/coolify` volume | apps keep running if Coolify UI dies; routing needs Traefik up |

In-memory-only state (accepted, bounded): connection tracker (60 s sweep),
CWV beacon caps (60 s sweep), alert dedup (128-key FIFO), session-liveness
cache (60 s TTL), generation-scoped catalog LRU (5000 entries).

## 3. Request lifecycles (condensed)

- **Auth:** Telegram/Google/Firebase id-token → verified → `auth_token` JWT
  cookie + sessions row; admin: argon2 password (+ dummy-verify on unknown
  user — timing parity) → `admin_token` JWT + admin_sessions (revocable).
  WhatsApp OTP: phone → gateway send → HMAC-derived code in DB → consume.
- **Checkout:** localStorage idempotency key → PG idempotency-keys row →
  transaction (stock decrement + order + wallet ledger) → provider
  fulfillment (manual by default) → sockets push order updates.
- **Realtime:** handshake gates: IP caps → origin allowlist (r107 Host
  fallback for same-origin polling) → JWT → DB liveness (60 s cache,
  5 min re-verify) → rooms `user:<id>` / `admin-room`.
- **Maintenance (event-driven):** real traffic triggers opportunistic sweeps
  (stock/flash-sale/coupon/OTP-prune/copilot-reaper, throttled 5-60 min per
  job) — no artificial traffic anywhere (the 2026-09-20 purge is complete).

## 4. Security posture (self-hosted deltas)

- Containers run as non-root `node` (both images, VERIFIED).
- `trust proxy` = 1 hop — correct behind Traefik; Cloudflare-IP validation
  happens in `cloudflareClientIp` (XFF rightmost + CF range check).
- Secrets enter ONLY via Coolify/compose env; gitleaks + CI secret-scan gate
  the repo (VERIFIED clean at r107 across both repos).
- Same-origin deployment upgraded cookie posture to `SameSite=lax`
  (was `none` for the Vercel→Render split).
- Gateway↔backend traffic stays on the compose network (no public exposure
  needed for OTP delivery).

## 5. Resource budget (12 GB envelope, measured/estimated)

| Consumer | Idle RSS (est.) | Notes |
|---|---|---|
| Ubuntu + Docker daemon | ~0.6-1.0 GB | |
| Coolify (all containers incl. Traefik/Postgres/Soketi) | ~0.8-1.2 GB | Coolify's own stack |
| subnation (Node 22, pnpm runtime) | ~250-400 MB | measured on Render free 512 MB with headroom |
| openwa (Node 22 + Baileys) | ~150-300 MB | no browser process by design |
| Build spike (Coolify Git builds) | ~1.5-2 GB, 2-4 min | transient; cache makes it rare |
| Headroom for bursts | ~7-8 GB | generous for a store of this scale |

Idle CPU is dominated by per-connection Socket.IO pings (25 s) and the
leader refresh (25 s single UPDATE) — effectively 0 on 2 OCPU.

## 6. History (what this replaced)

- **Until 2026-09:** Render web service (this Dockerfile, blueprint
  `render.yaml`) + Vercel SPA (`vercel.json` rewrites → Render API) + Render
  openwa gateway. Free-tier hour economics: shared 750 h/month pool across 8
  services → exhausted 2026-09-16 → all suspended → monthly October reset
  cycle. The migration's motivation.
- **2026-09-20:** Northflank fully rolled back (project deleted, keys
  revoked) — never to return (standing order).
- **2026-09-22 (r107):** migration-readiness round — hosting coupling
  removed from code, ARM64 proven at the dependency level, compose + CI
  images + runbooks added, three lifecycle bugs fixed (shutdown drain order,
  same-origin socket handshake, lease cadence economics).
