import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { formatRelativeTime } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

/**
 * Admin Promotions / Flash Sales
 *
 * Manages the previously dormant flash-sales subsystem. Schema-level
 * partial unique index guarantees only ONE active row at a time —
 * the create/activate UI surfaces this with a clear error message
 * when the operator tries to create a second active sale.
 *
 * The discount-percent input is hard-capped at 95% (matches backend
 * validation) so the catalog cannot enter a "free goods" state when
 * a fixed-amount coupon stacks on top.
 */

interface FlashSale {
  id: number;
  title: string;
  discount_percent: number;
  ends_at: string;
  is_active: boolean;
  is_currently_active: boolean;
  created_at: string;
}

const EMPTY_FORM = {
  title: "Flash Sale",
  discount_percent: "20",
  // Default to 24h from now (ISO local-style for the datetime-local input).
  ends_at: (() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // datetime-local expects YYYY-MM-DDTHH:MM (no Z).
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })(),
};

export default function AdminPromotionsPage() {
  const { adminToken } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [sales, setSales] = useState<FlashSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  const headers = { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };

  async function load() {
    if (!adminToken) return;
    setLoading(true);
    try {
      const r = await fetch("/api/admin/flash-sales", { headers });
      const d = await r.json();
      setSales(d.flash_sales ?? []);
    } catch (err) {
      toast({
        title: "تعذّر تحميل العروض",
        description: err instanceof Error ? err.message : "خطأ غير معروف",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [adminToken]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!adminToken) return;
    const discount = parseFloat(form.discount_percent);
    if (!Number.isFinite(discount) || discount <= 0 || discount > 95) {
      toast({ title: "نسبة الخصم بين 0 و 95.", variant: "destructive" });
      return;
    }
    const endsAt = new Date(form.ends_at);
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() < Date.now() + 5 * 60 * 1000) {
      toast({ title: "وقت الانتهاء يجب أن يكون بعد 5 دقائق على الأقل.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch("/api/admin/flash-sales", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: form.title.trim() || "Flash Sale",
          discount_percent: discount,
          ends_at: endsAt.toISOString(),
        }),
      });
      const body = await r.json();
      if (!r.ok) {
        toast({
          title: r.status === 409 ? "يوجد عرض نشط بالفعل" : "تعذّر الإنشاء",
          description: body?.error ?? `HTTP ${r.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "تم إنشاء العرض ✅" });
      setShowForm(false);
      setForm(EMPTY_FORM);
      void load();
    } catch (err) {
      toast({
        title: "تعذّر الإنشاء",
        description: err instanceof Error ? err.message : "خطأ غير معروف",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(sale: FlashSale, next: boolean) {
    if (!adminToken) return;
    try {
      const r = await fetch(`/api/admin/flash-sales/${sale.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ is_active: next }),
      });
      const body = await r.json();
      if (!r.ok) {
        toast({
          title: r.status === 409 ? "يوجد عرض نشط آخر" : "تعذّر التحديث",
          description: body?.error ?? `HTTP ${r.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: next ? "تم التفعيل" : "تم الإيقاف" });
      void load();
    } catch (err) {
      toast({
        title: "تعذّر التحديث",
        description: err instanceof Error ? err.message : "خطأ غير معروف",
        variant: "destructive",
      });
    }
  }

  async function handleDelete(sale: FlashSale) {
    if (!adminToken) return;
    if (!confirm(`إيقاف العرض "${sale.title}" نهائياً؟`)) return;
    try {
      const r = await fetch(`/api/admin/flash-sales/${sale.id}`, { method: "DELETE", headers });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        toast({ title: "تعذّر الإيقاف", description: body?.error, variant: "destructive" });
        return;
      }
      toast({ title: "تم الإيقاف" });
      void load();
    } catch (err) {
      toast({
        title: "تعذّر الإيقاف",
        description: err instanceof Error ? err.message : "خطأ غير معروف",
        variant: "destructive",
      });
    }
  }

  if (!adminToken) return null;

  const hasActive = sales.some((s) => s.is_currently_active);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-black text-lg">العروض السريعة</h1>
            <p className="text-xs text-muted-foreground">
              عرض واحد نشط في كل وقت — يطبَّق على المتجر بأكمله
            </p>
          </div>
        </div>
        <Button
          onClick={() => setShowForm((v) => !v)}
          disabled={hasActive && !showForm}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          {showForm ? "إغلاق النموذج" : "إنشاء عرض"}
        </Button>
      </div>

      {hasActive && !showForm && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            يوجد عرض نشط حالياً. أوقف العرض الحالي قبل إنشاء عرض جديد — يُسمح بعرض واحد فقط في كل
            وقت.
          </span>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-card border border-border/55 rounded-2xl p-5 space-y-4"
        >
          <h2 className="font-black text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> إنشاء عرض جديد
          </h2>

          <div>
            <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
              عنوان العرض
            </Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="عرض رمضان، تخفيضات الصيف…"
              maxLength={255}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                نسبة الخصم (%)
              </Label>
              <Input
                type="number"
                min="1"
                max="95"
                step="1"
                value={form.discount_percent}
                onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))}
                required
                dir="ltr"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                الحد الأقصى 95% — يحمي من بيع المنتج مجاناً عند تجمع الكوبونات.
              </p>
            </div>
            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                ينتهي في
              </Label>
              <Input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                required
                dir="ltr"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                يجب أن يكون بعد 5 دقائق من الآن على الأقل، وأقل من 30 يوماً.
              </p>
            </div>
          </div>

          {/* Live preview */}
          {(() => {
            const d = parseFloat(form.discount_percent);
            if (!Number.isFinite(d) || d <= 0) return null;
            return (
              <div className="p-3 rounded-xl border border-primary/25 bg-primary/8">
                <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
                  معاينة سريعة
                </div>
                <div className="text-xs text-foreground/90 leading-relaxed">
                  منتج بسعر <span className="font-mono font-bold">10.00 د.ل</span> سيُعرض بـ{" "}
                  <span className="font-mono font-bold text-primary">
                    {(10 * (1 - d / 100)).toFixed(2)} د.ل
                  </span>{" "}
                  (وفر {d}%).
                  {d >= 30 && (
                    <span className="block mt-1 text-amber-500">
                      ⚠ خصم كبير — راجع الهامش في حاسبة الأسعار قبل التفعيل.
                    </span>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_FORM);
              }}
            >
              إلغاء
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {submitting ? "جارٍ الإنشاء…" : "إنشاء وتفعيل"}
            </Button>
          </div>
        </form>
      )}

      {/* List */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold">السجل</h2>
          <span className="text-[10px] text-muted-foreground">
            {sales.length} {sales.length === 1 ? "عرض" : "عروض"}
          </span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 rounded-2xl skeleton-shimmer" />
            ))}
          </div>
        ) : sales.length === 0 ? (
          <div className="bg-card border border-border/55 rounded-2xl p-8 text-center">
            <Zap className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-bold mb-1">لا توجد عروض بعد</p>
            <p className="text-xs text-muted-foreground">
              اضغط "إنشاء عرض" لإطلاق أول حملة تخفيضات.
            </p>
          </div>
        ) : (
          sales.map((s) => {
            const endsAt = new Date(s.ends_at);
            const expired = endsAt.getTime() < Date.now();
            return (
              <div
                key={s.id}
                className={`bg-card border rounded-2xl p-4 ${
                  s.is_currently_active
                    ? "border-emerald-500/30 ring-1 ring-emerald-500/15"
                    : "border-border/55"
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-sm truncate">{s.title}</h3>
                      {s.is_currently_active && (
                        <span className="text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle className="w-2.5 h-2.5" /> نشط
                        </span>
                      )}
                      {expired && s.is_active && (
                        <span className="text-[10px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/25 px-1.5 py-0.5 rounded-full">
                          منتهٍ — في انتظار التنظيف التلقائي
                        </span>
                      )}
                      {!s.is_active && (
                        <span className="text-[10px] font-bold bg-muted/40 text-muted-foreground border border-border px-1.5 py-0.5 rounded-full">
                          متوقف
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="font-mono font-bold text-primary">
                        {s.discount_percent}% خصم
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        ينتهي{" "}
                        {expired
                          ? `قبل ${formatRelativeTime(s.ends_at)}`
                          : formatRelativeTime(s.ends_at)}
                      </span>
                      <span className="text-[10px] opacity-60">#{s.id}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {s.is_active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleActive(s, false)}
                        className="gap-1.5"
                      >
                        <Pause className="w-3.5 h-3.5" /> إيقاف
                      </Button>
                    ) : (
                      !expired && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive(s, true)}
                          className="gap-1.5"
                        >
                          <Play className="w-3.5 h-3.5" /> تفعيل
                        </Button>
                      )
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(s)}
                      className="gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-[10px] text-muted-foreground text-center pt-2">
        تطبَّق الخصومات تلقائياً على جميع المنتجات في المتجر. تنتهي العروض تلقائياً بعد وقت الانتهاء؛
        خدمة التنظيف الخلفية تُحدّث الحالة كل 5 دقائق.
      </p>
    </div>
  );
}
