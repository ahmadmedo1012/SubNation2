import {
  AlertCircle,
  CheckCircle,
  Clock,
  CreditCard,
  MessageSquare,
  Package,
  User,
  Wrench,
} from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/support.tsx —
// the ticket taxonomy shared by the page and its extracts: the category
// pills/badges map (CATEGORIES), the thread/list status map
// (STATUS_CONFIG) and the Ticket/TicketDetail response shapes. A .tsx
// meta module (the wallet topup-meta precedent) because STATUS_CONFIG
// carries rendered lucide glyphs. No state, no effects — pure data +
// pure render helpers; the page and the extracts import the same
// single source.

/* R124-I4 (A3 #15): the category picker/badges used emoji as icons
   (💳📦⚙️👤💬) — the page otherwise rides lucide. Same component-ref +
   stroke/size idiom as STATUS_CONFIG below. */
export const CATEGORIES = [
  { value: "billing", label: "الدفع والفواتير", icon: CreditCard },
  { value: "order", label: "الطلبات", icon: Package },
  { value: "technical", label: "مشكلة تقنية", icon: Wrench },
  { value: "account", label: "الحساب", icon: User },
  { value: "other", label: "أخرى", icon: MessageSquare },
];

export const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode; border: string }
> = {
  open: {
    label: "مفتوحة",
    // R94-A1 #5 (P2, WCAG AA): raw blue-400/yellow-400 on white cards
    // measured 2.54:1 / 1.53:1 in the light theme — the shared --status-*
    // tokens carry theme-aware values tuned for card surfaces.
    color: "text-status-info bg-status-info/10",
    icon: <Clock className="w-3 h-3" />,
    border: "border-status-info/25",
  },
  in_progress: {
    label: "قيد المعالجة",
    color: "text-status-warning bg-status-warning/10",
    icon: <AlertCircle className="w-3 h-3" />,
    border: "border-status-warning/25",
  },
  closed: {
    label: "مغلقة",
    color: "text-muted-foreground bg-muted/30",
    icon: <CheckCircle className="w-3 h-3" />,
    border: "border-border",
  },
};

export interface Ticket {
  id: number;
  title: string;
  category: string | null;
  status: string;
  created_at: string;
  last_reply: { author_type: string; message: string; created_at: string } | null;
}
export interface TicketDetail extends Ticket {
  replies: { id: number; author_type: string; message: string; created_at: string }[];
}

export function categoryLabel(cat: string | null) {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? "أخرى";
}
/** R124-I4 (A3 #15): renders the category's lucide icon at the
 * caller's stroke size (w-3 in the badges, w-3.5 in the pills) —
 * decorative, so aria-hidden like every icon-only glyph here. */
export function categoryIcon(cat: string | null, className = "w-3 h-3") {
  const Icon = CATEGORIES.find((c) => c.value === cat)?.icon ?? MessageSquare;
  return <Icon className={className} aria-hidden="true" />;
}
