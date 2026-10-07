> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r118/R118-A7-docs.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R118-A7 — Documentation & Operations Truth Audit (READ-ONLY)

- **Scope:** README.md, OPERATIONS_RUNBOOK.md, PLATFORM.md, PROJECT_OVERVIEW.md, docs/** (operations/, deployment/, architecture/, root), deploy/, config/, .specify/feature.json, render.yaml, vercel.json, docker-compose.yml, Dockerfile, root package.json scripts, scripts/*.sh (doc-referenced).
- **HEAD:** `ef3d0c3` (main, clean tree, verified). Live evidence gathered 2026-10-06 (curl subnation.ly + read-only Neon SELECTs via the pooled probe URL).
- **Method:** every "current state" claim extracted and checked against code (`rg` + line reads), live HTTP, or DB. Line cites re-walked for the five runbooks. Severity: **P1** = doc would cause an operator outage / wrong action · **P2** = materially misleading · **P3** = stale / polish.
- **Live baseline used for truth:** `https://subnation.ly` 200 (SPA + API), `/api/healthz` 200 `cache-control: public, max-age=5`, `/api/healthz/summary` `{"status":"ok"}`, `/api/catalog/stats` → `total_products:45, available_products:3, total_units:6`; no `server: cloudflare`/`cf-ray` anywhere (zone DNS-only); `https://www.subnation.ly/` 200 byte-identical, no redirect; `https://subnation-seven.vercel.app/robots.txt` 404 (Vercel mirror dead); bare `GET /api/healthz/firebase` → 401 (admin-gated). DB (read-only): 42 tables, 59 products (45 active), 263 variants, 6 unsold inventory units — 3 sellable under ACTIVE products (cpanel ×1, lifetime-cloud-storage ×1, netflix-premium ×1) + 3 under archived test products; 1 admin (`ahmadmedo`, `totp_enabled=false`); 7 lifetime orders; migrations fingerprint `v2:…` present.

---

## 1. PER-FILE VERDICT TABLE

| File | Verdict | One-line reason |
|---|---|---|
| README.md | **FALSE** | Front door says "production is offline / subnation.ly answers 503 / cutover pending" — live site is UP on Contabo/Coolify (F1, F5, F33). |
| OPERATIONS_RUNBOOK.md | **FALSE** | §5 "current-state authority" and §9 "dual deployment" describe a dead Render+Vercel stack as production (F2, F3, F4, F23–F25). |
| PLATFORM.md | **STALE** | Historical-snapshot banner exists, but "Render/Vercel remain live as the rollback path" + "currently 503" + "current production target is Oracle ARM64" are false-present-tense (F6, F35). |
| PROJECT_OVERVIEW.md | **STALE (labeled)** | Honestly bannered 2026-08-25 snapshot; but it defers "current state" to two docs that are themselves stale (F35). |
| package.json (root) | **ACCURATE** | All script targets exist (`@workspace/scripts` dev/start/seed/backup, `db push`, `codegen`, `validate:suite`); engines match docs. |
| tsconfig*.json (root, backend, frontend) | **ACCURATE** | All valid JSON; project references consistent. |
| .specify/feature.json | **ACCURATE (stale pointer)** | Valid JSON (R117-C1 fix held); points at `specs/010` though `012` is the newest spec (F29). |
| render.yaml | **STALE (labeled legacy)** | LEGACY/FROZEN banner is correct and prominent; "pre-launch … still in development" comment now false (F27); A7-2 warning comment is TRUE again at HEAD (call restored, `app.ts:34`). |
| vercel.json | **STALE (labeled legacy)** | LEGACY banner correct; "production target is Coolify on Oracle Cloud" wording stale (F28). |
| docker-compose.yml | **ACCURATE (stale comments)** | Healthchecks/ports/logging verified; header comments still name "Oracle VM" as production (F26). |
| Dockerfile | **ACCURATE** | No stale host claims; GIT_SHA build arg as documented. |
| deploy/env.compose.example | **ACCURATE (stale comment)** | Env contract correct; `:4` "R107 (Oracle/Coolify migration)" comment stale (F26 class). |
| config/README.md | **ACCURATE** | Load-order description matches scripts. |
| config/env.example | **STALE** | `DB_POOL_MAX=15` contradicts its own "match the code defaults" comment and the prod default 8 (F16); Render-era "direct not -pooler" + PG-lease-scheduler comments stale. |
| specs/ (003,004,008,010,011,012) | **STALE (historical)** | Feature-spec artifacts of completed rounds; fine as archives. |
| docs/API.md | **ACCURATE** | Rate limits (600/min IP, 1200/min user, auth 15 min), passwordless surface, base URL — all verified against `app.ts`/routes; bannered as operator reference with generated-contract pointer. |
| docs/COMPLIANCE.md | **FALSE** | Two materially false retention/backup claims (F13, F14) in a compliance-facing doc. |
| docs/DISASTER_RECOVERY.md | **STALE** | The DR source of truth names the Oracle VM as the current host and says the restore drill was never exercised (F11, F12, F31). |
| docs/FINAL_MONEY_INVARIANTS.md | **ACCURATE (stale stamp)** | All body cites spot-verified exact at HEAD (M1 `topup.service.ts:82+`, M2 `wallet.ts:429/447-470`, M3 `wallet.ts:365`, M4 `checkout.service.ts:253/294`); only the `521234f` header stamp is stale (F19). |
| docs/NEON_MCP_SETUP.md | **ACCURATE** | Endpoint `ep-spring-term-avwgxrte-pooler…` matches the live probe URL; project name matches. |
| docs/WHATSAPP_OPERATIONS.md | **ACCURATE** | R117-C1 Coolify rewrite verified (internal `openwa:2785`, Render gateway marked dead, no public gateway URL). |
| docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md | **STALE** | §1 diagram (CF proxied edge + Oracle VM) and §3 chain `V1-M6…V1-M20` + §4/§8 Oracle capacity model — corrected only by the R117 blockquote (F9, F10, F20). |
| docs/architecture/PRODUCTION_ARCHITECTURE.md | **STALE-lite** | R117-C1 fixes verified (V1-M23 chain, wallet cite, observed-host blockquote); `:29`/`:69` diagram still draws "Cloudflare →" unqualified (F9 class). |
| docs/operations/FINAL_INVENTORY_LOADING.md | **STALE (§8)** | Code cites & procedures verified executable; §8 "live state" is r112-era and now false (F15, F19, F22). |
| docs/operations/FINAL_ADMIN_TOTP_SETUP.md | **ACCURATE (stale stamp)** | Journey/lockouts/routes verified (`auth.ts:90/292/779/867`, `lockout.ts:4-5`, `settings.tsx:67/327/1239`); live `ahmadmedo totp_enabled=false` claim CURRENT; one wrong test filename (F19, F21). |
| docs/operations/FINAL_MONITORING.md | **STALE** | Oracle title/companions + CF-WebSocket triage row; all cron slots, healthz family, keepalive rules, rotation numbers verified accurate (F7, F8, F22). |
| docs/operations/LOGGING_AND_RETENTION_FINAL.md | **ACCURATE** | Every retention window verified in code (7d/180d/48h/14d/30d/90d/180d/24h); rotation blocks at `docker-compose.yml:113-117,174-178`; only caveat: openwa cites live in the sibling repo (F30). |
| docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md | **STALE body / ADDENDUM CORRECT** | §1–§4 still prescribe proxied-orange + Full(strict) + WS-ON as "final state"; §8 R117 addendum correctly documents DNS-only reality + the Traefik 301 recommendation (F18). |
| docs/deployment/COOLIFY_FINAL_SETUP.md | **ACCURATE (Oracle framing)** | Resource-creation steps host-neutral and consistent with compose/FINAL_PRODUCTION_ENV. |
| docs/deployment/COOLIFY_ORACLE_MIGRATION.md | **STALE (historical)** | r107 migration guide; still referenced as CURRENT triage authority by OPERATIONS_RUNBOOK §1/§2 (see F4). |
| docs/deployment/ENVIRONMENT_MATRIX.md | **STALE-lite** | r108-era matrix; rows verified; "Oracle single-container shape" wording + render.yaml pin notes stale. |
| docs/deployment/FINAL_COMMAND_BOOK.md | **STALE** | The copy-paste book still walks ORACLE first-boot/aarch64/`--arm64` and proxied-orange DNS as the procedure (F17, F18); test counts are R115-dated. |
| docs/deployment/FINAL_CUTOVER_CHECKLIST.md | **STALE** | R115 boxes all unchecked with no "EXECUTED" banner though the cutover is live (F32). |
| docs/deployment/FINAL_MIGRATION_READINESS.md | **STALE (historical)** | R108/R110 candidate report; title implies pending migration. |
| docs/deployment/FINAL_OPERATOR_INPUTS.md | **STALE** | "The cutover now waits exclusively on the inputs below" — the cutover happened (2026-10-01/02). |
| docs/deployment/FINAL_PRODUCTION_ENV.md | **ACCURATE (stale stamp)** | Spot-verified rows (pool 8, settle 45s, SINGLE_INSTANCE contract, §8 legacy table); R117 A7-2 fix present at `:157` (F19). |
| docs/deployment/FINAL_RESTORE_DRILL.md | **ACCURATE** | Ledger records the two real PASS drills; procedure matches scripts. |
| docs/deployment/FINAL_ROLLBACK_RUNBOOK.md | **ACCURATE (Oracle subtitle)** | Choreography host-neutral and consistent with live shape. |
| docs/deployment/FINAL_SIGNOFF.md | **ACCURATE (dated record)** | R115 release table; numbers match their dates (82 OpenAPI ops at R115 → 83 at HEAD after e394815). |
| docs/deployment/MIGRATION_RUNBOOK.md | **STALE (historical)** | Render/Vercel→Oracle checklist; migration complete. |
| docs/deployment/NEON_IDLE_ECONOMICS.md | **ACCURATE (stale stamp)** | Economics story intact; R117 OTP lockPool (2 dedicated clients) unmentioned (F19). |
| docs/deployment/ORACLE_FINAL_SETUP.md | **STALE (wrong-host guide)** | A complete Oracle Cloud provisioning guide referenced as THE host authority by 4 live docs — the actual host is Contabo (F17 class). |
| docs/deployment/RENDER_LEGACY_FALLBACK.md | **STALE** | Honest LEGACY framing, but `:4-5` "Production = Cloudflare → Oracle VM → Coolify" is doubly stale (F9/F11 class). |
| docs/deployment/SECRET_HANDLING_FINAL.md | **ACCURATE** | Coolify two-resource secret map consistent with FINAL_PRODUCTION_ENV §1/§6. |
| docs/loyalty, docs/pricing, docs/ux (FINAL_*) | **ACCURATE** | Policy docs with code-truth pointers; no false current-state claims found. |
| docs/inspection-r94/96/97/98/111/117, round-*, audits, ux-audit-*, catalog/, seo-enrichment | **ARCHIVED-class** | Dated audit artifacts (≈65% of the tree) — see §5 index proposal. |

---

## 2. FINDINGS (each: doc:line · quote · reality · severity · proposed edit)

### P1 — doc would cause an operator outage or wrong action

**F1. README.md:28-34 (also :10 badge, :63, :172-186) — "production is offline / subnation.ly answers 503".**
Quote: `🚧 Status (2026-09-23): production is offline. The Render free tier has been billing-suspended since ~2026-09-11 (subnation.ly answers 503 …) mid-migration to self-hosted Docker on Oracle Cloud (Coolify, ARM64) — cutover pending.`
Reality: live `curl https://subnation.ly/` → **200** (SPA+API+DB serving; `cache-control: public, max-age=5` on `/api/healthz`, R117 build live); host is Contabo (`vmi3624162.contaboserver.net`, R117 A4 + worklog:601/611), not Oracle. Badge `status-cutover_pending` (:10) and Deploy row "migration in progress, cutover pending" (:63) same class.
**P1** — an operator (or the owner's customer/partner) reading the README believes the store is down and may re-attempt the cutover or communicate a false outage.
Edit: replace the status banner with "Production is LIVE at https://subnation.ly (self-hosted Docker on Coolify since 2026-10; see docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md)"; fix the badge to `status-live`; rewrite the Deploy table row and delete/replace the "Deployment status (2026-09-23)" section with a 3-line current-state paragraph pointing to FINAL_SIGNOFF + inspection-r117.

**F2. OPERATIONS_RUNBOOK.md:213-248 (§5) — "current-state authority" describes the dead Render/Vercel stack as production.**
Quote: `R104 (2026-09-21) — the current-state authority for Render free-tier economics. … Production topology: Render free web (subnation, Docker: API + SPA) + Render free web (openwa-gateway, separate repo) + Neon Postgres (external) + Vercel (parallel frontend).`
Reality: production = Contabo VM + Coolify (subnation + openwa containers) + Neon; Render is billing-suspended (`RENDER_LEGACY_FALLBACK.md` §2, final-audit-2026-09-20); Vercel mirror is dead (`https://subnation-seven.vercel.app/robots.txt` → **404**, live-verified). The whole §5 budget table (750 h / 5 GB / 500 min) governs a stack that no longer serves traffic.
**P1** — during an incident or budget review the operator manages the wrong platform entirely.
Edit: demote §5 to a clearly-marked LEGACY appendix and replace with a 10-line "Production resource budget (Contabo/Coolify + Neon free CU-hours)" section; single source = FINAL_PRODUCTION_TOPOLOGY §8.

**F3. OPERATIONS_RUNBOOK.md:373-439 (§9) — "Dual-Deployment Architecture … Keep both deployments green … Cloudflare proxied, Always-Use-HTTPS".**
Quote: `97-F6 (R97 J-4): two live deployments run in parallel from this same repo. … Keep both deployments green. … DNS: subnation.ly / www on Cloudflare (proxied, Always-Use-HTTPS)` and `Confirmed by live evidence (R97-A1): subnation.ly responses carry server: cloudflare + x-render-origin-server: Render`.
Reality: one deployment; live headers carry NO `server: cloudflare`/`cf-ray` (DNS-only zone, LE cert at origin — live-verified 2026-10-06 + R117 A4); Vercel 404s; Render suspended. The R97 "live evidence" is being presented as current.
**P1** — an on-call operator following §9 verifies/fixes a Vercel preview and Cloudflare proxy settings that are not in the live path, while the real origin (Contabo/Traefik) burns.
Edit: replace §9 with "Single-origin architecture (post-cutover)" — one Coolify deployment, DNS-only zone, www+apex both 200 (301 recommendation → CLOUDFLARE_FINAL_CUTOVER §8); move the dual-deployment text to a LEGACY note.

### P2 — materially misleading

**F4. OPERATIONS_RUNBOOK.md:3-7 — migration-era header presents Oracle as TARGET and Render/Vercel as a live rollback path.**
Quote: `Migration state (r107): Oracle ARM64 + Coolify is the TARGET/final architecture … Everything Render/Vercel below is the PRE-MIGRATION / rollback path and stays valid only until the Phase-6 deletion.`
Reality: migration complete; host is Contabo (not Oracle ARM64); the "rollback path" is dead (Render billing-suspended rejects deploys — RENDER_LEGACY_FALLBACK §2; Vercel 404).
**P2.** Edit: "Migration COMPLETE (2026-10): production = Coolify on a Contabo VM (observed host R117) + Neon. Render/Vercel sections below are LEGACY historical records, not a usable rollback path — current rollback = FINAL_ROLLBACK_RUNBOOK.md (Coolify redeploy)."

**F5. README.md:157-170, 184-197 — self-hosted section + deployment-status details.**
Quote: `### Self-hosted: Oracle Cloud + Coolify (target — migration in progress)` · `an actual docker build on a Docker host is still pending` · `backend 1264/1264, frontend 573/573`.
Reality: cutover done (live); Coolify builds from Git on every deploy (live release); current counts 1517 backend tests / 165 files (R117-V1), frontend grown since (108 files per R117-A3).
**P2.** Edit: retitle "Self-hosted: Docker + Coolify (production since 2026-10)"; delete "docker build still pending"; refresh counts or point at FINAL_SIGNOFF as the dated authority.

**F6. PLATFORM.md:17-18, 28-41 — false-present-tense claims inside the historical banner.**
Quote: `Render/Vercel remain live as the rollback path until the DNS cutover.` · `https://subnation.ly … currently 503 (origin suspended)` · `the current production target is Oracle Cloud ARM64 + Coolify + Docker + Neon`.
Reality: DNS cutover happened; apex answers 200 (live); host is Contabo.
**P2.** Edit: mark §Production URLs "ALL RETIRED" (already) AND change "currently 503" → "was 503 while Render was suspended (pre-2026-10-01)"; fix :17-18 and :33 to name the Contabo/Coolify live stack.

**F7. docs/operations/FINAL_MONITORING.md:1,5,29 — Oracle VM framing on the monitoring runbook.**
Quote: `# Final Monitoring Runbook — SubNation (Oracle VM + Coolify)` · companion `docs/deployment/ORACLE_FINAL_SETUP.md (VM hardening)` · `fail2ban … (ORACLE_FINAL_SETUP.md §7)`.
Reality: live host is Contabo; the Oracle doc provisions a different cloud (F17). Everything else in the file verified accurate (cron slots 00:00/00:05/02:15/03:30/03:35/03:50/04:00/04:30/05:00 all match `jobs/cron.ts`; healthz family + admin gates all exist; keepalive rules match code).
**P2.** Edit: retitle "…(self-hosted VM + Coolify)"; add the observed-host line; keep ORACLE_FINAL_SETUP refs as "original provisioning guide (Oracle era)".

**F8. docs/operations/FINAL_MONITORING.md:97 — Socket.IO failure triage points at Cloudflare WebSockets toggle.**
Quote: `Socket.IO handshake non-200 through the domain | edge/WebSocket issue, not the app | Cloudflare dashboard → Network → WebSockets ON (… the proxied record must allow WS …)`.
Reality: the zone is DNS-only — there IS no Cloudflare edge in the live path (no cf-ray live; CLOUDFLARE_FINAL_CUTOVER §8). A WS failure today is an origin/Traefik problem, not a CF toggle.
**P2** — wrong first action during a realtime incident. Edit: re-route that row to "Traefik/Coolify router + container logs (zone is DNS-only; no CF proxy in path)" and keep the CF row only as a conditional "if the zone is ever re-proxied".

**F9. docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md:17-30 (and PRODUCTION_ARCHITECTURE.md:29,69) — uncorrected edge diagram.**
Quote: `Cloudflare (edge: DNS · proxy · TLS termination · WAF/DDoS-lite · WS passthrough) … subnation.ly A → <VM_IP> (proxied) · www CNAME → apex · Full (strict)` → `Oracle VM :443`.
Reality: DNS-only grey cloud, LE cert at origin, A records → 169.58.100.161 Contabo (R117 blockquote on the same page says exactly this — the diagram above it was never reconciled).
**P2.** Edit: redraw the §1 path as `Internet → Cloudflare DNS (DNS-only, grey) → VM :443 (Traefik/LE)` or annotate the diagram "as-designed at r112; observed live = DNS-only (see blockquote)".

**F10. docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md:93-95, 146-149 — Oracle capacity model as production truth.**
Quote: `a port is reachable only if BOTH the Oracle Security List and host iptables/ufw allow it` · `more Ampere OCPUs/RAM — but the Always Free A1 allowance is 2 OCPU / 12 GB total … The production shape IS the ceiling: 2/12.`
Reality: host is a Contabo VPS — Oracle Security Lists and the A1 allowance do not apply; the actual VM shape is unknown to the repo.
**P2.** Edit: genericize to "host firewall + provider security group"; replace the A1 ceiling row with "VM shape = operator's Contabo plan (record it here)".

**F11. docs/DISASTER_RECOVERY.md:3,10,48,58,102,129-133,271 — DR source of truth on the wrong host.**
Quote: `THE disaster-recovery source of truth for the current (Oracle/Coolify) stack` · `the Coolify deployment on the Oracle VM` · `Automated backups (r110 — host cron on the Oracle VM)` · `Host prerequisites … ORACLE_FINAL_SETUP.md §9` · `watch Oracle's status page`.
Reality: host is Contabo; in a VM-loss disaster the operator would re-provision per the Oracle guide (F17) — wrong cloud, wrong console, wrong status page. (The procedures themselves — psql/Neon/compose — are host-neutral and verified.)
**P2.** Edit: s/Oracle VM/self-hosted VM (Contabo, observed R117)/ throughout; repoint §host-prereqs to a host-neutral "VM tooling" list (Node 22 + pnpm + postgresql-client-17) and to the future Contabo guide (F34a).

**F12. docs/DISASTER_RECOVERY.md:330-334 — drill ledger contradicts the drill ledger of record.**
Quote: `| PENDING-OPERATOR | B — full-DB restore … | NOT EXERCISED — r110 automated the nightly backup but could not run a drill …`
Reality: `docs/deployment/FINAL_RESTORE_DRILL.md:96-97` records two executed PASS drills (2026-09-25 R112; 2026-10-01 R115, `restore-drill-check.sh exit 0 VALIDATED`), and FINAL_RESTORE_DRILL:149 explicitly says to mirror results into this ledger — never done.
**P2** — an operator believes restore is unproven. Edit: add both PASS rows + the remaining honest gap (first ON-VM drill still pending).

**F13. docs/COMPLIANCE.md §2 (Data Retention, item 2) — "audit_logs has no retention job".**
Quote: `but audit_logs itself has no retention job. Plan and implement a purge policy before claiming a 1-year bound externally.`
Reality: `backend/src/jobs/auth-audit-retention.ts:25` `AUDIT_LOGS_RETENTION_DAYS = 180`, wired to the 05:00 UTC cron (`cron.ts:217-234`) + boot one-shot; documented in LOGGING_AND_RETENTION_FINAL.md:91.
**P2** — a compliance-facing doc misstates deletion behavior in BOTH directions (understates audit_logs purge; lists admin_alerts as "30 d" without the unread-14d stale-mark). Edit: rewrite item 2 against the verified retention table in LOGGING_AND_RETENTION_FINAL.md §4.

**F14. docs/COMPLIANCE.md §5 (Backup Policies) — "backups are MANUAL today / no automated nightly job / drill log 'none yet'".**
Quote: `Backups are MANUAL today … no automated nightly backup job runs — provisioning one … is an operator TODO` · `Restore drills are manual and currently not scheduled (DISASTER_RECOVERY.md tracks the drill log as "none yet").`
Reality: nightly automation exists since r110 (`scripts/backup-cron.sh`, documented 03:15 UTC crontab, DISASTER_RECOVERY §Automated backups); two restore drills PASS (F12).
**P2.** Edit: replace with "Nightly automated dumps on the VM host (03:15 UTC, keep 14) + optional off-VM PUT; drills executed R112/R115 (see FINAL_RESTORE_DRILL ledger)."

**F15. docs/operations/FINAL_INVENTORY_LOADING.md:173-180 (§8) — the runbook's own "live state" is r112-era.**
Quote: `Deliverable stock under ACTIVE products: 1 unit — product slug netflix-premium; 10 deliverable units total incl. archived products' stock.`
Reality (DB read-only, 2026-10-06): **3 sellable units under ACTIVE products** (cpanel ×1, lifetime-cloud-storage ×1, netflix-premium ×1 — all deliverable), 6 unsold units total (3 more under archived sim-r94/test-product-playwright); live `/api/catalog/stats` → `available_products: 3, total_units: 6`. (R117 had observed 0 — stock loading has partially started since.)
**P2** — this is the operator's #1 runbook and §8 misstates the exact state it manages. Edit: replace §8 numbers with the current figures + date, or better: delete the static counts and instruct "run the §4 SQL (b) — it is the truth; §8's numbers were r112-epoch".

**F16. config/env.example:22 — DB_POOL_MAX=15 contradicts its own comment and the production contract.**
Quote: `DB_POOL_MAX=15` two lines above `# (r110 …) Match the code defaults (shared/db/src/index.ts)`.
Reality: code default = **8** in production (`shared/db/src/index.ts:42`); FINAL_PRODUCTION_ENV §3 says "Default 8 — leave unset"; render.yaml was fixed 15→8 for exactly this ("2026-09-20: 15 → 8. Neon Free compute is 0.25 CU — a 15-connection burst … queues"). Copying this template into production re-arms a known outage class.
**P2.** Edit: `DB_POOL_MAX=8` (or comment it out with "unset = code default 8 prod / 10 dev").

**F17. docs/deployment/FINAL_COMMAND_BOOK.md:41-57, 77 — the copy-paste book provisions the wrong host.**
Quote: `## ORACLE (the VM — first boot)` … `uname -m  # aarch64` … `./scripts/docker-verify.sh --arm64` … `ssh ubuntu@<OPERATOR_INPUT_VM_IP>`.
Reality: live host is a Contabo VPS (R117 observed-host evidence); the Oracle console/Security-List/aarch64 steps do not describe it. `docker-verify.sh` itself is host-neutral (arm64 gate is optional `--arm64`).
**P2.** Edit: retitle the section "VM (first boot — originally Oracle ARM64; CURRENT HOST = Contabo, use the native arch)", make `--arm64` conditional, and add the observed-host note.

**F18. docs/deployment/FINAL_COMMAND_BOOK.md:121-125 + CLOUDFLARE_FINAL_CUTOVER.md §1-§4 — "proxied orange / Full (strict) / WebSockets ON" taught as the final DNS state.**
Quote (command book): `(A subnation.ly → VM_IP proxied · CNAME www → subnation.ly proxied · SSL mode Full (strict) · WebSockets ON · cache only /assets/*)`; quote (cutover §1): `subnation.ly | A | <VM_IP> | Proxied (orange)`.
Reality: the live zone is **DNS-only (grey)** — no proxy, no edge TLS/WAF (CLOUDFLARE_FINAL_CUTOVER §8 addendum, R117; live headers). The §1 table is still labeled "final state" with no reconciliation pointer.
**P2.** Edit: annotate §1 with "OBSERVED LIVE (R117+): records are DNS-only grey — §8"; in the command book, add one line "current live state = DNS-only (see §8 addendum) — do not 're-fix' the zone to proxied without deciding".

### P3 — stale / polish / missing

**F19. Stale verification stamps on the FINAL_* operator docs.**
- `docs/FINAL_MONEY_INVARIANTS.md:3` — "proven from source at HEAD `521234f`" (R112 stamp; body re-verified R117-C1 and spot-verified at `ef3d0c3` in this audit — M1/M2/M3/M4 cites exact). [Seed (a) confirmed]
- `docs/operations/FINAL_INVENTORY_LOADING.md:7` — "verified at HEAD 521234f".
- `docs/operations/FINAL_ADMIN_TOTP_SETUP.md:5` — "Verified at HEAD 521234f".
- `docs/deployment/FINAL_PRODUCTION_ENV.md:3-4` — "Reconciled … at HEAD 521234f (r112) and RE-VERIFIED UNCHANGED at … 6f14bc3" (R116/R117 delta not re-stamped; content spot-checked still true).
- `docs/deployment/NEON_IDLE_ECONOMICS.md:3-5` — same 521234f stamp + "verified UNCHANGED through R115" (R117 added the OTP `lockPool` — 2 dedicated Neon clients on OTP starts — unmentioned).
**P3.** Edit: add a stamp line "cites re-verified at ef3d0c3 (R118-A7)" or re-stamp per file.

**F20. docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md:57 — stale migration-chain reference. [Seed (b) confirmed]**
Quote: `business schema (boot reconciler V1-M6…V1-M20; …)`.
Reality: runtime chain extends to **V1-M23** (`backend/src/migrate.ts:3185` — V1-M23 wallet_topups.reviewed_by, R116); drizzle chain to 0015. PRODUCTION_ARCHITECTURE was fixed to V1-M23 by R117-C1; this diagram was missed.
**P3.** Edit: `V1-M6…V1-M23`.

**F21. docs/operations/FINAL_ADMIN_TOTP_SETUP.md:144 — wrong test filename.**
Quote: `frontend/src/pages/admin/__tests__/admin-login-cookie-session.test.ts`.
Reality: the file is `.tsx` (`admin-login-cookie-session.test.tsx`); the other three cited test files exist exactly as written.
**P3.** Edit: `.ts` → `.tsx`. (Doc otherwise matches implementation: 2FA routes, lockout constants 5/15-doubling, no backup codes, `admin_users.ts:37-38` columns, live `ahmadmedo totp_enabled=false` — CURRENT.)

**F22. Line-drift class on verified-accurate runbooks.**
- FINAL_INVENTORY_LOADING: `products.ts:82-87` → actual `:83-88` (deliverableUnitCondition); `stats.ts:65,76` → actual `:37` (cacheWrap 30s) and `:77` (available_stock); `products.ts:509-749` → ends `:751`. All other cites (manual.provider 50-79/97-110/114-119, stockWatcher 135-168, admin/products 26-32/104/388-394, advisory lock :642, 500-row cap :627) exact.
- FINAL_MONITORING: `health.ts:473-476` (static ok) → actual `:495-501`.
**P3.** Edit: refresh the two/three drifted numbers.

**F23. OPERATIONS_RUNBOOK.md:20 — dashboard URL `/admin/observability` does not exist.**
Reality: the admin page is `/admin/system` (App.tsx:487); `/api/admin/observability/*` is the API. Live `/admin/observability` returns SPA 200 but renders no such page.
**P3.** Edit: `Internal admin observability | /admin/system (API: /api/admin/observability/*)`.

**F24. OPERATIONS_RUNBOOK.md:352-353 — bare-curl example for an admin-gated route.**
Quote: `$ curl https://subnation.ly/api/healthz/firebase` → shown returning the config JSON.
Reality: live bare curl → **401 UNAUTHORIZED** (`health.ts:508` `requireAdmin`); the runbook's own §7 note for `/ready` says exactly this.
**P3.** Edit: add `-H "Authorization: Bearer $ADMIN_JWT"` to the example.

**F25. OPERATIONS_RUNBOOK.md:110-115 — dormant #worker note says "the app runs on the PG-lease scheduler fallback".**
Reality: the deployed contract is `SINGLE_INSTANCE_MODE=true` synthetic in-process leadership (§5 of the same file; FINAL_MONITORING §2; `web-scheduler.ts:291-308`) — no PG-lease refresher runs.
**P3.** Edit: "the app runs SINGLE_INSTANCE_MODE (synthetic leadership); heartbeat is inert without Redis."

**F26. Host-naming comments in deploy artifacts.**
`docker-compose.yml:4` "R107 (Oracle Cloud + Coolify migration)" + `:15` "PRODUCTION (Oracle VM + Coolify)"; `deploy/env.compose.example:4` "R107 (Oracle/Coolify migration)"; `scripts/docker-verify.sh:5,13` "the Oracle VM"/"the Oracle Ampere A1 target" (optional-gate comments); `pnpm-workspace.yaml:68` "The Oracle ARM64 target". Compose/env/scripts are host-neutral and work on Contabo — only the comments misname the host. **P3.** Edit: "(originally the Oracle Cloud target; live host since 2026-10 = Contabo)".

**F27. render.yaml:73-74 — "Pre-launch state … the platform is still in development."**
Reality: live production store at subnation.ly since 2026-10. (File is otherwise correctly bannered LEGACY/FROZEN; the A7-2 "warns at boot" comment at :83 is TRUE again — the call was restored in 8acba4a, `app.ts:34`.) **P3.** Edit: drop the pre-launch sentence or mark it r116-era.

**F28. vercel.json:2 — legacy banner says "Production target is Coolify on Oracle Cloud".** **P3.** Edit: "…Coolify on the self-hosted VM (originally Oracle; live host = Contabo)".

**F29. .specify/feature.json — stale pointer.** Valid JSON (R117 fix held) but `feature_directory: "specs/010-ai-admin-copilot"` while `specs/012-arabic-catalog-enrichment` is the newest spec. **P3.** Edit: point at 012 or record why 010 stays active.

**F30. docs/operations/LOGGING_AND_RETENTION_FINAL.md:53-58 — openwa cites resolve outside this repo.**
Quote: `openwa/src/lib.ts:260-285 … openwa/src/index.ts:514-518…`.
Reality: `openwa/` is a separate repository (no sibling checkout; compose header says production uses the GHCR image). The cites are unverifiable from SubNation2 — label them "openwa repo (ahmadmedo1012/openwa)". **P3.**

**F31. docs/DISASTER_RECOVERY.md:293 — "(after Phase 1.6 ships)".** Stale parenthetical: audit_logs table + queries live since r99-era. **P3.** Edit: delete the parenthetical.

**F32. docs/deployment/FINAL_CUTOVER_CHECKLIST.md — R115 boxes all unchecked.** The cutover executed (live since 2026-10-01/02 per FINAL_SIGNOFF/FINAL_MIGRATION_READINESS r115-db record). **P3.** Edit: add a banner "EXECUTED 2026-10-01..02 — see FINAL_SIGNOFF; boxes below are the historical R115 print-out."

**F33. README.md:187-197 — stale repo-state numbers.** "backend 1264/1264, frontend 573/573 (at R109 6ab63bc)" and "an actual docker build … still pending" — current backend = 1517 tests/165 files (R117-V1); Coolify has been building+deploying the repo since cutover. **P3.** Edit: refresh or date-scope.

**F34. MISSING OPS DOCS (R117-proven needs; create in docs/operations/ or docs/deployment/).**
(a) **Contabo/Coolify operations guide** — nothing describes the live host's day-2 ops (where the VM console is, how to redeploy, where Traefik config lives); ORACLE_FINAL_SETUP/COOLIFY_ORACLE_MIGRATION cover the wrong cloud.
(b) **Neon cold-start runbook** — FINAL_MONITORING §3 has two good paragraphs ("slow first query is expected") but no procedure for "healthz flaps / 503 during cold start → what to check, when to panic"; R117 measured 1326 ms connect vs 215 ms warm.
(c) **www→apex 301 Traefik/Coolify snippet** — the recommendation is correctly documented at CLOUDFLARE_FINAL_CUTOVER.md §8:168-173 [seed (d) verified ✓] but no actual Traefik redirect-rule/middleware snippet exists anywhere for the operator to paste.
(d) **CHANGELOG — none exists repo-wide** (`find -iname "CHANGELOG*"` → empty); R116/R117 feature ships are only in round reports.
(e) **R116/R117 features undocumented in operator docs:** per-admin credentials-reveal volume gate 60/10 min + 429 + named alert (`admin/orders.ts:21-70`); OTP `lockPool` (max 2 dedicated clients, 429 lock-loser — `whatsapp-otp.service.ts:161-178`); `decrypt_failed` honest signal (`admin/orders.ts:322-330`); checkNeon warmup probe; static canonical in `frontend/index.html:63`; mobile money-page fixes (6538909). Belong in OPERATIONS_RUNBOOK/FINAL_MONITORING/API.md or a CHANGELOG.
**P3** (as missing-doc findings; (c) is the operator's pending canonical-host action).

**F35. Chain-of-staleness on "current state" pointers.** PROJECT_OVERVIEW.md (bannered historical) defers current state to `OPERATIONS_RUNBOOK.md` + `docs/final-audit-2026-09-20.md`; PLATFORM.md defers to "OPERATIONS_RUNBOOK §5" — all three targets are themselves stale/false (F1-F3). **P3.** Edit: repoint every "for current state see X" at the docs/README.md index (§5 below) once it exists.

---

## 3. EXECUTABILITY REPORT — the 5 runbooks (dry verification, no writes executed)

### 3a. docs/operations/FINAL_INVENTORY_LOADING.md — **FIXABLE (near-perfect); the #1 operator action is safe to follow.**
- Every referenced artifact EXISTS: `InventoryUploadDialog.tsx`, `inventory-parser.ts`, `routes/admin/products.ts` (upload :509-751, set-count :435, dedup-preview :373), `manual.provider.ts`, `stockWatcher.ts`, `stats.ts`, `copilot/admin-direct.ts` (update_stock :521+, `delta>0` refused :569), `products.ts` (public availability :155-157).
- Schema/table claims match `shared/db/src/schema/inventory.ts` + live DB exactly (columns, GCM-at-rest, two-pool semantics; 59/45/263 counts still true).
- SQL §4/§5: all columns exist (`is_sold`, `account_email`, `account_password`, `extra_details`, products `slug/is_active/is_archived`); BEGIN/ROLLBACK and the id-ceiling rollback pattern are copy-pasteable and correct; §4(b) is exactly the query that would have shown today's truth.
- Limits stated match code: 500 rows/batch (:627), ≤256 KB client read, advisory lock (:642), `skipped_duplicates` (:718), audit `product.inventory.upload` (:729), stock-sweep throttle 10 min (stockWatcher:115), low-stock ≤3 (LOW_STOCK_THRESHOLD=3), `/api/admin/stats` 30 s cache (stats.ts:37), catalog cache ≤60 s (+300 SWR).
- **Top issues:** (1) §8 stale live-state (F15 — 3 sellable products today, not 1 netflix unit); (2) stale 521234f stamp (F19); (3) three drifted line cites (F22). Nothing blocks execution.

### 3b. docs/operations/FINAL_ADMIN_TOTP_SETUP.md — **ACCURATE; executable as written.**
Implementation exists and matches (`/api/admin/2fa/setup|verify-setup` behind requireAdmin, `requires_2fa` + 10-min temp token, `verifySync`, lockout 5/15-doubling DB-backed, no backup codes, `admin_users.totp_secret/totp_enabled`). §4 recovery SQL columns verified. §6 claim "`ahmadmedo` still has `totp_enabled = false`" is CURRENT (DB read-only, 2026-10-06). Fixes needed: stale stamp + one test filename (F19, F21). Doc-side verdict for the A4 cross-check: **the doc is TRUE — the feature is implemented; only the operator enrollment step remains open.**

### 3c. docs/operations/FINAL_MONITORING.md — **EXECUTABLE with 2 stale pointers.**
Live-verified: `/api/healthz` 200, `/healthz/live` 200, `/healthz/summary` `{"status":"ok"}` (weekly checklist #1 works today). All 9 daily cron slots + opportunistic OTP prune + 60 s evaluator + alert channels (telegram/discord/webhook) match code. Compose healthcheck lines (30 s/150 s; 10 s openwa) verified. Defects: Oracle title/companions (F7) and the CF-WebSocket triage row (F8); `health.ts:473-476` cite drift (F22).

### 3d. docs/operations/LOGGING_AND_RETENTION_FINAL.md — **ACCURATE (best doc in the set).**
All 13 retention-table rows verified against code (7d/180d login+audit via `auth-audit-retention.ts:24-25`; 48 h idempotency `:17`; 14/30 admin_alerts `cron.ts:57-77`; 90/180 notifications `:24-25`; 24 h OTP throttle 60-min `whatsapp-otp.service.ts:124,783`; 03:15 host cron + keep-14; 10m×3 json rotation at compose:113-117/174-178). pino REDACT_PATHS at logger.ts:71+ ✓. Only caveat: openwa cites live in the sibling repo (F30).

### 3e. OPERATIONS_RUNBOOK.md (root) — **Render-flavored; sections 5/9 are FALSE for the live stack.**
Accurate parts: §2 per-rule triage anchors match `ALERT_RULES` + `runbookSection` (alerting.service.ts:87-128); dormant-rule banners (fe-sentry, worker, jobs) are honest; §8 smoke commands exist (`POST /api/admin/alerts/test` alerts.ts:44, `/api/cwv` cwv.ts:187); §10 `WHATSAPP_OTP_SETTLE_MS` 45 s/0-300k clamp verified (openwa.service.ts:221). False/stale: §5 (F2), §9 (F3), header (F4), `/admin/observability` (F23), bare firebase curl (F24), PG-lease note (F25). §3/§4 are LEGACY-marked with correct post-migration pointers (Coolify redeploy), so rollback guidance survives — but the numbered steps are Render-only.

---

## 4. CONSISTENCY MATRIX (topic → what docs say → what is TRUE)

| Topic | Docs say | TRUE (evidence) |
|---|---|---|
| Host | "Oracle VM/Cloud ARM64" (TOPOLOGY §1/§4/§8, DR:3/10, MONITORING:1, RUNBOOK:3, README:31/63, PLATFORM:33, COMMAND_BOOK, ORACLE_FINAL_SETUP, COOLIFY_ORACLE_MIGRATION) — vs the R117 blockquote in TOPOLOGY/PRODUCTION_ARCHITECTURE | **Contabo VPS** 169.58.100.161, PTR vmi3624162.contaboserver.net (R117 A4 live; headers this audit show LE-at-origin) |
| Deploy method | RUNBOOK §5 "Render free web + Vercel parallel (current-state authority)"; README "migration in progress" | **Coolify building this repo → Docker on Contabo; one replica; SINGLE_INSTANCE_MODE=true** (live since 2026-10-01/02) |
| DB | "Neon calm-art-99771185, us-east-1, 42 tables" (DR:12, SIGNOFF, PLATFORM:47) | **Verified**: probe URL host matches; 42 tables counted read-only |
| Domain strategy | TOPOLOGY/CUTOVER §1-§3 "Cloudflare proxied + Full(strict) + WS ON"; RUNBOOK §9 "proxied, Always-Use-HTTPS" | **Cloudflare DNS-only (grey)**; LE cert at origin; no cf-ray; §8 addendum + live headers |
| www→apex redirect | No doc claims an in-app redirect is active ✓ (f10bb9b removed it); §8 addendum recommends Traefik 301 | **No redirect at any layer** (www 200 = apex 200, byte-identical) — 301 remains an open operator action |
| Stock state | INVENTORY_LOADING §8 "1 unit (netflix)"; r117 report "0 sellable" | **3 sellable products (1 unit each: cpanel, lifetime-cloud-storage, netflix-premium), 6 unsold total** (DB + /api/catalog/stats) — loading started after R117 |
| Admin count | TOTP doc §6 "ahmadmedo only, totp_enabled=false" | **Verified current** (single admin, TOTP off) |
| Contracts/OpenAPI | SIGNOFF (R115) "82 documented" | **83 operationIds** at HEAD (e394815 added reveal-gate doc) — R115 number is correctly dated |
| Test counts | README "1264+573 (R109)"; COMMAND_BOOK/SIGNOFF "1497+703 (R115)" | **1517 backend/165 files at R117-V1**; both doc numbers are dated records (README's is presented as "Repo state" without a date scope) |
| Redis | "Not provisioned anywhere" (DR:12-14, TOPOLOGY §9, ENV docs) | Consistent with all docs/code; unverifiable from outside the VM but no contradiction found |
| Scheduler mode | RUNBOOK:112 "PG-lease fallback" vs RUNBOOK §5 + MONITORING + env docs "SINGLE_INSTANCE_MODE synthetic" | **SINGLE_INSTANCE_MODE=true contract** (env.compose.example:44; web-scheduler.ts:291-308) — RUNBOOK:112 is the outlier |
| Vercel mirror | RUNBOOK §9 "keep both green"; PLATFORM "LEGACY MIRROR, STALE" | **Dead — 404 live**; PLATFORM is right, RUNBOOK §9 is wrong |
| Backup automation | COMPLIANCE "manual, no nightly job" vs DR/LOGGING "nightly 03:15, keep 14" | **Automated (r110)** — DR/LOGGING correct; COMPLIANCE stale |
| Migration status | README/RUNBOOK/PLATFORM/MIGRATION_READINESS "pending/target" | **Complete** (live) |

---

## 5. DOCS INDEX PROPOSAL (docs/README.md — create; moves are NOT executed in this phase)

Inventory: **96 markdown files** under docs/ (16,558 lines; ≈1.4 MB). Naming today mixes `FINAL_*`, `STRONGEST_*`, `deep-audit-*`, `ux-audit-*`, `round-*`, `inspection-r*`, dated reports, and 6 topic subdirs — with no index and no status tags.

Proposed `docs/README.md` structure (status tags: **CURRENT** · **STALE** · **ARCHIVED**):

```
# SubNation2 Docs Index
> Current state lives in: FINAL_PRODUCTION_TOPOLOGY (architecture) ·
> OPERATIONS_RUNBOOK (on-call; pending R118 truth pass) · DISASTER_RECOVERY (DR)

## CURRENT (operator-facing)
operations/FINAL_INVENTORY_LOADING.md · FINAL_ADMIN_TOTP_SETUP.md ·
FINAL_MONITORING.md · LOGGING_AND_RETENTION_FINAL.md
architecture/FINAL_PRODUCTION_TOPOLOGY.md · PRODUCTION_ARCHITECTURE.md
deployment/{CLOUDFLARE_FINAL_CUTOVER,COOLIFY_FINAL_SETUP,FINAL_COMMAND_BOOK,
FINAL_PRODUCTION_ENV,FINAL_ROLLBACK_RUNBOOK,FINAL_RESTORE_DRILL,
SECRET_HANDLING_FINAL,NEON_IDLE_ECONOMICS,ENVIRONMENT_MATRIX,RENDER_LEGACY_FALLBACK}.md
../DISASTER_RECOVERY.md · WHATSAPP_OPERATIONS.md · API.md · COMPLIANCE.md ·
FINAL_MONEY_INVARIANTS.md · loyalty/ · pricing/ · ux/FINAL_UX_SYSTEM.md
  → each carries its R118 open-fix note (F7/F8/F9/F15/F17/F18…)

## STALE (truth-pass or re-scope before trusting)
README-adjacent: PLATFORM.md, PROJECT_OVERVIEW.md (both bannered historical)
deployment/{MIGRATION_RUNBOOK,COOLIFY_ORACLE_MIGRATION,ORACLE_FINAL_SETUP,
FINAL_MIGRATION_READINESS,FINAL_OPERATOR_INPUTS,FINAL_CUTOVER_CHECKLIST}.md
  (migration-era; keep until the Contabo guide exists, then archive)

## ARCHIVED → docs/archive/ (move, keep git history)
inspection-r94/ r96/ r97/ r98/ r111/ r117/   (30 files, ~1.0 MB)
round-92…round-98 + r110/r111/r116/r117 round reports
deep-audit-2026-09-06 · strongest-round-2026-09-06 · db-audit-2026-09-07
final-audit-2026-09-20 · free-tier-optimization-2026-09-20
ux-audit-{storefront,admin,icons} · subnation-ux-world-class-plan-2026-09-06
catalog/{final-report,catalog-gap-analysis}-2026-09-20 · seo-enrichment-r116.md
inspection-r98/* · round-*-repair-plan.md
```

Rules: (1) `FINAL_*` = the only naming pattern for CURRENT operator docs (already de-facto); (2) dated files get an `ARCHIVED (date)` first line instead of deletion; (3) every "for current state see X" pointer (F35) is rewritten to this index; (4) new docs get a `Status: CURRENT @ <date>` header line that must be touched by the change that invalidates it.

---

## 6. Stats

**Findings by severity: P1: 3 · P2: 15 · P3: 17** (35 findings; 2 of the P1s and 5 of the P2s share one root cause — no front-door doc ever recorded "cutover done, live on Contabo").

*Verified-OK highlights (no action):* WHATSAPP_OPERATIONS (R117 rewrite), LOGGING_AND_RETENTION_FINAL (all 13 retention rows exact), FINAL_MONEY_INVARIANTS body cites, FINAL_ADMIN_TOTP_SETUP content (incl. live TOTP state), API.md rate limits, NEON_MCP_SETUP endpoint, SECRET_HANDLING_FINAL, FINAL_RESTORE_DRILL ledger, FINAL_SIGNOFF (dated), render.yaml/vercel.json legacy banners, package.json/tsconfig validity, cron slots 00:00–05:00, healthz family, alerting channels, reveal-gate & lockPool code present (undocumented — F34e).
