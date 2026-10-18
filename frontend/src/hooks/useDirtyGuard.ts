import { useEffect } from "react";

/**
 * R98-05 (A5 §2 — dirty-state guard for long admin forms): registers a
 * `beforeunload` listener ONLY while the form is dirty, so a refresh /
 * tab close / OS-kill mid-edit asks the operator before silently
 * destroying a long Arabic description or a half-filled coupon form.
 *
 * Repo-wide there was ZERO beforeunload usage before this hook: every
 * guard on the long admin forms (settings / products editor / coupons /
 * promotions) protected the SUBMIT path (saving/disabled/confirm) but
 * never the LEAVE path — one stray sidebar click (full SPA unmount, no
 * prompt) or a refresh discarded everything with no question.
 *
 * What this hook deliberately does NOT cover (documented residual):
 *   - SPA route-leave interception (in-app navigation). Blocking wouter
 *     navigations requires a confirm choke point inside AdminLayout
 *     (module-level dirty flag + useConfirm), which is a UX decision
 *     deferred to a follow-up round — the browser-level guard already
 *     covers the destructive, data-loss-class cases (refresh/close).
 *
 * Usage (per page, `dirty` is any cheap boolean — manual field compare
 * or object identity vs the initial form constant):
 *
 *   useDirtyGuard(form !== EMPTY_FORM);
 *
 * The handler must call preventDefault() AND set returnValue for legacy
 * Chrome/Edge engines (spec: returnValue alone; Chrome: preventDefault
 * is what marks the event as cancelable; both together cover the matrix).
 */
export function useDirtyGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required by older Chrome/Edge to actually show the dialog.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
