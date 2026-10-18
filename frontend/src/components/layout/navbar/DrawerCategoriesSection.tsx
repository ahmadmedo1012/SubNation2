import { Link } from "wouter";
import { DRAWER_CATEGORIES } from "./drawer-data";

// R167 (layout decomposition): extracted verbatim from
// components/layout/Navbar.tsx — the «الفئات» section BOTH drawers
// render (it was already a factored local component; the move only adds
// its own module). The header keeps the drawers' shared machinery
// (drawerRef, Esc/Tab trap, focus move-in/return, the body scroll lock)
// and renders the two drawer extracts; this section is their shared
// middle — one source for the shortcuts + العروض. The move only changes
// the component's address — zero behavior, zero markup change.

/**
 * R135 (FE-1): the «الفئات» section BOTH drawers render — factored out of
 * the guest drawer's inline markup (R120-B1/A3-F1) so the authed variant
 * carries the category shortcuts + العروض from ONE source instead of a
 * hand-copied twin (the R134-A2-F1 lesson: parallel tables drift). The
 * output is element-for-element identical to the former inline guest JSX.
 */
export function DrawerCategoriesSection() {
  return (
    <>
      {/* R124-A3 #3: full token — the /80 alpha measured 4.14:1 in
          light mode (sub-AA for the 11px bold label); full
          --muted-foreground measures 6.67:1 (light) / 8.03:1 (dark). */}
      <div className="px-4 pt-1 pb-0.5 text-3xs font-bold text-muted-foreground">الفئات</div>
      <div className="grid grid-cols-2 gap-x-2">
        {DRAWER_CATEGORIES.map((c) => (
          <Link
            key={c.slug}
            href={`/category/${c.slug}`}
            className="flex items-center px-4 py-2.5 min-h-11 rounded-2xl text-sm font-semibold hover:bg-secondary/60 transition-colors"
          >
            {c.label}
          </Link>
        ))}
        <Link
          href="/flash-sales"
          className="flex items-center px-4 py-2.5 min-h-11 rounded-2xl text-sm font-semibold text-status-warning hover:bg-status-warning/10 transition-colors"
        >
          العروض
        </Link>
      </div>
      <div className="h-px bg-border/25 my-1" aria-hidden="true" />
    </>
  );
}
