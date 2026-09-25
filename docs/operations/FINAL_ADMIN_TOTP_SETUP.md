# Final Admin TOTP Setup — SubNation2 Operator Runbook

Scope: TOTP (2FA) on the admin account `ahmadmedo` — how the flow is
implemented, the exact enrollment steps, lockout numbers, and the honest
lost-device recovery path. Verified at HEAD 521234f against the cited files.

## 1. The TOTP journey as implemented

Enrollment (settings → security tab):
- UI: frontend/src/pages/admin/settings.tsx — tab `security` («الأمان», line
  67) renders `TwoFactorSetup` (lines 327-473, mounted at line 1239).
- POST /api/admin/2fa/setup (backend/src/routes/admin/auth.ts:779-865):
  server generates a fresh secret (`otplib` `generateSecret()`) and the
  otpauth URI (`generateURI({ label: admin_<id>, issuer: "SubNation" })`),
  stores `totpSecret` with `totpEnabled = false`, and returns
  `{ secret, otpauth_url }` ONCE. The QR is rendered client-side from
  `otpauth_url` (settings.tsx:351-355); the raw secret is also shown for
  manual entry (settings.tsx:416).

Current-password protection at enrollment (93-A1 S5, auth.ts:796-846):
- TOTP already ENABLED → calling setup (which disables it until re-verified)
  REQUIRES `current_password`: absent = 400, wrong = 401 + lockout ramp on
  key `admin-2fasetup:<username>`, correct = secret rotated + audited as
  `admin.totp_disabled`.
- TOTP disabled (fresh enrollment) → password OPTIONAL: the admin UI sends no
  body (settings.tsx:344-347), so the first enablement needs only the session
  cookie; if a password IS sent it is verified (a wrong one is rejected).

Enable (first code):
- POST /api/admin/2fa/verify-setup (auth.ts:867-895): the 6-digit code is
  verified against the stored secret (`verifySync`); success flips
  `totpEnabled = true` and audits `admin.totp_enabled`.

Login flow:
- POST /api/admin/login (auth.ts:90-290): username + password → if
  `totpEnabled && totpSecret`, responds `{ requires_2fa: true, temp_token }`
  where temp_token is a 10-minute `isTemp` challenge JWT — NOT a session.
- POST /api/admin/login/verify-2fa (auth.ts:292-382): `temp_token` + code →
  lockout gate on `admin-2fa:<adminId>` → `verifySync` → full row-backed
  session (`createAdminSession`) set as the httpOnly `admin_token` cookie (8h).
  A temp token never authorizes anything else (probe treats it as
  unauthenticated — auth.ts:421-423).
- UI: frontend/src/pages/admin/login.tsx (requires_2fa → code prompt,
  `autoComplete="one-time-code"`).

Backup / recovery codes: DO NOT EXIST. `admin_users` carries only
`totp_secret` + `totp_enabled` (shared/db/src/schema/admin_users.ts:37-38);
no route, column, or UI generates or accepts recovery codes. There is nothing
to save at enrollment — the reset path (§4) is the only fallback.

Disable / reset authorization: the account owner, from a valid session, with
the current password (the S5 gate above). There is no admin-to-admin TOTP
reset: admins.tsx only DISPLAYS another admin's `totp_enabled` badge
(frontend/src/pages/admin/admins.tsx:235).

## 2. Operator steps — enroll `ahmadmedo` now

1. Log in at the admin panel with username + password.
2. الإعدادات (settings) → الأمان (security) tab.
3. Click «إعداد المصادقة الثنائية» → a QR + the raw secret appear.
4. Scan the QR with an authenticator app (Google Authenticator / Aegis /
   1Password). If scanning is impossible, type the shown secret manually.
5. Enter the current 6-digit code → «تفعيل». Success = "تم تفعيل المصادقة
   الثنائية بنجاح".
6. There are NO backup codes to save (§1) — instead store the secret itself
   in the password manager at scan time; that is the only copy that will ever
   exist outside the server.
7. Log out, then log back in: password → code prompt → code. That completes
   the proof and is the r112 cutover checklist item.

Timing note: a TOTP code is time-based — if entry fails repeatedly while the
QR step worked, check the phone's clock (automatic time) before assuming a
bad enrollment. 5 wrong codes lock the 2FA step for 15 minutes (§3).

## 3. The lockout truth (from backend/src/lib/lockout.ts)

- Global constants: `MAX_ATTEMPTS = 5`, `BASE_LOCKOUT_MINUTES = 15`,
  doubling per full extra envelope — 15 / 30 / 60 / 120 / 240 min
  (lockout.ts:4-5, 65-80). A successful verify resets the counter.
- TOTP step (`admin-2fa:<adminId>`, auth.ts:335-357): 5 wrong codes → the
  admin is locked out of the 2FA step for 15 min (429 ACCOUNT_LOCKED,
  showing the remaining minutes); repeat envelopes double.
- Password step: per-(username, ip) key `admin:<username>:<ip>` — 5 failures /
  15 min; PLUS the r110 IP-independent global ceiling
  `admin-username:<username>` — 10 failures / 15 min doubling
  (auth.ts:85-88, 138-169 — an IP-rotating distributed brute force cannot
  refresh the envelope; the lockout deliberately answers like a wrong
  password, not a 429, to avoid a username oracle).
- Re-auth gates: `admin-pwchange:<username>` (change-password) and
  `admin-2fasetup:<username>` (2FA disable/rotate) — 5 failures / 15 min
  doubling each.
- The lockout is DB-backed (login_attempts) and survives restarts; attempts
  clear only on a success or lockout expiry.

## 4. Loss-of-device recovery (honest)

There is no reset token, no self-service reset, and no second admin. If the
authenticator is lost, the ONLY path is a direct DB update by the operator on
the VM, over SSH:

```sql
-- psql on the VM, over SSH. This DISABLES TOTP until re-enrollment (§2).
BEGIN;
SELECT username, totp_enabled, totp_secret IS NOT NULL AS has_secret
FROM admin_users WHERE username = 'ahmadmedo';   -- verify the target row
UPDATE admin_users
SET totp_enabled = false, totp_secret = NULL, updated_at = now()
WHERE username = 'ahmadmedo';
COMMIT;
```

Warnings:
- `updated_at` must be set explicitly in raw SQL (the Drizzle `$onUpdate`
  hook does not fire — the staleness-clock contract, admin_users.ts:50-52).
- Password login works immediately after; the account is password-only until
  the operator re-runs §2. Re-enroll the same day — this is a compromise-grade
  exception, not a routine operation.
- Never run this remotely over anything but SSH to the VM; never paste the
  statement into chat or tickets with real values filled in beyond the
  username above.

## 5. NEVER rules

- The secret is displayed ONCE at enrollment (the /2fa/setup response). It is
  never re-displayed, never emailed, never exported.
- The operator never shares the secret, the QR, or a valid code with anyone —
  including "support", the AI copilot, or this repository's automation.
- This document contains no real secret; none ever belongs in a doc or commit.
- Automation never touches the admin account: the r112 rule is that the agent
  NEVER modified / modifies the admin account, its password, or its TOTP
  state — enrollment and reset are operator actions (§2, §4).

## 6. The r112 status

- The TOTP code path is implemented and tested end-to-end:
  - backend/src/routes/admin/__tests__/2fa-setup-password.test.ts — the S5
    matrix (disable requires password; wrong password 401 + lockout; 5 wrong
    → 429; fresh enrollment password-optional).
  - backend/src/routes/__tests__/admin-auth-lockout.test.ts — lockout keying
    on req.ip (R97-01) and the no-token-in-body contract for /login +
    /login/verify-2fa (R97-02).
  - backend/src/lib/__tests__/lockout-upsert.test.ts — the atomic
    attempt-upsert SQL mirrors calculateLockoutDuration.
  - frontend/src/pages/admin/__tests__/admin-login-cookie-session.test.tsx —
    the cookie-based admin session including the 2FA step.
- Enrollment on the live account remains OPEN (r111): `ahmadmedo` still has
  `totp_enabled = false`. §2 is the operator's TODO and a cutover checklist
  item — until it is done, the admin account is protected by password +
  lockout only.
