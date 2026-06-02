import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetWalletQueryKey,
  getListTopupsQueryKey,
  useGetWallet,
  useListTopups,
  type Topup,
} from "@workspace/api-client-react";
import { CheckCircle2, Clock, Loader2, Sparkles, Wallet, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface Props {
  topupId: number | null;
  token: string;
  onClose: () => void;
  /**
   * Optional handler invoked when the user dismisses the success state.
   * When set, the success-screen primary button reads "متابعة الشراء"
   * and runs this callback instead of `onClose`. The wallet page wires
   * this to the `?return=` URL parameter so users redirected from a
   * product CTA bounce straight back to the product after their
   * top-up clears.
   */
  onApprovedContinue?: () => void;
}

const COUNTDOWN_SECONDS = 30;
const POLL_INTERVAL_MS = 3_000;

/**
 * Post-submit waiting screen for a wallet top-up request.
 *
 * Replaces the previous "small toast → page" pattern with a clear,
 * dedicated state that:
 *   1. Confirms the request was received.
 *   2. Shows a 30-second cosmetic countdown (UX indicator only — does
 *      NOT bound the actual approval window).
 *   3. Polls the topups list every 3s as a fallback to socket events.
 *      The socket handler in `use-socket.ts` invalidates the same
 *      query, so an approved/rejected status normally lands within
 *      ~one render of the server flip.
 *   4. Auto-transitions to the success/rejection state the moment the
 *      backend status changes — never forces the user to wait the full
 *      30 seconds when approval already happened.
 *
 * Backend behaviour is untouched: this component only observes status
 * via the existing `GET /api/wallet/topups` endpoint and reuses the
 * existing socket emissions.
 */
export function TopupWaitingModal({ topupId, token, onClose, onApprovedContinue }: Props) {
  const queryClient = useQueryClient();
  const open = topupId !== null;

  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  // Whether the cosmetic timer has elapsed without a decision yet.
  const [timedOut, setTimedOut] = useState(false);

  // Poll the user's topups while the modal is open AND no decision yet.
  const { data: topups = [] } = useListTopups({
    query: {
      enabled: open && !!token,
      queryKey: getListTopupsQueryKey(),
      refetchInterval: (q) => {
        if (!open) return false;
        const list = (q.state.data as Topup[] | undefined) ?? [];
        const match = list.find((t) => t.id === topupId);
        return match && match.status !== "pending" ? false : POLL_INTERVAL_MS;
      },
      refetchIntervalInBackground: true,
    },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  // Wallet balance is shown on the success state — pre-fetch it so the
  // post-approval render is instant.
  const { data: wallet } = useGetWallet({
    query: { enabled: open && !!token, queryKey: getGetWalletQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const topup = useMemo(
    () => (topupId === null ? null : (topups.find((t) => t.id === topupId) ?? null)),
    [topups, topupId],
  );

  const status: "waiting" | "approved" | "rejected" =
    topup?.status === "approved"
      ? "approved"
      : topup?.status === "rejected"
        ? "rejected"
        : "waiting";

  // Tick the cosmetic countdown. Resets whenever the modal opens for a
  // new topupId. `startedAt` is captured per-effect so it survives the
  // 1s interval ticks without sharing state with anything else — and a
  // separate reset effect can't race with this one anymore.
  useEffect(() => {
    if (!open || status !== "waiting") return;

    const startedAt = Date.now();
    setCountdown(COUNTDOWN_SECONDS);
    setTimedOut(false);

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = Math.max(0, COUNTDOWN_SECONDS - elapsed);
      setCountdown(left);
      if (left === 0) setTimedOut(true);
    };
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [open, status, topupId]);

  // When status flips (approved/rejected), make sure the wallet card
  // on the page behind the modal also refreshes immediately.
  useEffect(() => {
    if (status === "approved" || status === "rejected") {
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    }
  }, [status, queryClient]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-w-md p-0 overflow-hidden bg-card border-border/55 sm:rounded-2xl"
        // Don't let backdrop / esc close the modal while we're still waiting —
        // it would feel like we lost the request. After approval/rejection or
        // the cosmetic timer elapses, full keyboard/backdrop close is allowed.
        onEscapeKeyDown={(e) => {
          if (status === "waiting" && !timedOut) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (status === "waiting" && !timedOut) e.preventDefault();
        }}
      >
        {status === "waiting" && (
          <WaitingBody
            countdown={countdown}
            timedOut={timedOut}
            amount={topup?.amount}
            onClose={onClose}
          />
        )}
        {status === "approved" && (
          <ApprovedBody
            amount={topup?.amount ?? 0}
            balance={wallet?.balance ?? null}
            onClose={onClose}
            onContinue={onApprovedContinue}
          />
        )}
        {status === "rejected" && (
          <RejectedBody adminNote={topup?.admin_note ?? null} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function WaitingBody({
  countdown,
  timedOut,
  amount,
  onClose,
}: {
  countdown: number;
  timedOut: boolean;
  amount?: number;
  onClose: () => void;
}) {
  const pct = Math.max(0, Math.min(100, (countdown / COUNTDOWN_SECONDS) * 100));

  return (
    <div className="p-6 text-center">
      <div className="relative mx-auto mb-4 w-24 h-24 flex items-center justify-center">
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r="44"
            stroke="currentColor"
            strokeWidth="6"
            fill="none"
            className="text-muted/40"
          />
          <circle
            cx="50"
            cy="50"
            r="44"
            stroke="currentColor"
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 44}
            strokeDashoffset={2 * Math.PI * 44 * (1 - pct / 100)}
            className="text-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
        <div className="relative flex items-center justify-center w-full h-full">
          {timedOut ? (
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          ) : (
            <span
              className="text-2xl font-black tabular-nums text-primary"
              aria-live="polite"
              aria-atomic="true"
            >
              {countdown}
            </span>
          )}
        </div>
      </div>

      <h2 className="text-lg font-black mb-1.5">
        {timedOut ? "ما زلنا نراجع طلبك" : "تم استلام طلب الشحن"}
      </h2>
      <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
        {timedOut
          ? "قد تستغرق المراجعة وقتاً أطول قليلاً. سنخبرك فور اعتماد الطلب."
          : "نتحقق الآن من إتمام التحويل. عادةً ما يكتمل خلال ثوانٍ."}
      </p>

      {amount !== undefined && (
        <div className="bg-muted/30 border border-border/45 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-bold">المبلغ</span>
          <span className="font-black text-sm tabular-nums">{formatCurrency(amount)}</span>
        </div>
      )}

      <div className="flex items-center gap-2 justify-center text-xs text-muted-foreground mb-1">
        <Clock className="w-3.5 h-3.5" />
        <span>قيد المراجعة من الإدارة</span>
      </div>

      {timedOut && (
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full py-2.5 rounded-xl bg-muted/50 border border-border/55 text-sm font-bold hover:bg-muted/70 transition-colors press-spring"
        >
          إغلاق والمتابعة
        </button>
      )}
    </div>
  );
}

function ApprovedBody({
  amount,
  balance,
  onClose,
  onContinue,
}: {
  amount: number;
  balance: number | null;
  onClose: () => void;
  onContinue?: () => void;
}) {
  return (
    <div className="p-6 text-center">
      <div className="relative mx-auto mb-4 w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-400" />
        <Sparkles className="w-4 h-4 text-emerald-300 absolute -top-1 -right-1" />
      </div>
      <h2 className="text-lg font-black mb-1.5 text-emerald-400">تمت إضافة الرصيد</h2>
      <p className="text-sm text-muted-foreground mb-5">تم اعتماد طلب الشحن وإيداعه في محفظتك.</p>

      <div className="bg-emerald-500/8 border border-emerald-500/25 rounded-xl px-4 py-3.5 mb-3">
        <div className="text-[11px] text-emerald-400/70 font-bold mb-0.5">المبلغ المُضاف</div>
        <div className="text-2xl font-black tabular-nums text-emerald-300">
          + {formatCurrency(amount)}
        </div>
      </div>

      {balance !== null && (
        <div className="bg-muted/30 border border-border/45 rounded-xl px-4 py-3 mb-5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-bold">
            <Wallet className="w-3.5 h-3.5" />
            الرصيد الحالي
          </span>
          <span className="font-black text-sm tabular-nums">{formatCurrency(balance)}</span>
        </div>
      )}

      {onContinue ? (
        // Return-to-product flow: the user came here from a product page
        // because they couldn't afford it. Now that the top-up cleared,
        // the primary action is to continue the original purchase, not
        // to dismiss the modal. The "تم" path is preserved as a soft
        // secondary in case they changed their mind.
        <div className="space-y-2">
          <button
            type="button"
            onClick={onContinue}
            className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold transition-colors press-spring shadow-md shadow-primary/20"
          >
            متابعة الشراء
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            البقاء في المحفظة
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold transition-colors press-spring shadow-md shadow-primary/20"
        >
          تم
        </button>
      )}
    </div>
  );
}

function RejectedBody({ adminNote, onClose }: { adminNote: string | null; onClose: () => void }) {
  return (
    <div className="p-6 text-center">
      <div className="mx-auto mb-4 w-20 h-20 rounded-full bg-red-500/15 border border-red-500/35 flex items-center justify-center">
        <XCircle className="w-10 h-10 text-red-400" />
      </div>
      <h2 className="text-lg font-black mb-1.5 text-red-400">تم رفض الطلب</h2>
      <p className="text-sm text-muted-foreground mb-5">
        {adminNote ? "السبب الموضّح من الإدارة:" : "تواصل مع الدعم إذا كنت ترى أن هذا خطأ."}
      </p>

      {adminNote && (
        <div className="bg-red-500/8 border border-red-500/25 rounded-xl px-4 py-3.5 mb-5 text-sm text-red-200/95 leading-relaxed text-right">
          {adminNote}
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full py-2.5 rounded-xl bg-muted/60 border border-border/55 text-sm font-bold hover:bg-muted/80 transition-colors press-spring"
      >
        إغلاق
      </button>
    </div>
  );
}
