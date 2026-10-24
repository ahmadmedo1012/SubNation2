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
 * 93-C5 / F-03 (A2 P1 #2): transfer-receipt reference field. Programmatic
 * label + htmlFor (A4 P3 #37 — placeholder-only names), dir="ltr" +
 * font-mono for the receipt/reference runs (typically Latin digits),
 * maxLength 100 matching the backend's boundary.
 *
 * R154 (P1-A): the field exists solely as the LYPAY flow's OPTIONAL
 * bank-receipt reference — mobile_transfer retired it entirely that
 * round (the telecom USSD channel doesn't reliably surface a receipt
 * to the customer; the mobile flow's duplicate-risk signal is computed
 * from amount/network/sender-phone evidence instead). The backend's
 * dedup battery keys on the reference whenever present. The old
 * R123-E4a mandatory-prop era (mobile_transfer) died with that
 * retirement — R186-6 (A-F4) deleted its verified-dead true branch;
 * the copy is unconditionally optional now.
 */
export function PaymentReferenceField({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <div className="mt-3">
      <Label htmlFor={id} className="text-xs font-bold text-muted-foreground mb-2 block">
        {/* R116-S2: unified «رمز» family (رمز التحويل above, رمز الكوبون)
            — was «رقم مرجع التحويل», the only «رقم مرجع» outlier on the
            topup money flow. */}
        رمز التحويل <span className="font-semibold">(اختياري)</span>
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="text"
        maxLength={100}
        placeholder="رقم إيصال التحويل كما ورد في رسالة التحويل"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir="ltr"
        autoComplete="off"
        /* R139 (precision): border-border/50 + focus:border-primary/45
           overrides stripped — the shared Input family owns the AA
           resting border and the ONE focus system (the mobile-flow
           amount twin's form). h-11 = the 44px storefront floor. */
        className="text-left font-mono h-11 bg-card"
      />
      <p className="text-2xs text-muted-foreground mt-1.5 leading-relaxed">
        يساعد رمز التحويل فريق المراجعة في التحقق من تحويلك ومنع احتسابه مرتين.
      </p>
    </div>
  );
}
