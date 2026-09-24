# R111 Consolidated Audit Findings — 2026-09-23

> Round 111 — the biggest audit round in project history: 12 successful audit agents
> (B1–B6 backend, O1–O2 openwa, T2–T3 tests/data, D2 SEO, F4 frontend perf) produced
> the findings below. Individual agent reports were lost to a workspace snapshot
> reversion (4th occurrence — documented phenomenon); this consolidated record was
> reconstructed from the agents' verified final reports immediately after re-sync.
> Findings drive the R111 fix fleet. Base: SubNation2 `217de91` (r110) · openwa `d027199`.

## Executive summary

| Agent | Scope | P0 | P1 | P2 | P3 | Key result |
|---|---|---|---|---|---|---|
| B1 | Auth/session/CSRF/IDOR | 0 | 0 | 1 | 4 | IDOR sweep clean; 1 login-CSRF gap |
| B2 | Injection/validation/SSRF | 0 | 0 | 0 | 4+3P4 | All SQL/XSS/SSRF clean; zod .max() gaps → 500s |
| B3 | SIM scheduler | 0 | 0 | 0 | 2+3 INFO | SIM topology SOUND (203/203 tests); Oct-1 resume boots OLD code (operational) |
| B4 | Money final | 0 | 0 | 0 | 2+3P4 | No double-charge constructible; 1 ref-less topup dual-approval window |
| B5 | WhatsApp contract | 0 | 0 | 2 | 5 | Warm-up latch + cold-boot honesty on the Oct-1 seam |
| B6 | DB performance | 0 | 1(op) | 3 | 4 | Neon-killer lease heartbeat PROVEN live (92.4% of all UPDATEs); catalog search LRU self-DoS |
| O1 | openwa security | 1 High | 4 Med | 6 Low | 4 Info | Rate-limit evasion ×2880 proven live; resurrect race; name traversal |
| O2 | openwa lifecycle | 0 | 0 | 5 | 7+4P4 | Interim-creds shadow = top stuck-state risk on Oracle volume |
| T2 | FE+openwa test quality | — | — | — | — | openwa 57% of lines untested incl. ALL send paths; FE wallet/loyalty journeys untested |
| D2 | SEO/structured data | 0 | 1 | 2 | 5 | Googlebot gets share-card not SPA → all Product LD invisible to Google |
| F4 | Frontend perf | 0 | 0 | 1 | 5+5P4 | Entry 36.2KB gz; cart context re-renders 45 cards per tap |
| T3 | Live data | 0 | 0 | 0 | — | ALL invariants PASS; exactly 4 pending migrations (non-destructive); TOTP still off |

**Totals: 0 P0 · 1 operational P1 · 14 P2/High-Medium · ~40 P3/Low.** Money and auth cores held under adversarial review; the risks concentrate in (a) the October-1 resume seam, (b) openwa gateway hardening, (c) SEO crawler interception, (d) input-bound 500s.

---

## B1 — Auth/Session/CSRF/IDOR (0 P0 · 0 P1 · 1 P2 · 4 P3)

**Verified-OK (do not re-audit):** HS256 pinned + separate boot-checked ADMIN_JWT_SECRET; row-backed revocation both session types + real logout completeness; 2FA temp-token rejected at every gate; per-IP + global per-username + per-admin-2FA lockouts with dummy-argon2 parity; CF-range-validated req.ip everywhere; full IDOR sweep clean (orders/wallet/tickets/notifications/loyalty/cart/sessions all eq(userId)-scoped); OTP HMAC domain separation + timing-safe + attempt caps; CSRF exempt list minimal (/api/cwv, /api/webhook only).

- **[P2] B1-1 Login-CSRF on `GET /api/auth/telegram/callback`** — auth-settings.ts:957-997. The only session-mint endpoint outside the CSRF Origin gate (gate is POST/PUT/DELETE/PATCH-only, app.ts:707-709). Attacker's own signed Telegram payload lured through victim's browser silently binds victim to attacker's account → victim tops up attacker's wallet (the exact 98-F3 class). Fix: `state` nonce or Sec-Fetch-Site/Referer gate on this GET.
- **[P3] B1-3 Wallet credit gated by `users` scope, not `finance`** — admin/index.ts:85-89 + admin/users.ts:245-301 (cap 99,999,999.99 LYD). A scoped users-admin can print balances + grant convertible referral points.
- **[P3] B1-2 `login_attempts` has no retention** — lib/lockout.ts:108-136. Immortal row per failed attempt incl. nonexistent usernames. Slow unbounded growth.
- **[P3] B1-4 User session-liveness probe lacks userId predicate** — session-liveness.ts:34-43 (admin twin has it — "costs nothing").
- **[P3] B1-5 Legacy render.yaml ships `AUTH_COOKIE_SAMESITE=none`** — render.yaml:90-92. Any blueprint re-apply re-arms ambient-cookie CSRF incl. admin_token; Coolify env already lax.

## B2 — Injection/Validation/SSRF (0 P0-P2 · 4 P3 · 3 P4)

**Verified-clean:** all 91 sql`` parameterized; all 14 sql.raw code-constant; zero dangerouslySetInnerHTML; JSON-LD + share-card escaped; all redirects origin-checked; all 13 outbound fetches fixed-host; CORS exact allowlist fail-closed; no user-controlled file paths; generic 500s + pino redact; Arabic-Indic digits rejected server-side (parseInt NaN empirically).

- **[P3] B2-F1** `/api/admin/login` unbounded username → `login_attempts.identifier varchar(100)` overflow → **500 + Sentry event per failed attempt** (empirically reproduced 22001) — breaks uniform-401 parity. Fix: username .max() + identifier truncation.
- **[P3] B2-F2** wallet-topup `payment_network/sender_account` + lyPay `sender_phone` lack zod .max() vs varchar(50/255/20) → user-facing **500 not 400** on the money path; payment_network deserves an allowlist.
- **[P3] B2-F3** admin product create/patch `name/category/image_url` + admin-creation username unbounded → 500 (product-variants.ts slices correctly — inconsistency).
- **[P3] B2-F4** admin `bulk-status` `ids[]` no element cap (~90k ids → giant IN + per-id refund loop).
- **[P4]** bidi/zero-width not stripped from user text (visual spoofing in admin queues); `?page=` offset overflow; coupon_code raw-read bypassing its own zod gate (unexploitable today).

## B3 — SIM Scheduler (0 P0/P1 — topology SOUND)

**Verified end-to-end (203/203 targeted tests):** boot order gate→migrations→synthetic leadership→crons; no boot path expects Redis (REDIS_URL unset → null, warn, no throw); flip-back machinery byte-identical; 10 crons all UTC none Redis-gated; 14 one-shots all fire; stop() drains; no-Redis fallbacks all bounded (LRU 5000 cap, FIFO 128-key, MemoryStore with sweep, in-memory socket adapter); zero periodic scheduler DB queries at idle; every in-memory store bounded (16-store table).

- **[MEDIUM/op] F-1 October-1 auto-resume boots the pre-r108 build** (last live build 2026-09-11, no SIM) → 97-F1 PG-lease refresher @25s → **Neon awake ~720h/mo until r110 deployed**. deploy.yml gate can't change what the resume boots. Operator must deploy r110 on renewal day (render_go_live.py) or go straight to Oracle.
- **[LOW] F-2** socket 5-min re-verification issues real DB queries per live socket (socket.ts:112,725) — one perpetually-open admin tab pins Neon autosuspend (economics).
- **[LOW] F-3** fired boot one-shot chain has no cancellation handle — SIGTERM mid-chain races pool.end() (noisy logs; jobs idempotent).
- **[INFO]** F-4 stopLeaderJobs reason "not_leader" on SIM shutdown (cosmetic); F-5 advisory-lock tx can idle-in-transaction 2-3 min during boot (document-only); F-6 worker double-run warn-only (intentional).

## B4 — Money Final (0 P0/P1/P2 — 243/243 money tests)

**Verified:** middleware pass-through without Redis → in-tx idempotency_keys PK claim is the protection; first-attempt-lost-response → commit + client keeps key (localStorage TTL 10min fingerprint); same-key retry → clean replay 200 + Idempotent-Replayed before balance check, or 409; concurrent same-key → 23505 → full rollback never second charge; V1-M19/M20 traced safe; 48h retention runs cron 00:00 UTC + boot one-shot, SIM runs schedulers ungated. Checkout single-tx (3-col CAS, SKIP LOCKED, deliverability gate, provider_fulfillments, frozen orders.amount = 0 UPDATE sites); topup approve (status-guarded flip + advisory lock + in-tx dup + composite dedup + V1-M9 partial unique — two admins cannot double-credit); refund exactly-once exactly-amount terminal-status loyalty-clawback-floored; adjustment in-tx claim + note≥3 + no-below-zero + audit+ledger; coupons/flash ≥100% at 3 layers, 95% ceiling, atomic increment, floor >0 fail-closed; numeric(10,2) + roundLyd half-up + loyalty 100:1 exact-multiple.

- **[P3-R1 — the only wallet-credit inflation path left]** ref-less duplicate pending topups → both approvable → **200 LYD credited for one 100 LYD transfer** (optional receipt field + sessionStorage intent key + V1-M9/composite both exempt blank refs; needs two human ✅s). Fix: require payment_reference for mobile_transfer OR extend composite dedup to ref-less rows.
- **[P3-R2 documented trade-off]** 10-min key TTL / private-mode storage failure → late retry mints fresh key = genuine second purchase (2 units for 2 charges — no money creation).
- **[P4]** pricing toFixed half-cent rounds down; approve/convert lack result-balance overflow check; admin keys in-memory (guard-based safety).

## B5 — WhatsApp Contract (0 P0/P1 · 2 P2 · 5 P3)

Test evidence: backend whatsapp 78/78 · openwa 87/87. Prior rounds r95→r110 all verified fixed (not re-reported).

- **[P2] B5-1 Warm-up failure latch** — openwa.service.ts:405-509. One-shot warm-up armed only inside recordReadySince after gate-key miss; `known !== undefined` early-return blocks re-scheduling forever after timer fires once. With WHATSAPP_OTP_OPERATOR_E164 set, one transient warm-up failure = every OTP 503 whatsapp_settling/10s with false "will auto-send within a minute" banner **until process restart**. Self-heals on Render sleep; NOT on always-on Oracle. Fix: idempotent guard in ensureSession (settled && !warm && !pending → schedule) + regression test.
- **[P2] B5-2 Gateway cold-boot surfaces as whatsapp_not_paired** — openwa.service.ts:765-791 → whatsapp-otp.service.ts:236 → auth-whatsapp.ts:102. Session registered initializing ~3s in, ready at 10-25s; that window returns 503 no-Retry-After no-auto-retry with scary "قناة WhatsApp غير مربوطة" copy — a manual re-tap during routine wake. Fix: map initializing/created to gateway_waking semantics; keep disconnected/failed/qr_ready honest.
- **[P3] B5-3** restore-residual floor unclamped — SETTLE_MS < 5s yields a FUTURE readySince (:449-452). **B5-4** mid-send 409 flap degrades to generic 502 instead of retryable verdict. **B5-5** channel-death watch never fed send-path outcomes (success never resets streak; "ready-for-probe dead-for-send" never alerts). **B5-6** normalizeLibyanPhone rejects Arabic-Indic server-side (client converts — defense-in-depth). **B5-7** ENVIRONMENT_MATRIX.md:72 stale VITE_OPENWA_DOCS_URL line.
- **Oct-1 first-OTP verdict: workable but seam-exposed.** Happy path: boot-gate 45s budget → gateway wake ridden by gateway_waking 503+30s×2 auto-retry → epoch-marker adoption (5s residual settle) → LID preflight → OTP lands ~60-120s, zero extra taps if two auto-retries cover the boot. B5-2 = most likely extra-tap cause; B5-1 = hard-outage mode if operator env set and first warm-up trips. "Waiting for this message" closed for OTP traffic (45s gate + epoch re-arm + write-through persistence + per-send snapshot + LID preflight).

## B6 — DB Performance (1 P1-op · 3 P2 · 4 P3 · P4s)

- **[P1 operational] B6-01 Neon-killer heartbeat proven live, fixed in HEAD, never deployed.** Live cumulative stats: `scheduler_leader_lease` absorbed **24,053 of all 26,009 UPDATEs ever executed (92.4%)** + 24,007 seq scans; flash_sales 9,088 scans (old 5-min watcher); products/inventory 4,909/3,732 seq scans (uncached catalog). Every one reset Neon's 5-min autosuspend → 24/7 awake compute. r104+r108 fix it; production last deployed 2026-09-11 = pre-r104. **Deploy is the single highest-impact action.**
- **[P2] B6-02 catalog `?search=` LRU memory amplification** — unbounded LRU key per unique search, each holding full-catalog payload (~100-300KB); 5,000 entries ≈ 0.5-1.5GB on a 512MB container via an unauthenticated route → self-DoS. Fix: skip caching when search present + byte-budget the LRU.
- **[P2] B6-03 r96-M10 still open** — admin/orders.ts:118-120 decrypts up to **600 AES-GCM fields per list refresh**; wallet.ts:108-112 15/fetch. Fix: credentials-on-demand endpoint.
- **[P2] B6-04** no-Redis rate-limit windows reset on every cold start (MemoryStore fallback).
- **[P3] B6-05** audit_logs = only growing table with no retention (live 25 rows — ladder works for everything else). **B6-06** isValidAdminSession 2 queries where 1 suffices (admin_users_pkey hottest index: 7,886 scans). **B6-07** ready-to-fire DDL: notifications(user_id, created_at DESC) + admin_alerts indexes — add at 10-20k rows, not now. **B6-08** duplicate indexes with exact DROP INDEX CONCURRENTLY list (orders/wallet_ledger/inventory/risk_rules).
- **[P4]** unused trigram indexes (planner-correct at 59 rows); catalog cache pins 404s 60s despite "200-only" comment; statement_timeout 15s unpinned in render.yaml.
- **Verified-good:** zero N+1 in hot paths; all lists LIMIT-bounded; no hot JSONB; pool-vs-autosuspend correct (max 8, idle 30s drains to zero, connect 10s absorbs 1.8s wake, pooler endpoint); cache.ts no-Redis path is NOT a no-op (in-process LRU; only HTTP idempotency passes through, backstopped in-tx); quiet boot.
- **Top-3 measured queries:** catalog LIMIT 500 = 6.5ms; admin orders = 6.4ms; user orders = 1.8ms. The true tail cost is the wake path, not queries.

## O1 — openwa Security (1 High · 4 Medium · 6 Low · 4 Info)

**Verified-safe:** timing-safe key compare on all /api; boot-refuse/warn on key length; key never logged; **dashboard gate unbypassable** (real gate is HMAC cookie — disabled env 503s /login before empty-vs-empty compare); **doSave resurrect race truly dead** (interleaving re-constructed, 3 pinned tests); restore traversal dead (blob filenames); 100% parameterized SQL; AES-256-GCM fresh 96-bit IV + scrypt-32 + transparent re-key; PII masked in stdout; CORS default-deny; CSP/XFO/nosniff; generic 500s; single-flight all 4 start callers; bounded backoff with jitter+cap; pool timeouts; no git in image, npm ci, non-root.

- **[HIGH] O1-H1 Rate-limit bucket evasion via path shape** — rate-limit.ts:297-301. `classifyApiPath` regex strict/case-sensitive but Express routing isn't; `/pair-code/` and `/PAIR-CODE` reach the real handler yet land in the general 240/min bucket instead of pair-code 5/hour (**2,880× amplification** of pairing-code issuance with a leaked key; send-text 60→240/min too). **Empirically proven live (14 route invocations).** Fix: one-line path normalization + regression test.
- **[MED] O1-M1 Route-level resurrect race** — index.ts:921-935, 672-685. DELETE during in-flight startSession no-ops socket.end (socket not yet assigned) → background start connects on detached record → lastReadyAt reopens persist gates → upsert lands after tombstone (started later = treated as legit re-pair) → deleted row resurrected; boot self-heal makes it permanent. Invisible to the r110 FIFO chain (different layer). Fix: await rs.starting in both delete paths + stopRequested check right after socket creation.
- **[MED] O1-M2 Boot self-heal trusts DB session names without SESSION_NAME_RE** — index.ts:1127-1143 (only enforced at POST create + dashboard). path.join normalizes `..` (verified → /data/evil). Defense-in-depth (needs DB write); r110 hardened blob filenames but missed the name column.
- **[MED] O1-M3 Supply chain** — npm audit: 4 vulns (qs 6.15.3 ×2 moderate — pre-auth reachable via query parsing; sharp 0.35.3 libheif high but dead code for this text-only gateway) + no audit gate in CI. libsignal full-SHA-pinned ✓.
- **[MED] O1-M4 Rightmost-XFF trust unconditional** — rate-limit.ts:161-184, dashboard.ts:99-109. Safe on Render & compose 127.0.0.1:3001; broken if published directly (Coolify override) → attacker-chosen identity → unlimited key guessing + lockout bypass. Fix: TRUST_PROXY knob before Coolify go-live.
- **[LOW]** L1 failed auto-reconnect strands session at initializing forever · L2 raw err may leak JIDs in Baileys error text (OTP text & pair-code never logged ✓) · L3 /login+/logout outside Origin CSRF check · L4 no HSTS/Permissions-Policy + no-store misses /logout,/healthz · L5 JSON parse pre-throttle + default server timeouts · L6 node:22-alpine & actions tag-pinned not SHA-pinned.
- **[INFO]** /healthz counts disclosure; static scrypt salts (sound ≥32-char keys) + silent <32 DASHBOARD_SESSION_SECRET fallback; deliberate uncaughtException survival; committed dist in sync ✓.

## O2 — openwa Lifecycle (0 P0/P1 · 5 P2 · 7 P3 · 4 P4)

- **[P2 TOP STUCK-STATE RISK] O2-F1 Interim-creds shadow** — index.ts:229-231. Restore gate checks only creds.json EXISTENCE, not `registered`. Neon outage at gateway boot → empty listPersistedNames → SubNation auto-creates fresh session → interim creds.json (registered:false) **permanently shadows the good DB blob**. QR refs exhaust (~2-3 min) → timedOut close → backoff → fresh QR → infinite qr_ready loop. Self-heals on ephemeral Render disk; **permanent on the compose openwa-data volume**, and the operator's only dashboard fix (DELETE) destroys the good row too. Fix ~10 lines: prefer DB blob when local creds are interim.
- **[P2] O2-F2 initializing wedge** — startSession rejection on reconnect/boot paths only logs (index.ts:525-527, 1139-1141); only the /start route sets failed (:811). No socket → no close event → no re-arm. Fix: 2 lines.
- **[P2] O2-F3 fetchLatestBaileysVersion awaited with NO timeout** — index.ts:309; axios default unbounded. Paid once per cold boot (24h cache dies with process); black-holed route stalls session start ~2 min, serial boot loop stalls all sessions behind it. Fix: {timeout: 3000}.
- **[P2] O2-F4 Stale-close clobber** — close branch lacks rs.socket !== sock guard (index.ts:473-532): late close from old socket after new one opened → disconnect + second socket on one auth folder → 401 conflict → **credential wipe**. One-line guard.
- **[P2] O2-F5 SIGTERM flush budget 4s < pool statement_timeout 10s** — index.ts:1167 vs persist.ts:124. Flush queued behind a stuck upsert loses the race → last signal state lost on ephemeral disks → stale-restore "Waiting for this message". Fix: 3s timeout for flush path or 10s budget (compose grace 15s).
- **[P3]** F6 >256KB body → 500 not 413 (terminal MW discards err.statusCode) · F7 /healthz no degraded flag · F8 reconnectAttempts/disconnect-code/save-failures invisible to operators · F9 boot-restore DB names unvalidated (=O1-M2) · F10 process guards keep a limping process green · F11 lockfile records @types/pg as prod dep (ships in image) · F12 no HTTP drain on SIGTERM.
- **[P4]** F13 lockfile floor ^6.7.9 below CVE-2026-48063 fix (6.7.22) — our 6.7.24 pin is post-fix, not affected; raise declared floor. F14 orphaned epoch markers. F15 in-memory delivery log/rate buckets. F16 60 sends/min shared bucket.
- **Cold-start timeline (statically derived):** Render spin-up 10-40s → node boot 1-3s → self-heal Neon wake 1-4s (serial per session) → loadCreds 0.4-2.3s → fetchLatestBaileysVersion 0.3-2s (unbounded — F3) → makeWASocket connect 2-8s (cap 20s) → ready → consumer epoch-marker HIT → 5s residual settle → LID preflight → send 7-11s. **~40s claim verified for backend-awake marker-warm case; Oct-1 both-asleep serial double-wake floor ~55-80s+ is structural, not a regression.**

## T2 — FE + openwa Test Quality

- **Frontend (579 green, 10 findings, ≈15-20 missing journey tests):** zero tautologies/snapshots/act-suppression; checkout trio + customFetch + cart suites genuinely strong (payload-level idempotency-key lifecycle incl. 409 IDEMPOTENCY_IN_FLIGHT preservation, TTL+fingerprint binding). Weak spots: wallet MAX_PENDING=3 dead under test (static mock data:[]) — 10,000 cap, 0.01 floor, 0.5-dinar snap untested; loyalty convert-points success journey untested (r102 intent-key fingerprint pinned nowhere); admin wallet-adjust Idempotency-Key asserted as expect.any(String) only; shared use-confirm money hook zero tests; 2 testid-only files (justified harnesses).
- **openwa (87 green, 0 weak — but 57% of gateway lines unprotected):** lib.ts (37) + rate-limit.ts (28) strong; persist.ts good — r110 FIFO chain pinned strongly (reorder would fail); filename guard pinned as function but not its caller loop. **index.ts (1189 lines — engineSend incl. LID→PN fallback, reconnect backoff), dashboard.ts, dashboard-html.ts = ZERO tests. No Baileys double at all.** Highest-leverage: one FakeSocket (EventTarget + programmable sendMessage + real DisconnectReason taxonomy) + test seam into startSession/engineSend, then HTTP contract tests, then pin the O2-F5 race.

## D2 — SEO / Structured Data (1 P1 · 2 P2 · 5 P3)

- **[P1] D2-F1 Indexing crawlers intercepted on all product URLs** — app.ts:1114 `isShareBotUserAgent` includes googlebot|bingbot|yandexbot|duckduckbot|baiduspider → every crawl of /product/* gets the ~1KB unfurler card — no JSON-LD, no SPA boot, one line of Arabic body. Google's renderer fetches the same JS-less card → **all Product/FAQ/Breadcrumb LD on the 45 money pages unreachable by Google.** Fix: one regex split (unfurlers keep the card; indexers get the SPA shell). Also the boot-gate mirror at server.ts:96-99.
- **[P2] D2-F2 offers.availability ignores stock** — seo-builders.ts:118 keys off isActive only; all 45 active products have zero deliverable stock → 45/45 LDs assert InStock while UI says «نفد المخزون». Fix: thread is_available (1 line).
- **[P2 data] D2-F3** thin product meta descriptions — 34-86 chars (37/45 under 70); titles fine.
- **[P3] D2-F4 share-card residual confirmed latent** — app.ts:985 WHERE lacks isArchived; no archived product can render a card TODAY (admin archive sets both flags atomically, live dump 14/14 archived have is_active=false) BUT `PATCH /api/admin/products/:id` (:255) can set is_active=true on an archived row with no guard. Fix: mirror detail-route WHERE + PATCH guard + one middleware test.
- **[P3]** F5 card lacks twitter:image/og:locale/canonical link + numeric-form canonical for legacy URLs · F6 card DB query unthrottled/uncached (limiters are /api-only; s-maxage useless without CDN) · F7 /terms#privacy fragment canonical · F8 GSC verification meta ships content="" (mechanism correct since r97-J2; verify deploy env token).
- **Rich-results eligibility:** Product+Offer ❌(F1,F2) · product FAQ ❌(F1) · support/category FAQ ✅ · BreadcrumbList categories ✅ products ❌(F1) · ItemList ✅ · Organization ✅ (sameAs:[] cosmetic) · WebSite+SearchAction ✅.
- **Verified-good:** sitemap 56 URLs WHERE identical to public catalog, 100% latin unique slugs, truthful lastmod, 60s cache + admin bump; robots.txt correct absolute sitemap ref + admin/API/auth blocked; hreflang ar+x-default correct; absolute og:image on all 3 surfaces; @id graph consistency; runtime title/desc clamps 60/160; JSON-LD escaped + UTF-8; SPA deep links 200.

## F4 — Frontend Performance (1 P2 · 5 P3 · 5 P4)

Headline (fresh build 11.94s): entry 36.2KB gz (was 32.7 r96); eager JS 128.3KB gz **at the 130KB ceiling**; critical CSS 30.7KB gz; precache 10 entries / 347.72KiB vs 384KB budget (9.3% headroom); route-split complete (31 routes); vendor-charts 109KB gz / firebase 44KB / socket 13.2KB (admin-only) off storefront path; vendor-sentry not emitted; sourcemaps 0. r96/r100/r102 fixes verified held (AuthGate head-start probe∥chunk∥products, SW update toast, WebP 47 files 549.7KB avg 11.7KB, width/height + eager-first-4 + fetchpriority ladder).

- **[P2] F4-F1 Cart context single+wide** — memoized value stops only unrelated renders; every add-to-cart re-renders **all 45 cards** + Navbar + MobileNav → 80-200ms INP on the money-critical tap (cart.tsx:296, ProductCard.tsx:213). Fix: split cart context (commands vs state) — one file → −60-120ms INP.
- **[P3]** F2 entry diet: sonner 28.6% (10.4KB gz eager), generated api-client 8.7%, web-vitals 6.9% (module eager, call idle) → manualChunks + dynamic import. F3 head-start fetches full catalog (~4.7KB gz + ~53KB parse) on every non-home boot — dominant WhatsApp product deep-links waste it; gate to `/`. F4 guest LCP text uses font face 700 but only 400s preloaded → +1 RTT; preload readex-arabic-700 → **−150-350ms LCP**. F5 category grid lacks cv-card. F6 manifest screenshots:[] (no Android rich install sheet).
- **[P4]** init.js not precached; dead google/gstatic dns-prefetch; 90-byte socket-events chunk (extra RTT); Navbar scrolled backdrop-blur-3xl; admin orders 100 rows unvirtualized (admin-only).

## T3 — Live Data Quality (ALL invariants PASS)

- **Money:** 17 users (5 active); per-user SUM(ledger)==balance 0 mismatches; ledger arithmetic 7/7 correct; zero negative balances/loyalty/NULL-or-≤0 amounts; approved topups 376.00 all backed (ledger 426 = 376 + 50 documented sim row); refunds 160.00 == orders 160.00 no over/partial; **global conservation exact: Σbalances 334.51 = 426+160+150−401.49**; delivered passwords 7/7 ciphertext (V1-M7 held); 0 future timestamps.
- **Catalog:** 59=45+14, 263 variants, 0 orphans, ×20 price rule 0 violations, unique slugs, 45/45 local webp 450×450 on disk, SEO populated. **FAQ live=138 = apply payload exactly (42×3+3×4); r100 worklog's "152" was a documentation error, not data loss.**
- **Growth retention:** idempotency_keys 0 ✓ · whatsapp_otps 0 ✓ (retention held); audit_logs 25 + login_attempts 3 unpruned (confirms B6-05/B1-2); admin_alerts 65 all unread (6 legacy NULL dedupe_key; 46 from out-of-band 09-19 burst with distinct keys); sessions 37 (TTL 30d — 10 die by Oct 1, 27 live into Oct 10-11); notifications 9; inventory 10 (3 unsold under archived test products); topups 13 (5 approved/5 rejected/**3 pending 155 LYD stale**); orders 7 (5 completed + 2 refunded); risk/copilot/flash/openwa/lease all 0. PG 17.11, 12MB.
- **Pending migrations on Oct-1 resume (deployed build = e7de0f1 r97, ≤V1-M15 all applied; live = 40/41 r110 tables) — EXACTLY 4, all non-destructive:** V1-M17 rebuild uniq_product_variants_plan_duration NULLS NOT DISTINCT (0 NULL-equal dupes → cannot fail) · V1-M18 CREATE provider_fulfillments + enum + 2 indexes (only missing table) · V1-M19 order_id DROP NOT NULL + reference_type (absent, 0 rows) · **V1-M20 DROP idempotency_keys_order_id_fky (FK confirmed present; mandatory before first topup under r104+ code, else 23503→500)**. Plus fingerprint marker write (one full reconcile then fast-path). Everything M6-M16 verified no-op (M16 arrived out-of-band with the 09-19 catalog reconstruction). Oct-1 auto-resume boots the OLD build first (coherent flat-price catalog via legacy products.price) — no FK-violation window; the 4 stages run only when r110 deploys, behind the 503 gate.
- **Anomalies:** QATEST10 still disabled ✓; test products archived ✓; **TOTP still off on sole active admin ahmadmedo (r5 flag open)**; 45/45 active products have 0 deliverable stock (empty shelf on resume); expected alert noise on resume (staleness sweep auto-reads 19/65; fresh stock:zero burst likely); documented 09-19 out-of-band writes (dedupe discipline held).

---

## Fix-fleet priority queue (what R111 fixes now)

**Wave A — correctness/security (must fix):**
1. O1-H1 rate-limit path normalization (openwa) — proven exploitable
2. O2-F4 stale-close clobber guard (openwa) — credential-wipe path
3. O2-F1 interim-creds shadow (openwa) — permanent-stuck path on Oracle
4. O2-F3 fetchLatestBaileysVersion timeout (openwa)
5. O2-F2 initializing wedge + B5-2 initializing→gateway_waking mapping (SubNation2 side)
6. B5-1 warm-up re-arm guard (SubNation2)
7. D2-F1 crawler split + D2-F2 availability from is_available (SubNation2)
8. B1-1 Telegram callback CSRF state nonce (SubNation2)
9. B2-F1/F2/F3/F4 zod bounds + allowlist + bulk cap (SubNation2)
10. B4-R1 ref-less topup dual-approval (require payment_reference for mobile_transfer)
11. O1-M1 delete/await-starting race + O1-M2 boot SESSION_NAME_RE (openwa)
12. O2-F5 flush timeout (openwa)

**Wave B — hardening (should fix):**
13. B6-02 catalog search LRU byte-budget + search skip
14. B1-2 login_attempts prune job; B6-05 audit_logs retention policy
15. B1-3 wallet credit finance scope; B1-4 liveness userId predicate; B1-5 render.yaml samesite
16. F4-F1 cart context split (INP); F4-F4 preload 700 font (LCP)
17. B5-3 settle floor clamp; B5-4 409-flap verdict; B5-5 streak reset on success
18. D2-F4 share-card WHERE + PATCH isArchived guard
19. O1-M3 npm audit bump + CI gate; O1-M4 TRUST_PROXY knob
20. T2: openwa FakeSocket seam + pin O2-F5 + engineSend tests; FE wallet gates + loyalty journey tests

**Operator TODOs (cannot be done from sandbox):** deploy r110 on Oct-1 renewal (render_go_live.py) or cut to Oracle before; enable TOTP on ahmadmedo; restock the 45-product shelf; decide the 6 unused services' fate before Oct-1 (750h budget); record first restore drill; run docker-verify.sh on the VM.
