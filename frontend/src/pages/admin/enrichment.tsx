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

import { useAdminHeaders } from "@/hooks/use-admin-headers";
// R123 (E3 item 1): the three raw fetches ride the session-aware
// adminFetchJson wrapper — an inventory cookie expiring mid-review now
// gets the global «انتهت الجلسة» toast + redirect, and the card's inline
// error line shows the sentinel's Arabic message instead of a raw
// `HTTP 401`; the ok-guard + safe error-body parse move into the
// wrapper too.
import { adminFetchJson } from "@/lib/admin-session";
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
import { useConfirm } from "@/hooks/use-confirm";
// 93-C7 / C-UX3 (A12 §1.3 + §11.2): the enrichment reject reason was
// collected via native window.prompt — English browser chrome inside an
// Arabic RTL admin, no validation, ambiguous "" vs null semantics. It
// is now a small AppDialog with a textarea (RejectModal semantics).
import { AppDialog } from "@/components/ui/app-dialog";
// 93-C7 / C-UX6 (A12 §5): the hand-rolled "لا توجد مسودات…" block
// adopts the shared EmptyState card.
import { EmptyState } from "@/components/admin/EmptyState";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useMemo, useState } from "react";
import { AdminLayout } from "./layout";

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

const FIELD_LABEL: Record<FieldName, string> = {
  description: "وصف قصير",
  description_long: "وصف طويل",
  faq: "أسئلة شائعة",
};

export default function AdminEnrichmentPage() {
  const headers = useAdminHeaders();
  const headersJson = useAdminHeaders({ json: true });
  const qc = useQueryClient();

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
  });

  const drafts = useMemo(() => query.data?.pages.flatMap((p) => p.drafts) ?? [], [query.data]);
  // pending_count is computed at query time for the whole drafted set —
  // every page carries the same value; take the newest page's.
  const pending =
    query.data && query.data.pages.length > 0
      ? (query.data.pages[query.data.pages.length - 1].pending_count ?? null)
      : null;

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
                    <span className="text-muted-foreground/80"> (تُعرض أول {drafts.length})</span>
                  )}
                </>
              )}
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
            description={
              query.error instanceof Error
                ? query.error.message
                : "حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"
            }
            onRetry={() => query.refetch()}
          />
        )}
        {!query.isLoading && !query.isError && drafts.length === 0 && (
          <EmptyState
            icon={CheckCircle2}
            title="لا توجد مسودات تنتظر المراجعة"
            description={
              <>
                لتفعيل خط الأنابيب: اضبط <code dir="ltr">ENRICHMENT_RUNNER_ENABLED=true</code> على
                عامل الخادم.
              </>
            }
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
    onError: (e: Error) => setError(e.message),
  });

  const reject = useMutation({
    mutationFn: async (reason: string | null) =>
      adminFetchJson(`/api/admin/enrichment/${draft.id}/reject`, {
        method: "POST",
        headers: headersJson,
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => onMutate(),
    onError: (e: Error) => setError(e.message),
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
    <div className="border border-border/40 rounded-2xl bg-card/60 overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/30">
        <span className="text-sm font-bold flex-1">
          {draft.product_name}
          <span className="text-2xs font-normal text-muted-foreground mx-2">
            #{draft.product_id}
          </span>
        </span>
        <span className="text-2xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
          {FIELD_LABEL[draft.field_name]}
        </span>
        <span className="text-3xs text-muted-foreground" dir="ltr">
          {draft.input_tokens + draft.output_tokens} tok · {draft.model_id}
        </span>
      </header>

      <div className="p-3 space-y-3">
        {!editing && (
          <div
            dir="auto"
            className="text-sm leading-relaxed bg-background/60 border border-border/40 rounded-xl p-3 whitespace-pre-wrap"
          >
            {draft.generated_text}
          </div>
        )}
        {editing && (
          <textarea
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            rows={Math.min(20, Math.max(6, edited.split("\n").length + 2))}
            className="w-full bg-background border border-primary/40 rounded-xl px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
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
              className="w-full bg-background border border-border/60 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-destructive/25"
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
