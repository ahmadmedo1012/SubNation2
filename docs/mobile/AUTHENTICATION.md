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
| **Telegram OIDC** | `GET /api/auth/telegram/oidc/login?native=1` in `expo-web-browser`; the state row records the native flag; the callback redirects successful auth to `subnation://auth/callback#token=<jwt>` (single-use state + PKCE + 10-min TTL unchanged; token lands ONLY in the app-scheme redirect) | **Live** (backend bridge landed R191; web flow untouched) |
| **Google (Firebase)** | requires the Firebase Android/iOS apps to be registered in the owner's Firebase console (google-services.json / GoogleService-Info.plist + OAuth client) — a genuine owner-side prerequisite | **Pending owner config** — the button renders only when `EXPO_PUBLIC_FIREBASE_*` envs are set; `apps/mobile/.env.example` documents them |

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
