import { useState } from "react";
import { useListAdminUsers, getListAdminUsersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, tierLabel, tierColor } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Users, Search, Edit2, X, CheckCircle, Plus, Minus, Wallet, Star } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface EditUserForm {
  wallet_mode: "set" | "add" | "subtract";
  wallet_value: string;
  loyalty_points: string;
  loyalty_tier: string;
}

const TIERS = [
  { value: "",         label: "بدون تغيير" },
  { value: "bronze",   label: "برونزي" },
  { value: "silver",   label: "فضي" },
  { value: "gold",     label: "ذهبي" },
  { value: "platinum", label: "بلاتيني" },
];

const WALLET_MODES = [
  { value: "add",      label: "إضافة", icon: Plus },
  { value: "subtract", label: "خصم",   icon: Minus },
  { value: "set",      label: "تحديد", icon: null },
];

function TableSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="border-b border-border bg-muted/30 h-11" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={`flex items-center gap-4 px-4 py-3 border-b border-border/30 ${i % 2 !== 0 ? "bg-muted/5" : ""}`}>
          <div className="h-4 bg-muted skeleton-shimmer rounded w-28 shrink-0" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-16 shrink-0" />
          <div className="h-4 bg-muted skeleton-shimmer rounded-full w-14 shrink-0" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-12 shrink-0" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-16 flex-1" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-8 shrink-0" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-20 shrink-0" />
          <div className="h-7 w-7 bg-muted skeleton-shimmer rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default function AdminUsersPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditUserForm>({ wallet_mode: "add", wallet_value: "", loyalty_points: "", loyalty_tier: "" });

  const params: Record<string, string> = {};
  if (search) params.search = search;

  const { data: users = [], isLoading, refetch } = useListAdminUsers(params, {
    query: { queryKey: getListAdminUsersQueryKey(params), enabled: !!adminToken, refetchInterval: 30_000 },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  if (!adminToken) { navigate("/admin/login"); return null; }

  const totalWallet = (users as any[]).reduce((sum: number, u: any) => sum + (u.wallet_balance ?? 0), 0);
  const totalSpend  = (users as any[]).reduce((sum: number, u: any) => sum + (u.lifetime_spend ?? 0), 0);

  function openEdit(user: any) {
    setEditingUser(user);
    setForm({ wallet_mode: "add", wallet_value: "", loyalty_points: String(user.loyalty_points), loyalty_tier: user.loyalty_tier ?? "" });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser || !adminToken) return;
    setSaving(true);
    const body: Record<string, any> = {};
    if (form.wallet_value !== "") {
      const val = parseFloat(form.wallet_value);
      if (!isNaN(val)) {
        if (form.wallet_mode === "set")      body.wallet_balance    = val;
        else if (form.wallet_mode === "add") body.wallet_adjustment = val;
        else                                 body.wallet_adjustment = -val;
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "خطأ");
      toast({ title: "تم الحفظ" });
      queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey(params) });
      setEditingUser(null);
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black mb-0.5">المستخدمون</h1>
            <p className="text-xs text-muted-foreground">
              {(users as any[]).length > 0 ? `${(users as any[]).length} مستخدم مسجل` : "إدارة حسابات المستخدمين"}
            </p>
          </div>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search" placeholder="بحث برقم الهاتف..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="pr-9 h-9 w-56 text-sm" dir="ltr"
            />
          </div>
        </div>

        {/* Summary stats strip */}
        {!isLoading && (users as any[]).length > 0 && !search && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "إجمالي المستخدمين", value: (users as any[]).length,         icon: Users,  color: "text-blue-400",    bg: "bg-blue-400/10",    border: "border-blue-400/15" },
              { label: "إجمالي الأرصدة",    value: formatCurrency(totalWallet),     icon: Wallet, color: "text-cyan-400",    bg: "bg-cyan-400/10",    border: "border-cyan-400/15" },
              { label: "إجمالي الإنفاق",    value: formatCurrency(totalSpend),      icon: Star,   color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/15" },
              { label: "متوسط الإنفاق",     value: formatCurrency((users as any[]).length > 0 ? totalSpend / (users as any[]).length : 0), icon: Star, color: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/15" },
            ].map(stat => (
              <div key={stat.label} className={`bg-card border ${stat.border} rounded-xl px-4 py-3 flex items-center gap-3`}>
                <div className={`w-8 h-8 ${stat.bg} rounded-lg flex items-center justify-center shrink-0`}>
                  <stat.icon className={`w-4 h-4 ${stat.color}`} />
                </div>
                <div>
                  <div className={`font-black text-sm tabular-nums ${stat.color}`}>{stat.value}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{stat.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit modal */}
        {editingUser && (
          <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={e => e.target === e.currentTarget && setEditingUser(null)}>
            <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-md shadow-2xl animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-black">تعديل المستخدم</h2>
                  <p className="text-sm text-muted-foreground font-mono mt-0.5">{editingUser.phone}</p>
                </div>
                <button onClick={() => setEditingUser(null)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Current snapshot */}
              <div className="grid grid-cols-3 gap-2 mb-4 p-3.5 bg-muted/25 border border-border/50 rounded-xl">
                {[
                  { label: "الرصيد",   value: formatCurrency(editingUser.wallet_balance), cls: "text-primary" },
                  { label: "النقاط",   value: editingUser.loyalty_points,                cls: "text-foreground" },
                  { label: "المستوى", value: tierLabel(editingUser.loyalty_tier),        cls: tierColor(editingUser.loyalty_tier) },
                ].map(item => (
                  <div key={item.label} className="text-center">
                    <div className="text-[10px] text-muted-foreground mb-0.5">{item.label}</div>
                    <div className={`font-black text-sm tabular-nums ${item.cls}`}>{item.value}</div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <Label className="mb-2 block text-sm font-semibold">تعديل المحفظة (د.ل)</Label>
                  <div className="flex gap-1 mb-2 bg-secondary/50 border border-border rounded-xl p-1">
                    {WALLET_MODES.map(opt => (
                      <button key={opt.value} type="button"
                        onClick={() => setForm(f => ({ ...f, wallet_mode: opt.value as any }))}
                        className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold transition-all ${form.wallet_mode === opt.value ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                        {opt.icon && <opt.icon className="w-3 h-3" />}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <Input
                    type="number" min="0" step="0.5"
                    placeholder={form.wallet_mode === "set" ? "الرصيد الجديد" : form.wallet_mode === "add" ? "المبلغ للإضافة" : "المبلغ للخصم"}
                    value={form.wallet_value}
                    onChange={e => setForm(f => ({ ...f, wallet_value: e.target.value }))}
                    dir="ltr" className="h-10"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-sm font-semibold">نقاط الولاء</Label>
                    <Input type="number" min="0" value={form.loyalty_points} onChange={e => setForm(f => ({ ...f, loyalty_points: e.target.value }))} dir="ltr" className="h-10" />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-sm font-semibold">المستوى</Label>
                    <select value={form.loyalty_tier} onChange={e => setForm(f => ({ ...f, loyalty_tier: e.target.value }))}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary h-10">
                      {TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button type="button" variant="outline" onClick={() => setEditingUser(null)} className="flex-1 h-10 active:scale-[0.97]">إلغاء</Button>
                  <Button type="submit" className="flex-1 h-10 bg-primary hover:bg-primary/90 active:scale-[0.97]" disabled={saving}>
                    <CheckCircle className="w-4 h-4 ml-1.5" />
                    {saving ? "جارٍ الحفظ..." : "حفظ"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Table */}
        {isLoading ? <TableSkeleton /> : (users as any[]).length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-xl">
            <div className="w-12 h-12 rounded-xl bg-muted mx-auto mb-3 flex items-center justify-center">
              <Users className="w-5 h-5 opacity-30" />
            </div>
            <p className="font-bold text-sm">
              {search ? `لا نتائج لـ "${search}"` : "لا يوجد مستخدمون"}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/25">
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">رقم الهاتف</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">الرصيد</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">المستوى</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">النقاط</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">الإجمالي المنفق</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">الطلبات</th>
                      <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">التسجيل</th>
                      <th className="px-4 py-3 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {(users as any[]).map((user: any, idx: number) => (
                      <tr key={user.id} className={`border-b border-border/30 transition-colors hover:bg-muted/20 ${idx % 2 !== 0 ? "bg-muted/[0.035]" : ""}`}>
                        <td className="px-4 py-3 font-mono font-bold text-sm">{user.phone}</td>
                        <td className="px-4 py-3 font-black text-primary tabular-nums">{formatCurrency(user.wallet_balance)}</td>
                        <td className="px-4 py-3">
                          <span className={`font-bold text-xs ${tierColor(user.loyalty_tier)}`}>{tierLabel(user.loyalty_tier)}</span>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-sm">{user.loyalty_points}</td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums">{formatCurrency(user.lifetime_spend)}</td>
                        <td className="px-4 py-3 tabular-nums">{user.order_count}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">{user.created_at ? formatDate(user.created_at) : "—"}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => openEdit(user)}
                            className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-border bg-muted/10 text-xs text-muted-foreground">
                {(users as any[]).length} مستخدم
              </div>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {(users as any[]).map((user: any) => (
                <div key={user.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-bold text-sm">{user.phone}</div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span className={tierColor(user.loyalty_tier)}>{tierLabel(user.loyalty_tier)}</span>
                      <span>·</span>
                      <span>{user.order_count} طلب</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-black text-primary tabular-nums text-sm">{formatCurrency(user.wallet_balance)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{user.loyalty_points} نقطة</div>
                  </div>
                  <button onClick={() => openEdit(user)} className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground active:scale-90 shrink-0">
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
