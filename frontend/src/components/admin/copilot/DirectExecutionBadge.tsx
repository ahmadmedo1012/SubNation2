// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — the
// Super-admin direct-execution result badge (resolve_product /
// update_product / update_stock / admin_request outcomes). Presentational:
// the DirectExecution DTO only. ZERO markup change (the success/failure
// arms, the admin_request mono line and the stock-change join survive
// byte-identical).

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { DirectExecution } from "./copilot-types";

export function DirectExecutionBadge({ item }: { item: DirectExecution }) {
  const ok = item.success;
  type ProductData = {
    productId?: number;
    productName?: string;
    before_stock?: number;
    after_stock?: number;
    diff?: Array<{ field: string }>;
  };
  type AdminReqData = {
    method?: string;
    path?: string;
    status?: number;
    body?: unknown;
    truncated?: boolean;
  };
  const isReq = item.tool === "admin_request";
  const data = (item.data ?? {}) as ProductData & AdminReqData;
  const fields = Array.isArray(data.diff) ? data.diff.map((d) => d.field).join(", ") : null;
  const stockChange =
    typeof data.before_stock === "number" && typeof data.after_stock === "number"
      ? `${data.before_stock} → ${data.after_stock}`
      : null;
  return (
    <div
      className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 border shadow-sm ${
        ok
          ? "bg-status-success/10 border-status-success/30 text-status-success"
          : "bg-destructive/10 border-destructive/30 text-destructive"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-bold">{ok ? "تم التنفيذ" : "فشل التنفيذ"}</div>
        {ok && isReq && (
          <div className="text-2xs text-muted-foreground mt-0.5 font-mono break-all">
            {data.method} {data.path} · {data.status}
          </div>
        )}
        {ok && !isReq && data.productName && (
          <div className="text-2xs text-muted-foreground mt-0.5">
            <span className="font-mono">{item.tool}</span> · {data.productName} (#{data.productId})
            {fields && ` · ${fields}`}
            {stockChange && ` · مخزون: ${stockChange}`}
          </div>
        )}
        {!ok && <div className="text-2xs mt-0.5 break-words">{item.summary}</div>}
      </div>
    </div>
  );
}
