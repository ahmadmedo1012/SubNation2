import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return "0.00 د.ل";
  return `${Number(amount).toFixed(2)} د.ل`;
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
  const labels: Record<string, string> = {
    bronze: "برونزي",
    silver: "فضي",
    gold: "ذهبي",
    platinum: "بلاتيني",
  };
  return labels[tier] ?? tier;
}

export function tierColor(tier: string): string {
  const colors: Record<string, string> = {
    bronze: "text-amber-600",
    silver: "text-slate-400",
    gold: "text-yellow-400",
    platinum: "text-cyan-400",
  };
  return colors[tier] ?? "text-muted-foreground";
}

export function categoryLabel(cat: string | null | undefined): string {
  const labels: Record<string, string> = {
    streaming: "بث مباشر",
    music: "موسيقى",
    gaming: "ألعاب",
    productivity: "إنتاجية",
  };
  return cat ? (labels[cat] ?? cat) : "عام";
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "قيد الانتظار",
    processing: "جارٍ التنفيذ",
    completed: "مكتمل",
    delivered: "مكتمل",
    failed: "فشل",
    refunded: "مسترجع",
    approved: "موافق عليه",
    rejected: "مرفوض",
  };
  return labels[status] ?? status;
}

export function statusColor(status: string): string {
  // Class tuples ride the shared --status-* tokens (defined in
  // index.css and exposed to Tailwind via @theme as `status-success`,
  // etc.). Both light and dark themes get tonally-correct colors with
  // no per-call branching — the tokens already define light-mode
  // values that meet AA contrast on white surfaces.
  const colors: Record<string, string> = {
    pending: "text-status-warning bg-status-warning/10 border-status-warning/22",
    processing: "text-status-info bg-status-info/10 border-status-info/22",
    completed: "text-status-success bg-status-success/10 border-status-success/22",
    delivered: "text-status-success bg-status-success/10 border-status-success/22",
    approved: "text-status-success bg-status-success/10 border-status-success/22",
    failed: "text-status-error bg-status-error/10 border-status-error/22",
    rejected: "text-status-error bg-status-error/10 border-status-error/22",
    refunded: "text-status-info bg-status-info/10 border-status-info/22",
  };
  return colors[status] ?? "text-muted-foreground";
}

export function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} ${mins === 1 ? "دقيقة" : "د"}`;
  if (hours < 24) return `منذ ${hours} ${hours === 1 ? "ساعة" : "س"}`;
  if (days === 1) return "أمس";
  if (days < 7) return `منذ ${days} أيام`;
  return new Date(dateStr).toLocaleDateString("ar-LY", { month: "short", day: "numeric" });
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 48) return formatRelativeTime(dateStr);
  return d.toLocaleDateString("ar-LY", { month: "short", day: "numeric" });
}
