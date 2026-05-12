import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Hash,
  Infinity as InfinityIcon,
  Percent,
  Plus,
  RefreshCw,
  Tag,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

interface Coupon {
  id: number;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  min_order_amount: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  description: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  percentage: "نسبة مئوية",
  fixed: "مبلغ ثابت",
};

function TableSkeleton() {
  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
      <div className="border-b border-border/60 bg-muted/30 h-11" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/30">
          <div className="h-5 bg-muted skeleton-shimmer rounded w-24" />
          <div className="h-4 bg-muted skeleton-shimmer rounded-full w-16 shrink-0" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-16 shrink-0" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-20 flex-1" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-14 shrink-0" />
          <div className="h-7 w-16 bg-muted skeleton-shimmer rounded shrink-0" />
        </div>
      ))}
    </div>
  );
}

interface CreateForm {
  code: string;
  type: "percentage" | "fixed";
  value: string;
  min_order_amount: string;
  max_uses: string;
  expires_at: string;
  description: string;
}

const EMPTY_FORM: CreateForm = {
  code: "",
  type: "percentage",
  value: "",
  min_order_amount: "",
  max_uses: "",
  expires_at: "",
  description: "",
};

export default function AdminCouponsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);

  const headers = {
    Authorization: adminToken ? `Bearer ${adminToken}` : "",
    "Content-Type": "application/json",
  };

  const fetchCoupons = useCallback(
    async (silent = false) => {
      if (!adminToken) return;
      if (!silent) setLoading(true);
      try {
        const r = await fetch("/api/coupons/admin", { headers });
        if (r.ok) setCoupons(await r.json());
      } catch {
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [adminToken],
  );

  useEffect(() => {
    if (!adminToken) {
      navigate("/admin/login");
      return;
    }
    fetchCoupons();
  }, [adminToken]);

  const handleCreate = async () => {
    if (!form.code.trim()) {
      toast({ title: "خطأ", description: "رمز الكوبون مطلوب", variant: "destructive" });
      return;
    }

    const value = parseFloat(form.value);
    if (isNaN(value) || value <= 0) {
      toast({ title: "خطأ", description: "قيمة الخصم غير صالحة", variant: "destructive" });
      return;
    }

    setCreating(true);
    try {
      const body: any = {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value,
        min_order_amount: form.min_order_amount ? parseFloat(form.min_order_amount) : 0,
        max_uses: form.max_uses ? parseInt(form.max_uses) : null,
        expires_at: form.expires_at || null,
        description: form.description || null,
      };
      const r = await fetch("/api/coupons/admin", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      toast({ title: "تم إنشاء الكوبون", description: `رمز: ${result.code}` });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchCoupons(true);
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (coupon: Coupon) => {
    setToggling(coupon.id);
    try {
      const r = await fetch(`/api/coupons/admin/${coupon.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ is_active: !coupon.is_active }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      fetchCoupons(true);
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setToggling(null);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/coupons/admin/${id}`, { method: "DELETE", headers });
      fetchCoupons(true);
      toast({ title: "تم تعطيل الكوبون" });
    } catch {}
  };

  const activeCount = coupons.filter((c) => c.is_active).length;
  const totalUsed = coupons.reduce((a, c) => a + c.used_count, 0);

  return (
    <AdminLayout onRefresh={() => fetchCoupons()}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Tag className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-black">الكوبونات والخصومات</h1>
              <p className="text-xs text-muted-foreground">إنشاء وإدارة أكواد الخصم</p>
            </div>
          </div>
          <Button
            onClick={() => setShowCreate(true)}
            className="gap-1.5 text-sm bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 press-spring"
          >
            <Plus className="w-3.5 h-3.5" />
            كوبون جديد
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-border/60 rounded-2xl p-4 text-center float-in stagger-1">
            <div className="text-2xl font-black text-foreground tabular-nums">{coupons.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">إجمالي الكوبونات</div>
          </div>
          <div className="bg-card border border-border/60 rounded-2xl p-4 text-center float-in stagger-2">
            <div className="text-2xl font-black text-emerald-400 tabular-nums">{activeCount}</div>
            <div className="text-xs text-muted-foreground mt-0.5">نشطة</div>
          </div>
          <div className="bg-card border border-border/60 rounded-2xl p-4 text-center float-in stagger-3">
            <div className="text-2xl font-black text-primary tabular-nums">{totalUsed}</div>
            <div className="text-xs text-muted-foreground mt-0.5">مرات الاستخدام</div>
          </div>
        </div>

        {/* Create modal */}
        {showCreate && (
          <div
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center px-4"
            onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md float-in">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="font-black text-sm flex items-center gap-2">
                  <Tag className="w-4 h-4 text-primary" /> إنشاء كوبون جديد
                </h2>
                <button
                  onClick={() => {
                    setShowCreate(false);
                    setForm(EMPTY_FORM);
                  }}
                  className="p-1 rounded-lg hover:bg-muted transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Code */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">رمز الكوبون</Label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="SUMMER20"
                    className="font-mono uppercase"
                  />
                </div>

                {/* Type + Value */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">نوع الخصم</Label>
                    <div className="flex gap-1.5">
                      {(["percentage", "fixed"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setForm((f) => ({ ...f, type: t }))}
                          className={`flex-1 py-2 px-2 rounded-lg text-xs font-bold border transition-all press-spring ${
                            form.type === t
                              ? "bg-primary text-white border-primary"
                              : "bg-card border-border text-muted-foreground hover:border-border/80"
                          }`}
                        >
                          {t === "percentage" ? (
                            <>
                              <Percent className="w-3 h-3 inline ml-1" />
                              نسبة
                            </>
                          ) : (
                            <>
                              <Hash className="w-3 h-3 inline ml-1" />
                              مبلغ
                            </>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">
                      {form.type === "percentage" ? "النسبة (%)" : "المبلغ (د.ل)"}
                    </Label>
                    <Input
                      type="number"
                      value={form.value}
                      onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                      placeholder={form.type === "percentage" ? "20" : "5.00"}
                      min="0.01"
                      max={form.type === "percentage" ? "100" : undefined}
                    />
                  </div>
                </div>

                {/* Min order + max uses */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">حد أدنى للطلب (اختياري)</Label>
                    <Input
                      type="number"
                      value={form.min_order_amount}
                      onChange={(e) => setForm((f) => ({ ...f, min_order_amount: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">الحد الأقصى للاستخدام</Label>
                    <Input
                      type="number"
                      value={form.max_uses}
                      onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
                      placeholder="بلا حد"
                    />
                  </div>
                </div>

                {/* Expires at + description */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">تاريخ الانتهاء (اختياري)</Label>
                  <Input
                    type="datetime-local"
                    value={form.expires_at}
                    onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">وصف (اختياري)</Label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="مثال: خصم الصيف على الاشتراكات"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-2.5 pt-1">
                  <Button
                    onClick={handleCreate}
                    disabled={creating}
                    className="flex-1 bg-primary hover:bg-primary/90 press-spring gap-1.5"
                  >
                    {creating ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    {creating ? "جارٍ الإنشاء..." : "إنشاء الكوبون"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowCreate(false);
                      setForm(EMPTY_FORM);
                    }}
                    className="flex-1"
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <TableSkeleton />
        ) : coupons.length === 0 ? (
          <div className="bg-card border border-border/60 rounded-2xl py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted/30 border border-border/40 flex items-center justify-center mx-auto mb-3">
              <Tag className="w-6 h-6 opacity-20" />
            </div>
            <p className="font-bold text-foreground/50 text-sm mb-1">لا توجد كوبونات بعد</p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs text-primary hover:underline press-spring"
            >
              + إنشاء أول كوبون
            </button>
          </div>
        ) : (
          <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="hidden md:grid grid-cols-[1fr_90px_80px_70px_110px_80px_90px] gap-4 px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-bold text-muted-foreground">
              <span>الكوبون</span>
              <span>الخصم</span>
              <span>الحد الأدنى</span>
              <span>الاستخدام</span>
              <span>الانتهاء</span>
              <span>الحالة</span>
              <span>إجراءات</span>
            </div>

            <div className="divide-y divide-border/30">
              {coupons.map((coupon, i) => {
                const isExpired = coupon.expires_at && new Date(coupon.expires_at) < new Date();
                const isMaxed = coupon.max_uses !== null && coupon.used_count >= coupon.max_uses;
                const effectivelyActive = coupon.is_active && !isExpired && !isMaxed;
                return (
                  <div
                    key={coupon.id}
                    className={`flex flex-col md:grid md:grid-cols-[1fr_90px_80px_70px_110px_80px_90px] gap-2 md:gap-4 items-start md:items-center px-4 py-3 hover:bg-muted/15 transition-colors ${i % 2 !== 0 ? "bg-muted/5" : ""}`}
                  >
                    {/* Code + description */}
                    <div>
                      <div className="font-mono font-black text-sm tracking-wider text-foreground">
                        {coupon.code}
                      </div>
                      {coupon.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[180px]">
                          {coupon.description}
                        </div>
                      )}
                    </div>

                    {/* Value */}
                    <div className="flex items-center gap-1 font-black text-primary text-sm">
                      {coupon.type === "percentage" ? (
                        <>
                          <Percent className="w-3 h-3" />
                          {coupon.value}%
                        </>
                      ) : (
                        <>{coupon.value} د.ل</>
                      )}
                    </div>

                    {/* Min order */}
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {coupon.min_order_amount > 0 ? `${coupon.min_order_amount} د.ل` : "—"}
                    </div>

                    {/* Usage */}
                    <div className="text-xs tabular-nums font-bold">
                      <span className="text-foreground">{coupon.used_count}</span>
                      {coupon.max_uses !== null && (
                        <span className="text-muted-foreground">/{coupon.max_uses}</span>
                      )}
                      {coupon.max_uses === null && (
                        <InfinityIcon className="w-3 h-3 text-muted-foreground inline mr-1" />
                      )}
                    </div>

                    {/* Expiry */}
                    <div className="text-xs text-muted-foreground">
                      {coupon.expires_at ? (
                        <span className={isExpired ? "text-destructive" : ""}>
                          {formatDate(coupon.expires_at)}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <InfinityIcon className="w-3 h-3" /> بلا حد
                        </span>
                      )}
                    </div>

                    {/* Status */}
                    <div>
                      {effectivelyActive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle className="w-2.5 h-2.5" /> نشط
                        </span>
                      ) : isExpired ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full bg-muted/40 text-muted-foreground border border-border/40">
                          <Clock className="w-2.5 h-2.5" /> منتهي
                        </span>
                      ) : isMaxed ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                          <AlertCircle className="w-2.5 h-2.5" /> استُنفد
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full bg-muted/30 text-muted-foreground border border-border/40">
                          <XCircle className="w-2.5 h-2.5" /> معطل
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleToggle(coupon)}
                        disabled={toggling === coupon.id}
                        title={coupon.is_active ? "تعطيل" : "تفعيل"}
                        className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        {toggling === coupon.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : coupon.is_active ? (
                          <ToggleRight className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <ToggleLeft className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(coupon.id)}
                        title="حذف"
                        className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-4 py-2 border-t border-border/40 bg-muted/10 text-xs text-muted-foreground">
              {coupons.length} كوبون · {activeCount} نشط
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
