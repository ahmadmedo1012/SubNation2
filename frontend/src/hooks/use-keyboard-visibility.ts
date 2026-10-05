import { useEffect, useState } from "react";

/**
 * R116-S2 (P2): virtual-keyboard visibility via window.visualViewport.
 *
 * Same detection strategy as MobileNav (96-F5 / R96 P2-3 — do NOT edit
 * that component): a drop of >120px from the anchored baseline means a
 * keyboard is covering the viewport. Growing back re-anchors the
 * baseline and restores the element. Extracted into a hook so other
 * fixed/sticky bottom surfaces (the product page's sticky buy bar) can
 * share the exact same thresholds without duplicating the listener.
 *
 * Consumers should pair this with the no-JS CSS fallback
 * `[@media(max-height:480px)]:hidden` (short viewports / keyboard
 * resize layouts that never fire visualViewport — jsdom included).
 *
 * Returns `false` in runtimes without visualViewport (jsdom, old
 * browsers) — the CSS fallback carries those cases.
 */
export function useKeyboardVisibility(): boolean {
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return; // jsdom / old browsers — CSS fallback still applies
    let baseline = vv.height;
    const reanchor = () => {
      baseline = vv.height;
      setKeyboardVisible(false);
    };
    const onResize = () => {
      if (vv.height >= baseline) {
        // Grew back (keyboard closed / rotated to a taller viewport) —
        // re-anchor and restore.
        reanchor();
        return;
      }
      setKeyboardVisible(baseline - vv.height > 120);
    };
    // R117 (F-7): a >120px shrink that is NOT a keyboard (portrait →
    // landscape on a tablet: 1024 → 768) used to latch
    // keyboardVisible=true forever — the baseline could only re-anchor
    // on GROWTH past the stale value, which landscape never does.
    // orientationchange fires after the rotation settles: re-anchor
    // there too, so a rotation is never mistaken for a held keyboard.
    // (visualViewport resize + orientationchange both firing is fine —
    // re-anchor is idempotent.)
    const onOrientationChange = () => {
      // Defer one frame: visualViewport settles a tick AFTER the
      // orientation event on some engines.
      requestAnimationFrame(reanchor);
    };
    vv.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientationChange);
    return () => {
      vv.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientationChange);
    };
  }, []);

  return keyboardVisible;
}
