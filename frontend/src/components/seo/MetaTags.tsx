import { useEffect } from "react";

export interface SeoInput {
  /** ≤ 60 chars title shown in `<title>` and og:title */
  title: string;
  /** 120-160 chars description for meta description and og:description */
  description: string;
  /** Absolute or relative URL of the canonical image (1200×630 PNG ideal) */
  image?: string;
  /** OpenGraph type — defaults to "website"; "product" for product detail */
  type?: "website" | "product" | "article";
  /** Public path for the canonical link, e.g. "/" or "/product/42" */
  path: string;
  /** Locale code: "ar" forces dir=rtl + og:locale=ar_LY */
  locale?: "ar" | "en";
  /** Optional robots directive override */
  robots?: string;
  /** App-level default instance: only applies when no page-level SEO is active */
  fallback?: boolean;
  /** Optional JSON-LD blocks rendered by JsonLd component */
  jsonLd?: object[];
}

// V3-A1 (SEO audit 2026-09-06): react-helmet-async does not reliably
// apply page-level <head> changes under React 19 — the production build
// rendered 3× <title>, 2× canonical and never replaced the static
// index.html tags (verified live in headless Chromium). This component
// now manages document.head DIRECTLY:
//
//   - update-in-place semantics (upsert by selector) — duplicates are
//     collapsed instead of accumulated, which also fixes the
//     "more than one title tag" Lighthouse failure at the root;
//   - single-slot ownership: the most recently mounted page-level
//     instance owns the head; an App-level `fallback` instance applies
//     only when no page-level SEO is active, and re-applies whenever a
//     page unmounts (leaving an SEO-less route with a clean default);
//   - child-before-parent effect ordering (React guarantees) makes the
//     page's tags win over the App default on the same commit.
//
// Trusted Types / CSP: only attribute writes and <meta>/<link>/<script
// type="application/ld+json"> creation — no inline executable script.

const DEFAULT_IMAGE = "/opengraph.jpg";

/** 94-C3 (A3 P3-6): the browser-chrome tint was a single raw #e11d48 —
 * a rose hex that matches NEITHER theme's --primary (dark 348 80% 48% /
 * light 348 80% 46%). Two media-scoped values keep both entries inside
 * the brand ramp and follow the OS color scheme; browsers that ignore
 * `media` on theme-color fall back to the first (dark) tag — the app's
 * default theme. */
const THEME_COLOR_DARK = "#dc1840"; // hsl(348 80% 48%) — :root --primary
const THEME_COLOR_LIGHT = "#d3173d"; // hsl(348 80% 46%) — .light --primary

/** Ownership epoch — 0 means "no page-level SEO active". */
let pageOwnerEpoch = 0;
const fallbackListeners = new Set<() => void>();

function notifyFallback(): void {
  for (const fn of fallbackListeners) fn();
}

function getAppOrigin(): string {
  // Vite-injected build-time origin, falling back to runtime origin.
  const fromEnv = (import.meta.env.VITE_APP_ORIGIN as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location) return window.location.origin;
  return "https://subnation.ly";
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)).trim() + "…";
}

function upsertMeta(
  selector: string,
  attr: "name" | "property",
  key: string,
  content: string,
  media?: string,
): void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    if (media) el.setAttribute("media", media);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function setTitle(title: string): void {
  document.title = title;
  // Collapse any duplicate <title> elements (the static index.html one
  // plus whatever history left behind) — only the first is honored.
  const titles = document.head.querySelectorAll("title");
  titles.forEach((t, i) => {
    if (i > 0) t.remove();
  });
}

/**
 * Renders the canonical SEO `<head>` block for a route.
 */
export function MetaTags(input: Omit<SeoInput, "jsonLd">): null {
  const origin = getAppOrigin();
  const url = `${origin}${input.path.startsWith("/") ? input.path : "/" + input.path}`;
  const image = input.image ?? `${origin}${DEFAULT_IMAGE}`;
  const lang = input.locale ?? "ar";
  const ogLocale = lang === "ar" ? "ar_LY" : "en_US";
  const ogLocaleAlt = lang === "ar" ? "en_US" : "ar_LY";
  const title = clamp(input.title.trim(), 60);
  const description = clamp(input.description.trim(), 160);
  const robots = input.robots ?? "index,follow";
  const ogType = input.type ?? "website";
  const isFallback = input.fallback === true;

  const apply = (): void => {
    setTitle(title);
    upsertMeta('meta[name="description"]', "name", "description", description);
    upsertMeta(
      'meta[name="viewport"]',
      "name",
      "viewport",
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
    upsertMeta('meta[name="theme-color"]:not([media])', "name", "theme-color", THEME_COLOR_DARK);
    upsertMeta(
      'meta[name="theme-color"][media="(prefers-color-scheme: light)"]',
      "name",
      "theme-color",
      THEME_COLOR_LIGHT,
      "(prefers-color-scheme: light)",
    );
    upsertMeta('meta[name="robots"]', "name", "robots", robots);
    upsertLink("canonical", url);

    upsertMeta('meta[property="og:title"]', "property", "og:title", title);
    upsertMeta('meta[property="og:description"]', "property", "og:description", description);
    upsertMeta('meta[property="og:type"]', "property", "og:type", ogType);
    upsertMeta('meta[property="og:url"]', "property", "og:url", url);
    upsertMeta('meta[property="og:image"]', "property", "og:image", image);
    upsertMeta('meta[property="og:locale"]', "property", "og:locale", ogLocale);
    upsertMeta('meta[property="og:locale:alternate"]', "property", "og:locale:alternate", ogLocaleAlt);
    upsertMeta('meta[property="og:site_name"]', "property", "og:site_name", "SubNation");

    upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    upsertMeta('meta[name="twitter:image"]', "name", "twitter:image", image);
  };

  useEffect(() => {
    if (isFallback) {
      // App-level default: apply only when no page-level SEO owns the
      // head; re-apply whenever a page-level block unmounts.
      const conditionalApply = () => {
        if (pageOwnerEpoch === 0) apply();
      };
      fallbackListeners.add(conditionalApply);
      conditionalApply();
      return () => {
        fallbackListeners.delete(conditionalApply);
      };
    }

    // Page-level: claim ownership and write. If another page-level block
    // mounts later (route change), it claims a newer epoch and ours
    // silently stops mattering.
    const epoch = ++pageOwnerEpoch;
    apply();
    return () => {
      if (pageOwnerEpoch === epoch) {
        pageOwnerEpoch = 0;
        notifyFallback();
      }
    };
  }, [title, description, url, image, robots, ogType, ogLocale, isFallback]);

  return null;
}
