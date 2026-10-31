# R191 Round-Close — The native Expo application lands

Date: 2026-10-31 · Branch: `feat/mobile-r191` (PR to main) · Starting SHA: `afe79bac`

## A. Starting state

- Repo `main` @ `afe79bac` (clean; = the mission brief's known snapshot — no newer owner pushes).
- Production healthy (healthz ok, home 200, providers live: telegram+OIDC, google, whatsapp `ready`).
- R186–R188 detail-perfection long-tail: **0 open P0/P1**; standing deferral F-F5 (OpenWA evidence-first).
- Mission: audit + a production-grade native Expo app wired to the existing backend, EAS builds, CI, docs.

## B. Website work

Verified healthy + all 2,913 frontend tests green at the final tree (after healing the react-query instance split this round introduced and closed — §C). No re-audit of the R186–R188 lenses (the repo's own convention: completed audits are not re-run without a specific reason). F-F5 remains the owner-evidence deferral.

## C. The two-React incident (root-caused, fixed, pinned by tests)

Adding `apps/mobile` (react 19.3.0 — Expo SDK 58's requirement) re-resolved the ONE shared client's `@tanstack/react-query` dependency edge to the react@19.3.0 peer combo → the web (react 19.1.0, the owner's frozen eager-bundle budget) consumed hooks through an instance whose `useContext` read a foreign react → **105 frontend test failures** (null QueryClient context). The R172 "two @types peer combos = two instances = two React contexts" law, re-proven at dependency-edge scope.

Fix: a **second generated client** — `@workspace/api-client-native` (orval target #3, same spec/options, lockstep `custom-fetch.ts` twin) whose edge resolves in the mobile world; the web keeps `@workspace/api-client-react` with its peer context pinned by a `react@19.1.0` devDep. pnpm's `dependenciesMeta.injected` path was tried first and abandoned (documented in the workspace commit). Frontend suite: **320 files / 2,913 tests — 100% green, the exact R188 count.**

## D. The app (apps/mobile)

Expo SDK 58 · RN 0.88.1 · React 19.3.0 · Expo Router (typed routes, React Compiler, New Architecture) · NativeTabs ×5 (الرئيسية/المحفظة/طلباتي/السلة/حسابي — the web's own MobileNav) · per-tab stacks · Arabic RTL forced · the web's exact token table (dark-first) + Readex Pro 400/600/700 (the real Google-Fonts TTFs) · brand icons generated from the official mark.

Customer surface: catalog home (search/category/sort/in-stock + pull-to-refresh), category pages, PDP (variants with honest stock, FAQ, recommendations), dedicated search with history, local cart (`subnation_cart_v2` contract, stock-aware caps), **per-unit checkout** (per-unit {k,t,f} idempotency keys + order-group token + coupon validation + the M4/M5/M6 discipline ported from the web's checkout.tsx), wallet (balance, mobile_transfer top-ups with the R154 USSD installment plan + lypay bank coordinates, top-up queue, full ledger, Socket.IO realtime), orders (filters, group clustering, detail + status timeline + masked credential reveal), loyalty (tiers, idempotent convert), referrals (code + share + invited list), support (FAQ + tickets + threads), notifications (paged, mark-read, link routing), sessions (device list + revoke), auth (WhatsApp OTP fully native, Telegram OIDC via the new bridge, Google env-gated), onboarding.

Native session: Set-Cookie JWT capture → SecureStore → Bearer + `Origin: https://subnation.ly` on every request (the CSRF contract's documented non-browser rule). Zero changes to the web's auth model.

## E. Backend contracts

1. `push_tokens` (V1-M37 runtime stage + drizzle 0028 + schema twin + test-db DDL — the four-mirror law) · register/revoke/list routes (upsert ownership transfer, soft-revoke audit trail) · best-effort Expo push service (post-commit M16, DeviceNotRegistered purge, no retries) · wired at the order-completed + topup-approved/rejected notification points · **14 route + 6 service tests**.
2. Telegram native OIDC bridge: `?native=1` → `subnation://auth/callback#token=<jwt>` (single-use state, PKCE, 10-min TTL, audit parity) · **6 tests**.
3. `DELETE /auth/sessions/{id}` documented (route pre-existed; parity allowlist entry retired).
4. `/.well-known/assetlinks.json` + `apple-app-site-association` (owner-action placeholders documented in-code + EAS-BUILDS.md).

## F. Toolchain & supply chain

- `brace-expansion` override version-scoped (the unscoped ^2.1.6 floor broke @expo/fingerprint's minimatch@3 chain on EAS submission): `^1.1.7→1.1.12` + `^2.1.6` — both patched floors hold.
- Dockerfile: mobile never enters the production image (negative `--filter "!@workspace/mobile"` in deps; manifest-parity COPYs for api-client-native; runtime closure unchanged). CI `code` filter += `apps/mobile/**`.

## G. Quality evidence (final tree)

| Gate | Result |
|---|---|
| expo-doctor | 20/20 |
| mobile tsc / lint / vitest | 0 errors / 0 problems / **27/27** |
| expo export | android ✅ (4.6–5.1 MB hbc) · ios ✅ |
| root typecheck | ×6 chains green (native twin joined) |
| root lint | 0 errors 0 warnings |
| backend suite | full green (310 files; new: push-tokens 14, telegram-native 6, migrate-v1m37 5) |
| frontend suite | **320 / 2,913** (healed — the R188 count) |
| scripts suite | 8 / 74 |
| parity / error-code / header gates | 83 enforced · 26 synced · 9/9 |
| drizzle + orval drift | clean (three-target regen) |
| root build | green (budgets hold) |

## H. EAS builds (account rh2011, project @rh2011/subnation)

| Build | Platform | Profile | Status | Artifact |
|---|---|---|---|---|
| `5fcaed32-376f-43db-bfd4-813ba57690f7` | iOS | development (simulator) | ✅ | eas/r-fdA3KakVWBT30YWIoSK4036ZDLUm1sMSp_ZhVMTWw.tar.gz |
| `a1e88787-d425-4a2f-9d43-b23353d4f813` | Android | production (AAB) | ✅ | eas/23n4iIyZyQQ1G8afbA5rDAOnq_hN2179QTnpT5MO1Jo.aab |
| `d463dec7-2bfb-42de-9b60-19a487278d30` | Android | development (APK) | ✅ | eas/Lf-gEgw7aGEjHIwnhZgpTpIKiLrd35k1U_LDWm7pAos.apk |
| `42ea9b88-71f1-463c-b3f4-9dc782033503` | Android | development (post-sentry-removal = HEAD) | submitted at close | — |
| `9c7ace3b` / `92cb5ec8` / `e37c0f38` | iOS | development | ❌ sentry-cocoa C++ static-assertion failures on EAS's Xcode toolchain → **sentry-expo removed from v1**, re-add path documented |

## I. Honest open items (owner actions)

1. **On-device runtime verification** — not possible this round: the machine has no `/dev/kvm`/GPU (local emulator infeasible) and EAS Simulator is not enabled on the account (`simulator:availability → available:false`, waitlist https://expo.dev/services/simulators). Shipped evidence: typecheck/lint/tests/exports/cloud builds. The owner's first dev-build install on a real device completes the runtime leg.
2. **Google native sign-in** — needs the Firebase console's Android/iOS app registration (google-services.json / GoogleService-Info.plist); the button is env-gated (`EXPO_PUBLIC_FIREBASE_*` in `.env.example`).
3. **Deep-link activation** — replace the two well-known placeholders (EAS Play cert SHA256 + Apple Team ID) and rebuild.
4. **Store submission** — needs the owner's Play Console + Apple Developer accounts (`eas submit` ready; metadata in EAS-BUILDS.md).
5. **EAS Update** — channels declared; first OTA publish deliberately deferred to the first post-store release.
6. **Crash reporting** — re-add sentry-expo once a release carries the patched sentry-cocoa (the init was DSN-gated; zero functionality lost in v1).

## J. Ship

- Branch `feat/mobile-r191` → PR to `main` (push to main = production Coolify deploy; the PR lets CI's every-push/e2e-hermetic gates run on the branch first — the R189/R190 widened triggers).
- Docs: `docs/mobile/{README,ARCHITECTURE,AUTHENTICATION,EAS-BUILDS}.md` + `apps/mobile/CONVENTIONS.md`.
- This report + the CHANGELOG entry + this round's row in the engineering index.
