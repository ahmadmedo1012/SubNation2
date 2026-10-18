import { useState } from "react";
import { useAdminHeaders } from "@/hooks/useAdminHeaders";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errors";
// R123 (E3 item 1): the inline stock edit rides the session-aware wrapper
// (a 401 mid-save now gets the global «انتهت الجلسة» toast + redirect
// instead of a per-row failure toast); the two bulk loops keep their
// mid-loop isAdminUnauthorized shape but now break + try/finally (P3h)
// so the bulk-processing flag always resets.
import { AdminSessionExpiredError, adminFetchJson } from "@/lib/admin-session";

// R137 (FE decomposition): extracted verbatim from pages/admin/products.tsx —
// the row-local inline stock editor (the R115 absolute-SET semantics +
// the R123 session-aware save). Self-contained by design (the r135
// CopyField class): its val/saving atoms are EPHEMERAL row-editor state
// seeded from the `current` prop, never cross-section page truth — the
// page owns which row is editing (editingStockId) and the co-invalidation
// (stockEditDone); this component owns only the transient input buffer.
// The move only changes its address; DOM, classes, aria, the POST
// set-count and its toasts are byte-identical.

export function InlineStockEdit({
  productId,
  current,
  onDone,
}: {
  productId: number;
  current: number;
  onDone: () => void;
}) {
  const jsonHeaders = useAdminHeaders({ json: true });
  const { toast } = useToast();
  const [val, setVal] = useState(String(current));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = parseInt(val);
    if (isNaN(n) || n === current) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      // Stock edits are money-adjacent: a silent catch() here meant a
      // failed save looked identical to a successful one.
      // R123 (E3 item 1): adminFetchJson owns the ok-guard + safe parse.
      await adminFetchJson(`/api/admin/products/${productId}/inventory/set-count`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ count: n }),
      });
      toast({ title: "تم تحديث المخزون", variant: "success" });
    } catch (e) {
      // Session expiry already toasted + redirected globally — the
      // finally still closes the inline editor; every other failure
      // keeps its per-row destructive toast.
      if (!(e instanceof AdminSessionExpiredError)) {
        toast({
          title: "تعذّر تحديث المخزون",
          /* R148 (error-copy sweep): the raw extractor leaked ApiError's
             "HTTP 4xx …" prefix into this Arabic toast — routed through
             getErrorMessage (the products.tsx R126-L3 idiom; server Arabic
             passes, technical English collapses). */
          description: getErrorMessage(e),
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
      onDone();
    }
  };

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        min="0"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onDone();
        }}
        autoFocus
        /* R115 (A9 P3-7): the edit is an ABSOLUTE SET (POST set-count),
           not a +N increment — a "+5" mental model silently replaces
           the whole count. The title/aria-label carry the semantics
           (the value is prefilled with the current total, so a
           placeholder would never render). */
        title="العدد الكلي للوحدات — تعيين مطلق وليس إضافة (أدخل الرقم النهائي)"
        aria-label="العدد الكلي للوحدات (تعيين مطلق)"
        placeholder="الكل"
        /* 96-F7 (R96 M8): h-9 input (was w-16 h-6 — a 24px touch target
           for a money-adjacent field).
           R143 (L2-5): joins the input.tsx focus idiom — the old
           focus:ring-1 focus:ring-primary was a 1px ring compositing
           under the 3:1 indicator floor; 2px ring-ring +
           ring-offset-background matches the shared Input (F3-01). */
        className="w-20 h-9 bg-secondary border border-primary/40 rounded px-1.5 text-xs font-mono text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      />
      {/* 96-F7 (R96 M8): the save/cancel controls are now ≥36px tall
         with Arabic TEXT labels («حفظ»/«إلغاء») + gap-2 — the old p-0.5
         icon-only pair (~18px, gap-1) was unmissable under a thumb, and
         Enter/Esc shortcuts don't exist on touch keyboards. Enter/Escape
         still work (the input's onKeyDown above is untouched). */}
      <button
        onClick={save}
        disabled={saving}
        aria-label="حفظ المخزون"
        className="h-9 min-w-9 px-2.5 rounded-lg text-xs font-bold text-status-success hover:bg-status-success/10 transition-colors active:scale-95 disabled:opacity-50"
      >
        حفظ
      </button>
      <button
        onClick={onDone}
        aria-label="إلغاء تعديل المخزون"
        className="h-9 min-w-9 px-2.5 rounded-lg text-xs font-bold text-muted-foreground hover:bg-secondary transition-colors active:scale-95"
      >
        إلغاء
      </button>
    </div>
  );
}
