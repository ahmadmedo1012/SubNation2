// R117 (F-4): one-shot suppression for programmatic URL rewrites.
//
// product.tsx rewrites legacy numeric product URLs (/product/123) to the
// canonical slug form (/product/slug) via history.replaceState. wouter
// 3.9 monkey-patches replaceState and emits a location change for it, so
// the rewrite re-fired ScrollToTop's window.scrollTo(0,0) + the R116
// #main-content.focus() — a user who had scrolled/started reading while
// the by-id fetch resolved got snapped to top and their focus yanked.
//
// A module-level one-shot flag set IMMEDIATELY BEFORE the rewrite is the
// narrowest fix: ScrollToTop consumes (and clears) it on its next effect
// run, suppressing exactly one reset. It is guarded by a same-URL check
// at the call site so a no-op rewrite never arms the flag for an
// unrelated later navigation.

let quietNextScrollReset = false;

/** Arm the one-shot suppression. Call immediately before the
 *  history.replaceState that should not count as a navigation. */
export function quietNextScrollToTopReset(): void {
  quietNextScrollReset = true;
}

/** Consume the armed suppression (if any). Returns true exactly once per
 *  arm. ScrollToTop calls this at the top of its effect. */
export function consumeQuietScrollToTopReset(): boolean {
  if (!quietNextScrollReset) return false;
  quietNextScrollReset = false;
  return true;
}
