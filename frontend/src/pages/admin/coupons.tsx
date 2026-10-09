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
// R123 (E3 item 1): the four raw fetches ride the session-aware wrapper
// — this is the page that made admin-session.ts's /api/coupons/admin
// 401 extension (isAdminApiUrl) LIVE: a finance cookie expiring mid-work
// now gets the global «انتهت الجلسة» toast + redirect instead of a
// per-action «فشلت العملية» retry-loop toast. adminFetchJson also owns
// the ok-guard + safe error-body parse, so the old unguarded r.json()
// on error paths (English SyntaxError on a non-JSON 502) is gone.
import { AdminSessionExpiredError, adminFetchJson } from "@/lib/admin-session";
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

// 110-M (109-m P3): client-side parity with the backend create route
// (backend/src/routes/coupons.ts) — percentage coupons are rejected at
// value >= 100 (r4 red-team F-3: a 100% coupon zeroes finalPrice and the
// checkout INVALID_PRICE gate fail-closes on every purchase), and ALL
// values are capped at 10,000 LYD (MAX_FIXED_COUPON_VALUE — a direct
// wallet-debit magnitude at checkout). Mirrored here so the form blocks
// submit with an inline Arabic error instead of surfacing the server's
// 400 after a round-trip.
const MAX_FIXED_COUPON_VALUE = 10_000; // LYD — mirror of the backend bound

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
  // 110-M (109-m P3): inline validation error for the value field (see
  // the handleCreate parity guards) — cleared on any value/type edit.
  const [valueError, setValueError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  // R125-I3 (A2-16): per-row busy guard for the archive DELETE — a
  // double-click fired two DELETEs; the second 404'd and stacked an
  // error toast on top of the success toast.
  const [archiving, setArchiving] = useState<number | null>(null);

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
        // R123 (E3 item 1): adminFetchJson owns the ok-guard + safe
        // error-body parse (the old unguarded error-path r.json() threw
        // an English SyntaxError into an Arabic toast on a non-JSON 502).
        const list = await adminFetchJson<Coupon[]>("/api/coupons/admin", { headers });
        setLoadError(null);
        setCoupons(list);
      } catch (err) {
        // Session expiry already toasted + redirected — no noise on top.
        if (err instanceof AdminSessionExpiredError) return;
        // Network-level failure (offline/DNS) or a non-OK envelope —
        // same surfacing the inline !r.ok path had.
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

    // 110-M (109-m P3): parity guards — the exact bounds the backend
    // create route enforces (percentage < 100, value <= 10,000 LYD),
    // blocked here with an inline Arabic error BEFORE the round-trip.
    // The >= 100 wording matches the server's 400 message verbatim.
    if (form.type === "percentage" && value >= 100) {
      setValueError("نسبة الخصم يجب أن تكون أقل من 100% (السعر لا يمكن أن يصل إلى صفر)");
      return;
    }
    if (value > MAX_FIXED_COUPON_VALUE) {
      setValueError(
        `قيمة الخصم يجب ألا تتجاوز ${MAX_FIXED_COUPON_VALUE.toLocaleString("en-US")} د.ل`,
      );
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
      const result = await adminFetchJson<{ code: string }>("/api/coupons/admin", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      // R124-I5 (A6 F1): success variant.
      toast({ title: "تم إنشاء الكوبون", description: `رمز: ${result.code}`, variant: "success" });
      setShowCreate(false);
      // Form resets ONLY on success (93-C7 / C-UX3): previously every
      // dismiss path (backdrop click, X, إلغاء) wiped a half-filled
      // form — the exact A12 F-01 data-loss class. A dismissed draft
      // now survives reopening the dialog.
      setForm(EMPTY_FORM);
      // 110-M (109-m P3): the guard error dies with the form it belonged
      // to.
      setValueError(null);
      fetchCoupons(true);
    } catch (err: unknown) {
      // R123 (E3 item 1): 401 = session expiry — the global handler
      // already toasted + redirected; no generic error toast on top.
      if (err instanceof AdminSessionExpiredError) return;
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
      await adminFetchJson(`/api/coupons/admin/${coupon.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ is_active: !coupon.is_active }),
      });
      fetchCoupons(true);
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) return;
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
    // confirm now shows code + value.
    // R125-I3 (A2-16): honest verb — DELETE /api/coupons/admin/:id is a
    // SOFT ARCHIVE (routes/coupons.ts sets isActive:false, audits
    // coupon.archive; PATCH can resurrect the row), NOT a hard delete.
    // The button said «حذف» while the confirm said «تعطيل» — every
    // surface now says «أرشفة».
    const confirmed = await confirm({
      title: "أرشفة الكوبون؟",
      description: `سيتم أرشفة الكوبون ${coupon.code} (${
        coupon.type === "percentage" ? `${coupon.value}%` : formatCurrency(coupon.value)
      }) — يتوقف قبوله فوراً، ويبقى في السجل ويمكن استعادته لاحقاً.`,
      confirmLabel: "أرشفة",
      destructive: true,
    });
    if (!confirmed) return;
    setArchiving(coupon.id);
    try {
      await adminFetchJson(`/api/coupons/admin/${coupon.id}`, { method: "DELETE", headers });
      fetchCoupons(true);
      // R124-I5 (A6 F1): success variant. R125-I3 (A2-16): the toast
      // names the ARCHIVE outcome, matching what the API did.
      toast({ title: "تمت أرشفة الكوبون", variant: "success" });
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "خطأ",
        // B14-11 (R127-L11, same-file cheap pass): unified to the file's
        // majority fallback «فشلت العملية» (:255/:276) — the cross-repo
        // fallback canon decision stays deferred to R128 per B14's
        // batching.
        description: err instanceof Error ? err.message : "فشلت العملية",
        variant: "destructive",
      });
    } finally {
      setArchiving(null);
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
              <h1 className="text-lg font-bold">الكوبونات والخصومات</h1>
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
            <div className="text-2xl font-bold text-foreground tabular-nums">{coupons.length}</div>
            {/* R120-B4 (A2-F22): honest wording. The list endpoint
                (routes/coupons.ts AUD103-4-F9) caps at 200 newest rows
                with NO page param — «إجمالي الكوبونات» claimed a total
                the payload cannot know once the cap is hit. A short list
                IS the whole set (the total is then true); a full 200-row
                page switches to «عرض N (الأحدث أولاً)». Load-more is not
                trivial against the hand-rolled fetch here (no page
                contract server-side) — wording honesty this round. */}
            <div className="text-xs text-muted-foreground mt-0.5">
              {coupons.length >= 200 ? `عرض ${coupons.length} (الأحدث أولاً)` : "إجمالي الكوبونات"}
            </div>
          </div>
          <div className="bg-card border border-border/60 rounded-2xl p-4 text-center float-in stagger-2">
            <div className="text-2xl font-bold text-emerald-400 tabular-nums">{activeCount}</div>
            <div className="text-xs text-muted-foreground mt-0.5">نشطة</div>
          </div>
          <div className="bg-card border border-border/60 rounded-2xl p-4 text-center float-in stagger-3">
            <div className="text-2xl font-bold text-primary tabular-nums">{totalUsed}</div>
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
                      onClick={() => {
                        // 110-M (109-m P3): a type switch re-scales the
                        // value field — drop any stale guard error.
                        setValueError(null);
                        setForm((f) => ({ ...f, type: t }));
                      }}
                      /* R126-L3 (A4 quick-win): the active chip was purely
                         visual (bg-primary) — a screen reader announced
                         «نسبة / مبلغ» as two identical buttons with no
                         state. aria-pressed exposes the toggle (the
                         topups/orders status-tab chip idiom those pages'
                         comments already cite as "the coupons.tsx chip-bar
                         idiom" — the citation finally points at a real
                         implementation). */
                      aria-pressed={form.type === t}
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
                  onChange={(e) => {
                    // 110-M (109-m P3): any edit clears the stale guard
                    // error (re-validated on the next submit).
                    setValueError(null);
                    setForm((f) => ({ ...f, value: e.target.value }));
                  }}
                  placeholder={form.type === "percentage" ? "20" : "5.00"}
                  min="0.01"
                  max={form.type === "percentage" ? "100" : undefined}
                />
                {/* 110-M (109-m P3): inline parity-guard error — the same
                    text-xs/text-destructive field-error idiom as
                    settings.tsx / wallet.tsx. */}
                {valueError && (
                  <p className="text-xs text-destructive" role="alert">
                    {valueError}
                  </p>
                )}
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
              <p className="text-2xs text-muted-foreground">
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
                          <div className="font-mono font-bold text-sm tracking-wider text-foreground">
                            {coupon.code}
                          </div>
                          {coupon.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-[180px]">
                              {coupon.description}
                            </div>
                          )}
                        </div>

                        {/* Value */}
                        <div>
                          {/* R125-I3 (A2-17): the header row is hidden below
                              md — a bare stacked "5.00 د.ل" cell was
                              indistinguishable from الحد الأدنى. Each cell
                              gains a text-3xs field label visible ONLY on
                              the mobile flex-col layout. */}
                          <span className="md:hidden text-3xs font-bold text-muted-foreground/70 block mb-0.5">
                            الخصم
                          </span>
                          <div className="flex items-center gap-1 font-bold text-primary text-sm">
                            {coupon.type === "percentage" ? (
                              <>
                                <Percent className="w-3 h-3" />
                                {coupon.value}%
                              </>
                            ) : (
                              <>
                                {/* 93-C7 / C-UX5 (A5 C-3): formatCurrency instead
                               of the raw `{value} د.ل` — fixed-value coupons
                               now read "5.00 د.ل" like every other money
                               surface in the app. */}
                                <>{formatCurrency(coupon.value)}</>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Min order */}
                        <div className="text-xs text-muted-foreground tabular-nums">
                          <span className="md:hidden text-3xs font-bold text-muted-foreground/70 block mb-0.5">
                            الحد الأدنى
                          </span>
                          {coupon.min_order_amount > 0
                            ? formatCurrency(coupon.min_order_amount)
                            : "—"}
                        </div>

                        {/* Usage */}
                        <div className="text-xs tabular-nums font-bold">
                          <span className="md:hidden text-3xs font-bold text-muted-foreground/70 block mb-0.5">
                            الاستخدام
                          </span>
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
                          <span className="md:hidden text-3xs font-bold text-muted-foreground/70 block mb-0.5">
                            الانتهاء
                          </span>
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
                          <span className="md:hidden text-3xs font-bold text-muted-foreground/70 block mb-0.5">
                            الحالة
                          </span>
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
                        <div>
                          <span className="md:hidden text-3xs font-bold text-muted-foreground/70 block mb-0.5">
                            إجراءات
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleToggle(coupon)}
                              disabled={toggling === coupon.id}
                              title={coupon.is_active ? "تعطيل" : "تفعيل"}
                              aria-label={
                                coupon.is_active
                                  ? `تعطيل الكوبون ${coupon.code}`
                                  : `تفعيل الكوبون ${coupon.code}`
                              }
                              aria-pressed={coupon.is_active}
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
                              /* R125-I3 (A2-16): «أرشفة» — the DELETE is a
                                 soft archive (isActive:false), not a hard
                                 delete; the old «حذف» label over-promised
                                 destruction the API never performs. */
                              disabled={archiving === coupon.id}
                              title="أرشفة"
                              aria-label={`أرشفة الكوبون ${coupon.code}`}
                              className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                            >
                              {archiving === coupon.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
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
