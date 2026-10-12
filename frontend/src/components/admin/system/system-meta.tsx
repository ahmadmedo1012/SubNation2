import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { CheckStatus } from "@/lib/healthz";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the health-status tone map (ink + tint + border + Arabic label + icon
// per CheckStatus). The page (aggregate pill, scheduler banners) and every
// admin/system extract import from here — one source for the status
// vocabulary; the move only changes its address, zero behavior change.

// ── Visual helpers (reuse existing design tokens) ──────────────────────────
// R128 (A1-D1/F1): this page carried the admin console's largest raw-palette
// map set (81 lines) — every -400 ink on its /10 tint measured 1.47-2.51:1
// in the LIGHT admin theme. All hue classes now ride the theme-aware
// --status-* tokens (emerald→success, red→error, blue/cyan→info,
// orange→low-stock, yellow/amber→warning, violet/purple→status-purple);
// alphas were preserved byte-for-byte, so the DEFAULT dark theme is visually
// near-identical (the tokens' dark values sit within a hair of the raw -400s).

export const STATUS_META: Record<
  CheckStatus,
  { color: string; bg: string; border: string; label: string; icon: typeof CheckCircle2 }
> = {
  ok: {
    color: "text-status-success",
    bg: "bg-status-success/10",
    border: "border-status-success/20",
    label: "متاح",
    icon: CheckCircle2,
  },
  degraded: {
    // R126-L5 (A3 item-10): the degraded cluster rides the
    // --status-warning ink+tint pair — yellow-400 fails the light theme
    // (1.43-1.53:1, A3's figures); the token is AA both themes (6.04:1
    // on white / 5.09:1 on the /12 tint light, index.css F3-06). This
    // cluster feeds the page's core degraded-health value + the two
    // scheduler banners — the operator's most important warning state.
    color: "text-status-warning",
    bg: "bg-status-warning/10",
    border: "border-status-warning/20",
    label: "متدنٍ",
    icon: AlertTriangle,
  },
  failing: {
    color: "text-status-error",
    bg: "bg-status-error/10",
    border: "border-status-error/20",
    label: "خلل",
    icon: XCircle,
  },
};

/** One cluster of the tone map (what STATUS_META[tone] hands consumers). */
export type StatusMetaEntry = (typeof STATUS_META)[CheckStatus];
