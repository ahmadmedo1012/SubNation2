// R137 (FE decomposition): extracted verbatim from pages/admin/promotions.tsx —
// the flash-sale module's pure metadata moved to its own React-free module
// so the page file shrinks to orchestration. The page (and the extracts)
// import these by name — the interface, the EMPTY_FORM seed and the
// 30-day bound are byte-identical; ZERO behavior change. The
// create/activate/delete handlers that CONSUME MAX_DURATION_MS stay in
// the page (the flash-sale POST/PATCH/DELETE fire only through
// page-owned handlers), and the dirty guard's identity compare still
// points at THIS module-level EMPTY_FORM instance.

export interface FlashSale {
  id: number;
  title: string;
  discount_percent: number;
  ends_at: string;
  is_active: boolean;
  is_currently_active: boolean;
  created_at: string;
}

export const EMPTY_FORM = {
  // R125-I3 (A2-21): the default title is ARABIC — the old English
  // "Flash Sale" default surfaced to customers on the storefront
  // (flash-sales.tsx renders activeSale.title as the page headline).
  title: "عرض سريع",
  discount_percent: "20",
  // Default to 24h from now (ISO local-style for the datetime-local input).
  ends_at: (() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // datetime-local expects YYYY-MM-DDTHH:MM (no Z).
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })(),
};

/** The create-form contract — the inferred shape of the EMPTY_FORM seed. */
export type PromotionForm = typeof EMPTY_FORM;

// R125-I3 (A2-21): client-side parity with the backend's create bound
// (routes/admin/flash-sales.ts MAX_DURATION_MS) — the hint already
// promised «أقل من 30 يوماً» but only the 5-minute floor was validated,
// so a 60-day sale rode a full round-trip to the server's 400.
export const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
