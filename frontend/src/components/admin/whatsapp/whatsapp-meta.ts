import type { StatusBadgeVariant } from "@/components/ui/status-badge";

// R137 (FE decomposition): extracted verbatim from pages/admin/whatsapp.tsx —
// the whatsapp console's pure metadata moved to its own React-free module
// so the page file shrinks to orchestration. The page (and the header +
// sessions-list extracts) import these by name — every interface, constant
// and function is byte-identical; ZERO behavior change. The session
// create/start/pair/QR/delete mutations that CONSUME these contracts stay
// in the page (the writes fire only through page-owned handlers).

export interface WhatsAppSession {
  id: string;
  name: string;
  status: string;
}

export interface SessionsResponse {
  sessions: WhatsAppSession[];
}

export interface PairCodeResponse {
  session: WhatsAppSession;
  code: string;
}

// R107 (migration): gateway docs link is env-driven — the ONLY place a
// gateway URL ever lived in executable frontend code. R110 (109-b): the
// baked onrender.com default is GONE — it dies with the Render
// decommission, so an unset VITE_OPENWA_DOCS_URL degrades the header
// deep-link to a plain hint instead of pointing at a doomed domain. A
// single-origin Coolify deployment sets
// VITE_OPENWA_DOCS_URL=<gateway-origin>/api/docs at build time (Dockerfile
// ARG). Backend gateway traffic itself was always env-driven
// (WHATSAPP_OTP_BASE_URL) — this is the admin deep-link only, not a secret.
export const OPENWA_DOCS_URL: string =
  (import.meta.env.VITE_OPENWA_DOCS_URL as string | undefined)?.trim() || "";

export const STATUS_META: Record<string, { label: string; tone: StatusBadgeVariant }> = {
  ready: { label: "جاهزة", tone: "success" },
  qr_ready: { label: "تنتظر QR", tone: "warning" },
  authenticating: { label: "جارٍ التحقق", tone: "info" },
  initializing: { label: "جارٍ التشغيل", tone: "info" },
  connecting: { label: "جارٍ الاتصال", tone: "warning" },
  disconnected: { label: "منقطعة", tone: "error" },
  failed: { label: "فشلت", tone: "error" },
};

export function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, tone: "neutral" as const };
}

/** R125-I5 (A3-12, display-only): WhatsApp pair codes live roughly two
 * minutes. The backend's pair-code response carries NO expiry field
 * (openwa.service.ts requestWhatsAppPairCode → { session, code } only),
 * so the display layer marks the block stale after this TTL instead of
 * promising a countdown it can't honor. Purely visual: never blocks the
 * copy button, never touches pairing/session logic. */
export const PAIR_CODE_STALE_AFTER_MS = 120_000;
