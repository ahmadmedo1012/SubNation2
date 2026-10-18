import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown } from "lucide-react";
import { DRAWER_CATEGORIES } from "./drawer-data";

// R167 (layout decomposition): extracted verbatim from
// components/layout/Navbar.tsx — the desktop «الأقسام» disclosure. A
// self-contained FEATURE component in the GlobalSearch (R137) precedent:
// its open flag, its two refs and its three dismissal effects (route
// change / pointer-outside / ESC-with-focus-return) are disclosure-LOCAL
// (nothing else in the header reads them), so it moves as a unit with
// its own hooks and subscribes to the location itself for the
// active-category highlight; the header renders it inline in the desktop
// nav. The move only changes the disclosure's address — zero behavior,
// zero markup change (the navbar-desktop-categories render pins follow
// this surface).

export function DesktopCategoriesMenu() {
  // R132 (L2-F4): the desktop categories dropdown — the one desktop nav
  // surface that had NO category entry point (the hero brand chips and
  // the footer were the only paths to /category/* pages; mobile had the
  // drawer's shortcuts since R120-B1). A disclosure popover over the
  // same DRAWER_CATEGORIES data.
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const catMenuRef = useRef<HTMLDivElement>(null);
  const catMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [location] = useLocation();

  // R132 (L2-F4): the categories dropdown closes on route change too —
  // navigating via one of its links must not leave an open popover
  // behind over the new page.
  useEffect(() => {
    setCatMenuOpen(false);
  }, [location]);

  // R132 (L2-F4): click/pointer-outside closes the dropdown (the
  // wrapper contains the trigger + panel, so any target outside it is
  // outside the disclosure). passive pointerdown — no preventDefault.
  useEffect(() => {
    if (!catMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (catMenuRef.current && !catMenuRef.current.contains(e.target as Node)) {
        setCatMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [catMenuOpen]);

  // R132 (L2-F4): ESC closes the dropdown and returns focus to its
  // trigger (the disclosure contract — same as the drawer's ESC above,
  // minus the modal machinery since this popover is non-modal).
  useEffect(() => {
    if (!catMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCatMenuOpen(false);
        catMenuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [catMenuOpen]);

  return (
    <div ref={catMenuRef} className="relative">
      <button
        ref={catMenuButtonRef}
        type="button"
        aria-expanded={catMenuOpen}
        aria-haspopup="true"
        aria-controls="desktop-categories-menu"
        onClick={() => setCatMenuOpen((v) => !v)}
        className={`relative px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150 flex items-center gap-1 ${
          catMenuOpen || location.startsWith("/category/")
            ? "text-primary-text font-bold"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
        }`}
      >
        الأقسام
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200 ${catMenuOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {catMenuOpen && (
        <div
          id="desktop-categories-menu"
          /* R138 (visual — chrome consistency): the menu's ghost-card
             pairing (near-invisible border/60 under shadow-xl
             shadow-black/20 — raw black forced on light mode) is the
             exact pairing R124-A3 #10 deleted from the bell panel in
             this same header row; it now rides the repo's defensible
             dropdown recipe (visible border/70 + theme-toned
             shadow-sm) so the two desktop popovers read as one
             family. Geometry (top-full/start-0/z-50/float-in) is
             untouched. */
          className="absolute top-full mt-2 start-0 z-50 min-w-[190px] bg-card border border-border/70 rounded-xl shadow-sm py-2 float-in"
        >
          {DRAWER_CATEGORIES.map((c) => {
            const active = location === `/category/${c.slug}`;
            return (
              <Link
                key={c.slug}
                href={`/category/${c.slug}`}
                aria-current={active ? "page" : undefined}
                className={`flex items-center px-4 py-2.5 min-h-11 rounded-lg mx-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? "text-primary-text bg-primary/8 font-bold"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
