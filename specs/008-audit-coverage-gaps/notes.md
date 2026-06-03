# Coverage Gap Closures — Branch 008

**Branch**: `008-audit-coverage-gaps`
**Audit reference**: [`../004-security-audit/research.md`](../004-security-audit/research.md) §6 Coverage Gaps
**Date**: 2026-06-03
**Author**: Claude (Opus 4.7) on behalf of repo owner

This document records closures for three coverage gaps from security
audit 004. The original audit deliverables in
`specs/004-security-audit/` are intentionally NOT modified — they are
the immutable snapshot remediation references.

| Gap   | Subsystem | Closure type    | Branch action              |
|-------|-----------|-----------------|----------------------------|
| CG-01 | SUP-1     | Resolved        | Added CI step `audit`      |
| CG-02 | SUP-6     | Resolved        | New gitleaks rules added   |
| CG-03 | AUTH-2    | **Non-issue**   | Verified read-only; no fix |

The remaining gaps (CG-04 Cloudflare WAF, CG-05 Neon allow-list,
CG-06 Sentry org rules, CG-07 Render dashboard, CG-08 frontend
account-link UX) cannot be closed from the codebase alone — they
require external dashboard credentials or follow-on UX work. CG-08
is being addressed on a parallel branch (`009-account-link-consent`).

---

## CG-01 — Full automated CVE scan on `pnpm-lock.yaml`

**Original audit assumption**: top-15 deps are recent stable; no
critical RCE in the production tree.

**Closure (commit `21b8741`)**: new CI job `audit` running
`pnpm audit --prod` on every push and PR.

**Gating policy** (matches the audit's calibration anchors):

- **critical** in `--prod` deps → **BLOCK**. Today: 0.
- **high** in `--prod` deps → **INFORM**. Today: 1
  (`path-to-regexp` transitive via `express@5.2.1`). The job emits a
  `::warning::` so a future triage knows what to upgrade; CI is not
  blocked.
- **moderate / low / info** → not enforced.
- **dev / build-tool** deps (vite-plugin-pwa, orval, …) → not
  scanned; their CVEs do not ship to production. Run `pnpm audit`
  locally without `--prod` to see them.

**Verified locally**:

```
$ pnpm audit --prod --audit-level critical
exit 0  (8 vulns total: 7 moderate, 1 high, 0 critical)
```

**Follow-up**: when the single high finding (`path-to-regexp`)
gets a fixed version downstream of express 5, swap the gate from
critical to high. Until then, gating on every high would block CI
on a transitive we have already accepted.

---

## CG-02 — Explicit gitleaks rules for SubNation's signing secrets

**Original audit assumption**: gitleaks default rules (`useDefault =
true`) catch `SESSION_SECRET` / `ENCRYPTION_KEY` if accidentally
committed, via the high-entropy heuristics.

**Closure (commit `f883963`)**: three explicit rules in
`.gitleaks.toml` keyed by literal env-var name:

- `session-secret` — `SESSION_SECRET=` followed by ≥ 32 chars from
  the base64 alphabet. Matches the format of
  `openssl rand -base64 64 | tr -d '\n'`.
- `admin-jwt-secret` — `ADMIN_JWT_SECRET=` (≥ 32 chars). Added by
  branch 005 (Finding F-001 closure).
- `encryption-key` — `ENCRYPTION_KEY=` followed by exactly 64
  lowercase hex characters. Matches
  `crypto.randomBytes(32).toString('hex')`.

The corresponding `config/env.example` placeholders
(`replace-with-…` literal strings) are added to the regex
allowlist. The path-allowlist for `config/env.example` is already
in place; this is belt-and-suspenders.

**Verification**:

- `python3 tomllib` parses the updated config (matches the existing
  CI validation step).
- `git ls-files backend/.env config/.env .env` returns empty —
  none of these are tracked. The real-secret values that exist on
  developer disks are gitignored AND covered by the historical-only
  path allowlist.

---

## CG-03 — Frontend Telegram OAuth completion path (NON-ISSUE)

**Original audit assumption**: the frontend correctly hands the
verified payload to `/api/auth/telegram` and processes the
response.

**Verification scope** (this branch): read end-to-end:

- `frontend/src/components/TelegramLoginButton.tsx`
- `frontend/src/pages/telegram-callback.tsx`
- `backend/src/lib/telegram-auth.ts`
- `backend/src/routes/auth-settings.ts` (Telegram handlers)

**Findings**:

1. **No CSP / eval risk.** `TelegramLoginButton.tsx` does NOT
   inject `telegram-widget.js` (which uses `eval()` internally and
   would break under our CSP). It performs a top-level navigation
   to `oauth.telegram.org/auth` with explicit query params
   (`bot_id`, `origin`, `embed=0`, `request_access`, `return_to`).
   Top-level navigations are not subject to `script-src`,
   `frame-src`, or `connect-src` CSP directives.

2. **Fragment-based payload, never reaches server logs.** Telegram
   appends the signed payload as a URL **fragment**
   (`#tgAuthResult=<base64>`), not a query string. `telegram-callback.tsx`
   reads `window.location.hash`, decodes base64url, and POSTs the
   payload to `/api/auth/telegram`. This is Telegram's chosen
   security property — auth tokens never end up in HTTP access logs
   along the path.

3. **Single-flight POST.** `telegram-callback.tsx` uses a
   `handled.current = useRef(false)` guard so React 18 strict-mode
   re-mount + the natural component remount sequence both run the
   network call exactly once.

4. **`referralCode` is correctly excluded from HMAC.** The frontend
   appends `referralCode` (read from `?ref=…` on the callback URL,
   not from Telegram) to the POST body. The backend's
   `verifyTelegramAuth` at `backend/src/lib/telegram-auth.ts:70`
   and `:156` explicitly skips both `hash` and `referralCode` when
   building the HMAC check-string, so the signature still verifies.

5. **Replay protection lives server-side.** Single-source replay
   guard is the Redis `SET hash NX EX TTL` at
   `backend/src/routes/auth-settings.ts:297-315`. The frontend's
   `handled.current` ref is process-local React state (lost on
   reload), so it does NOT carry a separate replay surface — a
   user reloading the callback page would re-POST and get rejected
   by Redis if the hash was already consumed.

6. **Strips fragment from URL on success.** After receiving the
   JWT, the page calls
   `window.history.replaceState({}, "", window.location.pathname)`
   to remove `#tgAuthResult=…` from the address bar before
   navigating to `/`. Defense-in-depth against accidental copy-
   paste of the post-auth URL.

**Verdict**: CG-03's worst-case scenario ("Severity Medium — feature
silently broken OR frontend-side replay window not covered by the
backend's Redis check") does **not materialize**. The flow is
correctly engineered end-to-end. No fix required.

The gap is closed by inspection. If a future redirect-flow change
reintroduces the widget script or moves replay protection from
Redis to client state, this verification needs to be re-run.

---

## Cross-document trail

| Closure | Commit    | File(s) touched                                       |
|---------|-----------|-------------------------------------------------------|
| CG-02   | `f883963` | `.gitleaks.toml`                                      |
| CG-01   | `21b8741` | `.github/workflows/ci.yml`                            |
| CG-03   | (this)    | `specs/008-audit-coverage-gaps/notes.md` (read-only)  |

Audit branch 004 deliverables (`spec.md`, `plan.md`, `research.md`,
`security.md`, `priorities.md`, `quickstart.md`, `data-model.md`,
`contracts/`) are **intentionally untouched**. This document is
the post-audit follow-up trail.
