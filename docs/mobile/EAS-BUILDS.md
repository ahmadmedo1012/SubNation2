# Mobile EAS Builds & Delivery

> Status: CURRENT @ 2026-10-31 (R191)

## Project identity

- EAS project: `@rh2011/subnation` — id `9ab879a4-561d-46d0-b987-6853c6d8fe33`
  (committed in `apps/mobile/app.config.ts` `extra.eas.projectId`)
- Bundle ids: `ly.subnation.app` (Android package + iOS bundleIdentifier)
- Scheme: `subnation://`
- Runtime version policy: `appVersionSource: "remote"` (versions managed by EAS)

## Profiles (`apps/mobile/eas.json`)

| Profile | Android | iOS | Channel | Notes |
|---|---|---|---|---|
| development | APK | simulator build | development | `developmentClient: true`, `APP_VARIANT=development` → installs as "SubNation Dev" |
| preview | APK | — | preview | `APP_VARIANT=preview` → "SubNation Preview" |
| production | AAB | IPA | production | `autoIncrement` |

## Build evidence (R191, account rh2011)

| Build | Platform | Profile | Status | Artifact |
|---|---|---|---|---|
| `5fcaed32-376f-43db-bfd4-813ba57690f7` | iOS | development (simulator) | ✅ finished | https://expo.dev/artifacts/eas/r-fdA3KakVWBT30YWIoSK4036ZDLUm1sMSp_ZhVMTWw.tar.gz |
| `a1e88787-d425-4a2f-9d43-b23353d4f813` | Android | production | ✅ finished | https://expo.dev/artifacts/eas/23n4iIyZyQQ1G8afbA5rDAOnq_hN2179QTnpT5MO1Jo.aab |
| `d463dec7-2bfb-42de-9b60-19a487278d30` | Android | development | ✅ finished | https://expo.dev/artifacts/eas/Lf-gEgw7aGEjHIwnhZgpTpIKiLrd35k1U_LDWm7pAos.apk |
| `42ea9b88-71f1-463c-b3f4-9dc782033503` | Android | development (post-sentry-removal, matches HEAD) | submitted at round close | — |
| `9c7ace3b`, `92cb5ec8`, `e37c0f38` | iOS | development | ❌ errored | the sentry-cocoa pod fails EAS's Xcode toolchain ("std::allocator does not support const types" profiling-thread static assertions) — sentry-expo REMOVED from v1; re-add after a patched release (see `.env.example` note) |

## Environment configuration

- `EXPO_PUBLIC_API_URL` — API origin (defaults to `https://subnation.ly`)
- `EXPO_PUBLIC_FIREBASE_*` — Google sign-in (4 vars; see `.env.example`)
- `EXPO_PUBLIC_SENTRY_DSN` — reserved for the crash-reporting follow-up

Backend secrets are NEVER bundled — only `EXPO_PUBLIC_*` values ship in the
binary (build-time inlined).

## Commands

```bash
export EXPO_TOKEN=<token>            # account access token (owner's EAS account)
npx eas-cli@latest whoami
npx eas-cli@latest build --platform android --profile development --non-interactive
npx eas-cli@latest build:list --platform all --limit 5
```

## Store submission (owner actions — NOT done in R191)

1. **Google Play**: EAS can submit the AAB (`eas submit -p android`) once a
   Play Console app exists with package `ly.subnation.app` + a service
   account key. The production AAB above is store-shaped.
2. **Apple App Store**: requires the owner's Apple Developer account (Team
   ID). After that: `eas submit -p ios` with distribution certificates —
   EAS manages the signing keys via `eas credentials`.
3. **Deep links**: `/.well-known/assetlinks.json` and
   `/.well-known/apple-app-site-association` are SERVED by the backend
   (R191) with placeholder fingerprints — replace
   `REPLACE_WITH_EAS_PLAY_CERT_SHA256` (from `eas credentials` after the
   first production Android build) and `REPLACE_WITH_APPLE_TEAM_ID`, then
   rebuild to activate verified App Links / Universal Links.
4. **EAS Update** (`eas update:configure`) — channels are declared in
   `eas.json`; OTA publishing is deliberately left to the owner's first
   post-store release (no installed base yet to update).
