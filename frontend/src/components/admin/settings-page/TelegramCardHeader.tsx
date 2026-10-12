import { Bot } from "lucide-react";
// 93-C7 / C-UX2 (A12 B17): configured/secret/telegram pills migrate
// from raw emerald/yellow hues (+ a square `rounded` on the secret
// chip) to the canonical StatusBadge on the --status-* tokens.
import { StatusBadge } from "@/components/ui/status-badge";
import type { TelegramSettings } from "./settings-page-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/settings.tsx —
// the «التكاملات» tab's telegram card header (icon tile + title + the
// configured/unconfigured StatusBadge). The settings payload rides down as
// a value; the settings fetch + the diagnostic POST stay page-owned. The
// move only changes its address; DOM, classes and Arabic copy are
// byte-identical.

export function TelegramCardHeader({ settings }: { settings: TelegramSettings | null }) {
  return (
    <div className="flex items-center gap-2.5 mb-5">
      <div className="w-9 h-9 rounded-xl bg-status-info/10 border border-status-info/20 flex items-center justify-center">
        <Bot className="w-4.5 h-4.5 text-status-info" />
      </div>
      <div>
        <h2 className="font-bold text-sm">تيليجرام</h2>
        <p className="text-xs text-muted-foreground">إشعارات فورية للمشرفين</p>
      </div>
      <div className="mr-auto">
        {settings && (
          <StatusBadge variant={settings.telegram_configured ? "success" : "neutral"} size="xs">
            {settings.telegram_configured ? "مفعّل" : "غير مفعّل"}
          </StatusBadge>
        )}
      </div>
    </div>
  );
}
