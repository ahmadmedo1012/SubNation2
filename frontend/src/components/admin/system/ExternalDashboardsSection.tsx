import { AlertCircle, Database, ExternalLink, Server } from "lucide-react";
import type { ObservabilitySummary } from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the external-dashboards panel (the Render / Sentry / Neon deep-links).
// The summary query and the panel's visibility gate stay in the page —
// the snapshot flows down as a value; the move only changes its address,
// DOM/classes byte-identical.

export function ExternalDashboardsSection({ summary }: { summary: ObservabilitySummary }) {
  return (
    <section className="space-y-3 float-in stagger-10">
      <h2 className="text-sm font-bold">لوحات خارجية</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {summary.dashboards.render && (
          <a
            href={summary.dashboards.render}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-card border border-border/60 hover:border-border rounded-2xl p-4 flex items-center gap-3 transition-all card-spring"
          >
            <div className="w-9 h-9 rounded-xl bg-status-purple/10 border border-status-purple/20 flex items-center justify-center">
              <Server className="w-4 h-4 text-status-purple" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold">Render</div>
              <div className="text-3xs text-muted-foreground">النشرات والسجلات</div>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </a>
        )}
        {summary.dashboards.sentry && (
          <a
            href={summary.dashboards.sentry}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-card border border-border/60 hover:border-border rounded-2xl p-4 flex items-center gap-3 transition-all card-spring"
          >
            <div className="w-9 h-9 rounded-xl bg-status-purple/10 border border-status-purple/20 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-status-purple" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold">Sentry</div>
              <div className="text-3xs text-muted-foreground">الأخطاء والتتبع</div>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </a>
        )}
        {summary.dashboards.neon && (
          <a
            href={summary.dashboards.neon}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-card border border-border/60 hover:border-border rounded-2xl p-4 flex items-center gap-3 transition-all card-spring"
          >
            <div className="w-9 h-9 rounded-xl bg-status-success/10 border border-status-success/20 flex items-center justify-center">
              <Database className="w-4 h-4 text-status-success" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold">Neon</div>
              <div className="text-3xs text-muted-foreground">قاعدة البيانات</div>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </a>
        )}
      </div>
    </section>
  );
}
