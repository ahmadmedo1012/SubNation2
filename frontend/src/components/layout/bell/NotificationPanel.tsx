import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, RefreshCw, X } from "lucide-react";
import { trapTabKey } from "@/lib/a11y/trap-tab-key";
import type { Notif } from "@/hooks/useNotifications";
import { NotificationRow } from "./NotificationRow";
import { PanelFooter } from "./PanelFooter";

// R167 (layout decomposition): extracted verbatim from
// components/layout/NotificationBell.tsx — the portal'd panel: the
// vw/resize geometry + focus-return contract, the header (mark-all
// + close), the R153 tri-state body (loading / error / ok) and the
// footer mount. A self-contained FEATURE component in the GlobalSearch
// (R137) precedent: its vw state + focus refs are overlay-LOCAL (read
// by nothing outside the dialog), so it moves as a unit with its own
// hooks; the bell owns only the open flag + the data callbacks and
// passes them down. The per-item row and the footer link live in their
// own extracts (NotificationRow / PanelFooter). The move only changes
// the panel's address — zero behavior, zero markup change (the
// notification-bell-panel / markread / error-state-r153 render pins
// follow this surface).

/**
 * R133 (A4-F7): the Tab half of the aria-modal promise — the shared
 * React-free helper (lib/a11y/trap-tab-key; R146 components-audit F1
 * folded the local copy onto it, the body was byte-identical).
 * role="dialog" pairs with aria-modal="true", so Tab must cycle inside
 * the panel instead of walking into the page behind it (WCAG 2.1.2).
 */

export function NotificationPanel({
  notifs,
  unread,
  loadState,
  onRetry,
  onClose,
  onMarkAllRead,
  onMarkRead,
  onAction,
  anchorRect,
}: {
  notifs: Notif[];
  unread: number;
  loadState: "loading" | "ok" | "error";
  onRetry: () => void;
  onClose: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: number) => void;
  onAction: (n: Notif, href: string) => void;
  anchorRect: DOMRect | null;
}) {
  // ── Positioning ────────────────────────────────────────────────────────
  // Mobile (vw < 480): full-width, fixed below the top bar (top: 56px).
  // Desktop: anchored to the right edge of the bell button. We compute the
  // anchor position once on mount and don't react to window resize — opening
  // the panel during resize is a non-event we don't need to optimize.
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const isMobile = vw < 480;

  // 96-F5 (R96-M08 + M02 + M16): the mobile panel used to sit at a
  // hard-coded top: 56 with NO maxHeight. In the installed PWA
  // (black-translucent) the Navbar header now grows by
  // env(safe-area-inset-top), so 56 was wrong by exactly that inset —
  // and a long list ran past the viewport with the bottom rows
  // unreachable (position: fixed ignores page scroll). Derive the
  // offset from the header's REAL bottom edge (measured live from the
  // marker attribute Navbar sets) and cap the panel with a dvh-based
  // maxHeight so the body's overflow-y-auto actually engages.
  const headerEl =
    typeof document !== "undefined"
      ? document.querySelector<HTMLElement>('[data-navbar-header="1"]')
      : null;
  const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 56;

  // Compute panel position. On mobile we ignore anchorRect.
  // On desktop we right-align under the button, clamped 8px inside viewport.
  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        // 8px breathing gap below the real header bottom (safe-area
        // aware in PWA mode; 56 + inset + 8 in browser mode).
        top: headerBottom + 8,
        left: 8,
        right: 8,
        // 96-F5 (R96-M02): cap = viewport − header − 8px top gap − 8px
        // bottom gap, in dvh so the iOS URL-bar resize can't leave
        // rows below the fold. The flex-1 body then scrolls internally.
        maxHeight: `calc(100dvh - ${headerBottom + 16}px)`,
      }
    : (() => {
        const top = (anchorRect?.bottom ?? 56) + 8;
        // RTL anchoring: in this app the bell sits in the Navbar actions
        // cluster on the LEFT side of the screen (inline-end in RTL), so
        // a right-edge-anchored panel that grows leftward extends past
        // the left viewport edge and gets clipped on 480–1300px screens.
        // Anchor the panel's LEFT edge to the bell's left edge instead
        // (grows rightward, toward the reading flow origin), and clamp
        // so a narrow viewport can still fit a (shrunk) panel.
        const leftEdge = anchorRect?.left ?? 8;
        const width = Math.min(360, vw - leftEdge - 8);
        const left = Math.max(8, Math.min(leftEdge, vw - width - 8));
        return {
          position: "fixed",
          top,
          left,
          width,
          // R120-B1 (A3-F7): dvh straggler — the mobile branch above is
          // 100dvh; 100vh here overshot by the browser chrome on
          // dynamic-toolbar viewports, pushing the last rows under the
          // URL bar.
          maxHeight: `calc(100dvh - ${top + 16}px)`,
        };
      })();

  // C3 (V2 a11y audit): the portal'd panel is mounted at the END of
  // document.body — keyboard focus stays on the bell and Tab walks the
  // whole page before reaching the dialog. Move focus INTO the panel on
  // mount so the dialog is immediately operable (role="dialog" already
  // set below); Escape still closes it via the outer key handler.
  //
  // R133 (A4-F7): the OTHER half of the dialog contract — the bell
  // button (the invoker) is captured BEFORE focus moves in, and every
  // close path (X, Escape, outside-click) unmounts the panel whose
  // cleanup returns focus to the bell instead of dropping the keyboard
  // user onto <body> (the admin shell palette idiom, layout.tsx
  // returnFocusRef).
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, []);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      data-notification-panel="1"
      /* R124-A3 #10 (declare elevation once): the ghost-card pairing
         (near-invisible border/60 under a wide double shadow) is gone —
         the panel now rides the repo's defensible pairing (visible
         border + small shadow, same as ProductCard/Input/MobileNav).
         R115 (A10 a11y tail): z-50 keeps the panel INSIDE the modal
         layer instead of the old inline zIndex:70, which made it bleed
         above every Radix dialog (also z-50) — DOM order (this portal
         mounts at body end) still paints it above the Navbar. */
      className="bg-card border border-border/70 rounded-2xl shadow-sm overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 outline-none z-50"
      style={panelStyle}
      role="dialog"
      /* R133 (A4-F7): aria-modal completes the role="dialog" contract
         (the outside-click + Esc closes already behave modally); the
         onKeyDown trap keeps Tab inside — see the shared trapTabKey helper. */
      aria-modal="true"
      aria-label="الإشعارات"
      onKeyDown={(e) => {
        if (panelRef.current) trapTabKey(panelRef.current, e);
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/20 shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-bold text-sm">الإشعارات</span>
          {unread > 0 && (
            <span className="bg-primary text-primary-foreground text-3xs font-bold px-1.5 py-0.5 rounded-full leading-none">
              {unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {unread > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="-my-2 flex items-center gap-1.5 touch-target text-xs text-muted-foreground hover:text-primary-text transition-colors px-2.5 py-1.5 rounded-lg hover:bg-primary/8 press-spring"
            >
              <CheckCheck className="w-3 h-3" />
              {/* 93-C8 (A11 §2): unified mark-as-read verb. */}
              تحديد الكل كمقروء
            </button>
          )}
          {/* 94-C3 (A3 P1-3): 26×26 → 44×44 hit box; -my-2 keeps the
              header row from growing. */}
          <button
            type="button"
            onClick={onClose}
            className="-my-2 flex h-11 w-11 items-center justify-center touch-target p-1.5 rounded-lg hover:bg-secondary/70 text-muted-foreground hover:text-foreground transition-colors press-spring"
            aria-label="إغلاق"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body — R153: the tri-state (loading / error / ok) replaces the
          unconditional empty-hero: a first-load or outage previously
          rendered «لا توجد إشعارات» — false information in both cases. */}
      {loadState === "loading" && notifs.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground" role="status">
          <div className="relative w-14 h-14 mx-auto mb-3">
            <div className="absolute inset-0 rounded-2xl bg-muted/50 blur-sm animate-pulse" />
            <div className="relative w-14 h-14 rounded-2xl bg-muted/40 border border-border/30 flex items-center justify-center">
              <Bell className="w-6 h-6 opacity-20" />
            </div>
          </div>
          <p className="text-sm font-bold text-foreground/60 mb-0.5">جارٍ تحميل الإشعارات…</p>
          <p className="text-xs text-muted-foreground">لحظات وتظهر آخر التحديثات</p>
        </div>
      ) : loadState === "error" && notifs.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground" role="alert">
          <div className="relative w-14 h-14 mx-auto mb-3">
            <div className="absolute inset-0 rounded-2xl bg-destructive/10 blur-sm" />
            <div className="relative w-14 h-14 rounded-2xl bg-destructive/5 border border-destructive/20 flex items-center justify-center">
              <Bell className="w-6 h-6 text-destructive/70" />
            </div>
          </div>
          <p className="text-sm font-bold text-foreground/60 mb-0.5">تعذّر تحميل الإشعارات</p>
          <p className="text-xs text-muted-foreground mb-3">حدث خطأ في الاتصال — تحقّق من شبكتك</p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center gap-1.5 text-xs font-bold px-4 rounded-lg border border-border/60 hover:border-border transition-colors press-spring"
          >
            <RefreshCw className="w-3 h-3" />
            إعادة المحاولة
          </button>
        </div>
      ) : notifs.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <div className="relative w-14 h-14 mx-auto mb-3">
            <div className="absolute inset-0 rounded-2xl bg-muted/50 blur-sm" />
            <div className="relative w-14 h-14 rounded-2xl bg-muted/40 border border-border/30 flex items-center justify-center">
              <Bell className="w-6 h-6 opacity-20" />
            </div>
          </div>
          <p className="text-sm font-bold text-foreground/60 mb-0.5">لا توجد إشعارات</p>
          <p className="text-xs text-muted-foreground">ستظهر هنا آخر التحديثات</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/25 scrollbar-none">
          {notifs.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              onMarkRead={onMarkRead}
              onClose={onClose}
              onAction={onAction}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      {notifs.length > 0 && <PanelFooter count={notifs.length} onClose={onClose} />}
    </div>
  );
}
