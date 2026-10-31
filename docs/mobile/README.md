# SubNation Mobile — the native Expo app (`apps/mobile`)

> Status: CURRENT @ 2026-10-31 (R191) · Owner docs live here; the code is `apps/mobile`.

A native Android/iOS application for the SubNation storefront, built with
**Expo SDK 58** (React Native 0.88, React 19.3, Expo Router, New Architecture,
typed routes, React Compiler). It is a REAL native app — not a WebView
wrapper — and it talks to the SAME production backend as the website
(`https://subnation.ly`), through the SAME OpenAPI-generated contract.

## What ships in v1 (R191)

| Surface | State |
|---|---|
| Navigation | 5 native tabs (الرئيسية / المحفظة / طلباتي / السلة / حسابي) mirroring the web's own mobile nav; per-tab stacks; Arabic RTL forced |
| Catalog | Home = catalog (search + category rail + sort + in-stock filter), category pages, product detail with variant selector, honest stock, FAQ, recommendations |
| Search | Dedicated screen, debounced Arabic search, recent-search history |
| Cart | Local persisted cart (same `subnation_cart_v2` shape as the web), stock-aware caps, quantity steppers |
| Checkout | Wallet-only, **per-unit order creation** with per-unit idempotency keys + order-group token (the M4/M5/M6 discipline, ported from the web) |
| Wallet | Balance, top-ups (mobile_transfer: Libyana/Madar with USSD installment plan; lypay bank transfer), top-up queue, full LYD ledger, Socket.IO realtime |
| Orders | Filtered list, order-group clustering, detail with status timeline + masked credential reveal |
| Loyalty / referrals | Points, tiers, convert-to-wallet (idempotent), referral code + share + invited list |
| Support | FAQ, ticket creation, threaded replies |
| Notifications | Paged in-app notifications, mark-read/mark-all, internal link routing |
| Auth | **WhatsApp OTP** (fully native), **Telegram OIDC** (native bridge), Google (Firebase) pending owner-side native config |
| Sessions | Device list, per-device revoke, logout, logout-all |
| Push notifications | Client + backend infra landed (push_tokens table + routes + Expo push service); registration wired for the follow-up round |

## The three contracts that make it native

1. **Session**: the JWT never appears in response BODIES (the web's XSS-safe
   sentinel). The app captures the `auth_token` Set-Cookie at mint time,
   stores it in SecureStore, and presents it as a Bearer token. Session rows
   stay server-revocable — nothing about the web's model changes.
2. **CSRF**: every mutation needs an allow-listed `Origin` header — including
   Bearer clients. The app sends `Origin: https://subnation.ly` on every
   API-origin request (a global fetch shim — see `src/lib/api.ts`).
3. **Money**: the device never computes an authoritative total. Server quotes,
   `Idempotency-Key` headers with the {k,t,f} envelope, per-unit purchases,
   group tokens — the web's exact discipline, ported.

## Why there are TWO generated clients

The web pins react **19.1.0** (the owner's eager-bundle budget); Expo SDK 58
requires react **19.3.x**. One physical shared package can only peer its
react-query to ONE react — whichever it picks splits the other side's
QueryClient context (the R172 two-instance law, re-proven R191). So:

- `@workspace/api-client-react` — the web's client (react 19.1.0 world)
- `@workspace/api-client-native` — the mobile twin, generated from the SAME
  spec with the SAME options (`pnpm codegen` regenerates both; keep the two
  `custom-fetch.ts` copies in lockstep)

The mobile app MUST import from `@workspace/api-client-native`.

## Commands

```bash
# from repo root
pnpm install                       # workspace-wide (single root lockfile)

# from apps/mobile
pnpm start                         # Metro dev server (dev-client builds)
pnpm exec expo-doctor              # health check (20/20 at R191)
pnpm run typecheck                 # tsc --noEmit
pnpm exec expo lint                # eslint
pnpm run test:run                  # vitest (pure-logic suites)
pnpm exec expo export --platform android   # bundle validation without a device
pnpm exec expo export --platform ios

# EAS (EXPO_TOKEN in env — see docs/mobile/EAS-BUILDS.md)
npx eas-cli@latest build --platform android --profile development
```

## Files that own the architecture

- `app.config.ts` — CNG identity (ly.subnation.app), plugins, EAS project id
- `eas.json` — development / preview / production profiles
- `CONVENTIONS.md` — the implementation rules every screen follows
- `src/theme/` — the SubNation token table (dark-first, web parity)
- `src/lib/api.ts` — transport bootstrap (Origin shim + Bearer + 401 routing)
- `src/lib/auth-store.ts` — the native session mechanism (Set-Cookie capture)
- `src/lib/idempotency.ts` — the {k,t,f} money-intent envelope

See `ARCHITECTURE.md`, `AUTHENTICATION.md`, `EAS-BUILDS.md` for depth.
