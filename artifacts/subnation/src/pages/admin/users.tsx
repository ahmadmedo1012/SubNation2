import { useState } from "react";
import { useListAdminUsers, getListAdminUsersQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, tierLabel, tierColor } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Users, Search, Edit2, X, CheckCircle, Plus, Minus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface EditUserForm {
  wallet_mode: "set" | "add" | "subtract";
  wallet_value: string;
  loyalty_points: string;
  loyalty_tier: string;
}

const TIERS = [
  { value: "", label: "بدون تغيير" },
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

  function openEdit(user: any) {
    setEditingUser(user);
    setForm({ wallet_mode: "add", wallet_value: "", loyalty_points: String(user.loyalty_points), loyalty_tier: user.loyalty_tier });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser || !adminToken) return;
    setSaving(true);
    const body: Record<string, any> = {};
    if (form.wallet_value !== "") {
      const val = parseFloat(form.wallet_value);
      if (!isNaN(val)) {
        if (form.wallet_mode === "set")      body.wallet_balance   = val;
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
      toast({ title: "تم الحفظ", description: `تم تحديث بيانات ${editingUser.phone}` });
      queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey(params) });
      refetch();
      setEditingUser(null);
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black mb-0.5">المستخدمون</h1>
            <p className="text-muted-foreground text-sm">{users.length > 0 ? `${users.length} مستخدم مسجل` : "إدارة حسابات المستخدمين"}</p>
          </div>
          <div className="relative w-64">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              type="search" placeholder="بحث برقم الهاتف..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="pr-9 h-9" dir="ltr"
            />
          </div>
        </div>

        {/* Edit modal */}
        {editingUser && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setEditingUser(null)}>
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-black text-lg">تعديل المستخدم</h2>
                  <p className="text-sm text-muted-foreground font-mono mt-0.5">{editingUser.phone}</p>
                </div>
                <button onClick={() => setEditingUser(null)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Current state summary */}
              <div className="grid grid-cols-3 gap-3 mb-5 p-4 bg-muted/30 border border-border/50 rounded-xl">
                {[
                  { label: "الرصيد", value: formatCurrency(editingUser.wallet_balance), cls: "text-primary" },
                  { label: "النقاط", value: editingUser.loyalty_points,               cls: "text-foreground" },
                  { label: "المستوى", value: tierLabel(editingUser.loyalty_tier),      cls: tierColor(editingUser.loyalty_tier) },
                ].map(item => (
                  <div key={item.label} className="text-center">
                    <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
                    <div className={`font-black text-sm ${item.cls}`}>{item.value}</div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <Label className="mb-2 block text-sm font-semibold">تعديل المحفظة (د.ل)</Label>
                  <div className="flex gap-1.5 mb-2 bg-secondary/50 border border-border rounded-xl p-1">
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
                    dir="ltr"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-sm font-semibold">نقاط الولاء</Label>
                    <Input type="number" min="0" value={form.loyalty_points} onChange={e => setForm(f => ({ ...f, loyalty_points: e.target.value }))} dir="ltr" />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-sm font-semibold">المستوى</Label>
                    <select value={form.loyalty_tier} onChange={e => setForm(f => ({ ...f, loyalty_tier: e.target.value }))}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary h-10">
                      {TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={() => setEditingUser(null)} className="flex-1 active:scale-95 transition-transform">إلغاء</Button>
                  <Button type="submit" className="flex-1 bg-primary hover:bg-primary/90 active:scale-95 transition-transform" disabled={saving}>
                    <CheckCircle className="w-4 h-4 ml-1" />
                    {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-14 skeleton-shimmer" />)}</div>
        ) : users.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground bg-card border border-border rounded-xl">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-25" />
            <p className="font-bold">لا يوجد مستخدمون</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["رقم الهاتف", "الرصيد", "المستوى", "النقاط", "الإجمالي المنفق", "الطلبات", "تاريخ التسجيل", ""].map(h => (
                      <th key={h} className={`text-right px-4 py-3.5 font-semibold text-muted-foreground text-xs ${h === "" ? "" : "uppercase tracking-wide"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user: any, idx: number) => (
                    <tr key={user.id} className={`border-b border-border/40 transition-colors hover:bg-muted/25 ${idx % 2 !== 0 ? "bg-muted/5" : ""}`}>
                      <td className="px-4 py-3.5 font-mono font-bold text-sm">{user.phone}</td>
                      <td className="px-4 py-3.5 font-black text-primary">{formatCurrency(user.wallet_balance)}</td>
                      <td className="px-4 py-3.5">
                        <span className={`font-bold text-xs ${tierColor(user.loyalty_tier)}`}>{tierLabel(user.loyalty_tier)}</span>
                      </td>
                      <td className="px-4 py-3.5 tabular-nums">{user.loyalty_points}</td>
                      <td className="px-4 py-3.5 text-muted-foreground">{formatCurrency(user.lifetime_spend)}</td>
                      <td className="px-4 py-3.5 tabular-nums">{user.order_count}</td>
                      <td className="px-4 py-3.5 text-muted-foreground text-xs">{user.created_at ? formatDate(user.created_at) : ""}</td>
                      <td className="px-4 py-3.5">
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
            <div className="px-4 py-3 border-t border-border bg-muted/10 text-xs text-muted-foreground">
              {users.length} مستخدم
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
