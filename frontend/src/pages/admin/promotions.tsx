import { useConfirm } from "@/hooks/useConfirm";
import { useAdminHeaders } from "@/hooks/useAdminHeaders";
import { useDirtyGuard } from "@/hooks/useDirtyGuard";
import { useToast } from "@/hooks/useToast";
// R123 (E3 item 1): load/create/delete ride the session-aware wrappers
// (a 401 mid-work gets the global «انتهت الجلسة» toast + redirect);
// toggleActive keeps its R122 isAdminUnauthorized shape — plus the
// L13-1 (R143) 20 s timeout via adminFetch.
import {
  AdminSessionExpiredError,
  adminFetch,
  adminFetchJson,
  isAdminUnauthorized,
} from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE decomposition): the flash-sale page's presentational sections
// and pure metadata moved to @/components/admin/promotions/* (verbatim
// moves — the money path stays HERE: the sales list fetch, handleCreate
// (the create POST with the 0–95% + 5-minute + 30-day guards), toggleActive
// (the money-gated activate confirm + the activate/deactivate PATCH) and
// handleDelete (the confirm-gated permanent DELETE), plus every
// form/busy atom; the extracts render the byte-identical DOM they
// rendered inline yesterday). Import surface:
//   • promotions-meta — the pure module (the FlashSale/PromotionForm
//     contracts, the EMPTY_FORM seed the dirty guard identity-compares,
//     the 30-day MAX_DURATION_MS backend-bound mirror)
//   • PromotionsHeader — the h1 + «إنشاء عرض» CTA + the one-active-sale
//     warning banner
//   • CreatePromotionForm — the create shell (the page-owned form atom
//     rides down; submit/cancel fire through page-owned callbacks)
//   • PromotionsList — the «السجل» section: skeleton / error card /
//     empty state / the sale rows with their activate/stop/delete actions
import {
  EMPTY_FORM,
  MAX_DURATION_MS,
  type FlashSale,
} from "@/components/admin/promotions/promotions-meta";
import { PromotionsHeader } from "@/components/admin/promotions/PromotionsHeader";
import { CreatePromotionForm } from "@/components/admin/promotions/CreatePromotionForm";
import { PromotionsList } from "@/components/admin/promotions/PromotionsList";

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

export default function AdminPromotionsPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("inventory");
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [, navigate] = useLocation();

  const [sales, setSales] = useState<FlashSale[]>([]);
  const [loading, setLoading] = useState(true);
  // 94-C2 (A2 P2-9): the failure is a first-class surface — an error
  // card replaces the empty state so an outage can't masquerade as a
  // clean «لا توجد عروض بعد» history (the toast alone still left the
  // misleading empty card under it).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  // R158 (admin polish): the create-form field guards go INLINE (the
  // coupons.tsx valueError idiom) — a toast-only validation fired far
  // from the field it rejected; toasts stay reserved for server
  // errors. One error atom per guarded field, cleared on edit.
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [endsAtError, setEndsAtError] = useState<string | null>(null);
  // R147 (2-c D3): per-row busy guard for the store-repricing
  // activate/stop PATCH and the permanent DELETE — a double-click fired
  // two requests; the coupons.tsx `toggling`/`archiving` idiom (armed
  // only AFTER the confirm accepts, reset on every exit path).
  const [busyId, setBusyId] = useState<number | null>(null);

  // 98-F7 (R98-05): dirty-state guard — an edited flash-sale draft is
  // un-submitted work; a refresh/tab-close mid-edit now prompts instead
  // of silently wiping it (zero beforeunload existed repo-wide). Identity
  // compare vs the module-level EMPTY_FORM constant: useState seeds it,
  // setForm(EMPTY_FORM) resets it, user edits mint a new object. SPA
  // route-leave interception stays a documented residual
  // (see use-dirty-guard.ts).
  useDirtyGuard(form !== EMPTY_FORM);

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  const headers = useAdminHeaders({ json: true });

  // R169 (lint-zero): load wrapped in useCallback so the mount effect
  // can key on it honestly (canView/headers/toast all stable — boolean,
  // the useAdminHeaders useMemo, the useToast module-level fn).
  const load = useCallback(async () => {
    // R134 (A3-F1): fetch-free for a scope-less deep-link mount.
    if (!canView) return;
    if (!adminToken) return;
    setLoading(true);
    setLoadError(null);
    try {
      // R123 (E3 item 1): adminFetchJson owns the ok-guard + safe parse
      // (the old inline path parsed the error envelope by hand).
      const d = await adminFetchJson<{ flash_sales?: FlashSale[] }>("/api/admin/flash-sales", {
        headers,
      });
      setSales(Array.isArray(d?.flash_sales) ? d.flash_sales : []);
    } catch (err) {
      // Session expiry already toasted + redirected — not a load error.
      if (err instanceof AdminSessionExpiredError) return;
      // R148 (3-errcopy): getErrorMessage passes the wrapper's Arabic
      // body messages through and collapses network-level English —
      // the raw extractor leaked it into the error card + toast.
      const message = getErrorMessage(err);
      setLoadError(message);
      toast({
        title: "تعذّر تحميل العروض",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [canView, adminToken, headers, toast]);

  useEffect(() => {
    void load();
  }, [adminToken, load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!adminToken) return;
    const discount = parseFloat(form.discount_percent);
    // R158 (admin polish): the field guards render INLINE under their
    // fields (the coupons valueError idiom) — role="alert" +
    // text-status-error; the toast channel stays reserved for server
    // errors.
    if (!Number.isFinite(discount) || discount <= 0 || discount > 95) {
      setDiscountError("نسبة الخصم بين 0 و 95.");
      return;
    }
    const endsAt = new Date(form.ends_at);
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() < Date.now() + 5 * 60 * 1000) {
      setEndsAtError("وقت الانتهاء يجب أن يكون بعد 5 دقائق على الأقل.");
      return;
    }
    // R125-I3 (A2-21): mirror the backend's 30-day ceiling client-side
    // (same message wording as the server's 400) — the hint promised it,
    // the round-trip no longer has to.
    if (endsAt.getTime() > Date.now() + MAX_DURATION_MS) {
      setEndsAtError("أقصى مدة للعرض 30 يوماً.");
      return;
    }

    setSubmitting(true);
    try {
      // R123 (E3 item 1): adminFetch keeps the Response (the 409-specific
      // title below needs the status) while adding the 401 conversion —
      // a session expiry throws AdminSessionExpiredError after the global
      // toast + redirect.
      const r = await adminFetch("/api/admin/flash-sales", {
        method: "POST",
        headers,
        body: JSON.stringify({
          // R125-I3 (A2-21): Arabic default — the title renders on the
          // storefront (flash-sales.tsx activeSale.title).
          title: form.title.trim() || "عرض سريع",
          discount_percent: discount,
          ends_at: endsAt.toISOString(),
        }),
      });
      // Safe error-body parse (E3 item 1 note, promotions.tsx:157): a
      // non-JSON 502 must not throw an English SyntaxError into the
      // Arabic toast — getErrorMessage maps the envelope when present,
      // else the HTTP status carries below.
      const body = (await r.json().catch(() => ({}))) as Parameters<typeof getErrorMessage>[0];
      if (!r.ok) {
        toast({
          title: r.status === 409 ? "يوجد عرض نشط بالفعل" : "تعذّر الإنشاء",
          // Round-4 (org §6a): getErrorMessage maps the backend `code`
          // (ALREADY_EXISTS, INVALID_DATA…) to Arabic.
          description: getErrorMessage(body) || `HTTP ${r.status}`,
          variant: "destructive",
        });
        return;
      }
      // R124-I5 (A6 F1 + F18): success variant, and the emoji dropped
      // from the title — the only emoji-bearing toast in the admin
      // console; color + wording carry the confirmation now.
      toast({ title: "تم إنشاء العرض", variant: "success" });
      setShowForm(false);
      setForm(EMPTY_FORM);
      setDiscountError(null);
      setEndsAtError(null);
      void load();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "تعذّر الإنشاء",
        // R148 (3-errcopy): route through getErrorMessage — network-
        // level English collapses to Arabic (the R126-L3 guard).
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(sale: FlashSale, next: boolean) {
    if (!adminToken) return;
    // 94-C2 (A2 P2-9): ACTIVATING a flash sale repriced the WHOLE
    // store with one unconfirmed tap while «الإيقاف» (stopping it) had
    // a confirm — the price-changing action was the unconfirmed one.
    // Now activation confirms first, with the discount % in the message.
    if (next) {
      const ok = await confirm({
        title: "تفعيل العرض على كامل المتجر؟",
        description: `سيُطبّق خصم ${sale.discount_percent}% على جميع المنتجات فورًا حتى ${formatRelativeTime(sale.ends_at)}.`,
        confirmLabel: "تفعيل",
        destructive: false,
      });
      if (!ok) return;
    }
    setBusyId(sale.id);
    try {
      // L13-1 (R143): adminFetch threads the shared 20 s timeout — the
      // action that reprices the WHOLE store used to ride a raw fetch
      // with no busy state at all (L13-7): on a stalled link nothing
      // happened until the browser's ~300 s timeout fed this catch.
      // Bodies/headers/401 handling identical.
      const r = await adminFetch(`/api/admin/flash-sales/${sale.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ is_active: next }),
      });
      // 94-C2 (A2 P2-14): 401 mid-work = session expiry — the global
      // handler toasts + redirects; no misleading local toast on top.
      if (isAdminUnauthorized(r, `/api/admin/flash-sales/${sale.id}`)) return;
      // Safe error-body parse (same promotions.tsx:157 class): a
      // non-JSON 502 must not throw an English SyntaxError into the
      // Arabic toast.
      const body = (await r.json().catch(() => ({}))) as Parameters<typeof getErrorMessage>[0];
      if (!r.ok) {
        toast({
          title: r.status === 409 ? "يوجد عرض نشط آخر" : "تعذّر التحديث",
          description: getErrorMessage(body) || `HTTP ${r.status}`,
          variant: "destructive",
        });
        return;
      }
      // R124-I5 (A6 F1): success variant.
      toast({ title: next ? "تم التفعيل" : "تم الإيقاف", variant: "success" });
      void load();
    } catch (err) {
      // L13-1 (R143): the expired-session sentinel — the global handler
      // already toasted + redirected; stay quiet.
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "تعذّر التحديث",
        // R148 (3-errcopy): route through getErrorMessage (see load).
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      // R147 (2-c D3): reset on EVERY exit path (the session-expiry
      // return included) — a stranded busy id would freeze the row.
      setBusyId(null);
    }
  }

  async function handleDelete(sale: FlashSale) {
    if (!adminToken) return;
    // R125-I3 (A2-6): permanent DELETE and reversible PAUSE shared the
    // same confirm verb («إيقاف») and the same success toast («تم
    // الإيقاف») — an operator who meant to pause had no signal they had
    // just destroyed the row (and vice versa). The destructive path now
    // names the action on both the message AND the button (the clarify
    // rubric); pause keeps «إيقاف»/«تم الإيقاف».
    const ok = await confirm({
      title: "حذف العرض نهائياً؟",
      description: `سيتم حذف العرض "${sale.title}" نهائياً من السجل. لا يمكن التراجع عن هذه العملية — للإيقاف المؤقت استخدم زر الإيقاف.`,
      confirmLabel: "حذف نهائي",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(sale.id);
    try {
      // R123 (E3 item 1): adminFetchJson owns the ok-guard + safe parse
      // — the failure toast keeps its Arabic envelope mapping via the
      // wrapper's getErrorMessage.
      await adminFetchJson(`/api/admin/flash-sales/${sale.id}`, { method: "DELETE", headers });
      // R124-I5 (A6 F1): success variant. R125-I3 (A2-6): the toast
      // names the DESTRUCTIVE outcome — «تم حذف العرض».
      toast({ title: "تم حذف العرض", variant: "success" });
      void load();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "تعذّر الحذف",
        // R148 (3-errcopy): route through getErrorMessage (see load).
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      // R147 (2-c D3): reset on EVERY exit path — see toggleActive.
      setBusyId(null);
    }
  }

  if (!adminToken) return null;

  const hasActive = sales.some((s) => s.is_currently_active);

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="inventory" />;
  }

  return (
    <AdminLayout onRefresh={load}>
      <div className="max-w-4xl mx-auto space-y-5">
        <PromotionsHeader
          showForm={showForm}
          hasActive={hasActive}
          onToggleForm={() => setShowForm((v) => !v)}
        />

        {/* Create form — the shell renders the inputs verbatim; the form
            atom, the submitting flag and the flash-sale POST stay
            page-owned above. */}
        {showForm && (
          <CreatePromotionForm
            form={form}
            setForm={setForm}
            submitting={submitting}
            discountError={discountError}
            endsAtError={endsAtError}
            onDiscountErrorChange={setDiscountError}
            onEndsAtErrorChange={setEndsAtError}
            onSubmit={handleCreate}
            onCancel={() => {
              setShowForm(false);
              setForm(EMPTY_FORM);
              setDiscountError(null);
              setEndsAtError(null);
            }}
          />
        )}

        {/* List */}
        <PromotionsList
          sales={sales}
          loading={loading}
          loadError={loadError}
          onRetry={load}
          busyId={busyId}
          onToggleActive={toggleActive}
          onDelete={handleDelete}
        />

        <p className="text-3xs text-muted-foreground text-center pt-2">
          تطبَّق الخصومات تلقائياً على جميع المنتجات في المتجر. تنتهي العروض تلقائياً بعد وقت
          الانتهاء؛ خدمة التنظيف الخلفية تُحدّث الحالة كل 5 دقائق.
        </p>
      </div>
      <ConfirmDialog />
    </AdminLayout>
  );
}
