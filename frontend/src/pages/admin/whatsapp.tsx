import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
// R123 (E3 item 1): the six raw fetches ride the session-aware wrapper
// — a settings cookie expiring mid-work now gets the global «انتهت
// الجلسة» toast + redirect instead of an inline banner on a page the
// operator is already leaving, and adminFetchJson owns the ok-guard +
// safe error-body parse the local responseError helper hand-rolled
// (same Arabic mapping via getErrorMessage inside the wrapper). Pure
// UI-path change: the endpoints stay the app's own diagnostics proxy,
// and nothing here auto-triggers session operations.
import { AdminSessionExpiredError, adminFetchJson } from "@/lib/admin-session";
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
// R126-L3 (A2-2): a failed FIRST load renders the shared error card —
// the page previously showed its hand-rolled banner AND the empty
// state together (an outage masquerading as "no sessions yet").
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { AdminLayout } from "./layout";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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

// R107 (migration): gateway docs link is env-driven — the ONLY place a
// gateway URL ever lived in executable frontend code. R110 (109-b): the
// baked onrender.com default is GONE — it dies with the Render
// decommission, so an unset VITE_OPENWA_DOCS_URL degrades the header
// deep-link to a plain hint instead of pointing at a doomed domain. A
// single-origin Coolify deployment sets
// VITE_OPENWA_DOCS_URL=<gateway-origin>/api/docs at build time (Dockerfile
// ARG). Backend gateway traffic itself was always env-driven
// (WHATSAPP_OTP_BASE_URL) — this is the admin deep-link only, not a secret.
const OPENWA_DOCS_URL: string =
  (import.meta.env.VITE_OPENWA_DOCS_URL as string | undefined)?.trim() || "";

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

/** R125-I5 (A3-12, display-only): WhatsApp pair codes live roughly two
 * minutes. The backend's pair-code response carries NO expiry field
 * (openwa.service.ts requestWhatsAppPairCode → { session, code } only),
 * so the display layer marks the block stale after this TTL instead of
 * promising a countdown it can't honor. Purely visual: never blocks the
 * copy button, never touches pairing/session logic. */
const PAIR_CODE_STALE_AFTER_MS = 120_000;

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
  // R125-I5 (A3-12): staleness cue for the pair-code block — see
  // PAIR_CODE_STALE_AFTER_MS above. `issuedAt` drives a timeout that
  // flips `stale`; every code-issuing/reset path clears both.
  const [pairCodeIssuedAt, setPairCodeIssuedAt] = useState<number | null>(null);
  const [pairCodeStale, setPairCodeStale] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  // R125-I5 (A3-4c): `loading` gates the FIRST-load skeleton only —
  // `refreshing` is the silent-refresh indicator (header button spin)
  // that keeps the rendered rows standing during post-action reloads.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // R125-I5 (A3-4c): tracks whether at least one load completed, so the
  // post-action reloads below can stay silent (rows keep standing).
  const hasLoadedRef = useRef(false);

  const loadSessions = useCallback(async () => {
    // R125-I5 (A3-4c): every mutation handler ends with `await
    // loadSessions()` — the old unconditional setLoading(true) collapsed
    // the whole session list into a spinner on every create/start/pair/
    // delete (scroll position + row context lost mid-task). Only the
    // first load blanks the list now; refreshes keep the rows visible
    // and the header refresh button spins via `refreshing` instead.
    if (hasLoadedRef.current) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const body = await adminFetchJson<SessionsResponse>(
        "/api/admin/diagnostics/whatsapp/sessions",
        { headers },
      );
      setSessions(Array.isArray(body.sessions) ? body.sessions : []);
      hasLoadedRef.current = true;
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      setError(err instanceof Error ? err.message : "تعذّر جلب جلسات واتساب");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // R125-I5 (A3-12): the staleness timeout rides the issuance timestamp
  // — a fresh code resets the cue, clearing/nulling the code disarms it.
  useEffect(() => {
    if (pairCodeIssuedAt === null) return;
    setPairCodeStale(Date.now() - pairCodeIssuedAt >= PAIR_CODE_STALE_AFTER_MS);
    const timer = setTimeout(
      () => setPairCodeStale(true),
      Math.max(0, PAIR_CODE_STALE_AFTER_MS - (Date.now() - pairCodeIssuedAt)),
    );
    return () => clearTimeout(timer);
  }, [pairCodeIssuedAt]);

  // R125-I5 (A3-12): one place resets the pair-code surface — every
  // path that nulls the code also disarms the staleness cue.
  const clearPairCode = useCallback(() => {
    setPairCode(null);
    setPairCopied(false);
    setPairCodeIssuedAt(null);
    setPairCodeStale(false);
  }, []);

  const createSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("create");
    try {
      await adminFetchJson("/api/admin/diagnostics/whatsapp/sessions", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name }),
      });
      toast({ title: "تم إنشاء الجلسة", variant: "success" });
      await loadSessions();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      // R125-I5 (A3-12): action errors get the same toast treatment the
      // successes on this page get — the old banner-only path rendered
      // far from the pressed button (possibly off-screen). The top
      // banner stays reserved for list-load failures.
      toast({
        title: err instanceof Error ? err.message : "تعذّر إنشاء الجلسة",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const startSession = async (session: WhatsAppSession) => {
    setBusy(`${session.id}:start`);
    try {
      await adminFetchJson(
        `/api/admin/diagnostics/whatsapp/sessions/${encodeURIComponent(session.id)}/start`,
        { method: "POST", headers },
      );
      // R124-I5 (A6 F1): success variant — matches the green
      // create/delete session toasts on this page.
      toast({
        title: "بدأ تشغيل الجلسة",
        description: "يمكنك طلب QR أو رمز الاقتران الآن",
        variant: "success",
      });
      await loadSessions();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      // R125-I5 (A3-12): toast like the successes (see createSession).
      toast({
        title: err instanceof Error ? err.message : "تعذّر تشغيل الجلسة",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const requestPairCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pairTarget) return;
    setBusy(`${pairTarget}:pair`);
    clearPairCode();
    try {
      const body = await adminFetchJson<PairCodeResponse>(
        `/api/admin/diagnostics/whatsapp/sessions/${encodeURIComponent(pairTarget)}/pair-code`,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ phone }),
        },
      );
      setPairCode(body.code);
      // R125-I5 (A3-12): stamp the issuance — the staleness cue below
      // dims the block after PAIR_CODE_STALE_AFTER_MS.
      setPairCodeIssuedAt(Date.now());
      // R124-I5 (A6 F1): success variant.
      // R125-I5 (A3-12): the copy no longer promises «دقيقتان» — the
      // backend returns no expiry field, so the toast keeps a hedged
      // short-validity hint and the code block carries the staleness
      // cue instead of an honored-nowhere countdown.
      toast({
        title: "تم إصدار رمز الاقتران",
        description: "صلاحيته قصيرة — أدخله في واتساب فوراً",
        variant: "success",
      });
      await loadSessions();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      // R125-I5 (A3-12): toast like the successes (see createSession).
      toast({
        title: err instanceof Error ? err.message : "تعذّر إصدار رمز الاقتران",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const loadQr = async (session: WhatsAppSession) => {
    setBusy(`${session.id}:qr`);
    setQrImage(null);
    setPairTarget(session.id);
    clearPairCode();
    try {
      const body = await adminFetchJson<{ qrImage?: string | null }>(
        `/api/admin/diagnostics/whatsapp/sessions/${encodeURIComponent(session.id)}/qr`,
        { headers },
      );
      if (!body.qrImage) {
        throw new Error("لا يوجد QR حالياً؛ شغّل الجلسة وانتظر حالتها");
      }
      setQrImage(body.qrImage);
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      // R125-I5 (A3-12): toast like the successes (see createSession).
      toast({
        title: err instanceof Error ? err.message : "تعذّر جلب QR",
        variant: "destructive",
      });
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
    try {
      await adminFetchJson(
        `/api/admin/diagnostics/whatsapp/sessions/${encodeURIComponent(session.id)}`,
        { method: "DELETE", headers },
      );
      if (pairTarget === session.id) {
        setPairTarget(null);
        clearPairCode();
      }
      setQrImage(null);
      toast({ title: "تم حذف الجلسة", variant: "success" });
      await loadSessions();
    } catch (err) {
      if (err instanceof AdminSessionExpiredError) return;
      // R125-I5 (A3-12): toast like the successes (see createSession).
      toast({
        title: err instanceof Error ? err.message : "تعذّر حذف الجلسة",
        variant: "destructive",
      });
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
            <h2 className="text-2xl font-bold tracking-tight">إدارة جلسة واتساب</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              أنشئ جلسة الإرسال، شغّلها، ثم اربط رقم واتساب الخاص بالخدمة. لا تضع مفتاح API في
              المتصفح؛ الواجهة تمرّر الطلبات عبر الخادم بشكل محمي.
            </p>
          </div>
          {OPENWA_DOCS_URL ? (
            <a
              href={OPENWA_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              وثائق البوابة
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            // 110-M (109-b): no build-time docs URL — a muted plain-text
            // hint keeps the header layout; never link a dead domain.
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground/60">
              وثائق البوابة
            </span>
          )}
        </div>

        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 flex gap-3 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-muted-foreground leading-6">
            رمز الاقتران يربط رقم واتساب الذي سيرسل أكواد الدخول. بعد الربط انتظر حتى تصبح الحالة
            «جاهزة». حذف الجلسة يمسح اعتمادها ويحتاج اقتراناً جديداً.
          </p>
        </div>

        {/* R126-L3 (A2-2): the list-load banner now follows the
            orders/tickets stale-keep precedence — it renders ONLY when
            rows are standing (a failed REFRESH), carries role="alert"
            (it was silent to screen readers) and its own retry (the
            header refresh icon was the only recovery, with nothing
            pointing at it). A failed FIRST load renders the shared
            FetchErrorCard inside the sessions section below instead
            of this banner + the misleading «لا توجد جلسات بعد» pair. */}
        {error && sessions.length > 0 && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 flex gap-2 text-sm text-destructive"
          >
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadSessions()}
              className="ms-auto text-xs underline underline-offset-2 hover:opacity-80 shrink-0"
            >
              إعادة المحاولة
            </button>
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
              /* R125-I5 (A6-B13): placeholder-only inputs get
                  programmatic names. */
              aria-label="اسم الجلسة"
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
              disabled={loading || refreshing}
              aria-label="تحديث"
            >
              <RefreshCw className={loading || refreshing ? "animate-spin" : ""} />
            </Button>
          </div>

          {loading ? (
            // R125-I5 (A3-4c): page-shaped skeleton for the FIRST load
            // (the alerts.tsx card recipe + the A6-B8 role="status" /
            // sr-only pair) — replaces the bare centered spinner.
            <div className="p-4 space-y-3" role="status" aria-busy="true">
              <span className="sr-only">جارٍ التحميل…</span>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[76px] rounded-xl skeleton-shimmer" />
              ))}
            </div>
          ) : error && sessions.length === 0 ? (
            /* R126-L3 (A2-2): a failed FIRST load is NOT "no sessions" —
               the B5-04 false-empty class: the old path rendered this
               branch's EmptyState («أنشئ جلسة أولى للبدء») right under
               the error banner, telling the operator a broken gateway
               was a clean empty system. The skeleton/error/empty
               precedence every sibling page follows, with the shared
               card's own retry. */
            <div className="p-4">
              <FetchErrorCard
                size="section"
                title="تعذّر تحميل جلسات واتساب"
                description={`${error} — تحقّق من شبكتك ثم أعد المحاولة`}
                onRetry={() => void loadSessions()}
              />
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
                          className="text-2xs text-muted-foreground font-mono mt-1 truncate"
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
                            /* R125-I5 (A6-B13): name + tel autocomplete —
                                the field had inputMode="tel" but neither. */
                            aria-label="رقم واتساب بصيغة دولية"
                            autoComplete="tel"
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
                            {/* R125-I5 (A3-12): staleness cue — the code dims
                                + a reissue hint appears after the TTL. The
                                copy button stays usable ("على الأرجح" — the
                                display can't know the true expiry; the
                                backend sends none). */}
                            <code
                              className={`text-xl font-bold tracking-[0.25em] bg-background border border-border rounded-lg px-3 py-2 transition-opacity ${
                                pairCodeStale ? "opacity-50" : ""
                              }`}
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
                            {pairCodeStale && (
                              <span role="status" className="text-xs font-bold text-status-warning">
                                انتهت صلاحية الرمز على الأرجح — أعد إصدار رمز جديد
                              </span>
                            )}
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
                          clearPairCode();
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
