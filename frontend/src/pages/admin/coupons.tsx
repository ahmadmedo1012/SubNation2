import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { TableSkeleton as SharedTableSkeleton } from "@/components/admin/TableSkeleton";
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// 93-C7 / C-UX2 (A12 §11.1): status pills ride the canonical
// StatusBadge + --status-* tokens instead of raw emerald/yellow hues.
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirm } from "@/hooks/use-confirm";
import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatDate, formatCurrency, localDateTimeToUtcIso } from "@/lib/utils";
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

function TableSkeleton() {
  return (
    <SharedTableSkeleton
      rows={5}
      cells={[
        "w-24",
        "rounded-full w-16 shrink-0",
        "w-16 shrink-0",
        "flex-1 w-20",
        "w-14 shrink-0",
        "w-16 shrink-0",
      ]}
      zebra={false}
    />
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
  // 93-C7 / C-UX3 (A12 §1.3 + A5 C-1): the raw window.confirm on
  // coupon delete is replaced by the shared styled confirm — the
  // message now also NAMES the coupon (code + value), which the
  // native confirm never did.
  const { confirm, ConfirmDialog } = useConfirm();

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  // Round-4 (org §2/§6a): the old fetchCoupons swallowed BOTH network
  // errors and non-OK HTTP responses with a bare `catch {}` — the admin
  // list could fail with zero UI signal. The failure now surfaces as an
  // inline banner (plus a toast on the initial load).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);

  // 98-F7 (R98-05): dirty-state guard — a half-filled coupon form is
  // un-submitted work, so a refresh/tab-close mid-edit (or with a
  // dismissed-but-surviving draft, the 93-C7/C-UX3 behavior) prompts
  // before silently destroying it. Identity compare vs the module-level
  // EMPTY_FORM constant is exact: useState seeds it, setForm(EMPTY_FORM)
  // on success resets it, every user keystroke mints a new object.
  // SPA route-leave interception stays a documented residual
  // (see use-dirty-guard.ts).
  useDirtyGuard(form !== EMPTY_FORM);

  // 93-C7 / C-UX3 (A5 A-3 header drift): the hand-built
  // `Authorization: adminToken ? Bearer : ""` map is swapped for the
  // shared hook (empty-Bearer when logged out is neutralized centrally,
  // and the 401 session-expiry observer rides along).
  const headers = useAdminHeaders({ json: true });

  const fetchCoupons = useCallback(
    async (silent = false) => {
      if (!adminToken) return;
      if (!silent) setLoading(true);
      try {
        const r = await fetch("/api/coupons/admin", { headers });
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          // getErrorMessage maps the backend `code` to Arabic.
          const msg = getErrorMessage(body) || `فشل تحميل الكوبونات (HTTP ${r.status})`;
          setLoadError(msg);
          if (!silent) {
            toast({ title: "تعذّر تحميل الكوبونات", description: msg, variant: "destructive" });
          }
          return;
        }
        setLoadError(null);
        setCoupons(await r.json());
      } catch (err) {
        // Network-level failure (offline/DNS) — same surfacing.
        const msg = getErrorMessage(err);
        setLoadError(msg);
        if (!silent) {
          toast({ title: "تعذّر تحميل الكوبونات", description: msg, variant: "destructive" });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [adminToken, headers],
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
      const body: Record<string, unknown> = {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value,
        min_order_amount: form.min_order_amount ? parseFloat(form.min_order_amount) : 0,
        max_uses: form.max_uses ? parseInt(form.max_uses) : null,
        // 93-C7 / C-UX4 (A5 C-2 + A12 §11.2): `datetime-local` values are
        // NAIVE (no timezone). Sent raw, the UTC server reads the
        // operator's local wall-clock as UTC — a coupon meant to die at
        // 23:59 Libya time stayed redeemable until 01:59/02:59 the next
        // day (money leak: customers kept buying under a discount the
        // admin believed had ended). localDateTimeToUtcIso (the shared
        // helper C6 extracted from promotions.tsx's correct pattern)
        // re-encodes the intended instant as a true UTC ISO string.
        expires_at: localDateTimeToUtcIso(form.expires_at),
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
      // Form resets ONLY on success (93-C7 / C-UX3): previously every
      // dismiss path (backdrop click, X, إلغاء) wiped a half-filled
      // form — the exact A12 F-01 data-loss class. A dismissed draft
      // now survives reopening the dialog.
      setForm(EMPTY_FORM);
      fetchCoupons(true);
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشلت العملية",
        variant: "destructive",
      });
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
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشلت العملية",
        variant: "destructive",
      });
    } finally {
      setToggling(null);
    }
  };

  const handleDelete = async (coupon: Coupon) => {
    // 93-C7 / C-UX3 (A5 C-1): the native confirm named NO coupon — an
    // admin could disable the wrong row on a touch screen. The styled
    // confirm now shows code + value + explicit تعطيل semantics.
    const confirmed = await confirm({
      title: "تعطيل الكوبون؟",
      description: `سيتم تعطيل الكوبون ${coupon.code} (${
        coupon.type === "percentage" ? `${coupon.value}%` : formatCurrency(coupon.value)
      }) — لن يقبله العملاء بعد الآن.`,
      confirmLabel: "تعطيل",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const r = await fetch(`/api/coupons/admin/${coupon.id}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error((await r.json()).error);
      fetchCoupons(true);
      toast({ title: "تم تعطيل الكوبون" });
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشل تنفيذ العملية",
        variant: "destructive",
      });
    }
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

        {/* Create modal — 93-C7 / C-UX3 (A12 §11.2, H5): migrated from
            the hand-rolled fixed overlay to the shared AppDialog. Gained:
            focus trap + ESC + scroll-lock + role="dialog" + mobile
            bottom-sheet + the Radix animation family; ESC/backdrop/close
            are loading-guarded while `creating`, and dismissing NO
            LONGER resets the form (draft survives reopening). */}
        <AppDialog
          open={showCreate}
          onOpenChange={setShowCreate}
          title="إنشاء كوبون جديد"
          dismissable={!creating}
          size="md"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="flex-1 sm:flex-none"
              >
                إلغاء
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 bg-primary hover:bg-primary/90 press-spring gap-1.5 sm:flex-none"
              >
                {creating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                {creating ? "جارٍ الإنشاء…" : "إنشاء الكوبون"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Code */}
            <div className="space-y-1.5">
              <Label htmlFor="coupons-f1-15956" className="text-xs font-bold">
                رمز الكوبون
              </Label>
              <Input
                id="coupons-f1-15956"
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
                <Label htmlFor="coupons-f3-25257" className="text-xs font-bold">
                  {form.type === "percentage" ? "النسبة (%)" : "المبلغ (د.ل)"}
                </Label>
                <Input
                  id="coupons-f3-25257"
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
                <Label htmlFor="coupons-f4-28708" className="text-xs font-bold">
                  حد أدنى للطلب (اختياري)
                </Label>
                <Input
                  id="coupons-f4-28708"
                  type="number"
                  value={form.min_order_amount}
                  onChange={(e) => setForm((f) => ({ ...f, min_order_amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coupons-f5-30186" className="text-xs font-bold">
                  الحد الأقصى للاستخدام
                </Label>
                <Input
                  id="coupons-f5-30186"
                  type="number"
                  value={form.max_uses}
                  onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
                  placeholder="بلا حد"
                />
              </div>
            </div>

            {/* Expires at + description */}
            <div className="space-y-1.5">
              <Label htmlFor="coupons-f6-31815" className="text-xs font-bold">
                تاريخ الانتهاء (اختياري)
              </Label>
              <Input
                id="coupons-f6-31815"
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
              />
              {/* 93-C7 / C-UX4: honest hint — the naive local value is
                  converted to UTC on save; without it operators assumed
                  the server shared their wall-clock. */}
              <p className="text-[11px] text-muted-foreground">
                يُحوَّل تلقائياً إلى التوقيت العالمي (UTC) عند الحفظ — ينتهي في نفس اللحظة التي
                تحددها هنا.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="coupons-f7-15994" className="text-xs font-bold">
                وصف (اختياري)
              </Label>
              <Input
                id="coupons-f7-15994"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="مثال: خصم الصيف على الاشتراكات"
              />
            </div>
          </div>
        </AppDialog>

        {/* Table */}
        {loading ? (
          <TableSkeleton />
        ) : (
          <>
            {/* Failure banner: shown ABOVE whatever data we already have —
                a failed refresh (or initial load) never blanks a list the
                admin was already looking at. */}
            {loadError && (
              <div
                role="alert"
                className="mb-4 p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loadError}</span>
                <button
                  type="button"
                  onClick={() => fetchCoupons()}
                  className="ms-auto text-xs underline underline-offset-2 hover:opacity-80 press-spring"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}
            {coupons.length === 0 && !loadError ? (
              <EmptyState
                icon={Tag}
                title="لا توجد كوبونات بعد"
                action={
                  <button
                    onClick={() => setShowCreate(true)}
                    className="text-xs text-primary hover:underline press-spring"
                  >
                    + إنشاء أول كوبون
                  </button>
                }
              />
            ) : coupons.length > 0 ? (
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
                    const isMaxed =
                      coupon.max_uses !== null && coupon.used_count >= coupon.max_uses;
                    const effectivelyActive = coupon.is_active && !isExpired && !isMaxed;
                    return (
                      <div
                        key={coupon.id}
                        className={`flex flex-col md:grid md:grid-cols-[1fr_90px_80px_70px_110px_80px_90px] gap-2 md:gap-4 items-start md:items-center px-4 py-3 hover:bg-muted/20 transition-colors ${i % 2 !== 0 ? "bg-muted/5" : ""}`}
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
                            /* 93-C7 / C-UX5 (A5 C-3): formatCurrency instead
                               of the raw `{value} د.ل` — fixed-value coupons
                               now read "5.00 د.ل" like every other money
                               surface in the app. */
                            <>{formatCurrency(coupon.value)}</>
                          )}
                        </div>

                        {/* Min order */}
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {coupon.min_order_amount > 0
                            ? formatCurrency(coupon.min_order_amount)
                            : "—"}
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

                        {/* Status — 93-C7 / C-UX2 (A12 B8): canonical
                            StatusBadge (success/warning/neutral tones on
                            the --status-* tokens) replaces the four
                            raw-hue pills. */}
                        <div>
                          {effectivelyActive ? (
                            <StatusBadge variant="success" icon={CheckCircle}>
                              نشط
                            </StatusBadge>
                          ) : isExpired ? (
                            <StatusBadge variant="warning" icon={Clock}>
                              منتهي
                            </StatusBadge>
                          ) : isMaxed ? (
                            <StatusBadge variant="warning" icon={AlertCircle}>
                              استُنفد
                            </StatusBadge>
                          ) : (
                            <StatusBadge variant="neutral" icon={XCircle}>
                              معطل
                            </StatusBadge>
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
                            onClick={() => handleDelete(coupon)}
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
            ) : null}
          </>
        )}
      </div>
      <ConfirmDialog />
    </AdminLayout>
  );
}

// AUD103-6-F2 (r103): admin form labels programmatically associated with their controls.
