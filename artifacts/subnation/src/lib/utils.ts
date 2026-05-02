import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return `${amount.toFixed(2)} د.ل`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ar-LY", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function tierLabel(tier: string): string {
  const labels: Record<string, string> = { bronze: "برونزي", silver: "فضي", gold: "ذهبي", platinum: "بلاتيني" };
  return labels[tier] ?? tier;
}

export function tierColor(tier: string): string {
  const colors: Record<string, string> = {
    bronze: "text-amber-600", silver: "text-slate-400", gold: "text-yellow-400", platinum: "text-cyan-400",
  };
  return colors[tier] ?? "text-muted-foreground";
}

export function categoryLabel(cat: string | null | undefined): string {
  const labels: Record<string, string> = { streaming: "بث مباشر", music: "موسيقى", gaming: "ألعاب", productivity: "إنتاجية" };
  return cat ? (labels[cat] ?? cat) : "عام";
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "قيد الانتظار", completed: "مكتمل", failed: "فشل",
    refunded: "مسترجع", approved: "موافق عليه", rejected: "مرفوض",
  };
  return labels[status] ?? status;
}

export function statusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
    completed: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    approved: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    failed: "text-red-400 bg-red-400/10 border-red-400/20",
    rejected: "text-red-400 bg-red-400/10 border-red-400/20",
    refunded: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  };
  return colors[status] ?? "text-muted-foreground";
}
