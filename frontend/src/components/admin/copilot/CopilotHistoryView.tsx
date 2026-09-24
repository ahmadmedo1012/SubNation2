/**
 * Copilot action history view (010-ai-admin-copilot, US6).
 *
 * Renders the last N executed/cancelled/refused copilot actions for the
 * current admin. Reads from GET /api/admin/copilot/history — the
 * server-side feed, not the client-side conversation log.
 */

import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
// 93-C7 / C-UX2 (A12 B12): run-status pills ride the canonical
// StatusBadge (tones on the --status-* tokens).
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import type { LucideIcon } from "lucide-react";

type Outcome =
  | "success"
  | "partial"
  | "failure"
  | "refused"
  | "validation_rejected"
  | "rate_limited"
  | "stale"
  | "expired"
  | "cancelled";

interface HistoryEntry {
  id: number;
  preview_id: string | null;
  intent_text: string;
  tool_name: string | null;
  action_class: string;
  risk_tier: "low" | "high" | "no_execute";
  outcome: Outcome;
  failure_reason: string | null;
  executed_at: string | null;
  created_at: string;
}

interface HistoryResponse {
  entries: HistoryEntry[];
  next_cursor: string | null;
}

// 93-C7 / C-UX2 (A12 B12): run-status pills migrate from raw
// emerald/amber/red hues to the canonical StatusBadge tones on the
// --status-* tokens. Icons stay (StatusBadge renders them natively).
const OUTCOME_META: Record<Outcome, { label: string; tone: StatusBadgeVariant; icon: LucideIcon }> =
  {
    success: { label: "نجاح", tone: "success", icon: CheckCircle2 },
    partial: { label: "جزئي", tone: "warning", icon: AlertTriangle },
    failure: { label: "فشل", tone: "error", icon: XCircle },
    refused: { label: "رفض", tone: "error", icon: XCircle },
    // R111-F2 C6: was «فحص فشل» — inverted word order; the correct
    // noun-phrase order is «فشل الفحص» (the validation failed).
    validation_rejected: { label: "فشل الفحص", tone: "warning", icon: AlertTriangle },
    rate_limited: { label: "حدّ معدل", tone: "warning", icon: AlertTriangle },
    stale: { label: "قديم", tone: "neutral", icon: AlertTriangle },
    expired: { label: "منتهٍ", tone: "neutral", icon: AlertTriangle },
    cancelled: { label: "ملغى", tone: "neutral", icon: XCircle },
  };

export function CopilotHistoryView({ onClose }: { onClose: () => void }) {
  const headers = useAdminHeaders();
  const query = useQuery<HistoryResponse>({
    queryKey: ["admin-copilot-history"],
    queryFn: async () => {
      const resp = await fetch(`/api/admin/copilot/history?limit=25`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/20">
        <span className="text-sm font-bold flex-1">إجراءات سابقة (آخر 25)</span>
        <button
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
          aria-label="تحديث"
        >
          <RefreshCw className={`w-4 h-4 ${query.isFetching ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1 rounded-lg text-xs hover:bg-secondary transition-colors"
        >
          رجوع
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {query.isLoading && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل…
          </div>
        )}
        {query.isError && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4" /> فشل تحميل السجل
          </div>
        )}
        {query.data && query.data.entries.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-12">
            لم تُنفّذ أي إجراءات بعد.
          </div>
        )}
        {query.data?.entries.map((e) => {
          const meta = OUTCOME_META[e.outcome] ?? OUTCOME_META.failure;
          const ts = new Date(e.executed_at ?? e.created_at);
          const oneLine =
            e.intent_text.length > 100 ? e.intent_text.slice(0, 100) + "…" : e.intent_text;
          return (
            <div
              key={e.id}
              className="border border-border/40 rounded-xl bg-card/60 p-3 space-y-1.5"
            >
              <div className="flex items-center gap-2 text-xs">
                <StatusBadge variant={meta.tone} size="xs" icon={meta.icon}>
                  {meta.label}
                </StatusBadge>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {e.action_class}
                </span>
                {/* 94-C2 (A2 colors): raw amber-400 → the --status-warning
                    token (same meaning, AA-safe on both themes). */}
                {e.risk_tier === "high" && (
                  <span className="text-[10px] text-status-warning">عالي</span>
                )}
                <span className="mr-auto text-[10px] text-muted-foreground">
                  {/* 96-F7 (R96 A6 #6): -u-nu-latn pins Latin digits —
                      engines without ar-LY data fall back to the "ar"
                      root and emit Arabic-Indic numerals otherwise. */}
                  {ts.toLocaleString("ar-LY-u-nu-latn")}
                </span>
              </div>
              <div className="text-xs leading-5">{oneLine}</div>
              {e.failure_reason && (
                <div className="text-[11px] text-muted-foreground">السبب: {e.failure_reason}</div>
              )}
              {e.tool_name && (
                <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                  <ExternalLink className="w-2.5 h-2.5" />
                  {e.tool_name}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
