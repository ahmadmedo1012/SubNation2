import { CheckCircle, Clock, XCircle } from "lucide-react";
import { ProductCardShell } from "@/components/ui/route-skeleton";

// R136 (FE-3 decomposition): extracted verbatim from pages/home.tsx —
// the page's two shared presentation primitives. ProductSkeleton feeds
// the products-grid loading state; OrderStatusIcon feeds the recent-
// orders strip rows. Zero props, zero state — the move only changes
// their address (the sibling extracts import them; DOM and classes are
// byte-identical).

export function ProductSkeleton() {
  return <ProductCardShell />;
}

export function OrderStatusIcon({ status }: { status: string }) {
  // R94-A1 #5 (P2, WCAG AA): raw -400 shades measured 1.53–2.54:1 on
  // white cards in the light theme — the shared --status-* tokens are
  // theme-aware and tonally correct on card surfaces.
  if (status === "completed") return <CheckCircle className="w-3 h-3 text-status-success" />;
  if (status === "failed" || status === "refunded")
    return <XCircle className="w-3 h-3 text-status-error" />;
  return <Clock className="w-3 h-3 text-status-warning" />;
}
