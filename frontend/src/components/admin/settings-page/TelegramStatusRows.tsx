import { Bot, CheckCircle, Hash, Key, XCircle } from "lucide-react";
import type { TelegramSettings } from "./settings-page-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/settings.tsx —
// the «التكاملات» tab's telegram status rows (the three config-key checks
// with the R126-L5 status ink+tint pair). The settings payload rides down
// as a value; the settings fetch stays page-owned. The move only changes
// its address; DOM, classes and Arabic copy are byte-identical.

export function TelegramStatusRows({ settings }: { settings: TelegramSettings | null }) {
  return (
    <div className="space-y-2">
      {[
        {
          icon: Bot,
          label: "الحالة العامة",
          ok: settings?.telegram_configured,
          okText: "مفعّل ويعمل",
          failText: "غير مفعّل",
        },
        {
          icon: Key,
          label: "TELEGRAM_BOT_TOKEN",
          // N-4 (R142): the backend only exposes the AGGREGATE
          // telegram_configured (isTelegramConfigured() = token ∧ chat id
          // both set) — the old per-key reads (telegram_bot_set) were
          // never emitted and always rendered «غير موجود». Both key rows
          // now ride the aggregate verdict: «تم الضبط» is TRUE whenever
          // configured (both env vars present). shortcut: a partial
          // config (token set, chat missing) still reads «غير موجود» on
          // both rows — the real per-key signal needs the backend to emit
          // the two booleans (spec + handler + codegen); the diagnostic
          // «اختبار» ping below is the per-case drilldown until then.
          ok: settings?.telegram_configured,
          okText: "تم الضبط",
          failText: "غير موجود",
        },
        {
          icon: Hash,
          label: "TELEGRAM_CHAT_ID",
          ok: settings?.telegram_configured,
          okText: "تم الضبط",
          failText: "غير موجود",
        },
      ].map((row) => (
        /* R139 (precision): VERIFIED, no change — the ok/fail verdicts
           ride the --status-success/error ink pair on the quiet
           bg-muted/25 + border-border/60 inset rows (the R126-L5 AA
           fix); mono config keys, no status walls. */
        <div
          key={row.label}
          className="flex items-center justify-between px-4 py-3 bg-muted/25 border border-border/60 rounded-2xl"
        >
          <div className="flex items-center gap-2.5 text-sm">
            <row.icon className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono text-xs">{row.label}</span>
          </div>
          {/* R126-L5 (A3-4): integrations status text on the
              --status-success / --status-error ink+tint pair —
              raw emerald-400 / red-400 measured 1.92 / 2.77:1
              on the light theme (R125-A3 #8's figures). */}
          <div
            className={`flex items-center gap-1.5 text-xs font-bold ${row.ok ? "text-status-success" : "text-status-error"}`}
          >
            {row.ok ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {row.ok ? row.okText : row.failText}
          </div>
        </div>
      ))}
    </div>
  );
}
