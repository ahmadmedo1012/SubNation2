import { getErrorMessage } from "@/lib/errors";
import type { ArabicPluralForms } from "@/lib/utils";
import type { CreateVariantBody, UpdateVariantBody } from "@workspace/api-client-react";

// R137 (FE, closing decomposition): extracted verbatim from
// components/admin/ProductVariantsDialog.tsx — the dialog's pure logic
// (the form seed, the variant formatters, the route-specific error
// resolver, the submit validator and the PATCH/POST body builders) moved
// to this React-free module so the dialog file shrinks to orchestration +
// markup extracts. Zero behavior change: every function body is
// byte-identical, only the export keywords were added.

/** The add/edit form seed — all fields ride as trimmed strings. */
export const EMPTY_FORM = {
  plan_label: "",
  duration_label: "",
  duration_days: "",
  cost_price: "",
  price_lyd: "",
  sku: "",
  sort_order: "",
};

export type VariantForm = typeof EMPTY_FORM;

/** Arabic plural forms for «باقة» (the dialog header + toolbar counts). */
export const VARIANT_COUNT_FORMS: ArabicPluralForms = {
  one: "باقة",
  two: "باقتان",
  few: "باقات",
  many: "باقة",
  other: "باقة",
};

/** Same cent-rounding the backend pricing engine applies (round2). */
export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** $-money display for the internal USD cost column (admin-only field). */
export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Trim trailing zeros for the live-pricing factor/rate (2, not 2.00). */
export function fmtFactor(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** «plan — duration» display title for a variant row. */
export function variantTitle(v: {
  plan_label?: string | null;
  duration_label?: string | null;
}): string {
  const parts = [v.plan_label?.trim(), v.duration_label?.trim()].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" — ") : "باقة";
}

// catalog-recon: orval/customFetch rejections carry ApiError { data: { error,
// code } }. getErrorMessage() resolves the shared CODE map first (CONFLICT →
// generic «تعارض في العملية»), which would bury the route-specific wording
// the variant endpoints author — e.g. the order-guarded DELETE 409 («عطّلها
// بدلاً من ذلك»). Prefer the backend's own Arabic message, then fall back.
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

export function describeError(err: unknown): string {
  const data = (err as { data?: { error?: string; message?: string } | null }).data;
  const raw = data?.error ?? data?.message;
  if (typeof raw === "string" && raw.trim() && ARABIC_SCRIPT_RE.test(raw)) return raw;
  return getErrorMessage(err);
}

/** The submit gate — the first invalid field's Arabic error, or null. */
export function validateVariantForm(form: VariantForm, editingId: number | null): string | null {
  const plan = form.plan_label.trim();
  const duration = form.duration_label.trim();
  if (!plan && !duration) {
    return "يجب تحديد اسم الباقة أو المدة على الأقل";
  }
  const cost = parseFloat(form.cost_price);
  if (!Number.isFinite(cost) || cost < 0.01 || cost > 100_000) {
    return "التكلفة بالدولار مطلوبة (0.01 - 100,000)";
  }
  const price = form.price_lyd.trim();
  if (editingId != null && price !== "") {
    const p = parseFloat(price);
    if (!Number.isFinite(p) || p < 0.01 || p > 1_000_000) {
      return "السعر غير صالح (0.01 - 1,000,000)";
    }
  }
  const days = form.duration_days.trim();
  if (days !== "") {
    const d = parseInt(days, 10);
    if (!Number.isFinite(d) || d < 0) {
      return "أيام المدة يجب أن تكون رقمًا موجبًا";
    }
  }
  const sort = form.sort_order.trim();
  if (sort !== "") {
    const s = parseInt(sort, 10);
    if (!Number.isFinite(s) || s < 0) {
      return "الترتيب يجب أن يكون رقمًا موجبًا";
    }
  }
  return null;
}

/** The PATCH/POST body pair built from the validated form (call after
 *  validateVariantForm returns null — the builder re-derives the same
 *  trimmed fields the validator gated on). */
export function variantSubmitBodies(form: VariantForm): {
  update: UpdateVariantBody;
  create: CreateVariantBody;
} {
  const plan = form.plan_label.trim();
  const duration = form.duration_label.trim();
  const cost = parseFloat(form.cost_price);
  const price = form.price_lyd.trim();
  const days = form.duration_days.trim();
  const sort = form.sort_order.trim();
  // PATCH semantics: cost without price_lyd → engine repricing; an
  // empty sku string clears it (backend ignores non-string sku).
  const update: UpdateVariantBody = {
    plan_label: plan || null,
    duration_label: duration || null,
    cost_price: round2(cost),
    duration_days: days !== "" ? parseInt(days, 10) : null,
    sku: form.sku.trim(),
    sort_order: sort !== "" ? parseInt(sort, 10) : 0,
  };
  if (price !== "") update.price_lyd = round2(parseFloat(price));
  // POST: price always derives from cost via the engine (no override
  // from the add form — the live preview above shows it pre-save).
  const create: CreateVariantBody = {
    plan_label: plan || null,
    duration_label: duration || null,
    cost_price: round2(cost),
    duration_days: days !== "" ? parseInt(days, 10) : null,
    sku: form.sku.trim() || null,
    sort_order: sort !== "" ? parseInt(sort, 10) : 0,
  };
  return { update, create };
}
