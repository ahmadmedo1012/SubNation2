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

export interface TelegramSettings {
  telegram_chat_set: boolean;
  /** Present when API exposes aggregate Telegram readiness */
  telegram_configured?: boolean;
  telegram_bot_set?: boolean;
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
