import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { TableSkeleton as SharedTableSkeleton } from "@/components/admin/TableSkeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, tierColor, tierLabel } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAdminUsersQueryKey,
  type AdminUser,
  useListAdminUsers,
} from "@workspace/api-client-react";
import {
  CheckCircle,
  Download,
  Edit2,
  Filter,
  Minus,
  Plus,
  Search,
  Star,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

interface EditUserForm {
  wallet_mode: "set" | "add" | "subtract";
  wallet_value: string;
  loyalty_points: string;
  loyalty_tier: string;
}

const TIERS = [
  { value: "", label: "بدون تغيير" },
  { value: "bronze", label: "برونزي" },
  { value: "silver", label: "فضي" },
  { value: "gold", label: "ذهبي" },
  { value: "platinum", label: "بلاتيني" },
];

const TIER_FILTERS = [
  { value: "", label: "الكل" },
  { value: "bronze", label: "برونزي" },
  { value: "silver", label: "فضي" },
  { value: "gold", label: "ذهبي" },
  { value: "platinum", label: "بلاتيني" },
];

const WALLET_MODES = [
  { value: "add", label: "إضافة", icon: Plus },
  { value: "subtract", label: "خصم", icon: Minus },
  { value: "set", label: "تحديد", icon: null },
];

const SORT_OPTIONS = [
  { value: "wallet_desc", label: "الرصيد ↓" },
  { value: "spend_desc", label: "الإنفاق ↓" },
  { value: "orders_desc", label: "الطلبات ↓" },
  { value: "points_desc", label: "النقاط ↓" },
  { value: "created_asc", label: "الأقدم" },
];

/**
 * Compact pill row showing which auth providers are linked to a given
 * user. Backed by the boolean flags surfaced in /api/admin/users
 * (has_google / has_telegram / has_firebase).
 *
 * If multiple are linked, all show — admins can quickly see merged
 * accounts.
 *
 * Uses the relaxed `Record<string, unknown>` pattern because the
 * generated AdminUser type doesn't yet include the new fields. We
 * read them via bracket access + `Boolean(…)` so a missing field is
 * silently treated as absent rather than throwing a TS error.
 */
function ProviderBadges({ user }: { user: Record<string, unknown> }) {
  const hasGoogle = Boolean(user.has_google);
  const hasTelegram = Boolean(user.has_telegram);
  // Phone OTP via Firebase. Distinguished from Google by has_google flag.
  const hasFirebasePhone = Boolean(user.has_firebase) && !hasGoogle;

  const badges: Array<{ label: string; className: string }> = [];
  if (hasFirebasePhone) {
    badges.push({
      label: "هاتف",
      className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    });
  }
  if (hasGoogle) {
    badges.push({
      label: "Google",
      className: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    });
  }
  if (hasTelegram) {
    badges.push({
      label: "Telegram",
      className: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    });
  }
  if (badges.length === 0) {
    badges.push({
      label: "—",
      className: "text-muted-foreground bg-muted/30 border-border/40",
    });
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {badges.map((b) => (
        <span
          key={b.label}
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${b.className}`}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Best-effort identity label for a user row. Telegram-first accounts
 * have phone="tg_<id>" — show the display_name (or "Telegram") instead
 * of the placeholder. Same idea for fb_/gh_ prefixes (legacy).
 */
function userIdentityLabel(user: Record<string, unknown>): string {
  const phone = typeof user.phone === "string" ? user.phone : "";
  const displayName =
    typeof user.display_name === "string" && user.display_name.trim()
      ? user.display_name.trim()
      : null;
  if (phone.startsWith("tg_")) return displayName ?? "حساب Telegram";
  if (phone.startsWith("fb_")) return displayName ?? "حساب Facebook";
  if (phone.startsWith("gh_")) return displayName ?? "حساب GitHub";
  return phone;
}

function TableSkeleton() {
  return (
    <SharedTableSkeleton
      rows={6}
      cells={[
        "w-28 shrink-0",
        "w-16 shrink-0",
        "rounded-full w-14 shrink-0",
        "w-12 shrink-0",
        "flex-1 w-16",
        "w-8 shrink-0",
        "w-20 shrink-0",
        "w-7 shrink-0",
      ]}
    />
  );
}

export default function AdminUsersPage() {
  const { adminToken } = useAuth();
  const jsonHeaders = useAdminHeaders({ json: true });
  const headers = useAdminHeaders();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [sortBy, setSortBy] = useState("wallet_desc");
  const [showFilters, setShowFilters] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditUserForm>({
    wallet_mode: "add",
    wallet_value: "",
    loyalty_points: "",
    loyalty_tier: "",
  });

  const params: Record<string, string> = {};
  if (search) params.search = search;

  const {
    data: usersRaw = [],
    isLoading,
    refetch,
  } = useListAdminUsers(params, {
    query: {
      queryKey: getListAdminUsersQueryKey(params),
      enabled: !!adminToken,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    },
    request: { headers },
  });

  const users: AdminUser[] = usersRaw;

  if (!adminToken) {
    navigate("/admin/login");
    return null;
  }

  const totalWallet = users.reduce((sum: number, u) => sum + (u.wallet_balance ?? 0), 0);
  const totalSpend = users.reduce((sum: number, u) => sum + (u.lifetime_spend ?? 0), 0);

  // Client-side tier filter + sort
  const tierFiltered = tierFilter ? users.filter((u) => u.loyalty_tier === tierFilter) : users;

  const sorted = [...tierFiltered].sort((a, b) => {
    switch (sortBy) {
      case "wallet_desc":
        return (b.wallet_balance ?? 0) - (a.wallet_balance ?? 0);
      case "spend_desc":
        return (b.lifetime_spend ?? 0) - (a.lifetime_spend ?? 0);
      case "orders_desc":
        return (b.order_count ?? 0) - (a.order_count ?? 0);
      case "points_desc":
        return (b.loyalty_points ?? 0) - (a.loyalty_points ?? 0);
      case "created_asc":
        return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
      default:
        return 0;
    }
  });

  function openEdit(user: AdminUser) {
    setEditingUser(user);
    setForm({
      wallet_mode: "add",
      wallet_value: "",
      loyalty_points: String(user.loyalty_points),
      loyalty_tier: user.loyalty_tier ?? "",
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser || !adminToken) return;
    setSaving(true);
    const body: Record<string, number | string> = {};
    if (form.wallet_value !== "") {
      const val = parseFloat(form.wallet_value);
      if (!isNaN(val)) {
        if (form.wallet_mode === "set") body.wallet_balance = val;
        else if (form.wallet_mode === "add") body.wallet_adjustment = val;
        else body.wallet_adjustment = -val;
      }
    }
    if (form.loyalty_points !== "") {
      const pts = parseInt(form.loyalty_points);
      if (!isNaN(pts)) body.loyalty_points = pts;
    }
    if (form.loyalty_tier) body.loyalty_tier = form.loyalty_tier;
    try {
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "خطأ");
      toast({ title: "تم الحفظ", description: `تم تحديث بيانات ${editingUser.phone}` });
      queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey(params) });
      setEditingUser(null);
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشلت العملية",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const hasFilters = tierFilter !== "" || sortBy !== "wallet_desc";

  const exportUsersCSV = () => {
    const csvHeaders = [
      "رقم الهاتف",
      "الرصيد",
      "المستوى",
      "النقاط",
      "الإجمالي المنفق",
      "الطلبات",
      "تاريخ التسجيل",
    ];
    const rows = sorted.map((u) => [
      u.phone ?? "",
      ((u.wallet_balance ?? 0) || 0).toFixed(2),
      tierLabel(u.loyalty_tier ?? ""),
      u.loyalty_points ?? 0,
      ((u.lifetime_spend ?? 0) || 0).toFixed(2),
      u.order_count ?? 0,
      u.created_at ? formatDate(u.created_at) : "",
    ]);
    const csv = [csvHeaders, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black mb-0.5">المستخدمون</h1>
            <p className="text-xs text-muted-foreground">
              {users.length > 0
                ? `${sorted.length} / ${users.length} مستخدم`
                : "إدارة حسابات المستخدمين"}
              {tierFilter && ` · فلتر: ${tierLabel(tierFilter)}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                placeholder="بحث برقم الهاتف..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9 h-9 w-full sm:w-56 text-sm"
                dir="ltr"
              />
            </div>
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 px-3 h-9 rounded-lg border text-xs font-medium transition-all ${
                hasFilters || showFilters
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-secondary/40 border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              فلترة
              {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
            </button>
            {!isLoading && sorted.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={exportUsersCSV}
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">تصدير CSV</span>
              </Button>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-card border border-border/60 rounded-2xl p-4 animate-in fade-in slide-in-from-top-1 duration-150">
            <div className="flex flex-wrap gap-6">
              <div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  مستوى الولاء
                </div>
                <div className="flex gap-1 flex-wrap">
                  {TIER_FILTERS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setTierFilter(t.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        tierFilter === t.value
                          ? "bg-primary/10 border-primary/30 text-primary font-bold"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  الترتيب
                </div>
                <div className="flex gap-1 flex-wrap">
                  {SORT_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setSortBy(s.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        sortBy === s.value
                          ? "bg-primary/10 border-primary/30 text-primary font-bold"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              {hasFilters && (
                <div className="flex items-end">
                  <button
                    onClick={() => {
                      setTierFilter("");
                      setSortBy("wallet_desc");
                    }}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    إعادة ضبط
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Summary stats strip */}
        {!isLoading && users.length > 0 && !search && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "إجمالي المستخدمين",
                value: users.length,
                icon: Users,
                color: "text-blue-400",
                bg: "bg-blue-400/10",
                border: "border-blue-400/15",
              },
              {
                label: "إجمالي الأرصدة",
                value: formatCurrency(totalWallet),
                icon: Wallet,
                color: "text-cyan-400",
                bg: "bg-cyan-400/10",
                border: "border-cyan-400/15",
              },
              {
                label: "إجمالي الإنفاق",
                value: formatCurrency(totalSpend),
                icon: Star,
                color: "text-emerald-400",
                bg: "bg-emerald-400/10",
                border: "border-emerald-400/15",
              },
              {
                label: "متوسط الإنفاق",
                value: formatCurrency(users.length > 0 ? totalSpend / users.length : 0),
                icon: Star,
                color: "text-purple-400",
                bg: "bg-purple-400/10",
                border: "border-purple-400/15",
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className={`float-in bg-card border ${stat.border} rounded-2xl px-4 py-3 flex items-center gap-3`}
              >
                <div
                  className={`w-8 h-8 ${stat.bg} rounded-lg flex items-center justify-center shrink-0`}
                >
                  <stat.icon className={`w-4 h-4 ${stat.color}`} />
                </div>
                <div>
                  <div className={`font-black text-sm tabular-nums ${stat.color}`}>
                    {stat.value}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {stat.label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit modal */}
        {editingUser && (
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={(e) => e.target === e.currentTarget && setEditingUser(null)}
          >
            <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-md shadow-2xl animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-black">تعديل المستخدم</h2>
                  <p className="text-sm text-muted-foreground font-mono mt-0.5">
                    {editingUser.phone}
                  </p>
                </div>
                <button
                  onClick={() => setEditingUser(null)}
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Current snapshot */}
              <div className="grid grid-cols-3 gap-2 mb-4 p-3.5 bg-muted/25 border border-border/50 rounded-2xl">
                {[
                  {
                    label: "الرصيد",
                    value: formatCurrency(editingUser.wallet_balance),
                    cls: "text-primary",
                  },
                  { label: "النقاط", value: editingUser.loyalty_points, cls: "text-foreground" },
                  {
                    label: "المستوى",
                    value: tierLabel(editingUser.loyalty_tier),
                    cls: tierColor(editingUser.loyalty_tier),
                  },
                ].map((item) => (
                  <div key={item.label} className="text-center">
                    <div className="text-[10px] text-muted-foreground mb-0.5">{item.label}</div>
                    <div className={`font-black text-sm tabular-nums ${item.cls}`}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Extra quick info */}
              <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground border border-border/30 rounded-lg px-3 py-2 bg-muted/10">
                <span>
                  الطلبات: <strong className="text-foreground">{editingUser.order_count}</strong>
                </span>
                <span>
                  الإنفاق:{" "}
                  <strong className="text-emerald-400">
                    {formatCurrency(editingUser.lifetime_spend)}
                  </strong>
                </span>
                {editingUser.created_at && (
                  <span>
                    التسجيل:{" "}
                    <strong className="text-foreground">
                      {formatDate(editingUser.created_at)}
                    </strong>
                  </span>
                )}
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <Label className="mb-2 block text-sm font-semibold">تعديل المحفظة (د.ل)</Label>
                  <div className="flex gap-1 mb-2 bg-secondary/50 border border-border/60 rounded-2xl p-1">
                    {WALLET_MODES.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            wallet_mode: opt.value as EditUserForm["wallet_mode"],
                          }))
                        }
                        className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold transition-all ${form.wallet_mode === opt.value ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {opt.icon && <opt.icon className="w-3 h-3" />}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder={
                      form.wallet_mode === "set"
                        ? "الرصيد الجديد"
                        : form.wallet_mode === "add"
                          ? "المبلغ للإضافة"
                          : "المبلغ للخصم"
                    }
                    value={form.wallet_value}
                    onChange={(e) => setForm((f) => ({ ...f, wallet_value: e.target.value }))}
                    dir="ltr"
                    className="h-10"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-sm font-semibold">نقاط الولاء</Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.loyalty_points}
                      onChange={(e) => setForm((f) => ({ ...f, loyalty_points: e.target.value }))}
                      dir="ltr"
                      className="h-10"
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-sm font-semibold">المستوى</Label>
                    <select
                      value={form.loyalty_tier}
                      onChange={(e) => setForm((f) => ({ ...f, loyalty_tier: e.target.value }))}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary h-10"
                    >
                      {TIERS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingUser(null)}
                    className="flex-1 h-10 active:scale-[0.97]"
                  >
                    إلغاء
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1 h-10 bg-primary hover:bg-primary/90 active:scale-[0.97]"
                    disabled={saving}
                  >
                    <CheckCircle className="w-4 h-4 ml-1.5" />
                    {saving ? "جارٍ الحفظ..." : "حفظ"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <TableSkeleton />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={Users}
            title={
              search
                ? `لا نتائج لـ "${search}"`
                : tierFilter
                  ? `لا مستخدمون بمستوى ${tierLabel(tierFilter)}`
                  : "لا يوجد مستخدمون"
            }
            action={
              search || tierFilter ? (
                <button
                  onClick={() => {
                  setSearch("");
                  setTierFilter("");
                }}
                className="text-xs text-primary hover:underline mt-2"
              >
                مسح الفلاتر
              </button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-card border border-border/60 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/25">
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        المستخدم
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        المصدر
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        الرصيد
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        المستوى
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        النقاط
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        الإجمالي المنفق
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        الطلبات
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                        التسجيل
                      </th>
                      <th className="px-4 py-3 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((user, idx: number) => (
                      <tr
                        key={user.id}
                        className={`border-b border-border/30 transition-colors hover:bg-muted/20 ${idx % 2 !== 0 ? "bg-muted/[0.035]" : ""}`}
                      >
                        <td className="px-4 py-2.5 font-mono font-bold text-sm">
                          {userIdentityLabel(user as unknown as Record<string, unknown>)}
                        </td>
                        <td className="px-4 py-2.5">
                          <ProviderBadges user={user as unknown as Record<string, unknown>} />
                        </td>
                        <td className="px-4 py-2.5 font-black text-primary tabular-nums">
                          {formatCurrency(user.wallet_balance)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`font-bold text-xs px-2 py-0.5 rounded-full border ${
                              user.loyalty_tier === "platinum"
                                ? "text-cyan-400 bg-cyan-400/10 border-cyan-400/20"
                                : user.loyalty_tier === "gold"
                                  ? "text-yellow-400 bg-yellow-400/10 border-yellow-400/20"
                                  : user.loyalty_tier === "silver"
                                    ? "text-slate-300 bg-slate-400/10 border-slate-400/20"
                                    : user.loyalty_tier === "bronze"
                                      ? "text-amber-600 bg-amber-600/10 border-amber-600/20"
                                      : "text-muted-foreground bg-muted/40 border-border"
                            }`}
                          >
                            {tierLabel(user.loyalty_tier)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-sm">{user.loyalty_points}</td>
                        <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                          {formatCurrency(user.lifetime_spend)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums font-semibold">
                          {user.order_count}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs tabular-nums">
                          {user.created_at ? formatDate(user.created_at) : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => openEdit(user)}
                            className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-border bg-muted/10 text-xs text-muted-foreground flex items-center justify-between">
                <span>{sorted.length} مستخدم</span>
                <span className="text-muted-foreground">انقر على قلم التحرير للتعديل</span>
              </div>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {sorted.map((user) => (
                <div
                  key={user.id}
                  className="float-in bg-card border border-border/60 rounded-2xl p-4 flex items-center gap-3 hover:border-border hover:shadow-md hover:shadow-black/10 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-bold text-sm truncate">
                      {userIdentityLabel(user as unknown as Record<string, unknown>)}
                    </div>
                    <div className="mt-1">
                      <ProviderBadges user={user as unknown as Record<string, unknown>} />
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                      <span className={tierColor(user.loyalty_tier)}>
                        {tierLabel(user.loyalty_tier)}
                      </span>
                      <span>·</span>
                      <span>{user.order_count} طلب</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-black text-primary tabular-nums text-sm">
                      {formatCurrency(user.wallet_balance)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {user.loyalty_points} نقطة
                    </div>
                  </div>
                  <button
                    onClick={() => openEdit(user)}
                    className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90 shrink-0"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
