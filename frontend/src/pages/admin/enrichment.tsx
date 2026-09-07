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
import { getErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
// 93-C7 / C-UX3 (A12 §1.3 + §11.2): the enrichment reject reason was
// collected via native window.prompt — English browser chrome inside an
// Arabic RTL admin, no validation, ambiguous "" vs null semantics. It
// is now a small AppDialog with a textarea (RejectModal semantics).
import { AppDialog } from "@/components/ui/app-dialog";
// 93-C7 / C-UX6 (A12 §5): the hand-rolled "لا توجد مسودات…" block
// adopts the shared EmptyState card.
import { EmptyState } from "@/components/admin/EmptyState";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  panel_url: string;
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

  const query = useQuery<ListResponse>({
    queryKey: ["admin-enrichment-list", "drafted"],
    queryFn: async () => {
      const resp = await fetch("/api/admin/enrichment/list?state=drafted&limit=25", {
        headers,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
  });

  const drafts = useMemo(() => query.data?.drafts ?? [], [query.data]);
  const pending = query.data?.pending_count ?? null;

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

        {query.isLoading && (
          <div className="text-sm text-muted-foreground py-12 text-center">جارٍ التحميل…</div>
        )}
        {query.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4" /> فشل تحميل المسودات
          </div>
        )}
        {!query.isLoading && drafts.length === 0 && (
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

  const publish = useMutation({
    mutationFn: async (override?: string | null) => {
      const resp = await fetch(`/api/admin/enrichment/${draft.id}/publish`, {
        method: "POST",
        headers: headersJson,
        body: JSON.stringify({ final_text: override ?? null }),
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
      setEditing(false);
      onMutate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const reject = useMutation({
    mutationFn: async (reason: string | null) => {
      const resp = await fetch(`/api/admin/enrichment/${draft.id}/reject`, {
        method: "POST",
        headers: headersJson,
        body: JSON.stringify({ reason }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { error?: string } | null;
        // Round-4 (org §6a): map the backend `code` to Arabic via
        // getErrorMessage; the raw `error` string stays the fallback.
        throw new Error(getErrorMessage(body) || `HTTP ${resp.status}`);
      }
      return resp.json();
    },
    onSuccess: () => onMutate(),
    onError: (e: Error) => setError(e.message),
  });

  const busy = publish.isPending || reject.isPending;

  return (
    <div className="border border-border/40 rounded-2xl bg-card/60 overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/30">
        <span className="text-sm font-bold flex-1">
          {draft.product_name}
          <span className="text-[11px] font-normal text-muted-foreground mx-2">
            #{draft.product_id}
          </span>
        </span>
        <span className="text-[11px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">
          {FIELD_LABEL[draft.field_name]}
        </span>
        <span className="text-[10px] text-muted-foreground" dir="ltr">
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
              onClick={() => publish.mutate(null)}
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
                onClick={() => publish.mutate(edited)}
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
            <p className="text-[11px] text-muted-foreground">
              يُحفظ السبب مع سجل المسودة لتتبّع جودة التوليد.
            </p>
          </div>
        </AppDialog>
      </div>
    </div>
  );
}
