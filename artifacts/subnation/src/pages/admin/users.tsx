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
  { value: "bronze", label: "برونزي" },
  { value: "silver", label: "فضي" },
  { value: "gold", label: "ذهبي" },
  { value: "platinum", label: "بلاتيني" },
];

export default function AdminUsersPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditUserForm>({
    wallet_mode: "add",
    wallet_value: "",
    loyalty_points: "",
    loyalty_tier: "",
  });

  const params: Record<string, string> = {};
  if (search) params.search = search;

  const { data: users = [], isLoading, refetch } = useListAdminUsers(params, {
    query: {
      queryKey: getListAdminUsersQueryKey(params),
      enabled: !!adminToken,
      refetchInterval: 30_000,
    },
    request: { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } },
  });

  if (!adminToken) { navigate("/admin/login"); return null; }

  function openEdit(user: any) {
    setEditingUser(user);
    setForm({ wallet_mode: "add", wallet_value: "", loyalty_points: String(user.loyalty_points), loyalty_tier: user.loyalty_tier });
  }

  function closeEdit() { setEditingUser(null); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser || !adminToken) return;
    setSaving(true);

    const body: Record<string, any> = {};
    if (form.wallet_value !== "") {
      const val = parseFloat(form.wallet_value);
      if (!isNaN(val)) {
        if (form.wallet_mode === "set") body.wallet_balance = val;
        else if (form.wallet_mode === "add") body.wallet_adjustment = val;
        else if (form.wallet_mode === "subtract") body.wallet_adjustment = -val;
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
      closeEdit();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div>
        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-black">المستخدمون</h1>
          <div className="relative w-64">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="بحث برقم الهاتف..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pr-9"
              dir="ltr"
            />
          </div>
        </div>

        {/* Edit User Modal */}
        {editingUser && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && closeEdit()}>
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-black text-lg">تعديل المستخدم</h2>
                  <p className="text-sm text-muted-foreground font-mono">{editingUser.phone}</p>
                </div>
                <button onClick={closeEdit} className="p-1.5 rounded-lg hover:bg-secondary"><X className="w-4 h-4" /></button>
              </div>

              <div className="mb-4 p-3 bg-muted/40 rounded-xl flex gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs mb-0.5">الرصيد الحالي</div>
                  <div className="font-black text-primary">{formatCurrency(editingUser.wallet_balance)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs mb-0.5">النقاط</div>
                  <div className="font-bold">{editingUser.loyalty_points}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs mb-0.5">المستوى</div>
                  <div className={`font-bold ${tierColor(editingUser.loyalty_tier)}`}>{tierLabel(editingUser.loyalty_tier)}</div>
                </div>
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <Label className="mb-2 block">تعديل المحفظة (د.ل)</Label>
                  <div className="flex gap-2 mb-2">
                    {[
                      { value: "add", label: "إضافة", icon: <Plus className="w-3.5 h-3.5" /> },
                      { value: "subtract", label: "خصم", icon: <Minus className="w-3.5 h-3.5" /> },
                      { value: "set", label: "تحديد", icon: null },
                    ].map(opt => (
                      <button key={opt.value} type="button"
                        onClick={() => setForm(f => ({ ...f, wallet_mode: opt.value as any }))}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${form.wallet_mode === opt.value ? "bg-primary text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                        {opt.icon}{opt.label}
                      </button>
                    ))}
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder={form.wallet_mode === "set" ? "الرصيد الجديد" : form.wallet_mode === "add" ? "المبلغ للإضافة" : "المبلغ للخصم"}
                    value={form.wallet_value}
                    onChange={e => setForm(f => ({ ...f, wallet_value: e.target.value }))}
                    dir="ltr"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block">نقاط الولاء</Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.loyalty_points}
                      onChange={e => setForm(f => ({ ...f, loyalty_points: e.target.value }))}
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block">المستوى</Label>
                    <select
                      value={form.loyalty_tier}
                      onChange={e => setForm(f => ({ ...f, loyalty_tier: e.target.value }))}
                      className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  <Button type="button" variant="outline" onClick={closeEdit} className="flex-1">إلغاء</Button>
                  <Button type="submit" className="flex-1 bg-primary hover:bg-primary/90" disabled={saving}>
                    <CheckCircle className="w-4 h-4 ml-1" />
                    {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-16 animate-pulse" />)}</div>
        ) : users.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>لا يوجد مستخدمون</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">رقم الهاتف</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">الرصيد</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">المستوى</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">النقاط</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">الإجمالي المنفق</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">الطلبات</th>
                  <th className="text-right px-4 py-3 font-bold text-muted-foreground">تاريخ التسجيل</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((user: any) => (
                  <tr key={user.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold">{user.phone}</td>
                    <td className="px-4 py-3 font-bold text-primary">{formatCurrency(user.wallet_balance)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-bold ${tierColor(user.loyalty_tier)}`}>{tierLabel(user.loyalty_tier)}</span>
                    </td>
                    <td className="px-4 py-3">{user.loyalty_points}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatCurrency(user.lifetime_spend)}</td>
                    <td className="px-4 py-3">{user.order_count}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{user.created_at ? formatDate(user.created_at) : ""}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEdit(user)}
                        className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                        title="تعديل"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
