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
| `c539549d-a790-4c03-9de7-02cdbe11e1b7` | iOS | development (simulator) | ✅ finished @ `3f72c452` (the CI-green final mobile tree; later commits touch no apps/mobile file) | https://expo.dev/artifacts/eas/_GxvkqPf8kK_j5L7rG1R-mOgGXOobAxrx8aAuu4RGhE.tar.gz |
| `42ea9b88-71f1-463c-b3f4-9dc782033503` | Android | development (post-sentry-removal, pre-hardening tree) | ✅ finished | https://expo.dev/artifacts/eas/2XSow-qcjsOgGWuAz5cLfrCktNkJ0xw1PBHObbm9Png.apk |
| `a1e88787-d425-4a2f-9d43-b23353d4f813` | Android | production | ✅ finished | https://expo.dev/artifacts/eas/23n4iIyZyQQ1G8afbA5rDAOnq_hN2179QTnpT5MO1Jo.aab |
| `5fcaed32-376f-43db-bfd4-813ba57690f7` | iOS | development (simulator, pre-hardening tree) | ✅ finished | https://expo.dev/artifacts/eas/r-fdA3KakVWBT30YWIoSK4036ZDLUm1sMSp_ZhVMTWw.tar.gz |
| `9c7ace3b`, `92cb5ec8`, `e37c0f38` | iOS | development | ❌ errored | the sentry-cocoa pod fails EAS's Xcode toolchain ("std::allocator does not support const types" profiling-thread static assertions) — sentry-expo REMOVED from v1; re-add after a patched release (see `.env.example` note) |

**The Android quota boundary (PR close, 2026-10-31):** the account's
free-plan Android builds for the month are SPENT (3/3 — dev, production,
dev). A final-tree Android development build (the post-hardening tree —
deep-link alias, tightened intent filters, socket catalog, foreground
resync) is one command away the moment the quota resets (Nov 1) or the
plan is upgraded:

```bash
cd apps/mobile && EXPO_TOKEN=<token> eas build --platform android --profile development --non-interactive
```

Until then the Android-side evidence for the EXACT latest tree is:
`expo export --platform android` bundles clean (4 MB hbc with the new
routes compiled in), `expo config` parses (8 verified intent filters),
typecheck/lint/vitest green locally AND in CI's dedicated mobile leg,
and the signing fingerprint of every future build is already known and
committed (below).

**The signing fingerprint (extracted from the artifacts, committed in
`assetlinks.json`):** the dev APK's (`d463dec7`) v2 signing-block
certificate and the production AAB's (`a1e88787`) JAR-signature
certificate are byte-identical — EAS signs every Android build with the
one project keystore:

- SHA1: `AB:21:2D:9C:CC:4A:11:55:AD:CC:03:50:01:BA:CC:5D:ED:FD:A4:CB`
- SHA256: `5D:D2:D9:0C:A5:33:3B:7A:3D:60:14:17:E5:B2:A7:14:95:DC:31:E9:DD:E8:BD:35:29:79:3A:6F:55:33:A9:AC`

## Environment configuration

- `EXPO_PUBLIC_API_URL` — API origin (defaults to `https://subnation.ly`)
- `EXPO_PUBLIC_FIREBASE_*` — Google sign-in (4 vars; see `.env.example`)
- `EXPO_PUBLIC_SENTRY_DSN` — crash reporting, DSN-gated (R192: the integration
  is LIVE in the tree — unset DSN = disabled telemetry; see the Sentry
  section below)
- `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` — EAS build-time
  secrets for source-map upload (app.config.ts activates the upload phases
  the moment `SENTRY_AUTH_TOKEN` exists; absent = uploads disabled, never
  a failed build)

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
   (R191). The EAS keystore's REAL SHA256 is already committed
   (`5D:D2:D9:…:A9:AC` — extracted from the signed artifacts; the dev APK
   and the production AAB carry the same signer), so App Links verify on
   dev/preview installs once the backend deploys. Remaining owner actions:
   APPEND the Play App Signing SHA256 (Play Console → Release → Setup → App
   signing, after the app entry exists) and replace `TEAMID` (Apple
   Developer membership page) in `backend/src/routes/well-known.ts`, then
   redeploy.
4. **EAS Update** (`eas update:configure`) — channels are declared in
   `eas.json`; OTA publishing is deliberately left to the owner's first
   post-store release (no installed base yet to update).

## Crash reporting — the R192 Sentry return (root-caused and fixed)

R191 removed sentry-expo after 3 errored iOS builds. The R192 diagnosis
(fetched the actual EAS build logs + upstream research):

- **The failing package was `sentry-expo@7.x` — deprecated since Jan 2024**
  (no fixes, no security patches). It hard-pins `@sentry/react-native@5.5.0`,
  whose Podfile builds **sentry-cocoa 8.7.1 FROM SOURCE** — and 8.7.1's
  profiling module contains `std::vector<const ThreadHandleMetadataPair>` /
  `std::vector<const QueueMetadata>` (an invalid `std::allocator<const T>`
  instantiation) that newer clang rejects. Upstream: getsentry/sentry-cocoa
  #4886 / #5172; fixed in **sentry-cocoa 8.46.0 (2025-03-04)** via #4917/#4918;
  `@sentry/react-native` 6.10.0 first carried the fix.
- **The correct SDK 58 integration is `@sentry/react-native@~8.28.0`** (Expo's
  `bundledNativeModules` pin) with **NO sentry-expo at all**: it consumes
  **sentry-cocoa 9.29.0 as a PREBUILT xcframework** — the broken C++ is never
  compiled on any toolchain.

What landed (R192):

| Piece | File | Behavior without owner config |
|---|---|---|
| Package | `@sentry/react-native@~8.28.0` | autolinks; prebuilt native — builds clean |
| Metro | `apps/mobile/metro.config.js` (`getSentryExpoConfig`) | Debug-IDs in bundles/maps; Expo-router ErrorBoundary auto-wrap |
| Config plugin | `app.config.ts` `@sentry/react-native/expo` | `disableAutoUpload: true` while `SENTRY_AUTH_TOKEN` is absent — a credentials-less build can never fail on Sentry |
| Runtime init | `apps/mobile/src/lib/sentry.ts` (DSN-gated) | No `EXPO_PUBLIC_SENTRY_DSN` → never initializes: zero telemetry, identical behavior |

Owner activation (configuration only — zero code changes):

1. Sentry console → create the mobile project → set `EXPO_PUBLIC_SENTRY_DSN`
   as an EAS environment variable (or in `.env`).
2. For symbolicated stack traces set the EAS build secrets `SENTRY_ORG`,
   `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` — source-map upload activates on the
   next build automatically.
3. A controlled test exception (`Sentry.captureException` from a debug
   surface) then verifies the dashboard round-trip.

Privacy posture: `sendDefaultPii: false`, no traces/profiles/replay —
crash-and-exception reporting only; delivered credentials never pass through
the SDK.
