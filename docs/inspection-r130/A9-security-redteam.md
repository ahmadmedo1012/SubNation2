# R130-A9 — Security red team + authorization + privacy

**Scope:** R128/R129 delta (eb50024~1..fd702d6, 7 commits) + full-range
cross-check (7d469d5..fd702d6 for app.ts/.gitleaks.toml/middlewares), all
ten mission items, prior-round disposition re-verification.
**Method:** full reads of every delta-touched security-relevant file at
HEAD, per-surface delta diffs, the repo's own gitleaks (local 8.28.0, full
history, redacted), 7 GET-only live probes on subnation.ly (≤2/endpoint,
nothing authenticated, nothing mutated).

**Verdict: 0 P0 · 0 P1 · 0 P2 · 0 P3 · 1 P4.** The delta is security-inert;
it CLOSES inherited items (R128-B3 F1/F3/F4 verified closed in the delta
itself).

## A9-F1 [P4→P3 — VERIFIED, escalated by its own CI evidence] gitleaks full-history scans fail on 3 old patches quoting the public Firebase web key — FIXED R130 (scan-scope discovery + commit-scoped allowlist)
**The scan-scope discovery (the report's original premise was WRONG and is
corrected here):** gitleaks-action scans ONLY the pushed commit(s) on
`push` events (`--log-opts=-1` — the fd702d6 green run scanned exactly
**1 commit**) but scans FULL history on `schedule`/`workflow_dispatch`
(**745 commits**). So "CI's pinned 8.27.2 honors the allowlist" was never
true — push runs simply never scanned history. The first R130 dispatch run
failed with 3 `gcp-api-key` findings: (1) the R127 audit doc's verbatim
quote (masked at HEAD in R130 — but the deletion patch itself then carries
the literal, adding a 4th-looking instance inside commit 9fb4b1a's diff);
(2) SECRET_ROTATION_RUNBOOK.md (file since deleted); (3) render.yaml (file
since deleted). Empirically verified on BOTH 8.27.2-in-CI and 8.28-local:
no value-regex allowlist suppresses these (the captured secret rides
markdown/quote context), a combined regexes+commits entry is an AND (the
failing half sinks the entry), and `targetRules` scoping breaks `commits`
matching — the **commit-only global entry over exactly the 3 historical
SHAs** is the one shape that works (verified: full-history scan green; a
canary AWS-key shape still trips the gate). This also explains the
failing Monday `schedule` runs since R127. History is immovable without a
destructive rewrite; HEAD carries no literal.

## Not findings (confirmed acceptable / register discipline maintained)
- Dirty working tree (the R130 WIP): reviewed the diff — availability-aware
  pricing is server-side DB logic; cart addItem's boolean return is honest
  toast UX; no new trust of client input.
- .impeccable/config.json delta: CI-only design-linter config; ignoreRules
  stays [].

## Mission items — verified-clean surfaces (negative results)
1. Stock-honest cart: client stockCount is advisory UI only; the charge path
   never trusts it (in-tx re-reads, fail-closed price gate, zod perimeter,
   409 at claim). No client-sent stock/price reaches money.
2. Auth boundaries: delta touched no auth middleware; notifications
   pagination keeps requireUser + user_id scoping; copilot settings PATCH
   requireAdmin + scopes; requireUser fail-closed; Firebase verifyIdToken
   catch→throw.
3. Telegram webhook: secret gate 503-fail-closed / constant-time 403;
   admin-id numeric allowlist before parsing; parseTopupCallback regex
   remains the ONLY callback parser repo-wide; buttonsForTopup builds
   callback_data from server-known numeric ids; user-supplied
   paymentReference length-bounded + deduped + escapeHtml'd.
4. Redirect sanitization: all four consumers byte-equivalent to
   sanitizeInternalPath; the R129 gate-intent banners render only
   dictionary labels derived from the SANITIZED value.
5. Input validation: delta added zero new body-consuming routes; copilot
   settings uses a strict typeof allowlist over exactly 4 keys.
6. XSS: zero dangerouslySetInnerHTML/innerHTML/document.write in
   frontend/src (non-test); share-card interpolations through esc() into
   double-quoted attributes.
7. OpenWA boundary: backend is an outbound client only (env-configured base
   URL + API key); no inbound gateway webhook exists anywhere — nothing to
   authenticate because nothing calls in. (Untouched, per the protected-
   systems rule.)
8. Secrets hygiene: .gitleaks.toml unchanged across the full range (no
   broadened allowlists); the delta's only process.env additions are test
   throwaways.
9. Rate limiting: delta added no new public routes; shell/share-card routes
   ride catalogCache per the R122 contract.
10. CORS/CSP/headers: zero helmet/CORS changes in the delta; live byte-check
    matches app.ts (script-src keeps 'unsafe-inline' out; HSTS, nosniff,
    SAMEORIGIN, Permissions-Policy present); live probes: /assets miss →
    404 text/plain, /api/admin/audit-logs unauthenticated → 401 + no-store.

## Inherited — VERIFIED CLOSED this round
R128-B3-F1 (timeout no-op → error-logged in the delta), F2 (CSV formula —
R128, pinned), F3 (0020 doc note — in the delta), F4 (bidi actor cell);
R127-B11-F1 (webhook money path audited), F2 (Sentry denylist phone), F4
(PAT-in-remote-URL on THIS clone — clean URL + cache helper). Inherited-open
register unchanged (CSP script-src-attr, /api/metrics any-scope, admins.ts
mount-only auth, copilot rate-limit fail-open, Cloudflare ratelimit-policy
disclosure, security.txt soft-200 — no NEW evidence; not re-litigated).
