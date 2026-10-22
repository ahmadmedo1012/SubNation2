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
      {/* R182 (Lane-C D5): the two aria-pressed toggle buttons sat in a bare
          div with the caption a plain <p> — the money-path topup selector
          had no group semantics on the rotor. role="group" + aria-label
          matches the house primitive (ui/filter-tabs.tsx) and the PDP's
          VariantSelector («اختر الباقة»). */}
      <div role="group" aria-label="طريقة الدفع" className="grid grid-cols-2 gap-2">
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
            className={`flex flex-col sm:flex-row items-center gap-2 p-3 rounded-xl border transition-all duration-150 text-center sm:text-right press-spring min-w-0 ${
              /* R139 (precision): the money-path selector joins the PDP
                 VariantSelector trio — active = the tinted pill
                 (bg-primary/15 + border-primary/30 + primary-text ink,
                 NO shadow anywhere in the selector), inactive = the
                 family muted box. border-2 → border: the 1px box is the
                 family geometry (the old 2px + shadow-sm read as a
                 raised pre-r138 toggle). aria-pressed byte-identical. */
              method === m.id
                ? "border-primary/30 bg-primary/15 text-foreground"
                : "border-border/30 bg-card hover:border-border/70 hover:bg-muted/60 text-foreground/80"
            }`}
          >
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                method === m.id ? "bg-primary/15" : "bg-muted/60"
              }`}
            >
              <m.icon
                className={`w-4 h-4 ${method === m.id ? "text-primary-text" : "text-muted-foreground"}`}
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
