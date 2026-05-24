import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * lazyWithRetry — drop-in replacement for React.lazy that recovers
 * from post-deploy stale-chunk failures.
 *
 * ── The problem ────────────────────────────────────────────────────
 * Vite emits hashed asset filenames (`wallet-CSHLfnYj.js`). When we
 * deploy a new build, every chunk's hash changes. A user who was on
 * the old `index.html` (cached by the browser, kept open in a tab,
 * or served by the service worker) still has references to the OLD
 * hashes. The moment they navigate to a route whose chunk was only
 * referenced by the old index.html, the dynamic `import()` 404s and
 * React surfaces it as:
 *
 *   TypeError: Failed to fetch dynamically imported module:
 *   https://subnation.ly/assets/wallet-<hash>.js
 *
 * It's the #1 source of post-deploy Sentry noise on any modern SPA.
 *
 * ── The fix ────────────────────────────────────────────────────────
 * On a chunk-load error, force a single full-page reload. The new
 * index.html arrives, references the new hashes, the user lands on
 * the route they wanted with no visible error. A sessionStorage
 * flag ensures we reload at most ONCE per pathname per session — if
 * the reload doesn't recover (genuine 404 unrelated to deploy drift),
 * the error bubbles to the ErrorBoundary and the user sees the
 * "حدث خطأ" screen as before.
 *
 * ── What we detect ─────────────────────────────────────────────────
 * Both Webpack and Vite stamp distinguishable error signatures on
 * chunk-load failures, but the messages drift across browsers:
 *
 *   - Vite (Chrome/Edge): "Failed to fetch dynamically imported module"
 *   - Vite (Firefox):     "Importing a module script failed"
 *   - Vite (Safari):      "Unable to preload CSS for ..."
 *                         "<URL> error loading dynamically imported module"
 *   - Webpack (legacy):   ChunkLoadError, "Loading chunk N failed"
 *
 * The matcher below covers every observed variant. False-positives
 * (an unrelated TypeError happening to mention these strings) would
 * only trigger ONE reload, then bubble — no infinite-loop risk.
 */

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Loading chunk \S+ failed/i,
  /ChunkLoadError/i,
];

function isChunkLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "ChunkLoadError") return true;
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(err.message));
}

const RELOAD_KEY_PREFIX = "sn:chunk-reload:";

/**
 * Wraps a dynamic-import factory so chunk-load failures auto-recover
 * via a single page reload. Use exactly like React.lazy:
 *
 *   const WalletPage = lazyWithRetry(() => import("@/pages/wallet"));
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (isChunkLoadError(err) && typeof window !== "undefined") {
        // sessionStorage scope: per-pathname so a chronic failure on
        // /wallet doesn't block reloads on /home etc. Cleared at tab
        // close, so a returning user gets a fresh recovery attempt.
        const key = RELOAD_KEY_PREFIX + window.location.pathname;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
          // React.lazy expects this promise to resolve eventually;
          // returning a never-settling promise is fine because the
          // page is unloading and we'll never read its result.
          return new Promise<{ default: T }>(() => {
            /* unreachable */
          });
        }
        // Already reloaded once and still broken — bubble up to the
        // ErrorBoundary which will show the generic recovery screen.
      }
      throw err;
    }
  });
}
