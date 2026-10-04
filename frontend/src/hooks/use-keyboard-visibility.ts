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
    const onResize = () => {
      if (vv.height >= baseline) {
        // Grew back (keyboard closed / rotated to a taller viewport) —
        // re-anchor and restore.
        baseline = vv.height;
        setKeyboardVisible(false);
        return;
      }
      setKeyboardVisible(baseline - vv.height > 120);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  return keyboardVisible;
}
