import { Link } from "wouter";
import { Clock, ExternalLink, Info, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
// R146 (audit-frontend-pages F6): the near-duplicate page-local CopyField
// is deleted — the shared product/CopyField renders these rows with this
// page's receipt chrome via rowClassName (byte-identical DOM; the shared
// component's own docblock notes it was ported FROM order-detail V2-H10).
import { CopyField } from "@/components/product/CopyField";
import { CopyButton } from "@/components/CopyButton";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import type { Order } from "@workspace/api-client-react";

/**
 * R167 (F12, wave 2) — verbatim extract from pages/order-detail.tsx:
 * the delivery/credentials region — the R166 audit's F12 headline cut
 * (the "~162-line receipt/credentials block"). Owns the whole
 * mutually-exclusive trio: the credentials receipt card (delivered),
 * the decrypt-failure alert, and the «قيد الإعداد» prep card — plus
 * the region's hasDelivery/decryptFailed gates, which read only the
 * order fields this card renders (the StatusSteps null-branch idiom:
 * the region returns null on the failed/refunded terminal states,
 * where the terminal card owns the view).
 *
 * The receipt-card row chrome (RECEIPT_ROW) moved with its only
 * consumer. Presentational by contract (the R137 extract idiom):
 * values in, no state, no effects. Rendered DOM byte-identical —
 * pinned by order-refund-receipt / order-decrypt-failed (render) + the
 * R167 order-detail decomposition pin (source; the semantics/visual/
 * contrast suites read the page ∪ this extract).
 */

/** The receipt-card row chrome for the shared CopyField — verbatim the
 * row classes the deleted page-local CopyField carried. R139
 * (precision): the /30 hover wash is earned (the rows carry the
 * interactive CopyButton/reveal controls); the /20 hairlines between
 * rows come from the parent's divide-y below. */
const RECEIPT_ROW =
  "group flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors";

export function OrderCredentialsCard({ order }: { order: Order }) {
  const hasDelivery = !!(
    order.delivered_email ||
    order.delivered_password ||
    order.delivered_extra_details
  );
  // R118-B2 (A2 fix, buyer side — mirrors admin orders.tsx:1267): the
  // backend sets decrypt_failed:true on a COMPLETED order whose raw
  // credential columns are populated but could not be decrypted with
  // the current key (every safeDecrypt returned null). Without this
  // branch the page fell through to the «قيد الإعداد» card — telling
  // the buyer their data is still being prepared when it will never
  // arrive that way. The honest message points at support instead.
  // Local cast: the flag ships on the buyer Order response
  // independently of the generated schema revision.
  const decryptFailed = !hasDelivery && !!(order as { decrypt_failed?: boolean }).decrypt_failed;

  return hasDelivery ? (
    /* R138 (visual — the success-reading verification): this card
             is the page's payoff moment and already speaks the round's
             language — float-in stagger-1 is the sanctioned calm
             entrance (header → credentials → actions, one stagger
             ladder), and the ink is the status-success ladder at rest
             (/22 card edge, /5 header wash, /12+/22 ShieldCheck tile
             with the full-ink glyph). success-ring is deliberately NOT
             imported here: OrderSuccessScreen (checkout) owns that
             one-shot signature, and the animation-count rule says the
             stagger entrance already carries the moment. Verified —
             no chrome change needed. */
    /* R-140-l (semantics): the credentials card is this page's
             statement region — bound to its h2 the WalletStatementCard
             way (section + aria-labelledby="…-heading", the family's
             ONE section-binding idiom for money/list cards). The
             h2 follows the card-title family (wallet's «شحن المحفظة» /
             profile's «الحسابات المرتبطة» — font-bold h2, classes
             verbatim; only the tag + binding are new). */
    <section
      aria-labelledby="order-credentials-heading"
      className="bg-card border border-status-success/22 rounded-2xl overflow-hidden float-in stagger-1"
    >
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-status-success/15 bg-status-success/5">
        <div className="w-7 h-7 rounded-lg bg-status-success/12 border border-status-success/22 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-3.5 h-3.5 text-status-success" />
        </div>
        <div>
          <h2 id="order-credentials-heading" className="font-bold text-sm">
            بيانات الحساب
          </h2>
          <div className="text-3xs text-muted-foreground">
            انسخ بياناتك بأمان
            {/* R157-IMPL-B #4: the receipt states WHEN the delivery
                      landed — delivered_at rides the Order DTO but was
                      never rendered (the created_at row above is the only
                      timestamp on the page). */}
            {order.delivered_at && (
              <span title={formatDate(order.delivered_at)}>
                {" "}
                · سُلّمت {formatRelativeTime(order.delivered_at)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="divide-y divide-border/20">
        {order.delivered_email && (
          <CopyField
            label="البريد الإلكتروني"
            value={order.delivered_email}
            rowClassName={RECEIPT_ROW}
          />
        )}
        {order.delivered_password && (
          <CopyField
            label="كلمة المرور"
            value={order.delivered_password}
            secret
            rowClassName={RECEIPT_ROW}
          />
        )}
        {order.delivered_extra_details && (
          <div className={RECEIPT_ROW}>
            {/* 96-F4 (R96 A6 #7): free-text delivery details carry mixed-
                      direction runs (activation links / PIN codes inside Arabic
                      sentences) — dir="auto" + start alignment let the bidi
                      algorithm pick the base direction from the first strong
                      character instead of scrambling the visual order.
                      R157-IMPL-B #3: the row gains the SAME CopyButton the
                      email/password rows ride, but stays its own free-text
                      register (NOT CopyField's dir="ltr" mono — that would
                      scramble Arabic sentences; the field is not a secret,
                      so no reveal-toggle semantics). */}
            <div
              dir="auto"
              className="min-w-0 flex-1 text-sm text-muted-foreground leading-relaxed text-start break-words"
            >
              {order.delivered_extra_details}
            </div>
            <CopyButton text={order.delivered_extra_details} size="md" />
          </div>
        )}
      </div>
      {order.delivered_usage_terms && (
        <div className="mx-5 mb-5 flex gap-2.5 text-sm bg-status-warning/8 border border-status-warning/22 rounded-xl p-3.5">
          <Info className="w-4 h-4 text-status-warning shrink-0 mt-0.5" />
          <span className="text-status-warning leading-relaxed">{order.delivered_usage_terms}</span>
        </div>
      )}
    </section>
  ) : order.status !== "failed" && order.status !== "refunded" ? (
    decryptFailed ? (
      /* R118-B2 (A2): honest decrypt-failure card — same visual
                idiom as the «قيد الإعداد» card it replaces (icon tile /
                bold title / muted body), warning-toned because the
                order itself completed fine: only the delivery payload
                is undecryptable, and support holds the recovery path. */
      <div
        role="alert"
        className="bg-card border border-status-warning/30 rounded-2xl p-7 text-center float-in stagger-1"
      >
        <div className="w-12 h-12 rounded-2xl bg-status-warning/10 border border-status-warning/25 mx-auto mb-3 flex items-center justify-center">
          <ShieldAlert className="w-5 h-5 text-status-warning" />
        </div>
        {/* R-140-l (semantics): card-title h2 (the family's
                  font-bold h2 register) — the alert region names
                  itself for heading-navigation. */}
        <h2 className="font-bold text-sm mb-1">تعذّر فك تشفير بيانات التسليم</h2>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto mb-4">
          طلبك مكتمل ومحفوظ، لكن بيانات الحساب تعذّر فك تشفيرها حالياً. تواصل مع الدعم وستصلك
          بياناتك فوراً.
        </p>
        {/* R120-B7 (reviewer finding — A4-F1 sweep completion):
                  asChild composition (cart.tsx ghost-CTA idiom) instead of
                  Link>Button nesting — one anchor, one tab stop, identical
                  styling. */}
        <Button
          asChild
          /* R139 (precision): de-hand-rolled — the bg-primary/
                   hover:bg-primary/90 + shadow-md shadow-primary/22
                   overrides re-implemented buttonVariants on top of
                   Button (the R116-S1 ban); the default variant owns the
                   fill/hover/press/ONE focus system. h-10 → min-h-11:
                   the 44px storefront floor (the error-card recovery
                   pair above already rides it). */
          className="gap-1.5 rounded-xl min-h-11 px-5 font-bold"
        >
          <Link href={`/support?ref=${encodeURIComponent(order.order_code ?? "")}`}>
            <ExternalLink className="w-3.5 h-3.5" />
            تواصل مع الدعم
          </Link>
        </Button>
      </div>
    ) : (
      <div className="bg-card border border-border/60 rounded-2xl p-7 text-center float-in stagger-1">
        {/* R139 (precision): the prep tile joins the well family
                  (muted/60 + /40); card edge /50 → /60. */}
        <div className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/40 mx-auto mb-3 flex items-center justify-center">
          <Clock className="w-5 h-5 text-muted-foreground pulse-dot" />
        </div>
        {/* R-140-l (semantics): card-title h2 (the family's
                  font-bold h2 register) — heading order stays
                  sequential h1→h2 on every branch. */}
        <h2 className="font-bold text-sm mb-1">قيد الإعداد</h2>
        {/* R125-I7 (A7 B-8): the delivery window is UNIFIED with the
                  storefront's dominant honest promise — «فور تأكيد الدفع،
                  وخلال 24 ساعة كحد أقصى» (home's trust strip,
                  onboarding's feature row, terms §2). The drifted
                  «عادةً خلال 5 إلى 15 دقيقة» figure appeared nowhere
                  else and «ستصلك إشعار» presumed a notification path a
                  completed order never fires. */}
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
          سيتم تسليم بيانات الحساب فور اكتمال الطلب — عادةً فوراً، وبحد أقصى 24 ساعة. سنُشعرك فور
          جهوزيته.
        </p>
      </div>
    )
  ) : null;
}
