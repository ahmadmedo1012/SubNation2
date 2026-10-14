/**
 * R134 (A3-F2): the shared Tab-trap helper — the exact NotificationBell
 * (R133 A4-F7) idiom, extracted so new dialog surfaces stop
 * hand-rolling a fourth local copy. aria-modal="true" means Tab
 * must cycle inside the container instead of walking into the occluded
 * page behind the scrim (WCAG 2.1.2).
 *
 * R146 (components audit F1): the three surviving local copies
 * (Navbar drawer, NotificationBell panel, admin layout/focus-trap)
 * folded onto this helper — it is React-free, so importing it drags
 * no admin shell into the storefront chunk.
 */
export function trapTabKey(
  container: HTMLElement,
  e: { key: string; shiftKey: boolean; preventDefault(): void },
): void {
  if (e.key !== "Tab") return;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (focusables.length === 0) return;
  const current = document.activeElement as HTMLElement | null;
  const idx = current ? focusables.indexOf(current) : -1;
  e.preventDefault();
  const next = e.shiftKey
    ? idx <= 0
      ? focusables.length - 1
      : idx - 1
    : idx === -1 || idx === focusables.length - 1
      ? 0
      : idx + 1;
  focusables[next].focus();
}
