/**
 * Document-direction stability primitive.
 *
 * Why this exists
 * ───────────────
 * The SPA used to delegate `<html lang dir>` to react-helmet-async via the
 * `<MetaTags>` component. Helmet only declares those attributes while the
 * declaring component is mounted; on unmount it REMOVES them rather than
 * restoring the static `<html lang="ar" dir="rtl">` from `index.html`.
 *
 * Because `<MetaTags>` was mounted only on the routes that opt into
 * `useSeo()` (home + product detail), navigating to any other route caused
 * helmet to strip `dir`, the document momentarily flipped to LTR, the
 * mobile bottom navigation re-ordered, and pages with no explicit
 * `dir="rtl"` on their root div re-flowed mirrored.
 *
 * The fix is to:
 *   1. Stop helmet managing `<html lang dir>` (see MetaTags.tsx).
 *   2. Lock the document direction once at App boot via this primitive.
 *
 * Future i18n
 * ───────────
 * If/when the app supports a real language switcher, call
 * `applyDocumentDirection(nextLang)` from the switcher's effect — it
 * mutates the document attributes deterministically and emits a stable
 * `data-locale` attribute on `<html>` for selectors that need it.
 */

import { useEffect } from "react";

export type AppLanguage = "ar" | "en";
export type Direction = "rtl" | "ltr";

export const DEFAULT_LANG: AppLanguage = "ar";
export const DEFAULT_DIR: Direction = "rtl";

/** Resolve the canonical direction for a language. */
export function directionFor(lang: AppLanguage): Direction {
  return lang === "ar" ? "rtl" : "ltr";
}

/**
 * Synchronously set `<html lang>`, `<html dir>`, and `<html data-locale>`.
 * Safe to call from a render or an effect; only mutates if the value
 * differs, so calling on every render is fine.
 */
export function applyDocumentDirection(
  lang: AppLanguage = DEFAULT_LANG,
  dir: Direction = directionFor(lang),
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.lang !== lang) root.lang = lang;
  if (root.dir !== dir) root.dir = dir;
  if (root.getAttribute("data-locale") !== lang) root.setAttribute("data-locale", lang);
}

/**
 * Hook variant — locks the document direction once on mount. Mount this
 * at the root of `<App>` so that no descendant unmount (e.g. a Helmet
 * block flushing) can leave the document with a stripped `dir`.
 */
export function useDocumentDirection(lang: AppLanguage = DEFAULT_LANG): void {
  useEffect(() => {
    applyDocumentDirection(lang);
  }, [lang]);
}
