import { DetailsSection } from "@/components/admin/system/DetailsSection";
import { STATUS_META } from "@/components/admin/system/system-meta";
import { formatCount } from "@/lib/utils";
import type { MetricsSnapshot } from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the Core Web Vitals p75 panel of the advanced-diagnostics section (the
// five vitals' good/poor thresholds, tone dots + sample counts). The
// metrics query and the panel's visibility gate stay in the page — the
// snapshot flows down as a value; the move only changes its address,
// DOM/classes byte-identical.

/** Arabic plural forms for عيّنة — R187L-F1: the vitals' sample counts
 *  (the ALERT_COUNT_FORMS local-object idiom; was the frozen «N عيّنة»).
 *  Exported for the page's rps-chart window count (the same noun, one
 *  family — no second hand-typed copy to drift). */
export const SAMPLE_COUNT_FORMS = {
  zero: "عيّنات",
  one: "عيّنة",
  two: "عيّنتان",
  few: "عيّنات",
  many: "عيّنةً",
  other: "عيّنة",
};

export function CoreWebVitalsSection({ metrics }: { metrics: MetricsSnapshot }) {
  return (
    <DetailsSection title="Core Web Vitals (LCP · FCP · INP · CLS · TTFB — p75)">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {(
          [
            { key: "lcp", label: "LCP", good: 2500, poor: 4000, unit: "ms" as const },
            { key: "fcp", label: "FCP", good: 1800, poor: 3000, unit: "ms" as const },
            { key: "inp", label: "INP", good: 200, poor: 500, unit: "ms" as const },
            { key: "cls", label: "CLS", good: 0.1, poor: 0.25, unit: "" as const },
            { key: "ttfb", label: "TTFB", good: 800, poor: 1800, unit: "ms" as const },
          ] as const
        ).map(({ key, label, good, poor, unit }) => {
          const p75 = metrics.cwv.p75[key];
          const samples = metrics.cwv.samples[key] ?? 0;
          let tone: "ok" | "degraded" | "failing" = "ok";
          let display = "—";
          if (p75 !== null && p75 !== undefined) {
            if (p75 > poor) tone = "failing";
            else if (p75 > good) tone = "degraded";
            display =
              unit === "ms"
                ? p75 < 1000
                  ? `${Math.round(p75)}ms`
                  : `${(p75 / 1000).toFixed(2)}s`
                : p75.toFixed(3);
          } else if (samples === 0) {
            display = "بدون عيّنات";
          }
          const meta = STATUS_META[tone];
          return (
            <div
              key={key}
              className={`bg-card border ${meta.border} rounded-2xl p-4`}
              title={`${formatCount(samples, SAMPLE_COUNT_FORMS)} · حد الجيد: ${good}${unit} · حد الضعيف: ${poor}${unit}`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-3xs text-muted-foreground font-bold">{label}</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    tone === "ok"
                      ? "bg-status-success"
                      : tone === "degraded"
                        ? "bg-status-warning"
                        : "bg-status-error"
                  }`}
                />
              </div>
              <div className={`font-bold text-base leading-none tabular-nums ${meta.color}`}>
                {display}
              </div>
              <div className="text-3xs text-muted-foreground mt-1">
                {formatCount(samples, SAMPLE_COUNT_FORMS)}
              </div>
            </div>
          );
        })}
      </div>
    </DetailsSection>
  );
}
