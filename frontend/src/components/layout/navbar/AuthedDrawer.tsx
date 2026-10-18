import { LogOut } from "lucide-react";
import { Link } from "wouter";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { DrawerCategoriesSection } from "./DrawerCategoriesSection";
import { AUTHED_DRAWER_LINKS, DRAWER_SCROLL_CAP } from "./drawer-data";

// R167 (layout decomposition): extracted verbatim from
// components/layout/Navbar.tsx — the authed drawer panel
// (id="authed-menu", the token complement of the guest twin). The
// header keeps the drawers' shared machinery (drawerRef, the R126
// A13-F2 Esc/Tab trap + move-in/focus-return effects, the R120-B1 body
// scroll lock, the route-change close) and the {token && open && …}
// mount guard; this extract takes the shared drawerRef + the close/
// logout callbacks and renders the panel. The move only changes the
// panel's address — zero behavior, zero markup change (the
// navbar-authed-drawer render pins follow this surface).

export function AuthedDrawer({
  drawerRef,
  setOpen,
  logout,
}: {
  drawerRef: RefObject<HTMLDivElement | null>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  logout: () => void;
}) {
  return (
    <div
      id="authed-menu"
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label="القائمة"
      tabIndex={-1}
      className={`md:hidden border-t border-border/50 bg-card px-4 py-3 space-y-1 float-in ${DRAWER_SCROLL_CAP}`}
    >
      {AUTHED_DRAWER_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold hover:bg-secondary/60 transition-colors min-h-[48px]"
        >
          <l.icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          {l.label}
        </Link>
      ))}
      <DrawerCategoriesSection />
      {/* R135 (FE-1): close BEFORE logout — setOpen(false) and the
          token teardown land in the same commit, so the guest drawer's
          `!token && open` render can never flash open mid-logout, and
          the shared close path restores body scroll + focus. logout
          itself is the desktop user-menu flow verbatim (the useAuth
          logout: fire-and-forget POST /api/auth/logout + local
          identity teardown). */}
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          logout();
        }}
        className="flex w-full items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-status-error hover:bg-status-error/10 transition-colors min-h-[48px]"
      >
        <LogOut className="w-4 h-4" aria-hidden="true" />
        تسجيل الخروج
      </button>
    </div>
  );
}
