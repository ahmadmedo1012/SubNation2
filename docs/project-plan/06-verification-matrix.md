# 06 — Verification Matrix

Evidence required per claim. "Prove it" — command output or probe response, never inspection alone.

| Area | Claim to verify | Method | Wave |
| --- | --- | --- | --- |
| Gates | lint/typecheck/tests/build green at deployed SHA | local run, cite totals | every |
| Deploy chain | GitHub main → Coolify build → container | Coolify deployment record + build log + container `GIT_SHA` | 1 |
| Live SHA | outside == inside == main HEAD | `curl /api/healthz` + `docker exec env` | 1, every deploy |
| Health | healthz ok; summary stable ok when warm | curl ×N over minutes incl. after idle | 1, 10 |
| Auth: Telegram | providers lists telegram; verify layer rejects garbage | live probes | 5, 8 |
| Auth: Google | 503→configured transition when creds land; CSP correct | live probes + build args | 5 (gate: creds) |
| Auth: WhatsApp | gateway state machine, cooldowns, waking contract | endpoint + service tests + live gateway probes | 2, 8 |
| Admin | login, topup approve w/ reviewed_by, orders reveal gate, whatsapp manager | Playwright + API with admin session | 8 |
| Money | checkout single-tx, idempotency, refund, ledger | money suite (already 1517 tests) + targeted reruns on every money-adjacent diff | continuous |
| Inventory | single-writer claim, fail-closed on bad ciphertext | suite + targeted | 3, 4 |
| Provider secrecy | cost/identity/SKU never in public API/UI | catalog-security tests + grep pass | 3, 6, 7 |
| Security | semgrep/trivy/osv/gitleaks clean or triaged | tool JSON parsed, errors read | 7 |
| Browser QA | zero console errors on money+auth paths; screenshots | Playwright runs desktop/mobile/RTL/dark | 8 |
| Performance | bundle ≤ budget; boot < s; queries < ms thresholds | build stats + timing probes | 9 |
| Backups | restore drill reproducible | `scripts/restore-drill-check.sh` | 10 |
| Docs match reality | spot-check 5 claims against live | manual probe | 10 |

Rollback understanding per deploy: previous Coolify deployment restorable; DB expand-first; never
deploy `6caa63b` / `3a2e2e1` (r115 rollback floor).
