# 09 — External Blockers (gates outside my control)

Recorded exactly; work continues around them. Resume automatically when cleared.

| # | Blocker | Blocks | Exact action required from operator | Detected |
| --- | --- | --- | --- | --- |
| 1 | Embronic official API docs + credentials (+ reseller subscription if required) | Real fulfillment integration; sellable supply at scale (Waves 6→completion) | Supply docs + API credentials; then the prepared adapter resumes | mission start |
| 2 | Firebase service-account JSON (+ project id) for Google sign-in backend; VITE_FIREBASE_* web config for the button | Google login (Waves 5→completion) | Supply service-account JSON + web config; I wire env + build args + verify | live probe: 503 |
| 3 | WhatsApp QR scan on a phone with WhatsApp | WhatsApp OTP login (Wave 2 completion) | Open /admin/whatsapp → create session `subnation-otp` → pair via QR (or pair-code) | `/api/sessions` = [] |
| 4 | Inventory restock (real supply) | Store sells nothing (6 units, mostly archived) | Load inventory per `docs/operations/FINAL_INVENTORY_LOADING.md` or wait for Embronic | DB probe |
| 5 | TOTP enrollment for sole admin account | 2FA hardening (recommended, not blocking) | Enroll via /admin/profile 2FA setup | R116/R117 operator TODO |
| 6 | Vercel GitHub App disconnect (failing status checks on every push) | Clean CI surface | Account-level GitHub → Applications → remove Vercel integration | FINAL_OPERATOR_INPUTS |
| 7 | GitHub Actions billing (optional) | CI runs remotely; irrelevant while local gates are enforced | Operator billing decision | README/.hermes.md |
| 8 | Telegram alert-bot creds (optional channel) | Ops alerting via Telegram | Supply TELEGRAM_BOT_TOKEN+CHAT_ID as a pair | env matrix |
| 9 | Sentry DSN (optional) | Error tracking | Supply SENTRY_DSN (+VITE_ if frontend wanted) | env matrix |
| 10 | Cloudflare www→apex note (optional SEO hygiene) | Canonical 301 at edge/Traefik | R117 §8 recommendation — Traefik-layer label change (I can do the Traefik side; Cloudflare dashboard is operator-only) | R117 finding |
| 11 | DR/backup runbooks reference the abandoned Oracle host | Doc truth (P3) | None — I reconcile the docs in Wave 10 | R117 finding |

Nothing above blocks Waves 1, 3, 4 (post-3), 6 (prep), 7, 8 (minus paired-session flows), 9, or the
bulk of 10.
