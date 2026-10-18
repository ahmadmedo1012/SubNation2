import {
  ArrowLeft,
  ExternalLink,
  Info,
  MessageSquare,
  Package,
  ShoppingBag,
  Star,
  Wallet,
} from "lucide-react";

// R167 (layout decomposition): extracted verbatim from
// components/layout/NotificationBell.tsx — the per-type presentation
// table for notification rows. Pure DATA (icon references + class
// tokens, no JSX), so it rides the nav-sections.ts idiom (the R137
// admin-layout precedent: a React-free module any lane can import).
// The public ADDRESS survives unchanged: NotificationBell.tsx
// re-exports TYPE_CONFIG (the NAV_SECTIONS re-export idiom), so
// `import { TYPE_CONFIG } from "@/components/layout/NotificationBell"`
// (status-tokens.test.tsx + pages/notifications.tsx) still resolves.
// The move only changes the table's home — zero behavior, zero markup
// change (the status-token pins follow the surface).

/**
 * Per-type presentation config for notification rows. Exported for the
 * status-token regression test (status-tokens.test.tsx).
 *
 * Colors ride the shared `--status-*` tokens (B6-P1-4): the previous
 * raw emerald/blue/purple/yellow Tailwind tuples were dark-mode-tuned
 * only — in the light theme they mis-tinted (too pale for AA contrast)
 * and bypassed the palette that status-badge/statusColor already
 * establish. `--status-purple` (support) was added to index.css for this.
 */
export const TYPE_CONFIG: Record<
  string,
  {
    icon: React.ElementType;
    color: string;
    bg: string;
    border: string;
    actionLabel?: string;
    actionIcon?: React.ElementType;
    actionHref?: string;
  }
> = {
  wallet: {
    icon: Wallet,
    color: "text-status-success",
    bg: "bg-status-success/10",
    border: "border-status-success/20",
    actionLabel: "المحفظة",
    actionIcon: ArrowLeft,
    actionHref: "/wallet",
  },
  order: {
    icon: ShoppingBag,
    color: "text-status-info",
    bg: "bg-status-info/10",
    border: "border-status-info/20",
    actionLabel: "تفاصيل الطلب",
    actionIcon: ExternalLink,
    // Fallback destination when a notification carries no deep link —
    // without it the action chip (and the row's open affordance)
    // silently disappears for link-less order notifications.
    actionHref: "/orders",
  },
  support: {
    icon: MessageSquare,
    color: "text-status-purple",
    bg: "bg-status-purple/10",
    border: "border-status-purple/20",
    actionLabel: "التذكرة",
    actionIcon: ArrowLeft,
    actionHref: "/support",
  },
  loyalty: {
    icon: Star,
    color: "text-status-warning",
    bg: "bg-status-warning/10",
    border: "border-status-warning/20",
    actionLabel: "نقاطي",
    actionIcon: ArrowLeft,
    actionHref: "/loyalty",
  },
  product: {
    icon: Package,
    // 94-C3 (A3 P2-4): text-primary → text-primary-text — the row icon
    // sits on a bg-primary/10 chip over a dark card; --primary (48%L) is
    // the surface variant, --primary-text (65%L) is the text/icon one.
    color: "text-primary-text",
    bg: "bg-primary/10",
    border: "border-primary/20",
    actionLabel: "تصفح",
    actionIcon: ArrowLeft,
    actionHref: "/",
  },
  system: {
    icon: Info,
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    border: "border-border/40",
  },
};
