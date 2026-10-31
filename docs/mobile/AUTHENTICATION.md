# Mobile Authentication — the native session architecture

> Status: CURRENT @ 2026-10-31 (R191)

## The problem the web solved differently

The website authenticates with an httpOnly cookie (`auth_token`, 30-day HS256
JWT `{userId, sessionId}` minted by the backend). Session-mint response
BODIES return the sentinel `__cookie_session__` — the real JWT is NEVER in a
body (round 98-F3 closed that XSS surface). Browsers carry the cookie
automatically; a native app has no cookie jar semantics.

## The native mechanism (zero web changes)

```
mint endpoint (POST /api/auth/whatsapp/verify | /firebase/session |
               /telegram/oidc/callback?native=1)
      │  Origin: https://subnation.ly  (CSRF gate — Bearer clients included)
      │  Set-Cookie: auth_token=<jwt>; HttpOnly; ...
      ▼
capture Set-Cookie header (native fetch exposes it — browsers hide it from
JS, native HTTP clients do not)         src/lib/auth-store.ts
      │  parseAuthTokenFromSetCookie  (JWT is base64url+dots only — the
      │  regex is exact even when RN comma-joins multiple Set-Cookie headers)
      ▼
SecureStore ("subnation.auth_token")    — never AsyncStorage (skill law)
      ▼
Authorization: Bearer <jwt>  on every request (setAuthTokenGetter on the
generated client) + Origin on every mutation (global fetch shim in
src/lib/api.ts)
      ▼
/api/auth/probe at boot → { authenticated, user } (the hydration gate:
no screen routes on unhydrated state)
```

Everything server-side is unchanged: session rows live in `sessions`
(revocable by logout / logout-all-devices / per-device delete), the JWT's
`sessionId` is liveness-checked (60 s cache), 401s tear the client session
down (`addUnauthorizedHandler` → AuthProvider teardown → full query-cache
clear — the web's identity-switch contract).

## Providers

| Provider | Native flow | State |
|---|---|---|
| **WhatsApp OTP** | phone (Libyan normalization: Arabic-Indic/Farsi digits, +218/00218/0 prefixes) → `POST /api/auth/whatsapp/start` → 6-digit code → `POST /api/auth/whatsapp/verify` → Set-Cookie capture | **Live** (production gateway: `whatsapp_status: ready`) |
| **Telegram OIDC** | `GET /api/auth/telegram/oidc/login?native=1&app_nonce=<n>` in `expo-web-browser`; the state row records the native flag + the app-instance nonce; the callback redirects successful auth to `subnation://auth/callback#token=<jwt>&app_nonce=<n>` (single-use state + PKCE + 10-min TTL unchanged; token lands ONLY in the app-scheme redirect, NEVER a query string) | **Live** (backend bridge landed R191; R192 added the app-instance nonce binding — see below) |
| **Google (Firebase)** | requires the Firebase Android/iOS apps to be registered in the owner's Firebase console (google-services.json / GoogleService-Info.plist + OAuth client) — a genuine owner-side prerequisite | **Pending owner config** — the button renders only when `EXPO_PUBLIC_FIREBASE_*` envs are set; `apps/mobile/.env.example` documents them |

## The Telegram native bridge's app-instance nonce (R192, security)

The R192 security review found the one real hole in the R191 bridge:
any web page could open `subnation://auth/callback#token=<jwt>` directly
(the login-CSRF class — a forged deep link silently substituting the
victim's session with an attacker-minted JWT for the attacker's own
account). The fix binds the returned token to a flow THIS app instance
started:

1. **Before the browser opens** the app mints a 24-byte CSPRNG nonce,
   persists it in SecureStore (`subnation.telegram.pending_nonce`, 10-min
   TTL — persistence, not just memory, keeps the Android cold-start leg
   working when the OS kills the app mid-auth), and sends it on the login
   hop: `…/oidc/login?native=1&app_nonce=<n>`.
2. **The backend REQUIRES it** for native flows — a native login hop
   without a valid `app_nonce` is refused up front
   (`/login?error=native_nonce_required`, no state minted). A web page
   can therefore never mint a native-transport session at all.
3. **The callback echoes it**: `subnation://auth/callback#token=<jwt>&app_nonce=<n>`
   (fragment only — `URLSearchParams`-parsed, the R191 loose-regex
   fallback removed).
4. **The app verifies before storing** (`settleTelegramCallbackUrl` —
   the one gate shared by the cold-start route and the login screen's
   warm listener): no pending nonce, an expired flow, a missing/mismatched
   `app_nonce`, or an already-consumed nonce → **rejected, the token is
   never stored, the existing session is untouched**. A matching nonce is
   consumed on use (single use), and a 5-minute in-memory token-digest
   window keeps the Android WebBrowser/Linking double-delivery race
   idempotent for the SAME token while a different token stays rejected.
5. **Native flows mint no web cookie** (R192 F-3): the 30-day
   `auth_token` Set-Cookie is skipped entirely on native callbacks — a
   native login must not leave ambient web authority in the shared system
   browser (Custom Tabs / ASWebAuthenticationSession).

Pinned by: `backend/src/routes/__tests__/telegram-oidc-native.test.ts`
(8 tests — the nonce echo, the no-cookie contract, both refusal legs,
single-use) and `apps/mobile/src/lib/__tests__/telegram-auth.test.ts`
(17 tests — accept/reject/expiry/replay/double-delivery/RNG-fail-loud).

## Google native sign-in — the exact owner checklist (nothing else blocks)

The app-side wiring is a documented follow-up (the button is env-gated with
an honest «قريباً» until then), so this is preparation work the owner can do
in one sitting — every value below is already extracted/known:

1. **Firebase console** (console.firebase.google.com) → the project that
   already backs the site's Google login → Project settings → General →
   **Your apps** → register BOTH:
   - Android app, package `ly.subnation.app`
   - iOS app, bundle ID `ly.subnation.app`
2. **Add the signing fingerprints to the ANDROID app entry** (Firebase
   console → the Android app → Add fingerprint — BOTH lines):
   - SHA1: `AB:21:2D:9C:CC:4A:11:55:AD:CC:03:50:01:BA:CC:5D:ED:FD:A4:CB`
   - SHA256: `5D:D2:D9:0C:A5:33:3B:7A:3D:60:14:17:E5:B2:A7:14:95:DC:31:E9:DD:E8:BD:35:29:79:3A:6F:55:33:A9:AC`

   These are the EAS-managed keystore's fingerprints, extracted from the
   signed artifacts themselves (the dev APK and the production AAB carry
   the same signer — EAS signs every Android build with the one project
   keystore). After Play App Signing is set up, ALSO add the Play
   app-signing key's SHA1/SHA256 (same console page, from Play Console →
   Release → Setup → App signing).
3. **The four public values** (Project settings → General → the app's
   config: google-services.json / GoogleService-Info.plist) become the
   EAS build environment (apps/mobile/.env or EAS envs):
   `EXPO_PUBLIC_FIREBASE_API_KEY` · `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` ·
   `EXPO_PUBLIC_FIREBASE_PROJECT_ID` · `EXPO_PUBLIC_FIREBASE_APP_ID`
   — all four documented in `apps/mobile/.env.example`.
4. **The backend side** (Coolify env, config/env.example's Firebase
   block): `FIREBASE_AUTH_ENABLED=true` + `FIREBASE_PROJECT_ID` +
   `FIREBASE_SERVICE_ACCOUNT_JSON` (the admin service-account JSON —
   Project settings → Service accounts → Generate new private key). The
   backend's `verifyIdToken` path (`firebase-auth.service.ts`) is
   already live code — only the envs are absent.
5. A small follow-up round wires the mobile SDK
   (`@react-native-google-signin` + the firebase JS SDK) — the button
   then becomes functional the moment the envs above are present.

## What was deliberately NOT done

- No refresh-token rotation subsystem: the JWT is 30-day, revocable, and the
  probe reconciles dead sessions at boot — the smallest complete design.
- No cookie jar in the app: the single captured JWT in SecureStore IS the
  session (httpOnly browser semantics don't apply to a bearer-transport
  client).
- No raw JWT in any response body — reopening the 98-F3 XSS surface was
  rejected during design.
