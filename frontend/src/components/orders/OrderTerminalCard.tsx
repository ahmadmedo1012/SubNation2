import { Link } from "wouter";
import { ExternalLink, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { Order } from "@workspace/api-client-react";

/**
 * R167 (F12, wave 2) — verbatim extract from pages/order-detail.tsx:
 * the failed/refunded terminal card (the R166 audit's F12 headline
 * cut, the "~89-line terminal card"). Renders null on every other
 * status (the StatusSteps null-branch idiom) — the page mounts it
 * unconditionally under the header card.
 *
 * Presentational by contract (the R137 extract idiom): values in, no
 * state, no effects. Rendered DOM byte-identical — pinned by
 * order-refund-receipt (render) + the R167 order-detail decomposition
 * pin (source; the semantics/visual/contrast suites read the page ∪
 * this extract).
 */
export function OrderTerminalCard({ order }: { order: Order }) {
  if (order.status !== "failed" && order.status !== "refunded") return null;

  return (
    <div
      className={`bg-card border rounded-2xl p-6 text-center float-in stagger-1 ${
        order.status === "refunded" ? "border-status-info/22" : "border-status-error/22"
      }`}
    >
      <div
        className={`w-12 h-12 rounded-2xl border mx-auto mb-3 flex items-center justify-center ${
          order.status === "refunded"
            ? "bg-status-info/8 border-status-info/22"
            : "bg-status-error/8 border-status-error/22"
        }`}
      >
        {order.status === "refunded" ? (
          <Undo2 className="w-5 h-5 text-status-info" />
        ) : (
          <XCircle className="w-5 h-5 text-status-error" />
        )}
      </div>
      {/* R-140-l (semantics): card-title h2 (the family's
                  font-bold h2 register, tone classes verbatim) — the
                  terminal state names itself for heading-navigation;
                  one heading per mutually-exclusive card. */}
      <h2
        className={`font-bold text-sm mb-1 ${
          order.status === "refunded" ? "text-status-info" : "text-status-error"
        }`}
      >
        {order.status === "refunded" ? "تم الاسترداد" : "فشل الطلب"}
      </h2>
      <p className="text-xs text-muted-foreground leading-relaxed tabular-nums">
        {order.status === "refunded"
          ? `استُرد ${formatCurrency(order.amount ?? 0)} إلى محفظتك تلقائياً`
          : "يرجى التواصل مع الدعم الفني إن احتجت مساعدة"}
      </p>
      {order.status === "refunded" && (
        /* R115-I1 (A8 P2-3a, honest tail): the refund ALSO reverses
                 the purchase-award points for this order (refund.service
                 reclaims them, clamped at zero). The old copy said
                 nothing — points silently vanished from /loyalty with no
                 explanation on any page; this line closes that promise
                 gap («خُصمت نقاط الشراء المستردة»). */
        <p className="text-2xs text-muted-foreground/85 leading-relaxed mt-1 mb-4">
          كما خُصمت نقاط الشراء المستردة — نقاط هذا الطلب من رصيد نقاطك.
        </p>
      )}
      {order.status === "failed" && <div className="mb-4" />}
      {/*
              Promote the support link inside the failure card itself
              when the order failed. Failed/refunded is exactly the
              moment the user is most likely to need help, and burying
              the support link as a subtle text link at the very
              bottom of the page (below all other cards) means many
              users miss it.
              R151: widened to `refunded` too — a refunded order renders
              the same failure/refunded card (with the refund amount +
              points-reversal notice) but the in-card CTA stayed gated on
              `failed` only, leaving refunded users with just the
              bottom text link (which itself carried no order context).
              R167-A2 (the extract adaptation): the CTA's page-side gate
              `{(failed || refunded) && …}` folded into the null guard
              above — every status that reaches this card renders the
              CTA, byte-identical DOM.
            */}
      {/* R120-B7 (reviewer finding — A4-F1 sweep completion): same
                 asChild composition as the decrypt-failure card —
                 one anchor, one tab stop. */}
      <Button
        asChild
        /* R139 (precision): the failed-state twin of the
                   decrypt-failure CTA above — same de-hand-roll, same
                   44px floor. */
        className="gap-1.5 rounded-xl min-h-11 px-5 font-bold"
      >
        <Link href={`/support?ref=${encodeURIComponent(order.order_code ?? "")}`}>
          <ExternalLink className="w-3.5 h-3.5" />
          تواصل مع الدعم
        </Link>
      </Button>
    </div>
  );
}
