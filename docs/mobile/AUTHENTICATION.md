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

## What was deliberately NOT done

- No refresh-token rotation subsystem: the JWT is 30-day, revocable, and the
  probe reconciles dead sessions at boot — the smallest complete design.
- No cookie jar in the app: the single captured JWT in SecureStore IS the
  session (httpOnly browser semantics don't apply to a bearer-transport
  client).
- No raw JWT in any response body — reopening the 98-F3 XSS surface was
  rejected during design.
