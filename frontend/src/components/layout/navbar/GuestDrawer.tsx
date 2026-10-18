import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import type { RefObject } from "react";
import { DrawerCategoriesSection } from "./DrawerCategoriesSection";
import { DRAWER_SCROLL_CAP } from "./drawer-data";

// R167 (layout decomposition): extracted verbatim from
// components/layout/Navbar.tsx — the guest drawer panel (id="guest-menu").
// The header keeps the drawers' shared machinery (drawerRef, the R126
// A13-F2 Esc/Tab trap + move-in/focus-return effects, the R120-B1 body
// scroll lock, the route-change close) and the {!token && open && …}
// mount guard; this extract takes the shared drawerRef and renders the
// panel. The move only changes the panel's address — zero behavior,
// zero markup change (the navbar-guest-drawer-a11y render pins follow
// this surface).

export function GuestDrawer({ drawerRef }: { drawerRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      id="guest-menu"
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label="القائمة"
      tabIndex={-1}
      className={`md:hidden border-t border-border/50 bg-card px-4 py-3 space-y-1 float-in ${DRAWER_SCROLL_CAP}`}
    >
      {/* R135 (FE-1): the category shortcuts + العروض + divider render
          from the shared DrawerCategoriesSection — one source for both
          drawers (see its note); element-for-element the former inline
          markup, so the guest flow is unchanged. */}
      <DrawerCategoriesSection />
      <Link
        href="/support"
        className="flex items-center px-4 py-3 rounded-2xl text-sm font-semibold hover:bg-secondary/60 transition-colors min-h-[48px]"
      >
        الدعم الفني
      </Link>
      <Link
        href="/login"
        className="flex items-center px-4 py-3 rounded-2xl text-sm font-semibold hover:bg-secondary/60 transition-colors min-h-[48px]"
      >
        تسجيل الدخول
      </Link>
      <Link
        href="/register"
        className="flex items-center px-4 py-3 rounded-2xl text-sm font-bold text-primary-text bg-primary/8 hover:bg-primary/14 transition-colors min-h-[48px]"
      >
        {/* B6-P2-1: the last remaining text-glyph arrow — replaced with
            the same inline ChevronLeft idiom the icon-audit rows
            (#14/#19, category.tsx) standardized on. Forward = LEFT in
            RTL, and a glyph can bidi-reposition inside mixed runs. */}
        إنشاء حساب مجاني <ChevronLeft className="w-3 h-3 inline" />
      </Link>
    </div>
  );
}
