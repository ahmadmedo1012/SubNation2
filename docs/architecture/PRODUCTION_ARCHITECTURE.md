# SubNation Production Architecture

> **DEEP ENGINEERING REFERENCE — the detail behind the canonical front page.**
> The single-page "what runs where" truth lives in
> `docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md` (R112). This doc is the
> companion depth: **why**, the source-level mechanics, the economics, and the
> history. Read the TOPOLOGY first; the TOPOLOGY is authoritative for
> topology/ports/secrets/failure/backup/scaling — this doc adds the engineering
> depth the TOPOLOGY condenses.
>
> Relationship: `FINAL_PRODUCTION_TOPOLOGY.md` (R112 front page) ↔
> `PRODUCTION_ARCHITECTURE.md` (this deep reference) ↔
> `docs/deployment/` (setup/cutover/rollback) ·
> `docs/deployment/SECRET_HANDLING_FINAL.md` (values) ·
> `docs/DISASTER_RECOVERY.md` (restore) · `docs/FINAL_MONEY_INVARIANTS.md`
> (money invariants) · `docs/operations/` (ops).

---

## 0. The canonical topology (one picture — see the front page)

> The full browser→store / OTP / data path, port map, secrets map, failure
> matrix, backup RTO-RPO and scaling truth are in
> **`FINAL_PRODUCTION_TOPOLOGY.md §1–§9`**. It is kept as the single source of
> truth for those facts; this section used to redraw the same ASCII diagram.
> Redrawing it here would duplicate it, so we point instead.

**Stack in one line (r112 design; observed live R117/R118 = self-hosted
Contabo VM, Cloudflare zone DNS-only grey):** `self-hosted VM →
Coolify/Traefik (LE at origin) → subnation Express :8080 + openwa :2785
(internal) → external Neon + Cloudflare DNS`.

> **Observed host (R117 live probe, 2026-10-05):** live A records for both
> `subnation.ly` and `www.subnation.ly` point at `169.58.100.161` (PTR
> `vmi3624162.contaboserver.net` — **Contabo VPS, not the Oracle VM** this doc
> and the migration runbooks describe), TLS is a Let's Encrypt cert at origin,
> and no `cf-ray`/`server: cloudflare` headers appear (Cloudflare zone is
> DNS-only). Verify and reconcile: if the fleet moved hosts, update the
> DR/backup runbook host references (`ORACLE_FINAL_SETUP.md`,
> `DISASTER_RECOVERY.md`) to the real host.

The unique engineering content below is what the TOPOLOGY does **not** carry.

---

## 1. Runtime topology (single server)

```
┌────────── self-hosted VM (r112 design: Oracle ARM64 · 2 OCPU / 12 GB — live: Contabo) ─────┐
│                                                                                             │
│  Coolify (docker orchestration)                                                             │
│  ├── Traefik edge (Coolify-managed, LE certs)  :80/:443 → routes by Host header            │
│  │                                                                                          │
│  ├── subnation (this repo, ONE image, ONE container)                                        │
│  │    Express 5 :8080                                                                       │
│  │    ├── JSON API  /api/*  (auth, catalog, checkout, wallet, admin, copilot, SEO files)    │
│  │    ├── Socket.IO (same http server, /socket.io/, WS+polling)                             │
│  │    ├── SPA static  (frontend/dist/public — single origin, no split hosting)              │
│  │    ├── in-process schedulers: node-cron jobs + 60 s alerting (SINGLE_INSTANCE_MODE)      │
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
      ├── business schema (boot reconciler, V1-M6…V1-M23)  DNS proxy, WAF, WS passthrough
      │                        (r112 design — live = DNS-only grey, no edge; see FINAL_PRODUCTION_TOPOLOGY §1)
      ├── openwa_sessions (gateway-owned, AES-GCM)
      └── scheduler_leader_lease (multi-instance shape only — idle by default)
```

External SaaS the runtime talks to (all optional, degrade cleanly):
Firebase Auth (Google/Telegram identity verification), Telegram Bot API
(ops alerts + approval gateway), Sentry (errors/traces), OpenAI-compatible
LLM (admin copilot + enrichment), Google Analytics (frontend, build-time).

The single origin contract: `VITE_API_BASE_URL`/`VITE_SOCKET_URL`/`VITE_API_URL`
stay EMPTY — the browser speaks relative `/api` and same-origin WebSockets.
There is no second origin anywhere in the path. (TOPOLOGY §1)

---

## 2. Scheduler topology — SINGLE_INSTANCE_MODE is the default (R108)

### 2.1 The default shape: synthetic in-process leadership

The default target (`SINGLE_INSTANCE_MODE=true` in
`deploy/env.compose.example`) is the **single-instance topology**: the one web
container owns every job, and `backend/src/lib/web-scheduler.ts` grants a
**synthetic in-process leadership** — `isLeader` is `true` for the whole process
lifetime and `release()` is a no-op. There is **no leader election, no PG-lease
heartbeat, zero periodic Neon coordination queries**, so idle Neon autosuspend
is preserved (the 25 s lease refresh alone would have kept Neon compute awake
24/7 ≈ 720 h/mo ≈ 180 CU-h, against Neon Free's 100 CU-h/project/month
allowance). Every cron, the 60 s alerting evaluator and the boot one-shots run
ungated in-process. `DISABLE_WEB_SCHEDULERS=true` remains the hard off-switch
and takes precedence over single-instance mode.

Source truth (`web-scheduler.ts`):

- `SINGLE_INSTANCE_MODE=true` declares this process the only scheduler owner
  (line ~50, module doc).
- When set, `isLeader` stays `true` for the whole process lifetime and
  `release()` is a no-op — "nothing to release" (lines ~303–308).
- The boot path logs `SINGLE_INSTANCE_MODE=true — schedulers run ungated in this
  process (no leader election, no lease heartbeat, zero periodic Neon
  coordination queries)` (line ~336).
- `leadership.release()` on shutdown is internally bounded (2 s per the R5
  round-93 A3 guard at line ~361) so graceful shutdown never hangs.

### 2.2 The multi-instance escape hatch (inert by default)

The PG-lease machinery (single-row CAS on `scheduler_leader_lease`, 25 s
refresh / 60 s TTL, fail-closed demotion with a 20 s re-acquire loop) stays in
the codebase for the **multi-instance shape ONLY** — unset the flag to flip back.
Constraints while in single-instance mode: never scale the subnation service
beyond 1 replica (every cron would double-run), and do not run the optional
dedicated `worker.ts` alongside it (it double-runs too and logs a loud warning
naming the fix).

### 2.3 The economics (why single-instance)

Idle Neon autosuspend is the design, not a side effect:

- A 25 s lease-refresh query would keep Neon compute awake 24/7 ≈ **720 h/mo**
  ≈ **180 CU-h** — against Neon Free's **100 CU-h/project/month** allowance.
- `SINGLE_INSTANCE_MODE=true` makes that heartbeat **zero periodic queries**, so
  idle autosuspend is preserved (~0.5 idle q/h vs 144 q/h lease; TOPOLOGY §9).

### 2.4 Scheduler lifecycle integration

This is the same scheduler behaviour folded into the request lifecycles in
§4 below and the failure/backup tables in the TOPOLOGY §7–§8.

---

## 3. Schema authority — boot reconciler + Drizzle chain

The database schema is created/reconciled by the boot reconciler
`backend/src/migrate.ts` (labeled stages **V1-M6 … V1-M23** — the current chain;
the V1-M11 number was never used). The boot reconciler is the source of truth at
runtime; the Drizzle chain mirrors it for the CI drift gate.

- **Drizzle chain** in `shared/db/drizzle/`: **0000–0015** (mirror re-emitted
  R117; runtime chain V1-M23). 0013 (r110) re-synced the mirror for the CI drift
  gate; 0014 (r115 — the loyalty economics core: points_ledger, precise
  reversals, unified welcome policy) and 0015 (R117 — the V1-M23
  `wallet_topups.reviewed_by` re-emit) are the latest re-emits. The old
  "0000–0012 at bb4418e / 0013 lands in r110" text was stale.
- **Migrate stages** run at every boot: probe → alert pattern, idempotent
  DO-block existence checks. Current max stage is **V1-M23** (the r107 map's
  "V1-M6…V1-M20" / "12 migrations" counts were stale).

---

## 4. Request lifecycles (condensed)

- **Auth:** Telegram/Google/Firebase id-token → verified → `auth_token` JWT
  cookie + sessions row; admin: argon2 password (+ dummy-verify on unknown
  user — timing parity) → `admin_token` JWT + admin_sessions (revocable).
  WhatsApp OTP: phone → gateway send → HMAC-derived code in DB → consume.
- **Checkout:** localStorage idempotency key → PG idempotency-keys row →
  transaction (stock decrement + order + wallet ledger) → provider
  fulfillment (manual by default) → sockets push order updates. One atomic
  transaction: inventory claim + balance debit + coupon consumption + order row
  commit together or not at all (`FINAL_MONEY_INVARIANTS.md` M4 — `checkout
  .service.ts` single `.transaction()`; pre-tx `INSUFFICIENT_BALANCE`; race-free
  selection inside the tx).
- **Realtime:** handshake gates: IP caps → origin allowlist (r107 Host fallback
  for same-origin polling) → JWT → DB liveness (60 s cache, 5 min re-verify) →
  rooms `user:<id>` / `admin-room`.
- **Maintenance (event-driven):** real traffic triggers opportunistic sweeps
  (stock/flash-sale/coupon/OTP-prune/copilot-reaper, throttled 5-60 min per
  job) — no artificial traffic anywhere (the 2026-09-20 purge is complete).
- **Money invariants** (topup atomicity M1, topup dedup M2, `mobile_transfer`
  requires a payment reference M3 — `wallet.ts:365` (see
  `docs/FINAL_MONEY_INVARIANTS.md`, the cite-owner), refunds M7, etc.) are the
  full invariant set in `docs/FINAL_MONEY_INVARIANTS.md`; M3/M4 are the two most
  relevant to this topology.

---

## 5. Security posture (self-hosted deltas)

- Containers run as non-root `node` (both images, VERIFIED).
- `trust proxy` = 1 hop — correct behind Traefik; Cloudflare-IP validation
  happens in `cloudflareClientIp` (XFF rightmost + CF range check).
- Secrets enter ONLY via Coolify/compose env; gitleaks + CI secret-scan gate
  the repo (VERIFIED clean).
- Same-origin deployment upgraded cookie posture to `SameSite=lax`
  (was `none` for the Vercel→Render split).
- Gateway↔backend traffic stays on the compose network (no public exposure
  needed for OTP delivery).

---

## 6. Resource budget (12 GB envelope, measured/estimated)

| Consumer | Idle RSS (est.) | Notes |
|---|---|---|
| Ubuntu + Docker daemon | ~0.6-1.0 GB | |
| Coolify (all containers incl. Traefik/Postgres/Redis/Soketi) | ~0.8-1.2 GB | Coolify's own control-plane (its internal DB/queue) — NOT the app stack; the app's Postgres is Neon (external) and the no-app-Redis rule is unaffected by Coolify's plumbing |
| subnation (Node 22, pnpm runtime) | ~250-400 MB | measured on Render free 512 MB with headroom (pre-migration evidence; re-verify on the Oracle A1 at first boot) |
| openwa (Node 22 + Baileys) | ~150-300 MB | no browser process by design |
| Build spike (Coolify Git builds) | ~1.5-2 GB, 2-4 min | transient; cache makes it rare |
| Headroom for bursts | ~7-8 GB | generous for a store of this scale |

Idle CPU is dominated by per-connection Socket.IO pings (25 s) — effectively
0 on 2 OCPU. In the default SINGLE_INSTANCE_MODE there is no periodic
leader-refresh query at all; the 25 s lease UPDATE exists only in the
multi-instance shape.

---

## 7. History (what this replaced)

- **Until 2026-09:** Render web service (this Dockerfile, blueprint
  `render.yaml`) + Vercel SPA (`vercel.json` rewrites → Render API) + Render
  openwa gateway. Free-tier hour economics: shared 750 h/month pool across 8
  services → exhausted → all services billing-suspended (~2026-09-11;
  `subnation.ly` 503, resume/deploy API-rejected — dated records:
  `docs/history/free-tier-optimization-2026-09-20.md`,
  `docs/history/final-audit-2026-09-20.md` (both moved to `docs/history/`
  by the R122 docs reorg);
  the last live deploy runs 2026-09-11 code) → monthly October reset cycle.
  The migration's motivation.
- **2026-09-20:** Northflank fully rolled back (project deleted, keys
  revoked) — never to return (standing order).
- **2026-09-22 (r107):** migration-readiness round — hosting coupling
  removed from code, ARM64 runtime natives proven at the dependency level
  (the build-toolchain gap was found by R109 and fixed in r110 `bb4418e`),
  compose + CI images + runbooks added, three lifecycle bugs fixed (shutdown
  drain order, same-origin socket handshake, lease cadence economics).

## 8. History (post-r107 — the current production line)

- **r107–r108:** `SINGLE_INSTANCE_MODE=true` becomes the default (R108 economics
  — no Redis, no lease heartbeat, idle Neon autosuspend preserved).
- **r110:** truth pass — scheduler section corrected to the single-instance
  default, the Drizzle chain re-synced for the CI drift gate, the boot
  reconciler chain verified against the real migrate stages.
- **r111–r112:** production topology hardening — the money invariants (M3/M4),
  the single-page TOPOLOGY doc (`FINAL_PRODUCTION_TOPOLOGY.md`), the
  request-path/OTP/data-path canonicalization.
- **r113–r115:** deploy/ops runbooks (Docker verify, OpenWA gate, cutover
  preflight), the loyalty economics core (points_ledger, reversals, welcome
  policy) — the r115 Drizzle HEAD `6caa63b` (0015 re-emit followed in R117).
