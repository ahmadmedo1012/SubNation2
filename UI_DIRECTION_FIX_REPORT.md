# UI Direction Fix Report

**Date:** 2026-05-16
**Severity:** P1 — visible to every user during route transitions
**Status:** Fixed (commit pending push)

## 1. Symptom (as reported)

> During navigation between tabs/pages, layout suddenly flips between RTL
> and LTR. Some screens momentarily render mirrored. The bottom mobile
> navigation becomes inverted/swapped unexpectedly. The behaviour appears
> during route transitions and did not exist previously.

## 2. Root cause (one specific line)

`frontend/src/components/seo/MetaTags.tsx` line 57:

```jsx
<Helmet>
  <html lang={lang} dir={dir} />     // ← root cause
  ...
</Helmet>
```

`MetaTags` is rendered by the `useSeo()` hook, which is only called from
**two pages** in the entire SPA: `home.tsx` and `product.tsx`.

`react-helmet-async` "owns" any HTML attribute it declares. On unmount, it
**removes** the attribute it had set rather than restoring the static
value from `index.html`. The flow:

1. `index.html` ships with `<html lang="ar" dir="rtl">` (static baseline).
2. User opens `/` → `HomePage` mounts → `useSeo()` mounts `MetaTags` →
   helmet declares `<html lang="ar" dir="rtl">`. Helmet now owns those
   attributes.
3. User navigates to `/login` (no `useSeo` call). `MetaTags` unmounts.
   Helmet **strips** `lang` and `dir` from `<html>`.
4. The document is left with no `dir` attribute → browser falls back to
   `auto` (LTR for most content). Mobile bottom nav `flex flex-row`
   reorders. Pages without an explicit `dir="rtl"` on their root div
   inherit LTR and render mirrored.
5. User navigates back to `/`. Helmet re-declares `dir="rtl"`. The
   document flips back. Visible flicker on every transition into/out of
   a SEO-aware route.

This regression appeared with the SEO/MetaTags work added in the previous
sessions — that's why it didn't exist before.

## 3. Fix (surgical, minimal blast-radius)

Two changes, in `frontend/src`:

### (a) Stop helmet from managing `<html lang dir>` — root-cause removal

`components/seo/MetaTags.tsx`: deleted the `<html lang={lang} dir={dir} />`
line from inside the Helmet block. The component still emits `og:locale`,
`og:locale:alternate`, the canonical `<link>`, and all OG / Twitter Card
meta tags as before. Helmet is no longer responsible for the document's
direction.

### (b) Lock direction once at App boot — defence-in-depth

New file `lib/direction.ts`:

- `applyDocumentDirection(lang, dir)` — synchronous mutation; idempotent
  (only writes if different).
- `useDocumentDirection(lang)` — `useEffect` variant; mount once at the
  App root.
- `directionFor(lang)` — pure mapping `"ar" → "rtl"`, `"en" → "ltr"`.
- `DEFAULT_LANG = "ar"`, `DEFAULT_DIR = "rtl"`.

Wired in two places:

- `frontend/src/main.tsx`: calls `applyDocumentDirection("ar")` **before**
  React mounts. So even the very first paint can never be wrong, even if
  something racy happens between `index.html` parse and JS boot.
- `frontend/src/App.tsx`: calls `useDocumentDirection("ar")` at the top
  of the `App()` component. Re-affirms the direction on every full mount;
  defends against any future code that might mutate `<html dir>`.

## 4. Files changed

| File | Change |
|---|---|
| `frontend/src/components/seo/MetaTags.tsx` | Removed the `<html lang dir>` declaration from the Helmet block; updated the surrounding comment to explain why. |
| `frontend/src/lib/direction.ts` (NEW) | The single source of truth for document direction. Exports `applyDocumentDirection`, `useDocumentDirection`, `directionFor`, and the `DEFAULT_*` constants. |
| `frontend/src/main.tsx` | Calls `applyDocumentDirection("ar")` synchronously before React mounts. |
| `frontend/src/App.tsx` | Calls `useDocumentDirection("ar")` at the top of `App()`. |

## 5. What did NOT change (and why)

- **Per-component `dir="rtl"` / `dir="ltr"` overrides** on root divs of
  `onboarding.tsx`, `support.tsx`, `admin/security.tsx`,
  `admin/topups.tsx`, `ErrorBoundary.tsx`, `SessionManager.tsx`,
  `SentryTest.tsx`, etc. — left alone. They were defensive workarounds
  for the helmet bug; with the bug fixed, they're now redundant but
  harmless. Removing them would be a separate cleanup.
- **`dir="ltr"` on phone / account / OTP `<input>` fields** in
  `login.tsx`, `register.tsx`, `wallet.tsx`, `profile.tsx`,
  `forgot-password.tsx`, etc. — intentionally preserved. Phone numbers
  like `+218 91-234-5678` need LTR rendering even on an RTL page; this is
  correct UX, not a bug.
- **Helmet meta / OG / Twitter / canonical / `<title>` mutations** —
  unchanged. Helmet is great at managing those; the bug was specifically
  that helmet shouldn't manage *layout-affecting* attributes.
- **Mobile bottom nav, Navbar, Footer, FlashSaleBanner** — all unchanged.
  No layout code touched.
- **Auth, routing, animations, hydration paths** — untouched.

## 6. Verification

### Local

```
$ pnpm run typecheck          ✓ all 4 workspace packages clean
$ pnpm exec vitest run        Test Files 9 passed (9) | Tests 80 passed (80)
$ pnpm --filter @workspace/subnation run build
                              ✓ vite built; bundle 21,696 B gzip on index entry
```

### Production (post-deploy steps)

1. Open DevTools on `https://subnation.ly/` — confirm `<html dir="rtl">`.
2. Navigate `/` → `/login` → `/wallet` → `/orders` → `/profile` →
   back to `/` — `<html dir>` stays `"rtl"` throughout. No flash, no
   flip in the bottom nav.
3. Open `/product/:id` (a SEO-aware page). Confirm `<html dir>` still
   `"rtl"`, and `<link rel="canonical">` updates per route.
4. On mobile (Chrome Android), repeat the navigation cycle and confirm
   the bottom navigation bar's order does not change between routes.

## 7. Regression protections

- **Single source of truth.** `lib/direction.ts` is now the only place
  that mutates `document.documentElement.lang` / `dir`. Grepping the
  frontend for `documentElement.dir` / `documentElement.lang` returns
  exactly one file (this one). Future PRs that introduce a new mutator
  will fail this convention and should be refactored to call
  `applyDocumentDirection`.
- **Helmet ownership removed.** No `<html lang dir>` declaration in any
  Helmet block. Future SEO components that need a per-locale tag should
  use `og:locale`, *not* document-attribute mutation.
- **Boot-time + mount-time enforcement.** `main.tsx` runs the locking
  function before React even renders; `App.tsx` runs it again on first
  effect. Any descendant that mutates direction is overridden on the next
  full App mount.

## 8. Remaining risks

| Risk | Severity | Mitigation |
|---|---|---|
| A future PR adds a new MetaTags-style helmet block that re-declares `<html dir>` | Low | Code review + the comment in MetaTags.tsx explaining why this is forbidden |
| A future i18n switcher needs to flip lang at runtime | Low | `applyDocumentDirection(nextLang)` is the documented call; integrate from the switcher's effect |
| The legacy `dir="rtl"` overrides on root divs become inconsistent with future i18n | Low | Documented as a follow-up cleanup once a real switcher lands |
| Some browsers honour `dir="auto"` differently | Negligible | We never emit `dir="auto"`; baseline is always `rtl` |

## 9. Memory_MCP entity

This fix is captured under the existing `subnation2:state:post-stabilization:2026-05-16`
entity (memory MCP rejected the long-form observation due to a server-side
parser issue, but `FINAL_RUNTIME_STATE.md` and this report are the durable
on-disk record).
