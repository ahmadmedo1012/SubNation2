# RTL / LTR Layout Architecture

How the SubNation2 frontend handles text direction. Pair with
`UI_DIRECTION_FIX_REPORT.md` for the bug history that motivated this
architecture.

## 1. Tenets

1. **Document direction is global, set once, never per-route.** SubNation
   is an Arabic-first SPA. `<html lang="ar" dir="rtl">` is the truth for
   the entire session. No route, no SEO meta, no helmet block ever
   declares or mutates `<html dir>`.
2. **One mutator.** `frontend/src/lib/direction.ts` is the only file in
   the codebase that touches `document.documentElement.lang/dir`. It
   exposes `applyDocumentDirection(lang, dir)` and `useDocumentDirection(lang)`.
3. **Per-component overrides are allowed when they have semantic intent.**
   E.g. a phone-number `<input dir="ltr">` inside an Arabic form, or a
   debug-only `<SentryTest dir="ltr">`. These do not affect the document.
4. **CSS uses logical properties where possible** (`me-2`, `ms-1`,
   `text-start`, `text-end`) so a flip from RTL to LTR Just Works.
   Tailwind v4 is logical-property-aware; we lean on that.

## 2. Boot order

```
0. index.html parsed:
       <html lang="ar" dir="rtl">

1. main.tsx (synchronous):
       applyDocumentDirection("ar")
       // Idempotent re-affirmation; no flicker.

2. <App> renders:
       useDocumentDirection("ar")
       // Effect runs once on mount; idempotent re-affirmation.

3. Routes mount/unmount freely.
   Helmet manages <title>, <meta>, <link rel="canonical">, OG, Twitter,
   JSON-LD. Helmet does NOT touch <html dir>.

4. Future i18n switcher (when added):
       applyDocumentDirection(newLang)
       // Direction flips deterministically; CSS responds via logical props.
```

## 3. The single mutator API

```ts
// lib/direction.ts

export type AppLanguage = "ar" | "en";
export type Direction = "rtl" | "ltr";

export const DEFAULT_LANG: AppLanguage = "ar";
export const DEFAULT_DIR: Direction = "rtl";

/** Pure: "ar" → "rtl", "en" → "ltr". */
export function directionFor(lang: AppLanguage): Direction;

/**
 * Synchronous mutation. Idempotent — only writes if value differs.
 * Sets <html lang>, <html dir>, and <html data-locale>.
 */
export function applyDocumentDirection(
  lang?: AppLanguage,
  dir?: Direction,
): void;

/**
 * useEffect variant — locks direction at component mount. Reruns when
 * `lang` changes (so a future i18n switcher can pass the new value).
 */
export function useDocumentDirection(lang?: AppLanguage): void;
```

## 4. Per-component direction overrides

Two legitimate cases:

### (a) Numeric / Latin-script content embedded in an RTL page

```tsx
// Phone number — always reads LTR even on an Arabic form
<input dir="ltr" placeholder="+218 91 234 5678" />

// IBAN, OTP code, account number — same idea
<span dir="ltr">{accountNumber}</span>
```

These exist throughout `login.tsx`, `register.tsx`, `wallet.tsx`,
`forgot-password.tsx`, `profile.tsx`. Keep them.

### (b) Component that intentionally reads in the opposite direction

```tsx
// Debug surface — reads better LTR
<div dir="ltr"><SentryTest /></div>
```

Reserved for tools / dev surfaces. Don't use this for user-facing content.

## 5. CSS — Tailwind logical properties

Use these in component classes; they auto-flip with `<html dir>`:

| Logical | Physical-RTL | Physical-LTR |
|---|---|---|
| `ms-1` (margin-inline-start) | margin-right: 0.25rem | margin-left: 0.25rem |
| `me-2` (margin-inline-end) | margin-left: 0.5rem | margin-right: 0.5rem |
| `ps-3` (padding-inline-start) | padding-right: 0.75rem | padding-left: 0.75rem |
| `pe-4` (padding-inline-end) | padding-left: 1rem | padding-right: 1rem |
| `text-start` | text-align: right | text-align: left |
| `text-end` | text-align: left | text-align: right |
| `border-s` (border-inline-start) | border-right | border-left |

Avoid physical (`ml-2`, `mr-3`, `text-left`) when the direction matters.
Physical is correct for icons that always look the same regardless of
direction (e.g. a loading spinner).

## 6. Forbidden patterns

```tsx
// ❌ Never declare <html dir> via helmet
<Helmet><html dir="rtl" /></Helmet>

// ❌ Never mutate documentElement.dir directly outside lib/direction
document.documentElement.dir = "ltr";

// ❌ Never set dir conditionally based on route — direction is global
<Route path="/login" component={() => <Page dir="ltr" />} />

// ❌ Never use physical Tailwind classes for layout that should flip
<div className="ml-4 text-left">...
//          ^^^         ^^^^^^^^^^
// use ms-4 and text-start instead
```

## 7. Bidirectional text edge cases

When mixing Arabic + Latin in the same string, modern browsers handle
the bidirectional algorithm correctly **as long as the document and
container have the right base direction**. With our lock in place:

- Arabic text in an RTL container: reads right-to-left (correct).
- Latin text inserted in the middle: the BiDi algorithm handles it.
- Numbers: rendered LTR within an RTL container automatically.
- Unicode control chars (`\u200E`, `\u200F`) are not normally needed.

If a specific phrase doesn't render right (e.g. a phone number breaks
across lines), wrap **just that span** in `dir="ltr"` rather than
mutating the document.

## 8. Testing direction stability

Manual smoke tests:

```
1. Open https://subnation.ly/ in DevTools.
2. Inspect <html> — should be lang="ar" dir="rtl" data-locale="ar".
3. Navigate / → /login → /wallet → /orders → /profile → /product/1 → /.
   Inspect <html> after each navigation: lang/dir must NOT change.
4. Inspect the bottom mobile nav order — must not invert.
5. Open the React Helmet Async docs page in another tab if you're
   developing — confirm no warnings about uncontrolled HTML attribute
   in our app's console.
```

## 9. Future: real i18n switcher

When SubNation gains a language switcher, the integration is:

```tsx
// pseudo-code for a future LanguageSwitcher component
import { applyDocumentDirection, type AppLanguage } from "@/lib/direction";

function LanguageSwitcher() {
  const [lang, setLang] = useStoredLanguage(); // localStorage-backed

  function switchTo(next: AppLanguage) {
    setLang(next);
    applyDocumentDirection(next);
    // Update i18n provider, rerender, etc.
  }

  return <button onClick={() => switchTo(lang === "ar" ? "en" : "ar")}>
    {lang === "ar" ? "English" : "العربية"}
  </button>;
}
```

The CSS doesn't need to change — every component already uses logical
properties. Strings come from the i18n provider. The document attribute
flip is one function call.
