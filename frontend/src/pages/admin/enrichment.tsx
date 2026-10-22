/**
 * Catalog enrichment review panel (012-arabic-catalog-enrichment, US1).
 *
 * Lists drafts in state='drafted' from GET /api/admin/enrichment/list.
 * Each row offers three actions: تطبيق (publish), تعديل (edit then
 * publish), رفض (reject). Reuses AdminLayout for chrome and the existing
 * useAdminHeaders hook for auth.
 *
 * Per research §R-3 + R-5: dedicated page (not a panel above the product
 * list). Side-by-side current ↔ proposed diff. Numeric content (token
 * counts, dates) inside inline-LTR spans.
 */

import { useAdminHeaders } from "@/hooks/useAdminHeaders";
// R123 (E3 item 1): the three raw fetches ride the session-aware
// adminFetchJson wrapper — an inventory cookie expiring mid-review now
// gets the global «انتهت الجلسة» toast + redirect, and the card's inline
// error line shows the sentinel's Arabic message instead of a raw
// `HTTP 401`; the ok-guard + safe error-body parse move into the
// wrapper too.
import { adminFetchJson } from "@/lib/admin-session";
import { getErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
// R125-I3 (A2-1): the LoadMoreButton — the review queue's next_cursor
// was fetched but never used (drafts #26+ were invisible while the
// header promised the true pending count).
import { LoadMoreButton } from "@/components/ui/load-more-button";
// R125-I3 (A2-18): the bare centered «جارٍ التحميل…» + the thin
// no-retry error banner adopt the shared taxonomy (TableSkeleton /
// FetchErrorCard — the A6-F5 class this page was the fourth member of).
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { TableSkeleton } from "@/components/admin/TableSkeleton";
// R123 (E3 P3d): the publish action gains the shared styled confirm —
// it overwrites the product's LIVE catalog content in one tap.
import { useConfirm } from "@/hooks/useConfirm";
// 93-C7 / C-UX3 (A12 §1.3 + §11.2): the enrichment reject reason was
// collected via native window.prompt — English browser chrome inside an
// Arabic RTL admin, no validation, ambiguous "" vs null semantics. It
// is now a small AppDialog with a textarea (RejectModal semantics).
import { AppDialog } from "@/components/ui/app-dialog";
// 93-C7 / C-UX6 (A12 §5): the hand-rolled "لا توجد مسودات…" block
// adopts the shared EmptyState card.
import { EmptyState } from "@/components/admin/EmptyState";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
import { useAuth } from "../../lib/auth";
import { formatCount, formatDate } from "@/lib/utils";

type FieldName = "description" | "description_long" | "faq";

interface DraftRow {
  id: number;
  product_id: number;
  product_name: string;
  product_image_url: string | null;
  field_name: FieldName;
  state: "drafted" | "published" | "rejected" | "draft_invalid";
  generated_text: string;
  final_text: string | null;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  // R125-I3 (A2-19, ponytail): the panel_url field the backend ships
  // was declared here but never rendered — dead type surface, removed.
  // The card header carries the product name + id it pointed at.
}

interface ListResponse {
  drafts: DraftRow[];
  next_cursor: string | null;
  pending_count: number | null;
}

/**
 * R182 (§4 operational truth): the readiness contract the backend now
 * ships at GET /api/admin/enrichment/status — the five states the old
 * empty queue conflated into one misleading hint. Readiness booleans
 * mirror the runner's own gate order; `last_run` carries any outcome
 * (a failing or in-flight run is the more truthful row than the last
 * success). No secret ever crosses this contract — booleans + the run
 * row only.
 */
export interface StatusResponse {
  worker_tier: boolean;
  runner_enabled: boolean;
  llm_configured: boolean;
  daily_token_cap: number;
  last_run: {
    outcome: "in_flight" | "success" | "failure";
    started_at: string;
    completed_at: string | null;
    drafts_generated: number;
    failure_reason: string | null;
  } | null;
}

/**
 * R182 (§4): the state-aware diagnosis for the empty queue — derives
 * the ONE truthful blocker line from the status contract, in the
 * runner's own gate order: WORKER_TIER (enrichment-runner.ts:22) →
 * ENRICHMENT_RUNNER_ENABLED (:29) → daily cap ≤ 0 (enrichment.service.ts
 * FR-RUN-002) → llmAvailable (:61). The order is load-bearing — with
 * worker+enabled+cap=0+no-key the runner no-ops at the CAP, so the cap
 * line must win over the LLM line or the admin fixes the wrong blocker
 * (the independent-review catch). In the current single-container
 * deployment no worker tier exists, so the old hint's prescribed action
 * — flip ENRICHMENT_RUNNER_ENABLED on "the worker" — could never
 * succeed. A failed last run outranks "queue clear". Returns the
 * neutral copy while the status contract is still loading (React Query
 * re-renders the diagnosis in when it lands).
 */
export function deriveEmptyStateHint(status: StatusResponse | undefined): ReactNode {
  if (!status) {
    return <>قائمة المراجعة فارغة حالياً — تُعرض حالة خط التوليد عند توفرها.</>;
  }
  if (!status.worker_tier) {
    return (
      <>
        خط توليد المحتوى لا يعمل في هذا النشر: بوابة <code dir="ltr">WORKER_TIER=true</code> تُفحص
        أولاً ولا يوجد عامل خادم مُهيّأ حالياً. ضبط <code dir="ltr">ENRICHMENT_RUNNER_ENABLED</code>{" "}
        وحده لن يُشغّل الخط — راجع دليل النشر لتوفير عامل مخصص أو شغّل الدفعة يدوياً عبر أمر التشغيل
        في المستودع.
      </>
    );
  }
  if (!status.runner_enabled) {
    return (
      <>
        لتفعيل خط الأنابيب: اضبط <code dir="ltr">ENRICHMENT_RUNNER_ENABLED=true</code> على عامل
        الخادم (بوابة <code dir="ltr">WORKER_TIER</code> مفعّلة).
      </>
    );
  }
  if (status.daily_token_cap <= 0) {
    return (
      <>
        سقف التوكن اليومي معطّل (صفر أو أقل) — عدّل{" "}
        <code dir="ltr">ENRICHMENT_DAILY_TOKEN_CAP</code> ليقبل الخط العمل.
      </>
    );
  }
  if (!status.llm_configured) {
    return (
      <>
        الخط مفعّل لكن مزوّد LLM غير مُهيّأ — اضبط <code dir="ltr">COPILOT_API_KEY</code> (ومتغيرات
        المزوّد المرافقة) في بيئة عامل الخادم.
      </>
    );
  }
  const last = status.last_run;
  if (last?.outcome === "failure") {
    return (
      <>
        آخر تشغيل فشل في {formatDate(last.completed_at ?? last.started_at)}
        {last.failure_reason ? (
          <>
            {" "}
            — السبب المسجّل: <span dir="auto">{last.failure_reason}</span>
          </>
        ) : null}
        . راجع سجلات الخادم ثم أعد المحاولة.
      </>
    );
  }
  return <>لا عقبات مُكتشفة — قائمة المراجعة فارغة فعلاً، وسيظهر توليد جديد حسب جدولة الخط.</>;
}

/** R182 (§4, P2): the header's last-run line — «آخر تشغيل…» summary. */
function lastRunLine(status: StatusResponse | undefined): ReactNode {
  const last = status?.last_run;
  if (!last) return null;
  // formatDate renders bare in RTL everywhere else (risk-event/users
  // convention — the review's bidi-consistency nit); the count rides
  // formatCount for the Arabic plural forms («مسودة/مسودتان/مسودات»).
  const when = formatDate(last.completed_at ?? last.started_at);
  if (last.outcome === "in_flight") {
    return <>تشغيل جارٍ الآن…</>;
  }
  if (last.outcome === "failure") {
    return <>آخر تشغيل فشل: {when}</>;
  }
  return (
    <>
      آخر تشغيل ناجح: {when} ·{" "}
      {formatCount(last.drafts_generated, {
        one: "مسودة",
        two: "مسودتان",
        few: "مسودات",
        many: "مسودة",
        other: "مسودة",
      })}
    </>
  );
}

const FIELD_LABEL: Record<FieldName, string> = {
  description: "وصف قصير",
  description_long: "وصف طويل",
  faq: "أسئلة شائعة",
};

export default function AdminEnrichmentPage() {
  const headers = useAdminHeaders();
  const headersJson = useAdminHeaders({ json: true });
  const qc = useQueryClient();
  // R134 (A3-F1): the enrichment console is inventory-scoped (backend
  // routes/admin/index.ts /enrichment mount). No useAuth here before —
  // the page rode useAdminHeaders only; the gate needs the permission
  // check, and the infinite query gets its fetch-free mount.
  // R183: adminToken joined the destructure — every sibling query gates on
  // `!!adminToken && scope`; the token-less arm keeps a session-expiry
  // re-render from firing a guaranteed-401 fetch during the redirect
  // window (the house idiom, applied to this page's two queries).
  const { adminToken, hasAdminPermission } = useAuth();
  const canView = hasAdminPermission("inventory");

  // R125-I3 (A2-1): the queue is CURSOR-paginated server-side
  // (routes/admin/enrichment.ts — ?cursor= + next_cursor) but the page
  // fetched one 25-row page and rendered it as the whole queue while
  // the header promised the true pending_count — drafts #26+ were
  // invisible AND unreviewable. The alerts.tsx useInfiniteQuery idiom:
  // pages accumulate in place, next_cursor drives the load-more, and
  // publish/reject keep invalidating the same base key (refetches all
  // loaded pages).
  const PAGE_SIZE = 25;
  const query = useInfiniteQuery<ListResponse, Error>({
    queryKey: ["admin-enrichment-list", "drafted"],
    queryFn: ({ pageParam }) =>
      adminFetchJson<ListResponse>(
        `/api/admin/enrichment/list?state=drafted&limit=${PAGE_SIZE}${
          pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : ""
        }`,
        { headers },
      ),
    initialPageParam: "" as string,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    // R134 (A3-F1): fetch-free for a scope-less deep-link mount.
    // R183: + the token-less arm (the house idiom).
    enabled: !!adminToken && canView,
  });

  // R182 (§4): the pipeline status query — read-only diagnostic, rides
  // the same inventory scope (backend mounts it under the same
  // requirePermission("inventory") parent). Secondary data: a failed
  // load degrades to the neutral empty-state copy, never blocks the page.
  const statusQuery = useQuery<StatusResponse, Error>({
    queryKey: ["admin-enrichment-status"],
    queryFn: () => adminFetchJson<StatusResponse>("/api/admin/enrichment/status", { headers }),
    // R183: + the token-less arm (the house idiom).
    enabled: !!adminToken && canView,
    staleTime: 60_000,
  });

  const drafts = useMemo(() => query.data?.pages.flatMap((p) => p.drafts) ?? [], [query.data]);
  // pending_count is computed at query time for the whole drafted set —
  // every page carries the same value; take the newest page's.
  const pending =
    query.data && query.data.pages.length > 0
      ? (query.data.pages[query.data.pages.length - 1].pending_count ?? null)
      : null;

  // R134 (A3-F1): the deep-link honest-reason gate — the nav hides
  // this page from scope-less admins; a deep link used to fire the
  // queue query into a 403 dressed as a load failure. Sits AFTER every
  // hook (the query's enabled gate keeps the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="inventory" />;
  }

  return (
    <AdminLayout>
      <div className="space-y-4">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              مراجعة محتوى الكتالوج
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              مسودات أوصاف وأسئلة شائعة تنتظر موافقتك قبل نشرها على المنتجات.
              {pending != null && (
                <>
                  {" "}
                  بانتظار المراجعة:{" "}
                  <span dir="ltr" className="font-mono font-bold">
                    {pending}
                  </span>
                  {/* R125-I3 (A2-1): the loaded window vs the true pending
                      count — only rendered when drafts are actually
                      hidden behind the cursor. */}
                  {pending > drafts.length && (
                    <span className="text-muted-foreground/90"> (تُعرض أول {drafts.length})</span>
                  )}
                </>
              )}
              {/* R182 (§4, P2): the last-run summary — any outcome, from
                  the status contract. */}
              {statusQuery.data?.last_run && <span className="mx-1">·</span>}
              {statusQuery.data?.last_run && lastRunLine(statusQuery.data)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            تحديث
          </Button>
        </header>

        {/* R125-I3 (A2-18): the shared loading taxonomy — the bare
            centered «جارٍ التحميل…» is a TableSkeleton now (the
            coupons/referrals recipe). */}
        {query.isLoading && (
          <TableSkeleton rows={4} cells={["w-32", "rounded-full w-20", "flex-1 w-24", "w-16"]} />
        )}
        {/* R125-I3 (A2-18): the error branch had NO retry — only the
            header's تحديث incidentally retried. The FetchErrorCard
            carries a real retry (the products idiom). */}
        {query.isError && (
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل المسودات"
            // R148 (3-errcopy): route through getErrorMessage — the
            // raw extractor leaked network-level English into the
            // Arabic error card; the wrapper's Arabic passes through.
            description={getErrorMessage(query.error)}
            onRetry={() => query.refetch()}
          />
        )}
        {!query.isLoading && !query.isError && drafts.length === 0 && (
          <EmptyState
            icon={CheckCircle2}
            title="لا توجد مسودات تنتظر المراجعة"
            /* R182 (§4): the state-aware diagnosis replaces the old
                single hard-coded hint (set ENRICHMENT_RUNNER_ENABLED=true
                "on the worker") that (a) conflated five distinct backend
                states and (b) prescribed an action that cannot succeed in
                the current no-worker-tier deployment — the WORKER_TIER
                gate fires first. Derived from the status contract in the
                runner's own gate order; neutral copy while it loads. */
            description={deriveEmptyStateHint(statusQuery.data)}
          />
        )}
        {drafts.map((d) => (
          <DraftCard
            key={d.id}
            draft={d}
            onMutate={() => qc.invalidateQueries({ queryKey: ["admin-enrichment-list"] })}
            headersJson={headersJson}
          />
        ))}
        {/* R125-I3 (A2-1): the cursor load-more — hidden exactly when the
            server says the queue is exhausted (next_cursor null). */}
        {query.hasNextPage && (
          <div className="flex justify-center">
            <LoadMoreButton
              busy={query.isFetchingNextPage}
              disabled={query.isLoading}
              onClick={() => void query.fetchNextPage()}
            />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function DraftCard({
  draft,
  headersJson,
  onMutate,
}: {
  draft: DraftRow;
  headersJson: Record<string, string>;
  onMutate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(draft.generated_text);
  const [error, setError] = useState<string | null>(null);
  // 93-C7 / C-UX3: reject-reason dialog state (replaces window.prompt).
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  // R123 (E3 P3d): the styled confirm mount for the publish action.
  const { confirm, ConfirmDialog } = useConfirm();

  const publish = useMutation({
    mutationFn: async (override?: string | null) =>
      adminFetchJson(`/api/admin/enrichment/${draft.id}/publish`, {
        method: "POST",
        headers: headersJson,
        body: JSON.stringify({ final_text: override ?? null }),
      }),
    onSuccess: () => {
      setEditing(false);
      onMutate();
    },
    // R182 (Lane-A gap 2): route through getErrorMessage like the query
    // error path — raw e.message leaked network-level English into the
    // Arabic inline error chip (the R148 "3-errcopy" fix this page's
    // FetchErrorCard already received).
    onError: (e: Error) => setError(getErrorMessage(e)),
  });

  const reject = useMutation({
    mutationFn: async (reason: string | null) =>
      adminFetchJson(`/api/admin/enrichment/${draft.id}/reject`, {
        method: "POST",
        headers: headersJson,
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => onMutate(),
    onError: (e: Error) => setError(getErrorMessage(e)),
  });

  const busy = publish.isPending || reject.isPending;

  // R123 (E3 P3d): publishing REPLACES the product's live catalog
  // content in one tap — the confirm names the product + the field it
  // overwrites (the same context the card header carries), in the
  // styled-confirm idiom the destructive admin actions use.
  // R125-I3 (A2-2): the EDIT path ("تطبيق التعديل") used to fire
  // publish.mutate(edited) DIRECTLY — no confirm — while the unedited
  // path confirmed; the more consequential action (operator-authored
  // text over the live description) was the unguarded one. Both paths
  // now confirm; the edited-path message says the operator's EDITED
  // text is what goes live.
  const confirmPublish = async (editedText?: string) => {
    const editing = editedText != null;
    const confirmed = await confirm({
      title: editing ? "نشر النص المعدّل على المنتج؟" : "نشر المسودة على المنتج؟",
      description: editing
        ? `سيتم استبدال ${FIELD_LABEL[draft.field_name]} الحالي للمنتج «${draft.product_name}» بنصّك المعدّل — يظهر فوراً للعملاء في المتجر.`
        : `سيتم استبدال ${FIELD_LABEL[draft.field_name]} الحالي للمنتج «${draft.product_name}» بهذا النص المنشور — يظهر فوراً للعملاء في المتجر.`,
      confirmLabel: "نشر",
    });
    if (!confirmed) return;
    publish.mutate(editedText ?? null);
  };

  return (
    /* R139 (precision): the queue card goes solid — the translucent
       60%-alpha card fill → solid bg-card (the r138 "solid surfaces"
       family; the translucency was the pre-r138 idiom) on the resting
       border-border/60 edge (was /40 — the family value every catalog
       card rides). The interior hairlines keep their /40 step. */
    <div className="border border-border/60 rounded-2xl bg-card overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/30">
        <span className="text-sm font-bold flex-1">
          {draft.product_name}
          <span className="text-2xs font-normal text-muted-foreground mx-2">
            #{draft.product_id}
          </span>
        </span>
        {/* R139 (precision): the field-type chip gains the bordered
            tinted-pill box (border-primary/30) — the catalog lane's
            static-badge family (ProductCard variant badge, the
            InventoryUploadDialog «كود» badge); a borderless tinted
            pill is the one shape the r138 family retired. */}
        <span className="text-2xs text-primary-text bg-primary/10 border border-primary/30 px-2 py-0.5 rounded-full">
          {FIELD_LABEL[draft.field_name]}
        </span>
        <span className="text-3xs text-muted-foreground" dir="ltr">
          {draft.input_tokens + draft.output_tokens} tok · {draft.model_id}
        </span>
      </header>

      <div className="p-3 space-y-3">
        {!editing && (
          /* R139 (precision): the generated-copy well joins the r138
              well family — bg-muted/60 (was a translucent background
              wash with no family value) on the /40 edge; reads as a
              quiet inset against the now-solid card. */
          <div
            dir="auto"
            className="text-sm leading-relaxed bg-muted/60 border border-border/40 rounded-xl p-3 whitespace-pre-wrap"
          >
            {draft.generated_text}
          </div>
        )}
        {editing && (
          <textarea
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            rows={Math.min(20, Math.max(6, edited.split("\n").length + 2))}
            /* R133 (A4-F8): the edit-draft textarea had NO accessible
               name — no label, no id, no placeholder even (the finding's
               admin textarea tail). */
            aria-label="تعديل نص المسودة"
            className="w-full bg-background border border-primary/40 rounded-xl px-3 py-2 text-sm resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            /* R143 (L2-5, pages side): the draft-edit textarea joins the
               input.tsx focus idiom (see risk-event.tsx). */
          />
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-2 py-1">
            <AlertTriangle className="w-3 h-3" /> {error}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!editing && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void confirmPublish()}
              className="gap-2"
            >
              <Check className="w-3.5 h-3.5" /> تطبيق
            </Button>
          )}
          {!editing && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(true);
                setEdited(draft.generated_text);
                setError(null);
              }}
              className="gap-2"
            >
              <Pencil className="w-3.5 h-3.5" /> تعديل
            </Button>
          )}
          {editing && (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void confirmPublish(edited)}
                className="gap-2"
              >
                <Check className="w-3.5 h-3.5" /> تطبيق التعديل
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="gap-2"
              >
                <X className="w-3.5 h-3.5" /> إلغاء التعديل
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              // Open the styled reason dialog (93-C7 / C-UX3) instead of
              // window.prompt — same semantics, theme/RTL/focus-correct.
              setReason("");
              setRejectOpen(true);
            }}
            className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/5"
          >
            <XCircle className="w-3.5 h-3.5" /> رفض
          </Button>
          {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground self-center" />}
        </div>

        {/* Reject-reason dialog (93-C7 / C-UX3, A12 §1.5): textarea +
          confirm/cancel — the reason stays optional, ESC/backdrop cancel
          harmlessly (no data to lose), and submit is loading-guarded. */}
        <AppDialog
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          title="رفض المسودة"
          description={`${draft.product_name} — ${FIELD_LABEL[draft.field_name]}`}
          dismissable={!reject.isPending}
          size="sm"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setRejectOpen(false)}
                disabled={reject.isPending}
              >
                إلغاء
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const trimmed = reason.trim();
                  reject.mutate(trimmed.length > 0 ? trimmed : null);
                }}
                disabled={reject.isPending}
                className="gap-1.5"
              >
                {reject.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                رفض المسودة
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <label htmlFor="enrichment-reject-reason" className="text-xs font-bold">
              سبب الرفض (اختياري)
            </label>
            <textarea
              id="enrichment-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              dir="rtl"
              placeholder="مثال: الوصف غير دقيق — اذكر الخطأ ليُحسَّن التوليد لاحقاً"
              className="w-full bg-background border border-border/60 rounded-xl px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              /* R143 (L2-5, pages side): the rejection-reason textarea
                 joins the input.tsx focus idiom — focus:ring-destructive/25
                 was a 25%-alpha ring under the 3:1 floor. */
            />
            <p className="text-2xs text-muted-foreground">
              يُحفظ السبب مع سجل المسودة لتتبّع جودة التوليد.
            </p>
          </div>
        </AppDialog>
        {/* R123 (E3 P3d): the publish confirm's dialog mount. */}
        <ConfirmDialog />
      </div>
    </div>
  );
}
