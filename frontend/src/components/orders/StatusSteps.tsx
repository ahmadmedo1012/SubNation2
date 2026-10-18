import { CheckCircle, Clock } from "lucide-react";

/**
 * R167 (F12, wave 1) — verbatim extract from pages/order-detail.tsx:
 * the two-rung progress tracker under the header card
 * (استُلم الطلب → تم التسليم). Hidden on the failed/refunded branches
 * (returns null — the terminal card owns those states).
 *
 * Presentational by contract (the R137 extract idiom): one value in,
 * no state, no effects. Rendered DOM byte-identical — pinned by the
 * R167 order-detail decomposition pin (source).
 */
export function StatusSteps({ status }: { status: string }) {
  if (status === "failed" || status === "refunded") return null;
  const done = status === "completed";
  // R138 (visual): the completed ladder reads success at every rung
  // (/15 fill, /45 ring, /40 connector, full-ink glyphs at lucide
  // stroke 2) — the sanctioned status-success vocabulary; verified,
  // unchanged this round (the 700ms connector fill is the state-flip
  // transition, existing motion under the reduced-motion kill-switch).
  return (
    <div className="flex items-center gap-0 my-4">
      {/* Step 1 */}
      <div className="flex flex-col items-center gap-1.5 shrink-0">
        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-status-success/15 border-2 border-status-success/45 text-status-success">
          <CheckCircle className="w-3.5 h-3.5" />
        </div>
        <span className="text-3xs font-bold text-status-success whitespace-nowrap">
          استُلم الطلب
        </span>
      </div>

      {/* Connector */}
      <div
        className={`flex-1 h-[2.5px] mb-4 mx-2 rounded-full transition-all duration-700 ${done ? "bg-status-success/40" : "bg-border/35"}`}
      />

      {/* Step 2 */}
      <div className="flex flex-col items-center gap-1.5 shrink-0">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
            done
              ? "bg-status-success/15 border-status-success/45 text-status-success"
              : "bg-muted/40 border-border/40 text-muted-foreground"
          }`}
        >
          {done ? <CheckCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
        </div>
        <span
          className={`text-3xs font-bold whitespace-nowrap ${done ? "text-status-success" : "text-muted-foreground"}`}
        >
          تم التسليم
        </span>
      </div>
    </div>
  );
}
