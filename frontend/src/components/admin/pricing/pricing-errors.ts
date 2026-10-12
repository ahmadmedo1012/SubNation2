// R137 (FE decomposition): extracted verbatim from pages/admin/pricing.tsx —
// the page's API-error wording resolver moved to its own React-free module
// so the page file shrinks to orchestration. Pure function, zero behavior
// change (the page imports it by name — every call site stays
// byte-identical).

import { getErrorMessage } from "@/lib/errors";

// catalog-recon: orval/customFetch rejections carry ApiError { data: { error,
// code } }. getErrorMessage() resolves the shared CODE map first (INVALID_DATA
// → generic), which would bury the route's own Arabic wording (e.g. the
// out-of-range PUT message). Prefer the backend's message, then fall back.
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

export function describeError(err: unknown): string {
  const data = (err as { data?: { error?: string; message?: string } | null }).data;
  const raw = data?.error ?? data?.message;
  if (typeof raw === "string" && raw.trim() && ARABIC_SCRIPT_RE.test(raw)) return raw;
  return getErrorMessage(err);
}
