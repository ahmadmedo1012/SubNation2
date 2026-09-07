import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { copyToClipboard } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// 93-C7 / C-UX2 (A12 B6): session-status pills migrate from raw
// emerald/amber/blue/red hues to the canonical StatusBadge on the
// --status-* tokens.
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
// 93-C7 / C-UX6 (A12 §5): the hand-rolled bare "لا توجد جلسات بعد"
// empty state adopts the shared EmptyState card.
import { EmptyState } from "@/components/admin/EmptyState";
import { AdminLayout } from "./layout";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  Wifi,
  XCircle,
} from "lucide-react";

interface WhatsAppSession {
  id: string;
  name: string;
  status: string;
}

interface SessionsResponse {
  sessions: WhatsAppSession[];
}

interface PairCodeResponse {
  session: WhatsAppSession;
  code: string;
}

const STATUS_META: Record<string, { label: string; tone: StatusBadgeVariant }> = {
  ready: { label: "جاهزة", tone: "success" },
  qr_ready: { label: "تنتظر QR", tone: "warning" },
  authenticating: { label: "جارٍ التحقق", tone: "info" },
  initializing: { label: "جارٍ التشغيل", tone: "info" },
  connecting: { label: "جارٍ الاتصال", tone: "warning" },
  disconnected: { label: "منقطعة", tone: "error" },
  failed: { label: "فشلت", tone: "error" },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, tone: "neutral" as const };
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  // Round-4 (org §6a): getErrorMessage maps the backend `code` to Arabic
  // when present, else falls back to the raw `error` string / HTTP text.
  return getErrorMessage(body) || `فشلت العملية (${response.status})`;
}

export default function AdminWhatsAppPage() {
  const headers = useAdminHeaders();
  const jsonHeaders = useAdminHeaders({ json: true });
  const { toast } = useToast();
  // B5-05 (round-92 audit): the raw window.confirm on session delete is
  // replaced by the shared styled AlertDialog hook used by admins.tsx /
  // promotions.tsx — same message text.
  const { confirm, ConfirmDialog } = useConfirm();
  const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
  const [name, setName] = useState("subnation-otp");
  const [phone, setPhone] = useState("");
  const [pairTarget, setPairTarget] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  // B5-30 (round-92 audit): copied feedback for the pair-code copy
  // button (check-icon swap, same as the topups CopyButton idiom).
  const [pairCopied, setPairCopied] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/diagnostics/whatsapp/sessions", { headers });
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as SessionsResponse;
      setSessions(Array.isArray(body.sessions) ? body.sessions : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر جلب جلسات واتساب");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const createSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const response = await fetch("/api/admin/diagnostics/whatsapp/sessions", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      toast({ title: "تم إنشاء الجلسة", variant: "success" });
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إنشاء الجلسة");
    } finally {
      setBusy(null);
    }
  };

  const startSession = async (session: WhatsAppSession) => {
    setBusy(`${session.id}:start`);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/diagnostics/whatsapp/sessions/${encodeURIComponent(session.id)}/start`,
        { method: "POST", headers },
      );
      if (!response.ok) throw new Error(await responseError(response));
      toast({ title: "بدأ تشغيل الجلسة", description: "يمكنك طلب QR أو رمز الاقتران الآن" });
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تشغيل الجلسة");
    } finally {
      setBusy(null);
    }
  };

  const requestPairCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pairTarget) return;
    setBusy(`${pairTarget}:pair`);
    setError(null);
    setPairCode(null);
    setPairCopied(false);
    try {
      const response = await fetch(
        `/api/admin/diagnostics/whatsapp/sessions/${encodeURIComponent(pairTarget)}/pair-code`,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ phone }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as PairCodeResponse;
      setPairCode(body.code);
      toast({
        title: "تم إصدار رمز الاقتران",
        description: "أدخله في واتساب خلال دقيقتين تقريباً",
      });
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إصدار رمز الاقتران");
    } finally {
      setBusy(null);
    }
  };

  const loadQr = async (session: WhatsAppSession) => {
    setBusy(`${session.id}:qr`);
    setError(null);
    setQrImage(null);
    setPairTarget(session.id);
    setPairCode(null);
    setPairCopied(false);
    try {
      const response = await fetch(
        `/api/admin/diagnostics/whatsapp/sessions/${encodeURIComponent(session.id)}/qr`,
        { headers },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const body = (await response.json()) as { qrImage?: string | null };
      if (!body.qrImage) {
        throw new Error("لا يوجد QR حالياً؛ شغّل الجلسة وانتظر حالتها");
      }
      setQrImage(body.qrImage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر جلب QR");
    } finally {
      setBusy(null);
    }
  };

  const deleteSession = async (session: WhatsAppSession) => {
    const confirmed = await confirm({
      title: "حذف الجلسة؟",
      description: `سيتم حذف جلسة ${session.name} ومسح بيانات اقترانها. متابعة؟`,
      confirmLabel: "حذف",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(`${session.id}:delete`);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/diagnostics/whatsapp/sessions/${encodeURIComponent(session.id)}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) throw new Error(await responseError(response));
      if (pairTarget === session.id) {
        setPairTarget(null);
        setPairCode(null);
        setPairCopied(false);
      }
      setQrImage(null);
      toast({ title: "تم حذف الجلسة", variant: "success" });
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حذف الجلسة");
    } finally {
      setBusy(null);
    }
  };

  // B6 + B5-30 (round-92 audit): the pair-code copy was a raw
  // `navigator.clipboard?.writeText` fire-and-forget — bypassed the
  // shared helper (no secure-context fallback), gave no copied
  // feedback, and swallowed failures. Now: shared helper, check-icon
  // swap, and a destructive toast when the copy genuinely fails.
  const copyPairCode = async (code: string) => {
    const ok = await copyToClipboard(code);
    if (!ok) {
      toast({ title: "تعذّر نسخ الرمز", variant: "destructive" });
      return;
    }
    setPairCopied(true);
    setTimeout(() => setPairCopied(false), 1800);
  };

  return (
    <AdminLayout onRefresh={() => void loadSessions()}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-primary mb-1">
              <Wifi className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-widest">WhatsApp OTP</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight">إدارة جلسة واتساب</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              أنشئ جلسة الإرسال، شغّلها، ثم اربط رقم واتساب الخاص بالخدمة. لا تضع مفتاح API في
              المتصفح؛ الواجهة تمرّر الطلبات عبر الخادم بشكل محمي.
            </p>
          </div>
          <a
            href="https://openwa-gateway-7aaa.onrender.com/api/docs"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            وثائق البوابة
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 flex gap-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-muted-foreground leading-6">
            رمز الاقتران يربط رقم واتساب الذي سيرسل أكواد الدخول. بعد الربط انتظر حتى تصبح الحالة
            «جاهزة». حذف الجلسة يمسح اعتمادها ويحتاج اقتراناً جديداً.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 flex gap-2 text-sm text-destructive">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form
          onSubmit={createSession}
          className="rounded-2xl border border-border bg-card p-4 space-y-3"
        >
          <div className="flex items-center gap-2 font-bold">
            <Plus className="w-4 h-4 text-primary" />
            إضافة جلسة
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="subnation-otp"
              pattern="[A-Za-z0-9-]{3,50}"
              title="من 3 إلى 50 حرفاً إنجليزياً أو رقماً أو شرطة"
              required
              dir="ltr"
            />
            <Button type="submit" disabled={busy !== null} className="sm:min-w-32">
              {busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />}
              إنشاء
            </Button>
          </div>
        </form>

        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold">
              <KeyRound className="w-4 h-4 text-primary" />
              الجلسات الحالية
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void loadSessions()}
              disabled={loading}
              aria-label="تحديث"
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
          </div>

          {loading ? (
            <div className="p-8 flex justify-center text-muted-foreground">
              <Loader2 className="animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <EmptyState icon={Wifi} title="لا توجد جلسات بعد" description="أنشئ جلسة أولى للبدء." />
          ) : (
            <div className="divide-y divide-border">
              {sessions.map((session) => {
                const meta = statusMeta(session.status);
                const sessionBusy = busy?.startsWith(`${session.id}:`);
                return (
                  <div key={session.id} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold truncate" dir="ltr">
                            {session.name}
                          </span>
                          <StatusBadge variant={meta.tone} size="sm">
                            {meta.label}
                          </StatusBadge>
                        </div>
                        <div
                          className="text-[11px] text-muted-foreground font-mono mt-1 truncate"
                          dir="ltr"
                        >
                          {session.id}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void startSession(session)}
                          disabled={sessionBusy}
                        >
                          {busy === `${session.id}:start` ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Play />
                          )}
                          تشغيل
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void loadQr(session)}
                          disabled={sessionBusy}
                        >
                          {busy === `${session.id}:qr` ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <QrCode />
                          )}
                          QR
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void deleteSession(session)}
                          disabled={sessionBusy}
                        >
                          {busy === `${session.id}:delete` ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Trash2 />
                          )}
                          حذف
                        </Button>
                      </div>
                    </div>

                    {pairTarget === session.id ? (
                      <form
                        onSubmit={requestPairCode}
                        className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2"
                      >
                        <div className="text-xs text-muted-foreground">
                          اكتب رقم واتساب بصيغة دولية، مثال: <span dir="ltr">21891XXXXXXX</span>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            value={phone}
                            onChange={(event) => setPhone(event.target.value)}
                            placeholder="21891XXXXXXX"
                            inputMode="tel"
                            dir="ltr"
                            required
                          />
                          <Button type="submit" disabled={busy !== null}>
                            {busy === `${session.id}:pair` ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <KeyRound />
                            )}
                            إصدار رمز الاقتران
                          </Button>
                        </div>
                        {pairCode && (
                          <div className="flex flex-wrap items-center gap-2 pt-2">
                            <code
                              className="text-xl font-black tracking-[0.25em] bg-background border border-border rounded-lg px-3 py-2"
                              dir="ltr"
                            >
                              {pairCode}
                            </code>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => void copyPairCode(pairCode)}
                            >
                              {pairCopied ? <Check /> : <Copy />}
                              {pairCopied ? "تم النسخ" : "نسخ"}
                            </Button>
                          </div>
                        )}
                      </form>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPairTarget(session.id);
                          setPairCode(null);
                          setPairCopied(false);
                          setQrImage(null);
                        }}
                      >
                        <KeyRound />
                        ربط برمز الهاتف
                      </Button>
                    )}

                    {qrImage && pairTarget === session.id && (
                      <div className="rounded-xl border border-border bg-background p-4 flex flex-col items-center gap-2">
                        <img
                          src={qrImage}
                          alt={`رمز QR لجلسة ${session.name}`}
                          className="w-64 h-64"
                        />
                        <span className="text-xs text-muted-foreground">
                          من واتساب: الأجهزة المرتبطة ← ربط جهاز
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <ConfirmDialog />
    </AdminLayout>
  );
}
