/**
 * Admin risk event detail / investigation view (003-anomaly-detection, US1).
 *
 * Renders a single risk_events row with the rules that fired, statistical
 * signals, and the existing label history. Two action buttons: confirm
 * fraud / mark false positive — both POST to /api/admin/risk/events/:id/label.
 */

import { useAdminHeaders } from "@/hooks/useAdminHeaders";
// R123 (E3 item 1): the two raw fetches ride the session-aware wrapper
// — a users-scope cookie expiring mid-investigation now gets the global
// «انتهت الجلسة» toast + redirect; the label mutation's inline error
// line shows the sentinel's Arabic message (truthful) instead of a raw
// `HTTP 401`, and adminFetchJson owns the ok-guard + safe parse.
import { adminFetchJson } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
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
  RefreshCw,
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
  // R133 (A3-F5): the backend risk family is users-scoped (the list
  // page already gates on it — risk.tsx canViewRisk); this deep link
  // used to mount + fire the detail query for ANY authenticated admin
  // and land on the generic «فشل تحميل الحدث» banner. The honest-reason
  // card + a fetch-free mount close the R126-A3-8 straggler.
  const { adminToken, hasAdminPermission } = useAuth();
  const canViewRisk = hasAdminPermission("users");

  const query = useQuery<RiskEventDetail>({
    queryKey: ["admin-risk-event", id],
    queryFn: async () =>
      adminFetchJson<RiskEventDetail>(`/api/admin/risk/events/${id}`, { headers }),
    enabled: !!id && !!adminToken && canViewRisk,
  });

  const labelMut = useMutation({
    mutationFn: async (label: LabelKind) =>
      adminFetchJson(`/api/admin/risk/events/${id}/label`, {
        method: "POST",
        headers: headersJson,
        body: JSON.stringify({ label, notes: notes.trim() || undefined }),
      }),
    onSuccess: () => {
      setNotes("");
      qc.invalidateQueries({ queryKey: ["admin-risk-event", id] });
      // R125-I4 (A4-B-3): the label changes the risk LIST rows and the
      // dashboard's unresolved count — the old handler invalidated only
      // this detail key, so back-nav showed stale chips for up to the
      // 60s global staleTime / 30s dashboard poll. Base-key
      // invalidations prefix-match every filter variant of the list
      // (the socket-initializer key discipline).
      qc.invalidateQueries({ queryKey: ["admin-risk-events"] });
      qc.invalidateQueries({ queryKey: ["admin-risk-dashboard"] });
      // A4-B-3 stats co-invalidation (A10 §C-5): mutations that feed
      // admin numbers also refresh the shared stats key. R125-I6
      // landed the backend `admin-stats-update` emits for risk
      // writes; R126-L3 (A2-1) closed the frontend half — the socket
      // handler now invalidates the risk keys too
      // ("admin-risk-events" + "admin-risk-dashboard"), so another
      // admin's label refreshes this tab's lists on the push. The
      // invalidations here still cover the ACTING tab immediately;
      // /admin/stats is server-cached 30s, so the extra GET is cheap.
      qc.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
  });

  // R133 (A3-F5): the honest-reason gate — AFTER every hook (the
  // query's enabled gate above keeps a scope-less mount fetch-free),
  // BEFORE the loading/error returns (the risk.tsx idiom).
  if (!canViewRisk) {
    return (
      <AdminLayout>
        <p className="text-sm text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-xl px-3 py-2">
          تحقيقات المخاطر تتطلب صلاحية المستخدمين — تواصل مع مسؤول النظام
        </p>
      </AdminLayout>
    );
  }

  // R133 (A3-F5): the bare «جارٍ التحميل…» text becomes the page-shaped
  // skeleton (the risk.tsx dashboard idiom) — the detail page is a
  // 4-tile header + sections, and the skeleton mirrors it.
  if (query.isPending) {
    return (
      <AdminLayout>
        <div className="space-y-4 max-w-4xl" aria-hidden="true">
          <div className="h-4 w-44 rounded-md skeleton-shimmer" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl skeleton-shimmer" />
            ))}
          </div>
          <div className="h-36 rounded-2xl skeleton-shimmer" />
          <div className="h-24 rounded-2xl skeleton-shimmer" />
        </div>
      </AdminLayout>
    );
  }
  // R133 (A3-F5): the dead-end «فشل تحميل الحدث» banner becomes the
  // 404-vs-outage fork — a missing/deleted event is NOT a network
  // failure (no retry lies that one might work), and an outage is not
  // a 404 (the retry card + refetch honesty). The status rides on the
  // thrown error since R133 (admin-session adminFetchJson).
  if (query.isError || !query.data) {
    const status = (query.error as (Error & { status?: number }) | null)?.status;
    return (
      <AdminLayout>
        <div className="space-y-3">
          <Link
            href="/admin/risk"
            className="text-xs text-muted-foreground hover:text-primary-text inline-flex items-center gap-1"
          >
            <ArrowRight className="w-3 h-3" /> رجوع لقائمة الأحداث
          </Link>
          {status === 404 ? (
            <EmptyState
              icon={AlertTriangle}
              title="الحدث غير موجود"
              description="ربما حُذف السجل أو أن الرابط غير صحيح — عد إلى القائمة واختر حدثاً آخر."
            />
          ) : (
            <FetchErrorCard
              size="page"
              retryIcon={RefreshCw}
              title="تعذّر تحميل الحدث"
              description={`${getErrorMessage(query.error)} — تحقّق من شبكتك ثم أعد المحاولة`}
              onRetry={() => void query.refetch()}
            />
          )}
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
          className="text-xs text-muted-foreground hover:text-primary-text inline-flex items-center gap-1"
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
          <Stat label="الوقت" value={formatDate(event.created_at)} mono />
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
            <pre
              /* R139 (precision): bg-background/60 → bg-muted/60 — the
                 signal dump joins the r138 well family (quiet inset on
                 the now-solid section card, the enrichment copy-well
                 register). */
              className="text-2xs font-mono bg-muted/60 border border-border/40 rounded-lg p-2 overflow-x-auto"
            >
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
                      <span className="text-muted-foreground ms-auto">
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
              /* R133 (A4-F8): the notes field rode placeholder-only naming
                 — a textarea needs an accessible name even when it has no
                 visible label (the enrichment.tsx edit-draft twin). */
              aria-label="ملاحظات التصنيف (اختيارية)"
              placeholder="ملاحظات اختيارية (1000 حرف كحد أقصى)"
              className="w-full bg-background border border-border/50 rounded-xl px-3 py-2 text-xs resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              /* R143 (L2-5, pages side): the risk-note textarea joins the
                 input.tsx focus idiom — focus:ring-2 focus:ring-primary/30
                 composited under the 3:1 indicator floor (30% alpha over
                 the page, thinner stroke). Same class swap the admin
                 topup modals got on the components side. */
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={labelMut.isPending}
                onClick={() => labelMut.mutate("confirmed_fraud")}
                /* R139 (precision): VERIFIED, stays canonical-destructive
                   — the solid surface channel IS buttonVariants (AA pair,
                   R128 A1-F2). Unlike the topups quiet-danger triggers,
                   this label POST has NO confirm step: the solid red
                   surface is the action's ONLY severity carrier, so
                   quieting it would delete the signal rather than move
                   it into a confirm. */
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
              /* R139 (precision): text-destructive → text-status-error —
                 the page's red vocabulary is the --status-error family
                 (the honest-reason gates above already rode it). */
              <div className="text-xs text-status-error">{(labelMut.error as Error).message}</div>
            )}
            {labelMut.isSuccess && (
              <div className="text-xs text-status-success">تم حفظ التصنيف.</div>
            )}
          </div>
        </Section>
      </div>
    </AdminLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    /* R139 (precision): the register — section shell solidifies
       (bg-card/60 → bg-card, edge /40 → /60, the r138 translucent
       retirement) and the header band joins the table idiom
       (border-b /60 + font-semibold 600 — 700 stays on the stat
       values). */
    <section className="border border-border/60 rounded-2xl bg-card overflow-hidden">
      <header className="px-3 py-2 border-b border-border/60 bg-muted/30 text-xs font-semibold">
        {title}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    /* R139 (precision): solidified like Section + tabular-nums on the
       value (the top-line panel numbers ride the money-digit
       convention — score/confidence/date). */
    <div className="border border-border/60 rounded-xl bg-card px-3 py-2">
      <div className="text-3xs text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold mt-0.5 tabular-nums ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
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
