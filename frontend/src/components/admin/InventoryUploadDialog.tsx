import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useToast } from "@/hooks/use-toast";
// 93-C7 / C-UX3 (A12 §11.2, H7): migrated from the hand-rolled fixed
// overlay to the shared AppDialog (size="wide") — gains focus trap,
// scroll-lock, role="dialog"/aria-modal and the Radix animation family.
// The submitting-time backdrop guard is preserved via `dismissable`.
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
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
  const [existingKeys, setExistingKeys] = useState<Set<string>>(() => new Set<string>());
  const [fetchedCount, setFetchedCount] = useState<number | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/products/${productId}/inventory`, {
          headers: jsonHeaders,
        });
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
  const parsed = useMemo(() => parseInventoryText(text, existingKeys), [text, existingKeys]);
  const duplicateSet = useMemo(() => new Set(parsed.duplicateIndices), [parsed.duplicateIndices]);
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
    // 94-C2 (A2 P3-19): a failed file read used to leave an unhandled
    // rejection with the textarea untouched and no feedback.
    try {
      const content = await file.text();
      setText(content);
    } catch {
      toast({
        title: "تعذّر قراءة الملف",
        description: "قد يكون الملف محمياً أو غير قابل للقراءة — جرّب لصق المحتوى يدوياً",
        variant: "destructive",
      });
    }
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
      // 94-C2 (A2 P3-19): parse AFTER the ok check — an HTML error page
      // (proxy 502) used to throw an opaque English SyntaxError before
      // the real error path could run.
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
        added?: number;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `فشل الرفع (HTTP ${res.status})`);
      }
      toast({
        title: "تم الرفع",
        description: data?.message ?? `تم إضافة ${data?.added ?? 0} عنصر`,
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

  // ── ESC to close: handled by the AppDialog shell (Radix) with the
  //    `dismissable={!submitting}` guard — the previous hand-rolled
  //    window keydown listener is retired (93-C7 / C-UX3).

  return (
    <AppDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="رفع مخزون جديد"
      description={
        <span className="flex items-center gap-1.5">
          <span className="truncate">{productName}</span>
          {typeof displayCount === "number" ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="shrink-0 font-bold">{displayCount} عنصر متوفر حالياً</span>
            </>
          ) : loadingExisting ? (
            <>
              <span aria-hidden="true">·</span>
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
            </>
          ) : null}
        </span>
      }
      dismissable={!submitting}
      size="wide"
      footer={
        <>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 sm:flex-none"
          >
            إلغاء
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || willInsert === 0}
            className="flex-[2] gap-2 sm:flex-1"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جارٍ الرفع…
              </>
            ) : willInsert === 0 ? (
              "لا توجد عناصر للرفع"
            ) : parsed.duplicateIndices.length > 0 ? (
              `رفع ${willInsert} عنصر (تخطّي ${parsed.duplicateIndices.length} مكرر)`
            ) : (
              `رفع ${willInsert} عنصر`
            )}
          </Button>
        </>
      }
    >
      <AppDialogBody className="space-y-4">
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
            يكتشف النظام نوع كل سطر تلقائياً. الفواصل المدعومة: <code className="font-mono">|</code>{" "}
            <code className="font-mono">,</code> <code className="font-mono">;</code>{" "}
            <code className="font-mono">tab</code>. السطور التي تبدأ بـ{" "}
            <code className="font-mono">#</code> أو <code className="font-mono">//</code> تُعتبر
            تعليقات وتُتجاهل.
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
            dragActive ? "border-primary bg-primary/5" : "border-border/60 bg-background/40"
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
            <StatPill label="جاهز للإضافة" value={willInsert} Icon={CheckCircle} tone="success" />
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
                <CheckCircle className="w-3.5 h-3.5 text-status-success" />
                معاينة (أول {Math.min(parsed.entries.length, MAX_PREVIEW_ROWS)} من{" "}
                {parsed.entries.length})
              </h3>
            </div>
            <div className="bg-card border border-border/55 rounded-xl overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    {/* 96-F7 (R96 A6 #15): scope="col" — screen readers
                        announce the header↔cell relation on vertical
                        sweeps instead of a bare "خلية". */}
                    <th scope="col" className="text-right font-bold px-2 py-1.5 w-10">#</th>
                    <th scope="col" className="text-right font-bold px-2 py-1.5 w-20">النوع</th>
                    <th scope="col" className="text-right font-bold px-2 py-1.5">المعرّف</th>
                    <th scope="col" className="text-right font-bold px-2 py-1.5">حالة</th>
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
                  <span className="font-mono text-destructive/70 shrink-0">L{err.line}</span>
                  <span className="text-muted-foreground flex-1 truncate">{err.raw}</span>
                  <span className="text-destructive font-bold shrink-0">{err.reason}</span>
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
      </AppDialogBody>
    </AppDialog>
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
  // 94-C2 (A2 colors): the raw emerald/orange/blue/violet pills are
  // unified on the --status-* tokens (AA-safe on both themes; the old
  // -400-on-white pairs reached ~1.9–2.5:1 in light mode).
  const toneCls = muted
    ? "bg-muted/15 border-border/40 text-muted-foreground"
    : tone === "success"
      ? "bg-status-success/10 border-status-success/30 text-status-success"
      : tone === "warning"
        ? "bg-status-warning/10 border-status-warning/30 text-status-warning"
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
  const identifier = entry.kind === "credentials" ? entry.email : (entry.extra ?? "—");
  return (
    <tr
      className={`border-t border-border/30 ${
        isDuplicate ? "bg-status-warning/5" : "hover:bg-muted/10"
      }`}
    >
      <td className="px-2 py-1.5 text-muted-foreground font-mono">{index + 1}</td>
      <td className="px-2 py-1.5">
        {entry.kind === "credentials" ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-status-info/10 text-status-info border border-status-info/30 px-1.5 py-0.5 rounded">
            <Mail className="w-2.5 h-2.5" />
            حساب
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-primary/10 text-primary border border-primary/30 px-1.5 py-0.5 rounded">
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
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-status-warning/10 text-status-warning border border-status-warning/30 px-1.5 py-0.5 rounded">
            <AlertCircle className="w-2.5 h-2.5" />
            مكرر
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-status-success/10 text-status-success border border-status-success/30 px-1.5 py-0.5 rounded">
            <CheckCircle className="w-2.5 h-2.5" />
            جديد
          </span>
        )}
      </td>
    </tr>
  );
}
