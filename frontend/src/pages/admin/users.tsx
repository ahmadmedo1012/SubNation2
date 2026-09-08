import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { TableSkeleton as SharedTableSkeleton } from "@/components/admin/TableSkeleton";
// 94-C2 (A2 P2-5): the wallet-edit shell migrates from the hand-rolled
// fixed overlay to the shared AppDialog — focus trap, ESC handling,
// role="dialog"/aria-modal and a guarded dismiss while the money PATCH
// is in flight (the old backdrop closed mid-save and stranded the
// request with no visible surface).
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import {
  PROVIDER_TONE_CLASS,
  displayUserName,
  userProviderBadges,
  type AdminUserShape,
} from "@/lib/admin/user-display";
import { formatCount, formatCurrency, formatDate, tierColor, tierLabel } from "@/lib/utils";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getListAdminUsersQueryKey,
  type AdminUser,
} from "@workspace/api-client-react";
import {
  CheckCircle,
  ChevronDown,
  Download,
  Edit2,
  Filter,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Star,
  Users,
  Wallet,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
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

/** 94-C2 (A2 P1-1): the backend supports `page`/`limit` (clamped
 *  1..200, default 100) but the UI never sent either — the directory
 *  silently capped at the newest 100 users while the summary cards
 *  presented the slice as «إجمالي المستخدمين / الأرصدة / الإنفاق».
 *  The frozen `?page=&limit=` contract now accumulates in place. */
const USERS_PAGE_SIZE = 100;

/** Arabic plural forms for the directory counter (formatCount, A2 P3-4). */
const USER_COUNT_FORMS = {
  zero: "مستخدمين",
  one: "مستخدم",
  two: "مستخدمان",
  few: "مستخدمين",
  many: "مستخدمًا",
  other: "مستخدم",
};

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
  const badges = userProviderBadges(user as AdminUserShape);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {badges.map((b) => (
        <span
          key={b.label}
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${PROVIDER_TONE_CLASS[b.tone]}`}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
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
  const [search, setSearch] = useState(
    // 94-C2 (A2 P2-3): the GlobalSearch palette deep-links here with
    // ?search= — prefill the box (and the debounced mirror so the
    // first query already carries it, no double fetch).
    () => new URLSearchParams(window.location.search).get("search") ?? "",
  );
  const [debouncedSearch, setDebouncedSearch] = useState(search);
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
  // 93-C6 / F-07 (A5 S-1): the wallet save is a money action — it now
  // requires an explicit confirmation with a resulting-balance
  // preview (same useConfirm idiom as the orders bulk refund).
  const { confirm, ConfirmDialog } = useConfirm();

  // 300ms debounce (same pattern as admin/referrals) so the users
  // query doesn't fire per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data: usersPages,
    isLoading,
    // 93-C6 / F-07 (A5 S-2): a failed load previously fell through to
    // the "لا يوجد مستخدمون" empty state — an outage made the whole
    // user directory LOOK empty.
    isError,
    error,
    refetch,
    // 94-C2 (A2 P1-1): append controls + the implicit "more may
    // exist" flag (a full page).
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<AdminUser[], Error>({
    // Key keeps the "/api/admin/users" prefix so the existing
    // invalidations still refresh the accumulated pages; `search` in
    // the key restarts at page 1 and aborts the in-flight request via
    // the queryFn's AbortSignal (94-C2).
    queryKey: ["/api/admin/users", "load-more", { search: debouncedSearch.trim() || undefined }],
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams({
        page: String(pageParam),
        limit: String(USERS_PAGE_SIZE),
      });
      const s = debouncedSearch.trim();
      if (s) qs.set("search", s);
      return customFetch<AdminUser[]>(`/api/admin/users?${qs.toString()}`, { signal, headers });
    },
    initialPageParam: 1,
    // Frozen contract (A2 P1-1): plain-array body — a full page means
    // the next page MIGHT exist; a short page is the definite end.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === USERS_PAGE_SIZE ? allPages.length + 1 : undefined,
    enabled: !!adminToken,
    // Round-4 (perf P1-3): the admin-room socket listener invalidates
    // users on every `admin-stats-update` push (wallet/loyalty writes
    // change user rows) — 5-min fallback only.
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  const users: AdminUser[] = (usersPages?.pages ?? []).flat();
  // 94-C2 (A2 P1-1): the directory size is only provably known when a
  // single short page arrived — «عرض N» otherwise.
  const knownTotal =
    (usersPages?.pages.length ?? 0) <= 1 && users.length < USERS_PAGE_SIZE;

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  if (!adminToken) return null;

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
    // 93-C6 / F-07 (A5 U-1): a typo'd wallet amount used to be SILENTLY
    // DROPPED (parseFloat NaN → the field was omitted from the body
    // while loyalty still saved, and the toast still said "تم الحفظ").
    // A non-numeric value now blocks the submit outright.
    const walletInput = form.wallet_value.trim();
    const walletValue = walletInput === "" ? null : Number.parseFloat(walletInput);
    if (walletValue !== null && (!Number.isFinite(walletValue) || walletValue < 0)) {
      toast({
        title: "المبلغ غير صالح",
        description: "أدخل مبلغ محفظة رقميًا صحيحًا (0 أو أكثر) قبل الحفظ",
        variant: "destructive",
      });
      return;
    }
    // 93-C6 / F-07 (A5 S-1, round-93): money adjustment requires an
    // explicit confirmation BEFORE the PATCH fires — with the resulting
    // balance preview so a typo like 50-vs-5.00 is visible before it
    // lands ("set" especially overwrites a wallet in one tap).
    if (walletValue !== null) {
      const currentBalance = Number(editingUser.wallet_balance ?? 0) || 0;
      const nextBalance =
        form.wallet_mode === "set"
          ? walletValue
          : form.wallet_mode === "add"
            ? currentBalance + walletValue
            : currentBalance - walletValue;
      const actionText =
        form.wallet_mode === "set"
          ? `سيتم تحديد رصيد محفظة ${editingUser.phone} إلى ${formatCurrency(walletValue)} (الرصيد الحالي: ${formatCurrency(currentBalance)}).`
          : form.wallet_mode === "add"
            ? `سيتم إضافة ${formatCurrency(walletValue)} إلى محفظة ${editingUser.phone} (الرصيد الحالي: ${formatCurrency(currentBalance)}).`
            : `سيتم خصم ${formatCurrency(walletValue)} من محفظة ${editingUser.phone} (الرصيد الحالي: ${formatCurrency(currentBalance)}).`;
      const negativeWarning =
        form.wallet_mode === "subtract" && nextBalance < 0
          ? " تنبيه: المبلغ يتجاوز الرصيد الحالي وسيُرفض التحديث."
          : "";
      const ok = await confirm({
        title: "تأكيد تعديل المحفظة",
        description: `${actionText} الرصيد الجديد: ${formatCurrency(nextBalance)}.${negativeWarning}`,
        confirmLabel: "تنفيذ التعديل",
        destructive: form.wallet_mode === "subtract",
      });
      if (!ok) return;
    }
    setSaving(true);
    const body: Record<string, number | string> = {};
    if (walletValue !== null) {
      if (form.wallet_mode === "set") body.wallet_balance = walletValue;
      else if (form.wallet_mode === "add") body.wallet_adjustment = walletValue;
      else body.wallet_adjustment = -walletValue;
    }
    if (form.loyalty_points !== "") {
      const pts = parseInt(form.loyalty_points);
      if (!isNaN(pts)) body.loyalty_points = pts;
    }
    if (form.loyalty_tier) body.loyalty_tier = form.loyalty_tier;
    try {
      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        // F-008 (security audit 004): one Idempotency-Key per save
        // click. The audit's S-01 bundle wraps wallet_adjustment /
        // wallet_balance in AdjustmentService (transaction + ledger
        // entry + optimistic lock); the Idempotency-Key middleware
        // dedupes on top of that so a network retry / accidental
        // double-click does not double-credit. The same key spans
        // wallet + loyalty fields because they ride one PATCH — they
        // are one logical save action from the admin's POV.
        headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),
        body: JSON.stringify(body),
      });
      // 93-C6 / F-07 (A5 S-3): 401 mid-form = session expiry, not a
      // failed save — the global handler toasts + redirects.
      if (isAdminUnauthorized(res, `/api/admin/users/${editingUser.id}`)) return;
      // 93-C6 / F-07 (SIM P1): safe body parse — a non-JSON error body
      // (proxy HTML) used to throw a JSON SyntaxError into the toast.
      const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      // Round-4 (org §6a): money-path admin save — getErrorMessage maps
      // the backend `code` (INSUFFICIENT_PERMISSIONS, NEGATIVE_BALANCE,
      // CONFLICT points-race…) to Arabic instead of the bare "خطأ"
      // fallback.
      if (!res.ok) throw new Error(getErrorMessage(data) || "خطأ");
      toast({ title: "تم الحفظ", description: `تم تحديث بيانات ${editingUser.phone}` });
      // 94-C2: base key — refreshes the accumulating infinite query
      // (prefix match), not just one param-specific cache entry.
      queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      setEditingUser(null);
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        // 93-C6 / F-07 (SIM P1): route through getErrorMessage so the
        // response envelope (and network-level TypeErrors) surface as
        // Arabic, never silently.
        description: getErrorMessage(err),
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
            {/* 94-C2 (A2 P1-1): honest count — the directory no longer
                claims a grand total it can't know once pages are capped. */}
            <p className="text-xs text-muted-foreground">
              {users.length > 0
                ? `${knownTotal ? "" : "عرض "}${formatCount(users.length, USER_COUNT_FORMS)}${knownTotal ? "" : " (الأحدث أولاً)"}`
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
                <div className="text-[10px] font-bold text-muted-foreground mb-2">
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
                <div className="text-[10px] font-bold text-muted-foreground mb-2">
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

        {/* Summary stats strip — 94-C2 (A2 P1-1): the labels describe
            the LOADED sample, never a grand total (the old «إجمالي
            المستخدمين/الأرصدة/الإنفاق» cards presented the first page
            as the whole directory). */}
        {!isLoading && users.length > 0 && !search && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "المستخدمون المعروضون",
                value: formatCount(users.length, USER_COUNT_FORMS),
                icon: Users,
                color: "text-blue-400",
                bg: "bg-blue-400/10",
                border: "border-blue-400/15",
              },
              {
                label: "أرصدة المعروضين",
                value: formatCurrency(totalWallet),
                icon: Wallet,
                color: "text-cyan-400",
                bg: "bg-cyan-400/10",
                border: "border-cyan-400/15",
              },
              {
                label: "إنفاق المعروضين",
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

        {/* Edit dialog — 94-C2 (A2 P2-5): the money-action shell is
            the shared AppDialog (focus trap, ESC, aria) with
            dismissable={!saving} so a stray tap mid-PATCH can't destroy
            the form; the submit button lives in the dialog footer and
            associates with the form via form="user-edit-form". */}
        <AppDialog
          open={!!editingUser}
          onOpenChange={(o) => {
            if (!o) setEditingUser(null);
          }}
          title="تعديل المستخدم"
          description={editingUser?.phone}
          dismissable={!saving}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingUser(null)}
                disabled={saving}
                className="flex-1 h-10 active:scale-[0.97] sm:flex-none"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                form="user-edit-form"
                className="flex-1 h-10 bg-primary hover:bg-primary/90 active:scale-[0.97]"
                disabled={saving}
              >
                <CheckCircle className="w-4 h-4 ml-1.5" />
                {saving ? "جارٍ الحفظ..." : "حفظ"}
              </Button>
            </>
          }
        >
          <AppDialogBody className="space-y-4">
            {editingUser && (
              <>
              {/* Current snapshot */}
              <div className="grid grid-cols-3 gap-2 p-3.5 bg-muted/25 border border-border/50 rounded-2xl">
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
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground border border-border/30 rounded-lg px-3 py-2 bg-muted/10">
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

              <form id="user-edit-form" onSubmit={handleSave} className="space-y-4">
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
              </form>
              </>
            )}
          </AppDialogBody>
        </AppDialog>

        {/* 93-C6 / F-07 (A5 S-2): refresh of an already-rendered list
            failed — keep the stale rows, surface the failure inline. */}
        {isError && users.length > 0 && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span className="min-w-0">{getErrorMessage(error)}</span>
            <button
              type="button"
              onClick={() => refetch()}
              className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <TableSkeleton />
        ) : isError && users.length === 0 ? (
          /* 93-C6 / F-07 (A5 S-2): a failed load is NOT "no users" — the
             referrals.tsx error-card idiom (an outage/expired session
             previously masqueraded as the empty state). */
          <div className="text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-2xl">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
              <WifiOff className="w-8 h-8 text-status-error/70" />
            </div>
            <p className="font-black text-lg mb-1.5 text-foreground/80">تعذّر تحميل المستخدمين</p>
            <p className="text-sm mb-7 max-w-xs mx-auto leading-relaxed">
              {getErrorMessage(error)} — تحقّق من شبكتك ثم أعد المحاولة
            </p>
            <Button
              onClick={() => refetch()}
              className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              إعادة المحاولة
            </Button>
          </div>
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
                    <tr className="sticky top-0 z-10 border-b border-border bg-card/85 supports-[backdrop-filter]:bg-card/65 backdrop-blur-md">
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px]">
                        المستخدم
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px]">
                        المصدر
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px]">
                        الرصيد
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px]">
                        المستوى
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px]">
                        النقاط
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px]">
                        الإجمالي المنفق
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px]">
                        الطلبات
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px]">
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
                          {displayUserName(user as unknown as AdminUserShape)}
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
                            aria-label={`تعديل المستخدم ${user.phone ?? ""}`}
                            /* 93-C6 / F-07 (A5 S-6): p-1.5 ≈ 28px target —
                               p-2 + min sizes lift the tappable area for
                               the 375px admin layout. */
                            className="p-2 min-w-9 min-h-9 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90"
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
                <span>{formatCount(sorted.length, USER_COUNT_FORMS)}</span>
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
                      {displayUserName(user as unknown as AdminUserShape)}
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

            {/* 94-C2 (A2 P1-1): "load more" appends the next page of the
                frozen `?page=N+1&limit=` contract in place — users past
                the silent 100-row cap become reachable. The button hides
                once a short page arrives. */}
            {hasNextPage && (
              <div className="flex justify-center pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  disabled={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                >
                  {isFetchingNextPage ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> جارٍ التحميل…
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" /> تحميل المزيد
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {/* 93-C6 / F-07: the wallet-adjust confirmation dialog mount
          (useConfirm idiom — styled AlertDialog, ESC/rtl-correct). */}
      <ConfirmDialog />
    </AdminLayout>
  );
}
