import { Building2, Smartphone } from "lucide-react";
import type { Method } from "@/components/wallet/topup-meta";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the topup form's method tabs. The `method` STATE and the 96-F6/98-F2
// key-rotation on switch stay centralized in the page (the extract
// takes the selected value + the page-owned onSelect callback — never a
// raw setter, or the intent-key rotation would silently stop firing).
// The move only changes its address; DOM, classes, aria-pressed and
// event semantics are byte-identical.

export function MethodTabs({
  method,
  onSelect,
}: {
  method: Method;
  onSelect: (m: Method) => void;
}) {
  return (
    <div className="mb-5">
      <p className="text-xs text-muted-foreground mb-2.5 font-bold">طريقة الدفع</p>
      <div className="grid grid-cols-2 gap-2">
        {[
          {
            id: "mobile_transfer" as Method,
            icon: Smartphone,
            title: "تحويل رصيد",
            sub: "ليبيانا / مدار",
          },
          { id: "lypay" as Method, icon: Building2, title: "تحويل مصرفي", sub: "LyPay" },
        ].map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            /* R124-I1 (A5 P2, WCAG 4.1.2): the selected method is
                exposed to assistive tech — same tested
                aria-pressed toggle-button idiom as the catalog/
                variant pills (home.tsx / product.tsx), not
                class-only state. */
            aria-pressed={method === m.id}
            className={`flex flex-col sm:flex-row items-center gap-2 p-3 rounded-xl border-2 transition-all duration-180 text-center sm:text-right press-spring min-w-0 ${
              method === m.id
                ? "border-primary/50 bg-primary/7 shadow-sm"
                : "border-border/50 hover:border-border/80 bg-card"
            }`}
          >
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${method === m.id ? "bg-primary shadow-sm shadow-primary/30" : "bg-muted/60"}`}
            >
              <m.icon
                className={`w-4 h-4 ${method === m.id ? "text-white" : "text-muted-foreground"}`}
              />
            </div>
            <div className="min-w-0">
              <div
                className={`font-bold text-sm ${method === m.id ? "text-foreground" : "text-foreground/80"}`}
              >
                <span className="block leading-snug">{m.title}</span>
              </div>
              <div className="text-xs text-muted-foreground leading-snug">{m.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
