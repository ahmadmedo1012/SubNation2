import { AlertCircle, Clock, Cpu, Flag, Layers, MemoryStick } from "lucide-react";
import { SkeletonText } from "@/components/ui/Skeleton";
import type { ChartColors } from "@/lib/chart-theme";
import { DetailsSection } from "@/components/admin/system/DetailsSection";
import { MetricCard } from "@/components/admin/system/MetricCard";
import { formatUptime } from "@/components/admin/system/system-format";
import type { DiagnosticsResponse } from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the runtime + memory diagnostics panel (uptime / RSS / event-loop p99 /
// version tiles + the operational-flags chip cloud). The diagnostics
// query stays in the page — loading/error/data + the memory + event-loop
// sparkline series flow down as values; the move only changes its
// address, DOM/classes byte-identical.

export function RuntimeDiagnosticsSection({
  diag,
  diagLoading,
  diagError,
  memorySeries,
  eventLoopSeries,
  chart,
}: {
  diag: DiagnosticsResponse | undefined;
  diagLoading: boolean;
  diagError: boolean;
  memorySeries: number[];
  eventLoopSeries: number[];
  chart: ChartColors;
}) {
  return (
    <DetailsSection title="وقت التشغيل والذاكرة (RSS · event-loop · إصدار · أعلام)">
      {diagLoading ? (
        /* R136 (UX-1): SkeletonText — the 8-tile diagnostics
           grid, same one-wrapper treatment as the health grid. */
        <SkeletonText
          count={8}
          wrapperClassName="grid grid-cols-2 lg:grid-cols-4 gap-3"
          className="h-[88px] rounded-2xl"
          lastShorter={false}
        />
      ) : diagError || !diag ? (
        <div className="bg-card border border-status-warning/20 rounded-2xl p-4 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-status-warning shrink-0" />
          <span className="text-xs text-muted-foreground">
            تعذّر جلب تشخيص وقت التشغيل (يتطلب صلاحيات إدارية).
          </span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label="مدة التشغيل"
              value={formatUptime(diag.runtime.uptimeSec)}
              sub={`بيئة: ${diag.runtime.env}`}
              icon={Clock}
              color="text-status-success"
              bg="bg-status-success/10"
              border="border-status-success/20"
            />
            <MetricCard
              label="الذاكرة (RSS)"
              value={`${diag.memory.rssMb}MB`}
              sub={`heap: ${diag.memory.heapUsedMb}/${diag.memory.heapTotalMb}MB`}
              icon={MemoryStick}
              color="text-status-info"
              bg="bg-status-info/10"
              border="border-status-info/20"
              spark={memorySeries}
              sparkColor={chart.info}
            />
            <MetricCard
              label="event-loop p99"
              value={diag.eventLoop ? `${diag.eventLoop.p99Ms.toFixed(1)}ms` : "—"}
              sub={
                diag.eventLoop
                  ? `p50: ${diag.eventLoop.p50Ms.toFixed(1)}ms · p95: ${diag.eventLoop.p95Ms.toFixed(1)}ms`
                  : "غير متاح"
              }
              icon={Cpu}
              color={
                diag.eventLoop && diag.eventLoop.p99Ms > 100
                  ? "text-status-error"
                  : "text-status-info"
              }
              bg={
                diag.eventLoop && diag.eventLoop.p99Ms > 100
                  ? "bg-status-error/10"
                  : "bg-status-info/10"
              }
              border={
                diag.eventLoop && diag.eventLoop.p99Ms > 100
                  ? "border-status-error/20"
                  : "border-status-info/20"
              }
              spark={eventLoopSeries}
              sparkColor={chart.info}
            />
            <MetricCard
              label="الإصدار"
              value={diag.runtime.version}
              sub={`Node ${diag.node.version} · ${diag.runtime.service}`}
              icon={Layers}
              color="text-status-low-stock"
              bg="bg-status-low-stock/10"
              border="border-status-low-stock/20"
            />
          </div>

          <div className="bg-card border border-border/60 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Flag className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-3xs text-muted-foreground font-bold">الأعلام التشغيلية</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(diag.flags).map(([key, val]) => {
                const enabled = val === "true";
                return (
                  <span
                    key={key}
                    className={`text-3xs px-2 py-1 rounded-lg border font-mono ${
                      enabled
                        ? "bg-status-success/8 border-status-success/20 text-status-success"
                        : "bg-muted/30 border-border/50 text-muted-foreground"
                    }`}
                  >
                    {key}: {val}
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}
    </DetailsSection>
  );
}
