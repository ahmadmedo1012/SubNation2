# R148 — provider-integration honesty + error-copy closure: closing report

Round base: `9621bd6` (R147 close) → this round's code. Method: the repo's
standing Ponytail ruleset (root `AGENTS.md`) applied with lean specialist
lanes; Caveman methodology applied manually (no executable middleware in the
remote session — same honest status as R147).

## The mission's four external tracks, closed at the maximum authorized depth

R148's priorities 1–3 are operator-gated. Each was investigated to its real
boundary, the repository-side work was maximized, and the exact owner action
is recorded — nothing is claimed closed that is not closed.

### 1. Security exposures (:8080 / :6001 / :8000) — still open, now continuously measured

External state re-verified from this round's independent vantage
(2026-10-14): `169.58.100.161:8080` → **301/200** (Traefik dashboard +
unauthenticated API still public), `:6001` → **404** (Reverb still
answering), `:8000` → **302** (Coolify management still answering). The
live contract is unaffected (home 200, `/api/healthz` `{"status":"ok"}`).

No SSH key, Coolify credential, or provider-panel access exists in the
engineering environment, and `EXPOSURE_REMEDIATION_R144.md` is explicit that
closure is VM/panel work — the repo cannot close a port. What the repo CAN
do, this round shipped: **Probe 4 — the exposure guard** in
`.github/workflows/uptime-monitor.yml`. Every 5-minute watchdog run now
probes all three out-of-contract listeners from the GitHub-runner vantage:
each ✗ port logs a distinct line + a `::warning::` annotation
(`exposure_open=N/3`), deliberately warning-level only (exposure ≠ outage —
the run stays green so the badge keeps meaning "site up"; the Telegram
alerting path is byte-identical, zero noise risk). This automates the
runbook §4 verification protocol: when the operator executes §3.1 (dashboard
toggle / entrypoint removal), §3.2 (realtime stop), §3.3 (firewall
allowlist with the documented preflight-lockout discipline), the ✗ lines
flip to ✓ automatically and the Actions history becomes the "record the
result" evidence the runbook asks for.

**Owner action (unchanged, now self-verifying):** execute
`docs/deployment/EXPOSURE_REMEDIATION_R144.md` §3 in order; keep an SSH
session open for §3.3; confirm the allowlist before enabling default-deny.

### 2. Embronic — Phase A result: no official public API contract exists

Searched from the engineering vantage: web search (multiple query shapes)
returns zero Embronic API documentation; direct reads of
`embronic.com/product/reseller-kit/` + `/product/reseller-credit/` show a
WordPress/WooCommerce storefront whose reseller program is a **white-label
panel + credits product** ("platform, hosting, automation tools, account
generation systems, and white-label dashboards") — the only "api" strings
on the pages are WP internals; no `EMBRONIC_API_*` configuration exists in
any authorized environment. The integration is therefore blocked on a
genuine external prerequisite, exactly as the design doc recorded — no
endpoints were invented, no speculative `embronic.provider.ts` created, no
contract tests fabricated against a guessed mock.

`docs/pending/embronic-adapter-design.md` now carries the Phase A discovery
record + the exact 3-item owner action (API docs, credentials →
`EMBRONIC_API_*` in Coolify, tier confirmation), and the stale
`project-plan/09-external-blockers.md` pointer is corrected (the 00–09 set
moved to `docs/deprecated/project-plan/` in R122). The prepared boundary
(`manual.provider.ts` / `registry.ts` / `types.ts`) is verified untouched.
Manual inventory upload stays the documented interim supply path — NOT the
solution to the integration; no synthetic stock was created.

### 3. Monitoring / release identity / GSC — exact owner actions, no fabricated completion

- **Uptime alert delivery:** the watchdog runs green every 5 minutes
  (probes pass), but the repository secrets `TELEGRAM_BOT_TOKEN` +
  `TELEGRAM_CHAT_ID` are absent (verified via API — only `NEON_API_KEY` +
  `RENDER_DEPLOY_HOOK_URL` exist), so alert delivery degrades gracefully
  per design. The bot token + chat ID live in the Coolify env of record
  (the live Telegram ops channel, runbook §12 — never delete/replace that
  configuration). **Owner action:** copy those two values into GitHub →
  Settings → Secrets and variables → Actions (or hand them to the
  engineering session over a secure channel — the secrets write path is
  verified working with the owner PAT), then dispatch the workflow with
  `test_alert=true` and confirm receipt.
- **Release identity:** the mechanism is complete (`GIT_SHA` →
  `SOURCE_COMMIT` → `RENDER_GIT_COMMIT` resolution in the Dockerfile, both
  build args declared); what is missing is the Coolify-side input.
  **Owner action:** enable Coolify's *include source commit in build*
  (passes `SOURCE_COMMIT=<sha>` automatically per push-to-deploy — the
  Mission W1 mechanism) or set the `GIT_SHA` build arg; then verify the
  7-char SHA greppable in the live JS bundle (the R146 method).
- **GSC:** repo side shipped long ago; the live meta tag serves
  `content=""` (re-verified this round). **Owner action:** the 6-step HTML
  tag flow in `docs/deployment/GSC_VERIFICATION_R144.md` §1 (token from
  the operator's Google account → `VITE_GSC_VERIFICATION` build arg →
  redeploy → verify → sitemap submit).

## The product work (priorities 4–5): error-copy closure + the products-editor double-create guard

A read-only defect scan of the surfaces NOT recently swept (storefront
search, cart, checkout entry, orders/subscription delivery, admin
products/categories) found the customer surfaces **clean** — R145–R147
closed them — and concentrated the real defects in two classes:

### Lane 3-admin — the products editor could create duplicate catalog rows

`handleSubmit` had no pending guard and the advertised ⌘S shortcut
dispatched a submit event that **bypasses the disabled button** — two ⌘S
presses while a POST was in flight meant two `POST /api/admin/products`
(no Idempotency-Key on that route) → duplicate products in the live catalog
(slug uniquifier makes both succeed). Fixed with the smallest complete
change: a pending-guard first line + the R147 busy-state idiom on the save
button (Loader2 spin + «جارٍ الحفظ…» + `aria-busy`); the three raw error
toasts routed through `getErrorMessage`; the toolbar count plural rides
`formatCount` (the 93-C8 paradigm two rows above it).

### Lane 3-errcopy — every raw `err.message` display extractor, closed repo-wide

The products file's R126-L3 fix exposed a class: ~40 sites across 21 files
rendered `err instanceof Error ? err.message : …` into toasts and error
slots — and the generated ApiError message is
`"HTTP 400 Bad Request: <Arabic server message>"`, English HTTP noise
glued onto Arabic, shown verbatim. The repo's own bar (R96 96-F7
Arabic-collapse guard, R126-L3, R144-C1) treats exactly this as a defect.
Two specialist agents + coordinator follow-up swept **all** of them through
`getErrorMessage` (server Arabic passes, HTTP prefixes strip, technical
English collapses to Arabic network copy): 27 sites in the admin pages
tree (settings/pricing/promotions/admins/login/whatsapp/coupons/orders/
enrichment + the settings subcomponents), 5 in admin components
(InlineStockEdit, InventoryUploadDialog, CopilotPanel's three catch
extractors — now matching that file's own four getErrorMessage sites), and
the last 3 customer-facing ones (AuthProviders' linking + consent-token
error slots — which also gain the code-mapped Arabic copy for
EXPIRED/CANDIDATE_MISMATCH/FIREBASE_UID_MISMATCH — and
TelegramLoginButton's auth-url failure). Auth/security logic untouched;
session-expiry sentinel compares untouched (control flow, not display).

## Gates (all green, this exact tree)

- Frontend targeted: the four touched/new suites per lane + every suite
  pinning/mounting the changed files — products lane 281, error-copy lane
  533, coordinator follow-up 191 + 23 → **1,028 targeted tests green**;
  `tsc --noEmit` clean per lane.
- lint / typecheck / backend+frontend suites / production build: run once
  at commit time per `.hermes.md` (results in the commit message); CI runs
  the full batteries on the pushed SHA.
- The exposure-guard probe logic was verified against the live VPS
  (8080→301 ✗, 6001→404 ✗, 8000→302 ✗, dark control port → ✓) and the
  workflow YAML parsed clean.

## What this round did NOT do (honesty section)

- No Embronic adapter, no invented endpoints, no fabricated credentials.
- No manual inventory restock, no synthetic stock, no availability lies.
- No port actually closed (operator-gated), no Telegram secret values
  touched (never read, never echoed), no GSC token invented.
- No changes to checkout, wallet, provider boundary, migrations, or any
  money path; eager-bundle budget untouched (admin lazy chunks only).
