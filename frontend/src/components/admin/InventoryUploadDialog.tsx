import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useToast } from "@/hooks/use-toast";
import {
  buildExistingDedupKeys,
  parseInventoryText,
  type ParsedInventoryEntry,
} from "@/lib/inventory-parser";
import {
  AlertCircle,
  CheckCircle,
  FileText,
  Key,
  Loader2,
  Mail,
  Package,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface InventoryUploadDialogProps {
  productId: number;
  productName: string;
  /**
   * Total inventory items currently in this product (sold + unsold).
   * If omitted, the dialog displays the count it fetched itself.
   */
  inventoryCount?: number;
  onClose: () => void;
  onUploaded: () => void;
}

const MAX_PREVIEW_ROWS = 8;
const FILE_BYTE_LIMIT = 256 * 1024; // 256 KB — comfortably above 500 lines

export function InventoryUploadDialog({
  productId,
  productName,
  inventoryCount,
  onClose,
  onUploaded,
}: InventoryUploadDialogProps) {
  const { toast } = useToast();
  const jsonHeaders = useAdminHeaders({ json: true });
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Existing inventory: fetched once on mount so the dedup-preview
  // can flag entries that already exist in the DB. The actual count
  // (when caller didn't pass `inventoryCount`) and the per-row
  // identifiers both come from this fetch.
  const [existingKeys, setExistingKeys] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [fetchedCount, setFetchedCount] = useState<number | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/products/${productId}/inventory`,
          { headers: jsonHeaders },
        );
        if (!res.ok) {
          // Soft-fail: dedup-against-DB just won't be available;
          // the in-batch dedup + server-side dedup at submit still work.
          if (!cancelled) setLoadingExisting(false);
          return;
        }
        const data = (await res.json()) as {
          total: number;
          items: Array<{
            account_email: string | null;
            extra_details: string | null;
          }>;
        };
        if (cancelled) return;
        setExistingKeys(
          buildExistingDedupKeys(
            data.items.map((r) => ({
              accountEmail: r.account_email,
              extraDetails: r.extra_details,
            })),
          ),
        );
        setFetchedCount(data.total);
      } catch {
        // Network error → soft-fail (same rationale as above).
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, jsonHeaders]);

  const displayCount = inventoryCount ?? fetchedCount ?? undefined;

  // Live parse on every text change — cheap, runs on the operator's
  // machine, gives instant feedback as they paste.
  const parsed = useMemo(
    () => parseInventoryText(text, existingKeys),
    [text, existingKeys],
  );
  const duplicateSet = useMemo(
    () => new Set(parsed.duplicateIndices),
    [parsed.duplicateIndices],
  );
  const willInsert = parsed.entries.length - parsed.duplicateIndices.length;

  // ── File drag-drop handlers ──────────────────────────────────────
  const handleFile = async (file: File) => {
    if (file.size > FILE_BYTE_LIMIT) {
      toast({
        title: "الملف كبير جداً",
        description: `الحد الأقصى ${Math.floor(FILE_BYTE_LIMIT / 1024)} كيلوبايت`,
        variant: "destructive",
      });
      return;
    }
    const content = await file.text();
    setText(content);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  // ── Submit ───────────────────────────────────────────────────────
  const submit = async () => {
    if (parsed.entries.length === 0) {
      toast({ title: "لا توجد عناصر صالحة للرفع", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/products/${productId}/inventory`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          // Send the structured shape so the backend can validate
          // per-row and dedup against existing inventory.
          entries: parsed.entries.map((e) => ({
            kind: e.kind,
            email: e.email,
            password: e.password,
            extra: e.extra,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "فشل الرفع");
      toast({
        title: "تم الرفع",
        description: data.message ?? `تم إضافة ${data.added} عنصر`,
      });
      onUploaded();
    } catch (err) {
      toast({
        title: "فشل الرفع",
        description: err instanceof Error ? err.message : "خطأ غير متوقع",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── ESC to close ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-3xl max-h-[95vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-border/40 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Upload className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-base">رفع مخزون جديد</h2>
            <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
              <span className="truncate">{productName}</span>
              {typeof displayCount === "number" ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-bold shrink-0">
                    {displayCount} عنصر متوفر حالياً
                  </span>
                </>
              ) : loadingExisting ? (
                <>
                  <span aria-hidden="true">·</span>
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                </>
              ) : null}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="w-8 h-8 rounded-lg hover:bg-muted/40 flex items-center justify-center shrink-0 disabled:opacity-50"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Format help */}
          <details className="group bg-muted/20 border border-border/40 rounded-xl px-3 py-2 [&_summary::-webkit-details-marker]:hidden [&_summary]:list-none">
            <summary className="cursor-pointer flex items-center gap-2 text-xs font-bold select-none">
              <FileText className="w-3.5 h-3.5 text-primary" />
              الصيغ المدعومة (اضغط للعرض)
            </summary>
            <ul
              dir="ltr"
              className="mt-2 text-[11px] leading-relaxed text-muted-foreground space-y-1 text-left font-mono"
            >
              <li>
                <Mail className="w-3 h-3 inline mr-1" />
                <code>email|password</code> — حساب بسيط
              </li>
              <li>
                <Mail className="w-3 h-3 inline mr-1" />
                <code>email|password|extra</code> — حساب مع تفاصيل (مثل recovery email)
              </li>
              <li>
                <Key className="w-3 h-3 inline mr-1" />
                <code>XBOX-12345-ABCDE</code> — كود/مفتاح فقط (سطر واحد)
              </li>
              <li>
                <FileText className="w-3 h-3 inline mr-1" />
                <code>email,password,extra</code> — TSV/CSV من Sheets
              </li>
              <li>
                <FileText className="w-3 h-3 inline mr-1" />
                <code>{`{"email":"a@x.com","password":"p"}`}</code> — JSON
              </li>
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              يكتشف النظام نوع كل سطر تلقائياً. الفواصل المدعومة:{" "}
              <code className="font-mono">|</code> <code className="font-mono">,</code>{" "}
              <code className="font-mono">;</code> <code className="font-mono">tab</code>.
              السطور التي تبدأ بـ <code className="font-mono">#</code> أو{" "}
              <code className="font-mono">//</code> تُعتبر تعليقات وتُتجاهل.
            </p>
          </details>

          {/* Drop zone + textarea */}
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className={`relative rounded-xl border-2 border-dashed transition-colors ${
              dragActive
                ? "border-primary bg-primary/5"
                : "border-border/60 bg-background/40"
            }`}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "الصق العناصر هنا (سطر لكل عنصر)…\n" +
                "مثال:\n" +
                "user1@mail.com|Password123\n" +
                "user2@mail.com|Password456|recovery@mail.com\n" +
                "XBOX-CODE-12345-ABCDE"
              }
              dir="ltr"
              className="w-full min-h-[220px] bg-transparent px-4 py-3 text-xs font-mono focus:outline-none resize-y rounded-xl"
            />
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border/40 bg-background/30">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-bold text-primary hover:text-primary/80 flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                أو ارفع ملف .txt / .csv
              </button>
              {text && (
                <button
                  type="button"
                  onClick={() => setText("")}
                  className="text-[11px] font-bold text-muted-foreground hover:text-destructive"
                >
                  مسح
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </div>

          {/* Live summary stats */}
          {parsed.totalLines > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <StatPill
                label="إجمالي الأسطر"
                value={parsed.totalLines}
                Icon={FileText}
                tone="neutral"
              />
              <StatPill
                label="جاهز للإضافة"
                value={willInsert}
                Icon={CheckCircle}
                tone="success"
              />
              <StatPill
                label="مكرر"
                value={parsed.duplicateIndices.length}
                Icon={Package}
                tone="warning"
                muted={parsed.duplicateIndices.length === 0}
              />
              <StatPill
                label="أخطاء"
                value={parsed.errors.length}
                Icon={AlertCircle}
                tone="error"
                muted={parsed.errors.length === 0}
              />
            </div>
          )}

          {/* Preview table */}
          {parsed.entries.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-black flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                  معاينة (أول {Math.min(parsed.entries.length, MAX_PREVIEW_ROWS)} من{" "}
                  {parsed.entries.length})
                </h3>
              </div>
              <div className="bg-card border border-border/55 rounded-xl overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="text-right font-bold px-2 py-1.5 w-10">#</th>
                      <th className="text-right font-bold px-2 py-1.5 w-20">النوع</th>
                      <th className="text-right font-bold px-2 py-1.5">المعرّف</th>
                      <th className="text-right font-bold px-2 py-1.5">حالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.entries.slice(0, MAX_PREVIEW_ROWS).map((entry, idx) => (
                      <PreviewRow
                        key={idx}
                        index={idx}
                        entry={entry}
                        isDuplicate={duplicateSet.has(idx)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.entries.length > MAX_PREVIEW_ROWS && (
                <p className="text-[11px] text-muted-foreground mt-1.5 text-center">
                  + {parsed.entries.length - MAX_PREVIEW_ROWS} عنصر إضافي سيُرفع
                </p>
              )}
            </div>
          )}

          {/* Error list */}
          {parsed.errors.length > 0 && (
            <div>
              <h3 className="text-xs font-black flex items-center gap-1.5 mb-2 text-destructive">
                <AlertCircle className="w-3.5 h-3.5" />
                أسطر تعذّر تحليلها ({parsed.errors.length})
              </h3>
              <div className="bg-destructive/5 border border-destructive/25 rounded-xl px-3 py-2 space-y-1 max-h-32 overflow-y-auto">
                {parsed.errors.slice(0, 10).map((err, i) => (
                  <div key={i} className="text-[11px] flex items-start gap-2">
                    <span className="font-mono text-destructive/70 shrink-0">
                      L{err.line}
                    </span>
                    <span className="text-muted-foreground flex-1 truncate">
                      {err.raw}
                    </span>
                    <span className="text-destructive font-bold shrink-0">
                      {err.reason}
                    </span>
                  </div>
                ))}
                {parsed.errors.length > 10 && (
                  <div className="text-[10px] text-muted-foreground text-center pt-1">
                    + {parsed.errors.length - 10} خطأ آخر
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-4 border-t border-border/40 shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 text-sm font-bold text-muted-foreground hover:text-foreground border border-border/60 rounded-xl disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            onClick={submit}
            disabled={submitting || willInsert === 0}
            className="flex-[2] px-4 py-2.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                جارٍ الرفع…
              </>
            ) : willInsert === 0 ? (
              "لا توجد عناصر للرفع"
            ) : parsed.duplicateIndices.length > 0 ? (
              `رفع ${willInsert} عنصر (تخطّي ${parsed.duplicateIndices.length} مكرر)`
            ) : (
              `رفع ${willInsert} عنصر`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Internals ────────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  Icon,
  tone,
  muted,
}: {
  label: string;
  value: number;
  Icon: React.ComponentType<{ className?: string }>;
  tone: "neutral" | "success" | "warning" | "error";
  muted?: boolean;
}) {
  const toneCls = muted
    ? "bg-muted/15 border-border/40 text-muted-foreground"
    : tone === "success"
      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
      : tone === "warning"
        ? "bg-orange-500/10 border-orange-500/30 text-orange-400"
        : tone === "error"
          ? "bg-destructive/10 border-destructive/30 text-destructive"
          : "bg-muted/15 border-border/40 text-foreground";
  return (
    <div className={`flex flex-col items-center gap-0.5 px-2 py-2 border rounded-xl ${toneCls}`}>
      <Icon className="w-3.5 h-3.5" />
      <div className="text-base font-black tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground font-medium">{label}</div>
    </div>
  );
}

function PreviewRow({
  index,
  entry,
  isDuplicate,
}: {
  index: number;
  entry: ParsedInventoryEntry;
  isDuplicate: boolean;
}) {
  const identifier =
    entry.kind === "credentials" ? entry.email : (entry.extra ?? "—");
  return (
    <tr
      className={`border-t border-border/30 ${
        isDuplicate ? "bg-orange-500/5" : "hover:bg-muted/10"
      }`}
    >
      <td className="px-2 py-1.5 text-muted-foreground font-mono">{index + 1}</td>
      <td className="px-2 py-1.5">
        {entry.kind === "credentials" ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded">
            <Mail className="w-2.5 h-2.5" />
            حساب
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-violet-500/10 text-violet-300 border border-violet-500/30 px-1.5 py-0.5 rounded">
            <Key className="w-2.5 h-2.5" />
            كود
          </span>
        )}
      </td>
      <td
        className="px-2 py-1.5 font-mono text-[10px] text-foreground/85 truncate max-w-[180px]"
        dir="ltr"
        title={identifier}
      >
        {identifier}
      </td>
      <td className="px-2 py-1.5">
        {isDuplicate ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-orange-500/10 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded">
            <AlertCircle className="w-2.5 h-2.5" />
            مكرر
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">
            <CheckCircle className="w-2.5 h-2.5" />
            جديد
          </span>
        )}
      </td>
    </tr>
  );
}
