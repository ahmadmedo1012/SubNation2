/**
 * Admin risk event detail / investigation view (003-anomaly-detection, US1).
 *
 * Renders a single risk_events row with the rules that fired, statistical
 * signals, and the existing label history. Two action buttons: confirm
 * fraud / mark false positive — both POST to /api/admin/risk/events/:id/label.
 */

import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { getErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
// 93-C7 / C-UX2 (A12 B4): risk-event level + label pills migrate from
// raw emerald/yellow/amber/red hues to the canonical StatusBadge on the
// --status-* tokens. Label tones mirror STATUS_TONE (confirmed_fraud →
// error, false_positive → success, escalated → warning) with the page's
// own Arabic wording.
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useRoute } from "wouter";
import { AdminLayout } from "./layout";
import { formatDate } from "@/lib/utils";

type RiskLevel = "low" | "medium" | "high" | "critical";
type LabelKind = "confirmed_fraud" | "false_positive" | "escalated";

interface RiskLabel {
  id: number;
  label: LabelKind;
  labeled_by: number | null;
  labeled_by_username: string | null;
  labeled_at: string;
  notes: string | null;
}

interface RiskEventDetail {
  event: {
    id: number;
    user_id: number | null;
    user_phone: string | null;
    user_email: string | null;
    event_type: string;
    score: number;
    level: RiskLevel;
    confidence: number;
    rule_fired: string[];
    statistical_signals: Record<string, unknown>;
    ml_score: number | null;
    top_features: unknown;
    action_taken: string;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
    shown_at: string;
  };
  labels: RiskLabel[];
}

const LEVEL_META: Record<RiskLevel, { label: string; tone: StatusBadgeVariant }> = {
  low: { label: "منخفض", tone: "success" },
  medium: { label: "متوسط", tone: "warning" },
  high: { label: "عالي", tone: "low-stock" },
  critical: { label: "حرج", tone: "error" },
};

const LABEL_META: Record<LabelKind, { label: string; tone: StatusBadgeVariant }> = {
  confirmed_fraud: { label: "احتيال مؤكد", tone: "error" },
  false_positive: { label: "إنذار كاذب", tone: "success" },
  escalated: { label: "تصعيد", tone: "warning" },
};

export default function AdminRiskEventPage() {
  const [, params] = useRoute<{ id: string }>("/admin/risk/events/:id");
  const id = params?.id ?? "";
  const headers = useAdminHeaders();
  const headersJson = useAdminHeaders({ json: true });
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");

  const query = useQuery<RiskEventDetail>({
    queryKey: ["admin-risk-event", id],
    queryFn: async () => {
      const resp = await fetch(`/api/admin/risk/events/${id}`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    enabled: !!id,
  });

  const labelMut = useMutation({
    mutationFn: async (label: LabelKind) => {
      const resp = await fetch(`/api/admin/risk/events/${id}/label`, {
        method: "POST",
        headers: headersJson,
        body: JSON.stringify({ label, notes: notes.trim() || undefined }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { error?: string } | null;
        // Round-4 (org §6a): map the backend `code` to Arabic via
        // getErrorMessage; the raw `error` string stays the fallback.
        throw new Error(getErrorMessage(body) || `HTTP ${resp.status}`);
      }
      return resp.json();
    },
    onSuccess: () => {
      setNotes("");
      qc.invalidateQueries({ queryKey: ["admin-risk-event", id] });
    },
  });

  if (query.isLoading) {
    return (
      <AdminLayout>
        <div className="text-sm text-muted-foreground py-12 text-center">جارٍ التحميل…</div>
      </AdminLayout>
    );
  }
  if (query.isError || !query.data) {
    return (
      <AdminLayout>
        <div className="space-y-3">
          <Link
            href="/admin/risk"
            className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            <ArrowRight className="w-3 h-3" /> رجوع لقائمة الأحداث
          </Link>
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4" /> فشل تحميل الحدث
          </div>
        </div>
      </AdminLayout>
    );
  }

  const { event, labels } = query.data;
  const tone = LEVEL_META[event.level];
  const userLabel =
    event.user_phone ?? event.user_email ?? (event.user_id ? `#${event.user_id}` : "—");
  const alreadyLabeled = labels.length > 0;

  return (
    <AdminLayout>
      <div className="space-y-4 max-w-4xl">
        <Link
          href="/admin/risk"
          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
        >
          <ArrowRight className="w-3 h-3" /> رجوع لقائمة الأحداث
        </Link>

        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-primary" />
            تحقيق #{event.id}
          </h1>
          <StatusBadge variant={tone.tone} size="xs">
            {tone.label}
          </StatusBadge>
          <span className="text-xs text-muted-foreground font-mono">{event.event_type}</span>
        </div>

        {/* Top-line panel */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="النقاط" value={String(event.score)} />
          <Stat label="الثقة" value={`${(event.confidence * 100).toFixed(0)}%`} />
          <Stat label="الإجراء" value={event.action_taken} />
          {/* 96-F7 (R96 A6 #6): -u-nu-latn pins Latin digits (engines
              without ar-LY data fall back to Arabic-Indic numerals). */}
          <Stat
            label="الوقت"
            value={formatDate(event.created_at)}
            mono
          />
        </div>

        <Section title="المستخدم">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <KV k="المعرّف" v={userLabel} />
            <KV k="عنوان IP" v={event.ip_address ?? "—"} mono />
            <KV
              k="User Agent"
              v={event.user_agent ? event.user_agent.slice(0, 120) : "—"}
              mono
              span2
            />
          </div>
        </Section>

        <Section title="القواعد التي أطلقت هذا الحدث">
          {event.rule_fired.length === 0 ? (
            <div className="text-xs text-muted-foreground">لم تطلق أي قاعدة هذا الحدث.</div>
          ) : (
            <ul className="space-y-1.5">
              {event.rule_fired.map((r) => (
                <li
                  key={r}
                  className="text-xs font-mono bg-muted/40 border border-border/40 rounded-lg px-2 py-1.5"
                >
                  {r}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {Object.keys(event.statistical_signals).length > 0 && (
          <Section title="إشارات إحصائية">
            <pre className="text-2xs font-mono bg-background/60 border border-border/40 rounded-lg p-2 overflow-x-auto">
              {JSON.stringify(event.statistical_signals, null, 2)}
            </pre>
          </Section>
        )}

        <Section title="التصنيفات السابقة">
          {labels.length === 0 ? (
            <div className="text-xs text-muted-foreground">لا توجد تصنيفات بعد.</div>
          ) : (
            <ul className="space-y-1.5">
              {labels.map((l) => {
                const meta = LABEL_META[l.label];
                return (
                  <li
                    key={l.id}
                    className="border border-border/40 rounded-lg px-3 py-2 text-xs space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <StatusBadge variant={LABEL_META[l.label].tone} size="xs">
                        {meta.label}
                      </StatusBadge>
                      <span className="text-muted-foreground">
                        {l.labeled_by_username ?? `admin#${l.labeled_by}`}
                      </span>
                      <span className="text-muted-foreground mr-auto">
                        {/* 96-F7 (R96 A6 #6): -u-nu-latn pins Latin digits. */}
                        {formatDate(l.labeled_at)}
                      </span>
                    </div>
                    {l.notes && <div className="text-muted-foreground">{l.notes}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title={alreadyLabeled ? "إضافة تصنيف آخر" : "تصنيف الحدث"}>
          <div className="space-y-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="ملاحظات اختيارية (1000 حرف كحد أقصى)"
              className="w-full bg-background border border-border/50 rounded-xl px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={labelMut.isPending}
                onClick={() => labelMut.mutate("confirmed_fraud")}
                className="gap-2"
              >
                <XCircle className="w-3.5 h-3.5" /> احتيال مؤكد
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={labelMut.isPending}
                onClick={() => labelMut.mutate("false_positive")}
                className="gap-2"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> إنذار كاذب
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={labelMut.isPending}
                onClick={() => labelMut.mutate("escalated")}
                className="gap-2"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> تصعيد
              </Button>
            </div>
            {labelMut.isError && (
              <div className="text-xs text-destructive">{(labelMut.error as Error).message}</div>
            )}
            {labelMut.isSuccess && <div className="text-xs text-emerald-400">تم حفظ التصنيف.</div>}
          </div>
        </Section>
      </div>
    </AdminLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border/40 rounded-2xl bg-card/60 overflow-hidden">
      <header className="px-3 py-2 border-b border-border/40 bg-muted/30 text-xs font-bold">
        {title}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border border-border/40 rounded-xl bg-card/60 px-3 py-2">
      <div className="text-3xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function KV({
  k,
  v,
  mono = false,
  span2 = false,
}: {
  k: string;
  v: string;
  mono?: boolean;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "col-span-2" : ""}>
      <div className="text-3xs text-muted-foreground">{k}</div>
      <div className={`text-xs mt-0.5 ${mono ? "font-mono break-all" : ""}`}>{v}</div>
    </div>
  );
}
