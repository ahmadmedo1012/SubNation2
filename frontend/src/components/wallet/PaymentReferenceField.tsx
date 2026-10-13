import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the transfer-receipt reference field rendered under the amount in
// BOTH topup flows. It was already a self-contained (props-only)
// component inside the page file; the payment_reference STATE and the
// 96-F6/98-F2 key-rotation onChange stay centralized in the page (the
// extract takes the value + the page-owned handler as props — never a
// raw setter). The move only changes its address; DOM, classes, aria
// and event semantics are byte-identical.

/**
 * 93-C5 / F-03 (A2 P1 #2): transfer-receipt reference field, rendered
 * under the amount in BOTH topup flows. Programmatic label + htmlFor
 * (A4 P3 #37 — placeholder-only names), dir="ltr" + font-mono for the
 * receipt/reference runs (typically Latin digits), maxLength 100
 * matching the backend's boundary.
 *
 * R123-E4a (P1): the mobile_transfer flow passes required — the backend
 * has hard-required the reference there since B4-R1 (backend
 * wallet.ts:380-392, 400 «رمز التحويل (رقم العملية من إيصال التحويل)
 * مطلوب…» — R126-L2/A8 F4 aligned the message to the «رمز التحويل»
 * canon) while this field said «اختياري», so users on the
 * Libyana/Madar flow who skipped the receipt hit a post-submit 400.
 * lypay keeps it genuinely optional (gateway receipts are not
 * consistently exposed to users).
 */
export function PaymentReferenceField({
  value,
  onChange,
  id,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  required: boolean;
}) {
  return (
    <div className="mt-3">
      <Label htmlFor={id} className="text-xs font-bold text-muted-foreground mb-2 block">
        {/* R116-S2: unified «رمز» family (رمز التحويل above, رمز الكوبون)
            — was «رقم مرجع التحويل», the only «رقم مرجع» outlier on the
            topup money flow. R123-E4a: (مطلوب) on the mobile flow — the
            backend rejects a blank reference there (B4-R1). */}
        رمز التحويل <span className="font-semibold">{required ? "(مطلوب)" : "(اختياري)"}</span>
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="text"
        maxLength={100}
        placeholder="رقم إيصال التحويل كما ورد في رسالة التحويل"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        dir="ltr"
        autoComplete="off"
        /* R139 (precision): border-border/50 + focus:border-primary/45
           overrides stripped — the shared Input family owns the AA
           resting border and the ONE focus system (the mobile-flow
           amount twin's form). h-11 = the 44px storefront floor. */
        className="text-left font-mono h-11 bg-card"
      />
      <p className="text-2xs text-muted-foreground mt-1.5 leading-relaxed">
        {required
          ? "مطلوب للتحقق من تحويلك ومنع احتسابه مرتين."
          : "يساعد رمز التحويل فريق المراجعة في التحقق من تحويلك ومنع احتسابه مرتين."}
      </p>
    </div>
  );
}
