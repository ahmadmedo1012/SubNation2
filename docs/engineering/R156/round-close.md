# R156 — The Telegram OIDC production login fix (nonce-less auth-code tokens + multi-algorithm verification)

Date: 2026-10-17. Status: shipped. Predecessor: R155 (the diagnosability
round that made this failure visible).

## The production report

After R155 shipped, the operator retried the real Telegram login. The
banner now read «تعذر التحقق من هوية Telegram. حاول مرة أخرى.» — reason
`oidc_invalid_token`. That message is itself R155's diagnosability doing
its job: the token exchange SUCCEEDED (BotFather Client ID/Secret pair
valid — `invalid_client` ruled out), an `id_token` came back (a missing
one would read `oidc_missing_id_token`), and the failure sat in the
ID-token VALIDIDATION chain. The user was consistently bounced back to
`/login` (their "not redirected into the site after login" symptom) on
every attempt.

## Root cause (evidence, not hypothesis)

Three independent primary sources, all fetched live 2026-10-17:

1. **`core.telegram.org/bots/telegram-login` — the `/auth` parameter
   table.** The documented parameters are `client_id`, `redirect_uri`,
   `response_type`, `scope`, `state`, `code_challenge`,
   `code_challenge_method`. **There is NO `nonce` parameter.** The nonce
   appears only as a JavaScript-SDK `InitOption` (the widget's
   `postMessage` mode), not in the manual Authorization Code flow this
   implementation rides.
2. **`oauth.telegram.org/.well-known/openid-configuration` (live).**
   `claims_supported` = aud, preferred_username, phone_number, exp, iat,
   iss, name, picture, sub, ton — **no `nonce` claim**.
3. **The docs' own decoded example ID token** carries no nonce either.

The R154 validator REQUIRED the nonce claim: a real auth-code `id_token`
— which legitimately carries none — failed `nonce_mismatch` →
`oidc_invalid_token` on EVERY real login, for every user, regardless of
algorithm or operator configuration. The CSRF/replay defense for this
flow was never actually weakened by that absence: the single-use state
store (10-min TTL), PKCE S256 (code↔verifier binding), and the one-time
authorization code are the OAuth2 Authorization Code Flow's native
protections; the OIDC nonce is belt-and-suspenders that the provider
simply does not emit here.

Secondary, same-failure-class hazards fixed in the same round (the live
JWKS proves they are real):

- **Algorithms.** The live JWKS carries four keys: `oidc-1` (RSA,
  RS256), `oidc-es256-1` (EC P-256), `oidc-eddsa-1` (Ed25519),
  `oidc-es256k-1` (secp256k1). The docs: RS256 default, ES256/EdDSA/ES256K
  selectable under BotFather → Login Widget → Advanced. The R154 validator
  accepted RS256 ONLY — an operator-selected ES256/EdDSA bot (legitimate,
  profile-scope-compatible) would have failed `bad_algorithm` the same
  way. ES256K genuinely cannot serve this flow: Telegram rejects the
  `profile` scope we require when it is selected (documented), and Node
  verifies no secp256k1.
- **Claim types.** The docs' example ships `aud` as a string and `id` as
  a number, but a numeric `aud` / string `id` is a classic API-drift
  shape that would have hard-failed `wrong_audience`/`missing_id_claim`.

## The fix (`backend/src/services/telegram-oidc-flow.ts`)

Smallest complete, security-preserving:

1. **Nonce is enforced WHEN PRESENT, tolerated when absent** — a
   constant-time compare against the flow's stored nonce whenever
   Telegram echoes one (forward-compatible: we keep sending the nonce
   parameter, which Telegram ignores today); a nonce-less token passes
   because the single-use state + PKCE + one-time code carry the
   CSRF/replay defense. Never a silent skip — presence is still checked
   and mismatches still fail closed.
2. **Multi-algorithm verification** — RS256 (RSA), ES256 (EC P-256,
   JOSE raw r||s → DER conversion before `crypto.verify`), EdDSA
   (Ed25519, native). Every key is cross-bound: a JWKS key advertising
   alg X only verifies a token whose header says X, and the key TYPE
   must match the algorithm's family — the alg-confusion attacks stay
   dead (HS256/alg=none/ES256K all die at the pin; a forged header-kid
   cross-binding dies at the key). A kid-less header falls back to the
   key advertising the token's own alg (the live JWKS sets `alg` on
   every key).
3. **Type tolerance with value discipline** — `aud` accepted as string
   (documented) or number (coerced); `id` accepted as a positive safe
   integer (documented) or its 1–15-digit numeric-string form. The VALUE
   checks (issuer equality, audience equality, linkage-key shape) are
   untouched.
4. **Per-check failure detail on the log line** — every validation
   failure now logs its reason PLUS bounded, type-only discriminators
   (`alg`, `kid`, `issType`, `audType`, `noncePresent`, `idType` — never
   token values, never secrets) under
   `[telegram-oidc] ID token validation failed`. If Telegram ever drifts
   again, the log names the exact check on the first failure.

Operator docs (the route pair's BotFather ritual comment) now document
the algorithm selector and the ES256K/profile-scope conflict.

## Tests — the flow battery grows 15 → 21

- **The production killer regression**: a nonce-LESS token verifies
  (unit) and completes the full login end-to-end (state consumed,
  session minted, user row created) — the exact shape that failed every
  real production login.
- ES256 (P-256) and EdDSA (Ed25519) tokens verify — real locally
  generated keys, JOSE-raw ES256 signatures through a DER↔JOSE test
  helper, mirroring the live 4-key JWKS shape (minus ES256K).
- ES256K refused (`bad_algorithm`); tampered ES256 payload dies
  (`bad_signature`); an RS256 header pointing at the ES256 key dies at
  the cross-binding (`bad_signature`).
- `aud`-as-number + `id`-as-string shapes verify with the linkage key
  intact.
- A nonce the token DOES carry must still match (`nonce_mismatch`
  retained) and the failure detail carries `noncePresent`/`alg`/`kid` —
  the diagnosability contract pinned.
- The mock JWKS now serves all three supported keys with `alg` set (as
  the live one does); every pre-existing R154/R155 case still passes.

## Gates (this round, this tree)

- Backend: 277 files / **2,558 tests green** (4 sequential chunks:
  lib+services 122/1,162; routes 2a 51/362 + 2b 50/498 — one
  non-reproducing route flake on the first 2b run, 2× green re-runs,
  the documented R153 pattern; rest 54/536).
- Frontend: 271 files / **2,537 tests green** (untouched by this round).
- Combined **5,095**. Lint 0 errors / 15 warnings (baseline held),
  typecheck clean, route parity 86 ops, error-code sync 55, header
  params 7/7, production build green — eager 146,730 B gz (unchanged;
  budget 150 KiB).
- CI green on the pushed commit (see the CHANGELOG entry).

## Live acceptance

The happy-path real login (a real Telegram account at the consent
screen) remains operator-gated by nature — but the failing check class
it hit in production (the documented auth-code token shape) is now the
explicitly tested happy path, and any residual failure logs its exact
discriminator on the first attempt.
