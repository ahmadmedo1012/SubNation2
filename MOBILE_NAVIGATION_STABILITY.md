# Mobile Navigation Stability

Companion to `UI_DIRECTION_FIX_REPORT.md`. Specifically explains why the
mobile bottom navigation was inverting and what to expect after the fix.

## 1. Why the bottom nav was inverting

`frontend/src/components/layout/MobileNav.tsx` lays its links out as a
horizontal flex row:

```tsx
<nav className="flex justify-around items-center ...">
  <Link>...</Link>
  <Link>...</Link>
  <Link>...</Link>
  <Link>...</Link>
</nav>
```

CSS `flex-direction: row` reads **inline-start to inline-end**, which
means:

- When `<html dir="rtl">` is active → first child is on the **right**,
  last child on the **left**. Correct for an Arabic UI.
- When `<html dir="ltr">` (or `dir=""`) is active → first child is on
  the left, last child on the right. **Mirrored** vs the design.

The previous helmet bug (see `UI_DIRECTION_FIX_REPORT.md` §2) was
stripping `<html dir>` on every navigation away from a SEO-aware route
(`/`, `/product/:id`). For the duration of that strip, the bottom nav
re-rendered LTR — visually swapping its children left-to-right.

The user-visible symptom matches exactly: "bottom mobile navigation
becomes inverted/swapped unexpectedly".

## 2. What changed

Nothing in `MobileNav.tsx` itself. The fix is upstream — `<html dir>`
is now locked at App boot and never stripped. The bottom nav's flex
layout naturally reads RTL because the document is RTL.

This is the right design: **the navigation doesn't know or care about
direction**, it just lays its children inline. The document tells it
which way "inline" means. Centralising direction control means the nav
can be modified, themed, animated, or replaced without re-introducing
the bug.

## 3. Touch target safety preserved

The Phase-1 mobile UX work (touch targets ≥ 44 px, `viewport-fit=cover`,
safe-area inset padding via `mobile-nav-safe-pad`) is unchanged. We
didn't touch:

- `MobileNav.tsx`
- `Navbar.tsx`
- `frontend/src/index.css` mobile rules
- `vite-plugin-pwa` manifest icons

## 4. Smoke test — Android Chrome

```
1. Open https://subnation.ly/ on an Arabic-locale Android phone.
2. Confirm: bottom nav order from RIGHT to LEFT reads:
   [home]  [products]  [orders]  [wallet]  [profile]
   (or whatever your current order is — point is: stable).
3. Tap each tab in order. Direction must not flip during transitions.
4. Background the app, foreground it (Android task switcher). Direction
   must persist.
5. Hard-refresh the page (pull-to-refresh). Direction must be RTL on
   the very first paint (no flash of LTR).
```

## 5. Edge cases handled

- **Cold cache + slow JS load.** `index.html` ships with
  `<html lang="ar" dir="rtl">` so even before main.tsx runs, the document
  is RTL. The synchronous `applyDocumentDirection("ar")` in main.tsx
  re-affirms this before React hydrates.
- **Service-worker pre-cached HTML.** Same — the cached `index.html`
  carries the correct attribute.
- **Deep-linked product page.** `/product/42` mounts `MetaTags`, but
  `MetaTags` no longer declares `<html dir>`, so the document direction
  is set by the index.html / boot path, never by the route.
- **Back/forward navigation through history.** The browser doesn't
  re-execute `index.html` on history navigation, but it ALSO doesn't
  re-execute helmet's onUnmount logic during back/forward — so even if
  the old bug were present, history nav would not be the trigger. With
  the fix, nothing about back/forward is special.

## 6. Animations and transitions

We don't use Framer Motion or CSS transitions on layout properties for
the mobile nav. The order is set by the DOM order + flex direction; no
animation hides or re-orders children. So a fix to direction stability
also stabilises the nav's *visual* stability — there's no animation that
could fight the new order.

If a future PR adds page-transition animations (e.g. slide-in for route
change), they should:

1. Use `transform: translateX(-100%)` on the OUTGOING page, not on the
   document or `<body>`.
2. Respect logical inset start/end so the animation direction matches
   the document direction automatically (`transform-style: preserve-3d`
   doesn't matter; `translateX` with `dir`-aware sign is what matters).
3. Not modify `<html dir>` for any reason. Even briefly.

## 7. Related layout invariants you should preserve

- The Navbar, FlashSaleBanner, Footer, and MobileNav use `flex` and
  `grid` with logical Tailwind utilities. Don't introduce
  physical-direction utilities (`ml-`, `mr-`, `text-left`) on these
  components.
- The PWA manifest has `"dir": "rtl"` and `"lang": "ar"`. Keep these
  matched with the app's actual default — they affect the install
  prompt's UI direction.
- `frontend/src/index.css` has a `.scroll-fade-rtl` and
  `.scroll-fade-rtl-start` rule. These rely on `[dir="rtl"]` selectors
  resolving correctly. The fix preserves that.

## 8. Performance impact

Zero. The fix only:

1. Removed one Helmet declaration (saves a microscopic amount of
   helmet processing on every page mount/unmount).
2. Added one synchronous `documentElement.dir = "rtl"` write at boot
   (no-op when the value already matches, which it does since
   index.html already declared it).
3. Added one `useEffect` at App root that runs once.

Bundle impact: ~0.4 KB raw uncompressed for `lib/direction.ts`. Index
chunk before fix: 21,690 B gzip. After fix: 21,696 B gzip. Within noise.
