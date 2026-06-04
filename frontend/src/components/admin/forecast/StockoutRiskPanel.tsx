/**
 * Inventory demand forecast panel + drawer (011-inventory-demand-forecast,
 * US1 + US4).
 *
 * Renders the top-N at-risk products above the existing product list.
 * Reads `GET /api/admin/forecast/at-risk`. Each row expands into the
 * explainability drawer (US4) which fetches `/products/:id` once.
 *
 * Design constraints (research §R-5):
 *   - RTL-aware (parent layout already sets dir).
 *   - Numeric content inside an inline-LTR span to avoid Arabic/Latin
 *     numeral mixing artifacts.
 *   - Stale + calibrating + uninitialized states all distinct so the
 *     admin can act on each correctly.
 */

import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  Info,
  Loader2,
  Package,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

type Confidence = "high" | "medium" | "low" | "insufficient_data";
type PipelineState = "fresh" | "stale" | "uninitialized" | "calibrating";

interface AtRiskRow {
  product_id: number;
  product_name: string;
  product_image_url: string | null;
  product_slug: string | null;
  category: string | null;
  current_stock_on_hand: number;
  avg_daily_sales: number | null;
  predicted_demand_7d: number | null;
  predicted_demand_30d: number | null;
  predicted_runout_at: string | null;
  recommended_reorder_qty: number | null;
  confidence: Confidence;
  forecast_date: string;
  panel_url: string;
}

interface AtRiskResponse {
  pipeline_state: PipelineState;
  last_successful_run_at: string | null;
  data_freshness_hours: number | null;
  rows: AtRiskRow[];
}

interface ProductDetailResponse {
  pipeline_state: PipelineState;
  forecast: (AtRiskRow & {
    explanation: {
      avg_daily_sales: number | null;
      dow_blend_7d: number | null;
      days_of_history_available: number;
      run_completed_at: string | null;
    };
  }) | null;
}

const CONFIDENCE_META: Record<Confidence, { label: string; bg: string; text: string }> = {
  high: { label: "ثقة عالية", bg: "bg-emerald-500/10", text: "text-emerald-400" },
  medium: { label: "ثقة متوسطة", bg: "bg-yellow-500/10", text: "text-yellow-400" },
  low: { label: "ثقة منخفضة", bg: "bg-orange-500/10", text: "text-orange-400" },
  insufficient_data: {
    label: "بيانات غير كافية",
    bg: "bg-muted/30",
    text: "text-muted-foreground",
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString("ar-LY", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function daysFromNow(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(`${iso}T00:00:00Z`).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function StockoutRiskPanel() {
  const headers = useAdminHeaders();
  const query = useQuery<AtRiskResponse>({
    queryKey: ["admin-forecast-at-risk"],
    queryFn: async () => {
      const resp = await fetch("/api/admin/forecast/at-risk?limit=10", { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 5 * 60 * 1000, // 5 min
    retry: false,
  });

  // Don't render anything for uninitialized — the existing low-stock
  // chip in the page header already covers the "act now" surface, and
  // this panel showing an empty banner before the first cron run would
  // be more confusing than helpful (per research §R-5 and FR-PANEL).
  if (query.isLoading) return null;
  if (query.isError) return null;
  if (!query.data) return null;
  if (query.data.pipeline_state === "uninitialized") return null;
  if (query.data.rows.length === 0 && query.data.pipeline_state === "fresh") {
    return null;
  }

  const data = query.data;
  const isStale = data.pipeline_state === "stale";
  const isCalibrating = data.pipeline_state === "calibrating";

  return (
    <div className="border border-border/40 rounded-2xl bg-card/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-gradient-to-l from-orange-500/5 to-transparent">
        <ShieldAlert className="w-4 h-4 text-orange-400" />
        <h2 className="text-sm font-bold flex-1">خطر النفاد</h2>
        <span className="text-[11px] text-muted-foreground">
          {data.last_successful_run_at
            ? `آخر تحديث: ${new Date(data.last_successful_run_at).toLocaleString("ar-LY", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}`
            : ""}
        </span>
        <button
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
          aria-label="تحديث"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
        </button>
      </header>

      {(isStale || isCalibrating) && (
        <div
          className={`flex items-start gap-2 px-4 py-2 text-[11px] ${isCalibrating ? "bg-amber-500/10 text-amber-400" : "bg-yellow-500/10 text-yellow-400"} border-b border-border/40`}
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {isCalibrating
              ? "خط الأنابيب في وضع المعايرة — التنبيهات معطلة مؤقتاً (معدل التقاط < 50%)."
              : `البيانات قديمة (${data.data_freshness_hours ?? "?"} ساعة منذ آخر تحديث ناجح).`}
          </span>
        </div>
      )}

      {data.rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          لا توجد منتجات معرضة لخطر النفاد.
        </div>
      ) : (
        <ul className="divide-y divide-border/30">
          {data.rows.map((r) => (
            <RiskRow key={r.product_id} row={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RiskRow({ row }: { row: AtRiskRow }) {
  const headers = useAdminHeaders();
  const [open, setOpen] = useState(false);
  const days = daysFromNow(row.predicted_runout_at);
  const conf = CONFIDENCE_META[row.confidence];

  const detail = useQuery<ProductDetailResponse>({
    queryKey: ["admin-forecast-product", row.product_id],
    queryFn: async () => {
      const resp = await fetch(`/api/admin/forecast/products/${row.product_id}`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <li className="px-4 py-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 text-right group"
      >
        <div className="w-9 h-9 rounded-lg bg-muted/40 border border-border/40 shrink-0 overflow-hidden flex items-center justify-center">
          {row.product_image_url ? (
            <img
              src={row.product_image_url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <Package className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm truncate">{row.product_name}</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${conf.bg} ${conf.text} shrink-0`}
            >
              {conf.label}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              <Package className="w-3 h-3" />
              المخزون: <span dir="ltr" className="font-mono">{row.current_stock_on_hand}</span>
            </span>
            {row.predicted_runout_at && (
              <span>
                النفاد:{" "}
                <span dir="ltr" className="font-mono">
                  {formatDate(row.predicted_runout_at)}
                </span>{" "}
                {days != null && (
                  <span className="text-orange-400">
                    (
                    <span dir="ltr">{days}</span> يوم)
                  </span>
                )}
              </span>
            )}
            {row.recommended_reorder_qty != null && row.recommended_reorder_qty > 0 && (
              <span className="text-emerald-400">
                إعادة الطلب: <span dir="ltr" className="font-mono">+{row.recommended_reorder_qty}</span>
              </span>
            )}
          </div>
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <ExplainDrawer detail={detail.data ?? null} loading={detail.isLoading} row={row} />
      )}
    </li>
  );
}

function ExplainDrawer({
  detail,
  loading,
  row,
}: {
  detail: ProductDetailResponse | null;
  loading: boolean;
  row: AtRiskRow;
}) {
  const e = detail?.forecast?.explanation;
  return (
    <div className="mt-2 mr-12 rounded-xl border border-border/40 bg-muted/20 p-3 text-xs space-y-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Sparkles className="w-3 h-3" />
        ما الذي أنتج هذا التوقع؟
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> جاري التحميل…
        </div>
      )}
      {!loading && e && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <KV
            label="متوسط المبيعات اليومية"
            value={e.avg_daily_sales == null ? "—" : e.avg_daily_sales.toFixed(2)}
          />
          <KV
            label="معامل اليوم"
            value={e.dow_blend_7d == null ? "—" : e.dow_blend_7d.toFixed(2)}
          />
          <KV
            label="أيام تاريخ الطلبات"
            value={String(e.days_of_history_available)}
          />
          <KV label="مخزون عند آخر تشغيل" value={String(row.current_stock_on_hand)} />
          <KV
            label="متوقع 7 أيام"
            value={row.predicted_demand_7d == null ? "—" : String(row.predicted_demand_7d)}
          />
          <KV
            label="متوقع 30 يوم"
            value={row.predicted_demand_30d == null ? "—" : String(row.predicted_demand_30d)}
          />
        </div>
      )}
      {!loading && !e && (
        <div className="flex items-start gap-2 text-muted-foreground">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            {row.confidence === "insufficient_data"
              ? "يحتاج المنتج إلى 14 يوماً على الأقل من سجل الطلبات قبل أن يصدر توقع."
              : "لا تتوفر تفاصيل لهذا المنتج."}
          </span>
        </div>
      )}
      <div className="pt-1 border-t border-border/30">
        <Link href={`/admin/products?highlight=${row.product_id}`}>
          <Button size="sm" variant="outline" className="text-xs gap-1.5">
            فتح في المنتجات
          </Button>
        </Link>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/30 rounded-lg bg-background/50 px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div dir="ltr" className="font-mono text-sm font-bold mt-0.5">
        {value}
      </div>
    </div>
  );
}
