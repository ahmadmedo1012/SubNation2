// R137 (1-f decomposition): the admin shell's Tab-cycle focus trap —
// a verbatim re-export of the shared React-free helper (lib/a11y — the
// R146 components-audit F1 fold; the local body was byte-identical to
// it). Pure DOM utility: the move only changes its address, zero
// behavior change. Consumers: pages/admin/layout.tsx (the mobile nav
// drawer) and GlobalSearch.tsx (the ⌘K palette).
export { trapTabKey } from "@/lib/a11y/trap-tab-key";
