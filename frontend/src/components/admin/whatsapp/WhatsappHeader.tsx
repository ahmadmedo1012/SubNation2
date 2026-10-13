import { AlertTriangle, ExternalLink, Wifi } from "lucide-react";
import { OPENWA_DOCS_URL } from "./whatsapp-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/whatsapp.tsx —
// the page intro: the WhatsApp OTP header (R134 A3-F5e h1 joining the nav's
// exact label + the 110-M/109-b env-driven docs deep-link that degrades to
// a muted plain-text hint when VITE_OPENWA_DOCS_URL is unset) and the
// pair-code warning banner. Zero props: everything here is static or
// module-scope config. The move only changes its address; DOM, classes and
// Arabic copy are byte-identical.

export function WhatsappHeader() {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary-text mb-1">
            <Wifi className="w-4 h-4" />
            {/* R140 (r139 debt closure — the flagged named-tracking no-op):
                tracking-widest dies — the global Arabic letter-spacing
                guard zeroes the five NAMED tracking utilities, so the Latin
                eyebrow rendered untracked (139-i's flag). Not converted to
                the arbitrary tracking-[…] form: this is a chrome label,
                not a code run — the tracked register is for OTP/code
                displays; removal is a zero-visual-delta kill. */}
            <span className="text-xs font-bold uppercase">WhatsApp OTP</span>
          </div>
          {/* R134 (A3-F5e): h1 joins the nav's exact label («جلسة
              واتساب» — every sibling page keeps h1 === nav: المنتجات/
              الطلبات/…); the «إدارة…» form was the lone split. */}
          <h1 className="text-xl font-bold">جلسة واتساب</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            أنشئ جلسة الإرسال، شغّلها، ثم اربط رقم واتساب الخاص بالخدمة. لا تضع مفتاح API في
            المتصفح؛ الواجهة تمرّر الطلبات عبر الخادم بشكل محمي.
          </p>
        </div>
        {OPENWA_DOCS_URL ? (
          <a
            href={OPENWA_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary-text transition-colors"
          >
            وثائق البوابة
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        ) : (
          // 110-M (109-b): no build-time docs URL — a muted plain-text
          // hint keeps the header layout; never link a dead domain.
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            وثائق البوابة
          </span>
        )}
      </div>

      {/* R139 (precision): VERIFIED, no change — the pairing warning
          banner already rides the quiet token-tint register (the
          status-warning /5 tint + /20 edge with the warning ink on the
          icon only, body muted — the r126-L5 AA-tuned pair); never a
          full-status wall. */}
      <div className="rounded-2xl border border-status-warning/20 bg-status-warning/5 p-4 flex gap-3 text-sm">
        <AlertTriangle className="w-5 h-5 text-status-warning shrink-0" />
        <p className="text-muted-foreground leading-6">
          رمز الاقتران يربط رقم واتساب الذي سيرسل أكواد الدخول. بعد الربط انتظر حتى تصبح الحالة
          «جاهزة». حذف الجلسة يمسح اعتمادها ويحتاج اقتراناً جديداً.
        </p>
      </div>
    </>
  );
}
