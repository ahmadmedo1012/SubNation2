# Secret Handling — Final (r112)

> FINAL. Where every production secret lives, how it is generated, backed up,
> and restored. Companion to `FINAL_PRODUCTION_ENV.md` (variable semantics) —
> this file covers VALUES only. Rule zero: **values exist in exactly two
> places — the Coolify env screens and the encrypted offline operator backup.
> Nowhere else. Never in git.**

## 1. Where each secret belongs (Coolify resource → env screen)

Two Coolify resources. Each secret is pasted into the env screen of the service
that reads it — nothing else.

| Secret | Coolify resource / env screen | Shape | Why it lives there |
|---|---|---|---|
| `SESSION_SECRET` | **SubNation** → Environment | ≥32 chars | User JWT signing (`backend/src/lib/jwt.ts`) |
| `ENCRYPTION_KEY` | **SubNation** → Environment | exactly 64 hex | AES-256-GCM at-rest (`lib/encryption.ts`) |
| `ADMIN_JWT_SECRET` | **SubNation** → Environment | ≥32 chars, ≠ SESSION_SECRET | Admin JWT signing (F-001 separation) |
| `WHATSAPP_OTP_API_KEY` | **SubNation** → Environment | ≥32 chars, **= OPENWA_API_KEY** | Gateway auth (SubNation's sending copy) |
| `DATABASE_URL` | **SubNation** → Environment | `postgresql://…?sslmode=require` | Neon Postgres pool |
| `OPENWA_API_KEY` | **openwa** → Environment | ≥32 chars, **= WHATSAPP_OTP_API_KEY** | Gateway auth (validating copy; exit 1 without it) |
| `OPENWA_CREDENTIALS_KEY` | **openwa** → Environment | ≥32 chars, ≠ OPENWA_API_KEY | Session-credential encryption (`persist.ts`) |
| `PERSISTENCE_URL` | **openwa** → Environment | `postgresql://…?sslmode=require` | `openwa_sessions` persistence (may be the same Neon DB as `DATABASE_URL`) |
| `DASHBOARD_USERNAME` + `DASHBOARD_PASSWORD` | **openwa** → Environment (optional pair) | password ≥8 chars | Operator dashboard; both-or-neither |
| `DASHBOARD_SESSION_SECRET` | **openwa** → Environment (optional) | ≥32 chars | Dashboard cookie signing |
| `OTP_HMAC_KEY` | **SubNation** (only if overriding) | ≥32 chars | Default derives from `SESSION_SECRET` — leave unset |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `DISCORD_WEBHOOK_URL` / `GENERIC_ALERT_WEBHOOK_URL` / `METRICS_ADMIN_TOKEN` / `COPILOT_API_KEY` / `FIREBASE_SERVICE_ACCOUNT_JSON` | **SubNation** (optional integrations) | per-integration | Only when that integration is enabled |

Build-time note: the ONLY build-arg-adjacent secret is `SENTRY_AUTH_TOKEN`
(+`SENTRY_ORG`/`SENTRY_PROJECT`) for source-map upload in CI/GHCR builds —
never a Coolify runtime env var, never in `VITE_*` build args (all `VITE_*`
are public-by-design).

## 2. Equality / inequality contract

**MUST be identical (the one required parity — copy-paste the same value):**

| Pair | Why |
|---|---|
| `OPENWA_API_KEY` == `WHATSAPP_OTP_API_KEY` | SubNation sends it; openwa timing-safe-compares it. Any mismatch = every OTP request rejected. |

**MUST all differ — pairwise distinct across this family:**
`SESSION_SECRET` · `ADMIN_JWT_SECRET` · `ENCRYPTION_KEY` ·
`OPENWA_CREDENTIALS_KEY` · `OPENWA_API_KEY` (and therefore
`WHATSAPP_OTP_API_KEY`, its twin) · `DASHBOARD_PASSWORD` · `DASHBOARD_SESSION_SECRET` ·
`OTP_HMAC_KEY` (when set). Reason: each protects an independent trust domain
(user sessions / admin sessions / at-rest data / gateway credentials / gateway
auth / dashboard); one leaked value must not forge another domain.

`scripts/final-cutover-preflight.sh` enforces these at check time (§B):
`ADMIN_JWT_SECRET != SESSION_SECRET`, `WHATSAPP_OTP_API_KEY == OPENWA_API_KEY`,
`OPENWA_CREDENTIALS_KEY != OPENWA_API_KEY` — and
`scripts/src/validate-production-env.ts` enforces the full pairwise family
before deploy. Both print names/lengths/booleans only, never values.

## 3. Generation — `scripts/generate-production-secrets.sh`

```bash
./scripts/generate-production-secrets.sh                    # core set
OTP_HMAC_KEY_EXPLICIT=1 ./scripts/generate-production-secrets.sh
DASHBOARD_ENABLED=1 ./scripts/generate-production-secrets.sh
ALL=1 ./scripts/generate-production-secrets.sh              # every knob
```

- Generates, with the exact shape each consumer validates:
  `SESSION_SECRET` (≥32), `ENCRYPTION_KEY` (64 hex), `ADMIN_JWT_SECRET` (≥32,
  ≠ session), `OPENWA_API_KEY` (≥32, printed twice — once as
  `WHATSAPP_OTP_API_KEY`), `OPENWA_CREDENTIALS_KEY` (≥32, ≠ API key); optional
  `OTP_HMAC_KEY` / `DASHBOARD_*`.
- CSPRNG (`openssl rand` / `/dev/urandom`); internal shape guards mirror the
  boot validators.
- **Never writes to disk, never touches the repo, never uploads anything** —
  stdout only, clearly labelled.
- **Never rotates existing values** — it has no knowledge of production; it
  only mints new material. Re-running it does NOT update anything.
- After pasting: validate (§5 of `FINAL_PRODUCTION_ENV.md`) — must exit 0.

## 4. Offline operator backup (mandatory)

Recommended default: **store the env as a secure note in the password manager**
(1Password/Vaultwarden/Bitwarden), one entry per service, plus one entry
holding the full `.env` text. Accessible from any machine, no VM dependency.

Encrypted-file alternative (kept OFF the VM — password manager, cloud drive,
USB):

```bash
# Encrypt (age) — recipient = your age public key:
age -r <recipient> -o subnation-prod-env.txt.age subnation-prod-env.txt
# Encrypt (gpg) — passphrase mode:
gpg -c -o subnation-prod-env.txt.gpg subnation-prod-env.txt

# Decrypt back (age):
age --decrypt -i ~/.config/age/key.txt -o subnation-prod-env.txt subnation-prod-env.txt.age
# Decrypt back (gpg):
gpg -d -o subnation-prod-env.txt subnation-prod-env.txt.gpg
```

- `subnation-prod-env.txt` is a plain-text export of the filled env (the
  compose template with real values). Delete the plaintext immediately after
  encrypting; keep only the `.age`/`.gpg` blob off-VM.
- Back up BEFORE first production boot and after any deliberate secret change.
- The Neon connection strings can also be re-fetched from the Neon console;
  the five generated secrets CANNOT be re-derived — the backup is the only
  copy besides Coolify.

## 5. Restore procedure (VM loss / Coolify rebuild / new operator machine)

1. **Fetch** — decrypt the backup (`age --decrypt …` / `gpg -d …`) or open the
   password-manager entry.
2. **Paste** into the Coolify env screens per §1 (SubNation resource gets the
   SubNation rows; openwa resource gets the openwa rows; keep the
   `WHATSAPP_OTP_API_KEY` == `OPENWA_API_KEY` copy-paste identical).
3. **Redeploy** both services from Coolify.
4. **Verify** — on the VM, against the restored `.env`:

   ```bash
   ./scripts/final-cutover-preflight.sh .env
   ```

   It re-checks every secret shape and the equality/inequality contract
   WITHOUT printing values (exit 0 = clear), then
   `docker-verify.sh` proves the boot (healthz 503→200) and a private smoke
   test confirms end-to-end OTP.
5. `OPENWA_CREDENTIALS_KEY` must be the ORIGINAL value (§6) — restoring a
   different one silently orphans every WhatsApp session.

## 6. openwa rotation warning — generate `OPENWA_CREDENTIALS_KEY` ONCE

From `deploy/env.compose.example` (r110, 109-h):

> Rotation reality (openwa persist.ts): only the FIRST rotation — blobs still
> encrypted with the legacy API-key-derived key — is transparent (decrypted via
> the legacy slot + re-encrypted on first read). A SECOND rotation is NOT
> transparent: the legacy decrypt slot accepts the API-key derivation only, so
> blobs written under an earlier OPENWA_CREDENTIALS_KEY fail BOTH keys →
> treated as absent → every session must re-pair via QR. Generate ONCE; if
> rotation is ever truly forced, plan a QR re-pairing window for each linked
> session.

Operational consequence: this key is **generate-once, restore-verbatim**. It is
the single most rotation-hostile value in the stack — treat its offline backup
as mandatory from the first boot.

## 7. What must NEVER be in the repo / git

- **Any secret value.** The repo carries placeholders only:
  `deploy/env.compose.example`, `config/env.example`, `frontend/.env.example`
  — all `replace-with-*` / empty templates. Real values live in the Coolify
  env screens and the encrypted offline backup. Nothing else.
- `.env` at the repo root (and `config/.env*`) are git-ignored; the filled
  file exists only transiently on the operator machine/VM.
- The **gitleaks gate** (`.gitleaks.toml`, wired into CI
  `.github/workflows/ci.yml`) blocks any commit that carries a detected
  secret — the enforcement layer for this rule. Do not bypass it; rotate
  instead.
- Never paste secrets into chat, tickets, logs, or `docker history`-visible
  build args; the validator/preflight tooling is value-silent by design —
  keep operator habits the same.
