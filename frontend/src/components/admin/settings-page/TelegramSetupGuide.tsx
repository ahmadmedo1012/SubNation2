import { Info } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/settings.tsx —
// the «التكاملات» tab's static telegram setup guide (the numbered
// BotFather → getUpdates → Secrets → restart steps). Zero props: nothing
// here reads page state. The move only changes its address; DOM, classes
// and Arabic copy are byte-identical.

export function TelegramSetupGuide() {
  return (
    <div className="mt-5 p-4 bg-muted/30 border border-border/50 rounded-2xl">
      <div className="flex items-center gap-2 mb-3">
        <Info className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-bold">كيفية الإعداد</span>
      </div>
      <ol className="space-y-2 text-xs text-muted-foreground leading-relaxed list-none">
        {[
          <>
            أنشئ بوت تيليجرام عبر{" "}
            {/* R126-L5 (A3-4): inline code tokens on
                text-primary-text — raw text-primary is 3.76:1
                on the dark card (A6-B6). */}
            <span className="font-mono text-primary-text">@BotFather</span> واحصل على التوكن
          </>,
          <>
            أرسل رسالة للبوت ثم افتح{" "}
            <span className="font-mono text-3xs text-primary-text">
              api.telegram.org/bot&#123;TOKEN&#125;/getUpdates
            </span>{" "}
            للحصول على Chat ID
          </>,
          <>
            أضف <span className="font-mono text-primary-text">TELEGRAM_BOT_TOKEN</span> و{" "}
            <span className="font-mono text-primary-text">TELEGRAM_CHAT_ID</span> في متغيرات البيئة
            (Secrets)
          </>,
          <>أعد تشغيل الخادم</>,
        ].map((step, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-4 h-4 rounded-full bg-muted-foreground/20 text-muted-foreground flex items-center justify-center text-3xs font-bold shrink-0 mt-0.5">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
