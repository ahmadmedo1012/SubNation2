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
import { getErrorMessage } from "@/lib/errors";
import { copyToClipboard } from "@/lib/utils";
// 93-C7 / C-UX6 (A12 §5): the hand-rolled bare "لا توجد جلسات بعد"
// empty state adopts the shared EmptyState card.
import { EmptyState } from "@/components/admin/EmptyState";
// R126-L3 (A2-2): a failed FIRST load renders the shared error card —
// the page previously showed its hand-rolled banner AND the empty
// state together (an outage masquerading as "no sessions yet").
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { SkeletonText } from "@/components/ui/Skeleton";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
import { useAuth } from "../../lib/auth";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Wifi, XCircle } from "lucide-react";
// R137 (FE decomposition): the whatsapp console's presentational
// sections + pure metadata moved to @/components/admin/whatsapp/*
// (verbatim moves — the mutation path stays HERE: loadSessions (the
// session-aware list GET + the hasLoadedRef first-load/refresh split),
// createSession, startSession, requestPairCode, loadQr, deleteSession
// (the confirm-gated DELETE) and copyPairCode, plus every session/
// pair/QR atom and the pair-code staleness timer; the extracts render
// the byte-identical DOM they rendered inline yesterday). Import
// surface:
//   • whatsapp-meta — the pure module (the session/response contracts,
//     OPENWA_DOCS_URL, STATUS_META/statusMeta, PAIR_CODE_STALE_AFTER_MS)
//   • WhatsappHeader — the page intro (header + docs deep-link +
//     the pair-code warning banner)
//   • CreateSessionForm — the «إضافة جلسة» form (name draft + the
//     page's setter ride down; submit fires through createSession)
//   • SessionsSectionHeader — the section title row + refresh button
//   • WhatsappSessionsList — the rows (start/QR/delete/pair/copy fire
//     through the page-owned callbacks above)
// The SkeletonText loading branch + the FetchErrorCard first-load
// error + the EmptyState empty branch stay inline (the
// skeleton-primitives adoption-floor pin reads this file's import).
import {
  PAIR_CODE_STALE_AFTER_MS,
  type PairCodeResponse,
  type SessionsResponse,
  type WhatsAppSession,
} from "@/components/admin/whatsapp/whatsapp-meta";
import { WhatsappHeader } from "@/components/admin/whatsapp/WhatsappHeader";
import { CreateSessionForm } from "@/components/admin/whatsapp/CreateSessionForm";
import { SessionsSectionHeader } from "@/components/admin/whatsapp/SessionsSectionHeader";
import { WhatsappSessionsList } from "@/components/admin/whatsapp/WhatsappSessionsList";

export default function AdminWhatsAppPage() {
  const headers = useAdminHeaders();
  const jsonHeaders = useAdminHeaders({ json: true });
  const { hasAdminPermission } = useAuth();
  // R134 (A3-F1): the whatsapp console rides the settings-scoped
  // diagnostics mount (backend routes/admin/index.ts) — the nav hides
  // it from scope-less admins, but a deep link used to fire loadSessions
  // into a synchronized 403 burst. The gate keeps a scope-less mount
  // fetch-free and answers the honest reason instead.
  const canView = hasAdminPermission("settings");
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
    // R134 (A3-F1): fetch-free for a scope-less deep-link mount.
    if (!canView) return;
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
      // R148 (3-errcopy): getErrorMessage passes the wrapper's Arabic
      // body messages through and collapses network-level English —
      // the raw extractor leaked it into the error card + banner.
      setError(getErrorMessage(err));
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
        // R148 (3-errcopy): route through getErrorMessage — Arabic
        // body messages pass through, network-level English collapses.
        title: getErrorMessage(err),
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
      // R148 (3-errcopy): route through getErrorMessage (see load).
      toast({
        title: getErrorMessage(err),
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
      // R148 (3-errcopy): route through getErrorMessage (see load).
      toast({
        title: getErrorMessage(err),
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
      // R148 (3-errcopy): route through getErrorMessage (see load).
      toast({
        title: getErrorMessage(err),
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
      // R148 (3-errcopy): route through getErrorMessage (see load).
      toast({
        title: getErrorMessage(err),
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

  // R137 (FE decomposition): the pair-form opener — the exact body the
  // «ربط برمز الهاتف» button's inline onClick had (setPairTarget +
  // clearPairCode + setQrImage), hoisted verbatim so the sessions-list
  // extract can fire it as one callback; zero behavior change.
  const openPairForm = (sessionId: string) => {
    setPairTarget(sessionId);
    clearPairCode();
    setQrImage(null);
  };

  // R134 (A3-F1): the deep-link honest-reason gate — sits AFTER every
  // hook (loadSessions' own guard keeps a scope-less mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="settings" />;
  }

  return (
    <AdminLayout onRefresh={() => void loadSessions()}>
      <div className="space-y-5">
        <WhatsappHeader />

        {/* R126-L3 (A2-2): the list-load banner now follows the
            orders/tickets stale-keep precedence — it renders ONLY when
            rows are standing (a failed REFRESH), carries role="alert"
            (it was silent to screen readers) and its own retry (the
            header refresh icon was the only recovery, with nothing
            pointing at it). A failed FIRST load renders the shared
            FetchErrorCard inside the sessions section below instead
            of this banner + the misleading «لا توجد جلسات بعد» pair. */}
        {error && sessions.length > 0 && (
          /* R139 (precision): the stale-refresh banner joins the r138
             calm-error register (139-d's ChartErrorBanner idiom): the
             destructive/25 + destructive/5 red frame retires for the card
             family's resting border-border/60 + solid bg-card, and the
             error tone concentrates in the ink — the XCircle glyph + the
             retry affordance — while the message text moves to
             text-foreground/80. Severity lives in CONTENT (message +
             role="alert" + the error-ink retry), not a tinted wall;
             handler + role byte-identical. */
          <div
            role="alert"
            className="rounded-xl border border-border/60 bg-card p-3 flex gap-2 text-sm"
          >
            <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-status-error" />
            <span className="text-foreground/80">{error}</span>
            <button
              type="button"
              onClick={() => void loadSessions()}
              className="ms-auto text-xs font-bold text-status-error underline underline-offset-2 hover:opacity-80 shrink-0"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        <CreateSessionForm
          name={name}
          onNameChange={setName}
          busy={busy}
          onSubmit={createSession}
        />

        {/* R139 (precision): the sessions section frame joins the resting
            border family — border-border/60 (every sibling admin card:
            the settings cards, the system DetailsSection shell, the
            orders/topups tables); the full-strength border-border was the
            lane's lone outlier. */}
        <section className="rounded-2xl border border-border/60 bg-card overflow-hidden">
          <SessionsSectionHeader
            loading={loading}
            refreshing={refreshing}
            onRefresh={() => void loadSessions()}
          />

          {loading ? (
            /* R136 (UX-1): SkeletonText — R125-I5's page-shaped skeleton
               (the alerts.tsx card recipe). Same DOM: ONE announcing
               wrapper (role=status + sr-only preserved; the wrapper's
               aria-busy rides off — the pair is what TableSkeleton
               carries) + 3 plain rows, geometry verbatim. */
            <SkeletonText
              count={3}
              wrapperClassName="p-4 space-y-3"
              className="h-[76px] rounded-xl"
              lastShorter={false}
            />
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
            <WhatsappSessionsList
              sessions={sessions}
              busy={busy}
              pairTarget={pairTarget}
              pairCode={pairCode}
              pairCodeStale={pairCodeStale}
              pairCopied={pairCopied}
              qrImage={qrImage}
              phone={phone}
              onPhoneChange={setPhone}
              onStartSession={startSession}
              onLoadQr={loadQr}
              onDeleteSession={deleteSession}
              onRequestPairCode={requestPairCode}
              onCopyPairCode={copyPairCode}
              onOpenPairForm={openPairForm}
            />
          )}
        </section>
      </div>
      <ConfirmDialog />
    </AdminLayout>
  );
}
