# 09 — External Blockers (gates outside my control)

Recorded exactly; work continues around them. Resume automatically when cleared.

| # | Blocker | Blocks | Exact action required from operator | Detected |
| --- | --- | --- | --- | --- |
| 1 | Embronic official API docs + credentials (+ reseller subscription if required) | Real fulfillment integration; sellable supply at scale (Waves 6→completion) | Supply docs + API credentials; then the prepared adapter resumes | mission start |
| 2 | Firebase service-account JSON (+ project id) for Google sign-in backend; VITE_FIREBASE_* web config for the button | Google login (Waves 5→completion) | Supply service-account JSON + web config; I wire env + build args + verify | live probe: 503 |
| 3 | ~~WhatsApp QR scan on a phone with WhatsApp~~ **RESOLVED 2026-10-05** — session `subnation-otp` paired & READY (operator completed pairing; evidence: `docs/project-state/external-integrations-final.md`) | WhatsApp OTP login (Wave 2 completion) | — none remains — | `/api/sessions` = [] (Wave 0) |
| 4 | Inventory restock (real supply) | Store sells nothing (6 units, mostly archived) | Load inventory per `docs/operations/FINAL_INVENTORY_LOADING.md` or wait for Embronic | DB probe |
| 5 | TOTP enrollment for sole admin account | 2FA hardening (recommended, not blocking) | Enroll via /admin/profile 2FA setup | R116/R117 operator TODO |
| 6 | ~~Vercel GitHub App disconnect (failing status checks on every push)~~ **RESOLVED 2026-10-05** — Vercel project + GitHub App integration deleted; `deploy.yml`/`render.yaml`/`vercel.json` removed from the repo (`62ee976`) | Clean CI surface | — none remains — | FINAL_OPERATOR_INPUTS |
| 7 | GitHub Actions billing (optional) | CI runs remotely; irrelevant while local gates are enforced | Operator billing decision | README/.hermes.md |
| 8 | Telegram alert-bot creds (optional channel) | Ops alerting via Telegram | Supply TELEGRAM_BOT_TOKEN+CHAT_ID as a pair | env matrix |
| 9 | Sentry DSN (optional) | Error tracking | Supply SENTRY_DSN (+VITE_ if frontend wanted) | env matrix |
| 10 | Cloudflare www→apex note (optional SEO hygiene) | Canonical 301 at edge/Traefik | R117 §8 recommendation — Traefik-layer label change (I can do the Traefik side; Cloudflare dashboard is operator-only) | R117 finding |
| 11 | ~~DR/backup runbooks reference the abandoned Oracle host~~ **RESOLVED** — host references reconciled by the R118-B4a host-naming truth pass (2026-10-06, see `docs/README.md`); Wave 10 closed 2026-10-05. `ORACLE_*.md` guides remain labeled historical | Doc truth (P3) | — none remains — | R117 finding |

Nothing above blocks Waves 1, 3, 4 (post-3), 6 (prep), 7, 8 (minus paired-session flows), 9, or the
bulk of 10.
