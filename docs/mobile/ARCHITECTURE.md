# Mobile Architecture

> Status: CURRENT @ 2026-10-31 (R191)

## Monorepo placement

```
apps/mobile/            ← the Expo workspace package (@workspace/mobile)
  app.config.ts         ← CNG (no committed android/ or ios/ — .gitignored)
  eas.json              ← build profiles
  CONVENTIONS.md        ← the implementation rules (read before coding)
  src/
    app/                ← routes ONLY (Expo Router, typed routes)
      (tabs)/           ← NativeTabs: (home) (wallet) (orders) (cart) (account)
        (home)/         ← catalog stack: index, search, category/[slug], product/[slug]
        (wallet)/       ← wallet + top-ups + ledger
        (orders)/       ← list + [orderCode] detail
        (cart)/         ← local cart
        (account)/      ← hub + loyalty/referrals/notifications/sessions/terms/support
      login.tsx         ← root modal (auth surface)
      checkout.tsx      ← root screen above tabs (the money flow)
      onboarding.tsx    ← first-run welcome
    screens/<name>/     ← screen bodies + private components
    components/         ← shared primitives (Button, Card, states, PriceDisplay…)
    theme/              ← the SubNation token table (colors/spacing/typography/radius/shadows/motion)
    lib/                ← api transport, auth store/provider, cart, money, errors, idempotency
    hooks/              ← use-whatsapp-otp (the web machine's port), use-socket
  assets/fonts/         ← Readex Pro 400/600/700 (the web's exact font)
  assets/images/        ← brand icons generated from the official mark
```

## Key decisions (and their one-line reasons)

- **Expo Router + NativeTabs** — platform-real tab bars (liquid glass iOS 26+,
  Material 3 Android); 5 tabs exactly (Android's hard limit) mirroring the
  web's own MobileNav.
- **`@workspace/api-client-native`** — the generated-client twin; one physical
  package cannot serve react 19.1.0 (web, owner's bundle budget) and 19.3.0
  (Expo SDK 58) at once (R172 two-instance law). Same spec, same orval
  options, own `custom-fetch.ts` copy (keep in lockstep).
- **Origin-shim fetch wrapper** — the CSRF gate requires an allow-listed
  Origin on ALL mutations, Bearer clients included; one global shim feeds
  every request (generated client, mint calls, sockets).
- **SecureStore-only tokens** — the JWT is a credential; AsyncStorage is for
  carts and intent keys only.
- **Per-unit checkout** — the backend owns atomicity (M4); the client replays
  the web's per-unit loop with per-unit {k,t,f} idempotency envelopes + the
  order-group token (M5/M6).
- **RTL forced** (`I18nManager.forceRTL`) — Arabic-first product; logical
  padding everywhere; money/code rows `direction: "ltr"`.
- **Dark-first theme** — the web's exact token table (dark default, light
  pairs); React Compiler enabled (SDK 58 default).

## Backend additions that serve the app (R191)

| Piece | Where |
|---|---|
| `push_tokens` table + register/revoke/list routes + best-effort Expo push service | `backend/src/migrate/stages/05-push-tokens-r191.ts` (V1-M37), `backend/src/routes/notifications.ts`, `backend/src/services/push.service.ts`, drizzle `0028` |
| Telegram native OIDC bridge (`?native=1` → `subnation://auth/callback#token=`) | `backend/src/routes/auth-settings.ts`, `backend/src/lib/telegram-oidc-states.ts` |
| `DELETE /auth/sessions/{id}` documented in the spec (route pre-existed) | `shared/api-spec/openapi.yaml` |
| `/.well-known/assetlinks.json` + `apple-app-site-association` | `backend/src/routes/well-known.ts` (placeholders for owner fingerprints) |

## Testing

- `apps/mobile` vitest: pure-logic suites (M17 money idiom pins, Set-Cookie
  JWT extraction, {k,t,f} envelope guards, product-art versioner) — 27 tests.
- Backend: full suite green incl. the new push-token/telegram-native/migration
  suites (route-level, PGlite + real express + fetch).
- Bundles: `expo export` android + ios both clean at HEAD.
- EAS builds: see EAS-BUILDS.md for the artifact evidence.
- **Not done (honest)**: on-device/emulator runtime verification — this
  round's machine has no KVM/GPU (local emulator infeasible) and the EAS
  Simulator feature is not enabled on the owner's account
  (`simulator:availability → available: false`, waitlist open). Static +
  cloud-build evidence is what R191 ships; the owner's first `eas build`→
  install on a real device is the remaining runtime step.
