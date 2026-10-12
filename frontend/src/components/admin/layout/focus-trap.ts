// R137 (1-f decomposition): extracted verbatim from pages/admin/layout.tsx —
// the minimal Tab-cycle focus trap shared by the admin shell's two modal
// surfaces (the GlobalSearch palette and the mobile nav drawer). React-free
// DOM utility; the move only changes its address, zero behavior change.

/**
 * R125 (A6 B-9 + B-15): minimal Tab-cycle focus trap, shared by the
 * GlobalSearch palette and the mobile nav drawer. Both claim
 * role="dialog" aria-modal="true", and before this helper neither
 * enforced it — Tab walked out of the "modal" into the page behind
 * (WCAG 2.1.2). Only Tab/Shift+Tab are intercepted; every other key
 * is left to the surface's own handlers.
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
