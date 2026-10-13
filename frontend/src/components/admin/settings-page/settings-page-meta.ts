// R137 (FE decomposition): extracted verbatim from pages/admin/settings.tsx —
// the settings shell's pure metadata moved to its own React-free module so
// the page file shrinks to orchestration. The page (and the tab-bar +
// telegram extracts) import these by name — every interface and function is
// byte-identical; ZERO behavior change. The settings fetch, the telegram
// diagnostic POST and the ?tab= URL sync that CONSUME these stay in the
// page (the mutations fire only through page-owned handlers).

/** R123 (E3 P3f): المصادقة + التكاملات manage settings-scoped backend
 *  surfaces — this pure module-level gate (the tab bar filter, the ?tab=
 *  sync and the deep-link initializer all share it) keeps its only
 *  per-session input a parameter, so the URL→tab effect below can list
 *  that input in its deps instead of a per-render closure. */
export function tabAllowed(id: string, canManageSettings: boolean): boolean {
  return id === "auth" || id === "integrations" ? canManageSettings : true;
}

/**
 * N-4 (R142): GET /api/admin/settings' REAL contract — the backend emits
 * exactly these four fields (backend/src/routes/admin/settings.ts:15-22;
 * the spec's AdminSettings matches). The previous shape claimed
 * telegram_chat_set / telegram_bot_set booleans the backend has NEVER
 * emitted, so the integrations tab's key rows read undefined and always
 * rendered «غير موجود».
 */
export interface TelegramSettings {
  /** isTelegramConfigured() — BOTH env vars (token + chat id) present. */
  telegram_configured: boolean;
  platform_name: string;
  currency: string;
  maintenance_mode: boolean;
}

/** R125-I5 (A3-12, whatsapp sibling idiom): the structured result of the
 *  telegram diagnostic ping — the shape runTelegramTest POSTs for and
 *  renders inline. Carried here so the page's result atom and the
 *  TelegramDiagnosticPing extract speak one contract. */
export interface TelegramTestResult {
  configured: boolean;
  delivered: boolean;
  attempts: number;
  errorMessage: string | null;
  hint: string | null;
}
