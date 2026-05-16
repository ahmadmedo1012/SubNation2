# Secret Rotation Runbook — historical .env leak

**Status: action required.** Files committed at older points in git history
contained real production secrets. The new gitleaks config silences the CI
gate (so unrelated PRs no longer fail), but the secrets in the immutable
git log MUST be rotated, otherwise anyone with read access to the repo
(now or in the future) can reuse them.

This doc lists every secret found, where it was committed, and the exact
rotation steps. Once each line is rotated, mark it `[x] rotated <date>`.

---

## Affected files (now removed from HEAD or properly gitignored)

| File | Status in HEAD | Status in history | Action |
|---|---|---|---|
| `.env` | ✗ removed via `git rm --cached` | ⚠ present in many commits | rotate every key inside |
| `backend/.env` | ✗ never tracked (already gitignored) | ⚠ present in 4 commits | rotate every key inside |
| `subnation-2571e-firebase-adminsdk-fbsvc-2d103b0a90.json` | ✗ deleted | ⚠ present in old "Cascade snapshot" commits | revoke service-account key |
| `PRODUCTION_DEPLOYMENT_CHECKLIST.md` | ✗ deleted | ⚠ contained example bearer tokens | no action if examples; verify |
| `AUTH_MIGRATION_ROADMAP.md` | ✗ deleted | ⚠ contained example tokens | no action if examples; verify |
| `test-firebase-auth.md` | ✗ deleted | ⚠ contained Firebase project ID | safe — project ID is public |

---

## Required rotations (do these in order)

### 1. Firebase Admin Service Account key — **CRITICAL**

The service-account JSON (`subnation-2571e-firebase-adminsdk-fbsvc-2d103b0a90.json`)
was committed. Anyone who finds it in history can mint admin tokens, read all
Firestore data, send arbitrary push notifications, and modify Auth users.

**Rotation:**
1. Go to https://console.firebase.google.com/project/subnation-2571e/settings/serviceaccounts/adminsdk
2. Click **Generate new private key** → download the new JSON file (do NOT commit it).
3. Open https://console.cloud.google.com/iam-admin/serviceaccounts?project=subnation-2571e → click the `firebase-adminsdk-fbsvc@…` service account → **Keys** tab → find the key with id ending in `2d103b0a90` → click **Delete**. This invalidates the leaked key globally.
4. Render Dashboard → SubNation service → Environment → update `FIREBASE_SERVICE_ACCOUNT_JSON` with the new JSON content (single-line, escaped — paste the raw JSON content).
5. Save → trigger a redeploy.
6. Verify: `curl -s https://subnation.ly/api/healthz/firebase | jq .admin_auth_initialized` returns `true`.

### 2. Render API Key — **HIGH**

`RENDER_API_KEY` was committed in `.env`. Anyone with this can deploy, scale,
delete, or read environment variables on any Render service in the workspace.

**Rotation:**
1. https://dashboard.render.com/u/account/api-keys → revoke the old key.
2. Create a new one → save it locally (it's only shown once).
3. If anything else uses this key (CI, scripts, MCPs), update them.

### 3. Neon API Key — **HIGH**

`NEON_API_KEY` was committed. Allows database creation, role management,
branch operations on the Neon org.

**Rotation:**
1. https://console.neon.tech/app/settings/api-keys → revoke the old key.
2. Create a new key → store securely.

### 4. Session Secret — **HIGH**

`SESSION_SECRET` signs every JWT issued by the backend. If leaked, attacker
can mint admin / user tokens directly.

**Rotation:**
1. Generate: `openssl rand -hex 32`
2. Render Dashboard → Environment → update `SESSION_SECRET` → trigger redeploy.
3. **Side effect:** every existing user session is invalidated immediately
   (everyone gets logged out). Communicate this if it matters.

### 5. Encryption Key — **HIGH**

`ENCRYPTION_KEY` may be used for at-rest encryption of OTP codes / sensitive
fields. Rotation affects what can be decrypted.

**Rotation:** check `backend/src/lib/crypto.ts` (or equivalent) for what the
key encrypts. If it encrypts row-level data in Postgres, you may need a
two-step rotation (decrypt-with-old → re-encrypt-with-new) or accept that
those rows become unreadable.

### 6. Telegram Bot Token — **MEDIUM**

Allows sending messages as the bot, reading bot updates.

**Rotation:**
1. Open Telegram → message `@BotFather`.
2. `/revoke` → choose `SubNation` bot → confirm.
3. `/token` → get new token → update `TELEGRAM_BOT_TOKEN` in Render env.

### 7. Discord Webhook URL — **LOW**

If used, allows posting to one Discord channel.

**Rotation:** Discord channel settings → Integrations → Webhooks → delete + recreate.

### 8. Firebase Web API Key — **NO ACTION**

`VITE_FIREBASE_API_KEY` is **public by design** in Firebase. It's embedded
in every browser bundle on subnation.ly. Security comes from the
**Authorized domains** list (Firebase Console → Authentication → Settings)
plus reCAPTCHA on phone auth, NOT from key secrecy. See
https://firebase.google.com/docs/projects/api-keys.

The current value is allowlisted in `.gitleaks.toml` under
`targetRules = ["gcp-api-key"]`. If the key is ever rotated:
1. Update `VITE_FIREBASE_API_KEY` in the Render environment.
2. Update the regex in `.gitleaks.toml`'s Firebase allowlist with the new
   value (read it from `frontend/src/lib/firebase.ts` runtime config or
   from the deployed SPA bundle — never paste it into prose docs).

---

## After rotation

1. Verify production is still healthy:
   ```
   curl -s https://subnation.ly/api/healthz/ready | jq
   ```
   Expect all 4 deps `ok`.
2. Open https://subnation.ly/admin/system → all panels green.
3. Smoke-test login with Google + Phone OTP.

---

## (Optional) Scrub git history

If you want to **delete** the leaked values from git history (vs. just
rotating them so they're useless), use [`git filter-repo`](https://github.com/newren/git-filter-repo):

```bash
# DESTRUCTIVE — coordinate with everyone who has a clone first
git filter-repo --invert-paths --path .env --path backend/.env \
  --path subnation-2571e-firebase-adminsdk-fbsvc-2d103b0a90.json
git push --force --all
```

This rewrites every commit, so:
- Every clone everywhere becomes broken (must re-clone).
- Open PR branches must be rebased.
- The old commit SHAs no longer exist (links break).

For a small private repo with one or two contributors, this is fine. For
a public repo with collaborators, just rotating the secrets is usually
enough — the leaked values become worthless and the history merely shows
that you used to have them.

**Recommendation: rotate (mandatory) + leave history (optional cleanup).**
The repo is already private; the gitleaks allowlist is sufficient to
unblock CI.
