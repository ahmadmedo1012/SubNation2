import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TopupWaitingModal } from "@/components/TopupWaitingModal";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey } from "@/lib/idempotency";
import {
  RECEIVER_PHONE,
  transferCode,
  transferCodeTelHref,
  type TransferNetwork,
} from "@/lib/transfer-code";
import {
  copyToClipboard,
  formatCurrency,
  formatDate,
  formatRelativeTime,
  statusColor,
  statusLabel,
  tierColor,
  tierLabel,
} from "@/lib/utils";
import { isValidLibyanPhone, libyanPhoneError } from "@/lib/validation";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetWalletQueryKey,
  getListTopupsQueryKey,
  useCreateTopup,
  useGetWallet,
  useListTopups,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Lock,
  PhoneCall,
  Plus,
  Smartphone,
  Star,
  TrendingUp,
  Wallet,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { formatCount } from "@/lib/utils";

const MAX_PENDING = 3;

// LocalStorage keys
const STORAGE_KEYS = {
  SENDER_PHONES: "subnation_saved_sender_phones",
  TOPUP_PREFERENCES: "subnation_topup_preferences",
};

// Get saved sender phones from localStorage
function getSavedSenderPhones(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SENDER_PHONES);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

// Save sender phone to localStorage
function saveSenderPhone(phone: string) {
  const phones = getSavedSenderPhones();
  if (!phones.includes(phone)) {
    phones.unshift(phone);
    if (phones.length > 5) phones.pop(); // Keep only last 5
    localStorage.setItem(STORAGE_KEYS.SENDER_PHONES, JSON.stringify(phones));
  }
}

// Get saved topup preferences. `method` is included so a user who
// previously chose LyPay doesn't have to re-pick mobile_transfer
// every visit — the wallet form remembers their last choice.
function getTopupPreferences() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.TOPUP_PREFERENCES);
    return saved
      ? JSON.parse(saved)
      : { network: "libyana", amount: "", method: "mobile_transfer" };
  } catch {
    return { network: "libyana", amount: "", method: "mobile_transfer" };
  }
}

// Save topup preferences
function saveTopupPreferences(network: string, amount: string, method: string) {
  localStorage.setItem(STORAGE_KEYS.TOPUP_PREFERENCES, JSON.stringify({ network, amount, method }));
}

const LYPAY_INFO = {
  account_name: "سبنيشن ليبيا",
  iban: "LY83 0180 0000 0000 0028 7766 3",
  account_number: "0028776630001",
  bank: "بنك التجارة والتنمية",
  branch: "طرابلس - القبة",
};

const NETWORK_PRESETS: Record<string, number[]> = {
  libyana: [1, 5, 10, 20, 50, 100],
  madar: [1, 5, 10, 20, 50, 100],
};

const NETWORKS = [
  {
    value: "libyana",
    label: "ليبيانا",
    // R94-A1 #5 (P2, WCAG AA): green-300/blue-300 on white cards
    // measured 1.40:1 / 2.30:1 in the light theme — the selected network
    // name was near-invisible. The shared --status-* tokens are
    // theme-aware; border/bg stay brand-tinted (non-text).
    color: "text-status-success",
    border: "border-green-500/45",
    bg: "bg-green-500/10",
    activeBg: "bg-green-500",
  },
  {
    value: "madar",
    label: "مدار",
    color: "text-status-info",
    border: "border-blue-500/45",
    bg: "bg-blue-500/10",
    activeBg: "bg-blue-500",
  },
];

type Method = "mobile_transfer" | "lypay";

function networkLabel(net?: string | null) {
  if (net === "libyana") return "ليبيانا";
  if (net === "madar") return "مدار";
  return net ?? "";
}

function topupStatusIcon(status: string) {
  if (status === "approved") return <CheckCircle className="w-4 h-4 text-status-success" />;
  if (status === "rejected") return <XCircle className="w-4 h-4 text-status-error" />;
  return <Clock className="w-4 h-4 text-status-warning pulse-dot" />;
}

/**
 * 96-F6 (R96 A2 P1-6): amount-field sanitizer for the type="text" +
 * inputMode="decimal" inputs below. An Arabic-locale virtual keyboard can
 * deliver Arabic-Indic (٠-٩) or Persian (۰-۹) digits and locale decimal
 * separators (٫ / ,); paste can deliver letters and multiple dots. Only
 * digits and ONE decimal point survive — mirrors the sender-phone digit
 * sanitizer in step 4. The 0.5-step rounding stays in onBlur +
 * handleSubmit (unchanged).
 */
function sanitizeAmountInput(raw: string): string {
  let s = raw
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    // Locale decimal separators (Arabic ٫, Latin comma) → dot
    .replace(/[٫,]/g, ".");
  s = s.replace(/[^0-9.]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    // Collapse to a single decimal point (keep the first).
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  }
  return s;
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const handle = async () => {
    // Shared helper (secure-context check + execCommand fallback +
    // boolean result). Copying the IBAN/account number is part of the
    // money path — the previous raw `navigator.clipboard.writeText`
    // rejected silently on non-secure contexts / strict Firefox,
    // leaving the button dead with an unhandled rejection (B4 P1-2).
    const ok = await copyToClipboard(text);
    if (!ok) {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handle}
      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-180 press-spring border ${
        failed
          ? "bg-status-error/12 text-status-error border-status-error/25"
          : copied
            ? "bg-status-success/12 text-status-success border-status-success/25"
            : "bg-primary/8 text-primary border-primary/20 hover:bg-primary/15"
      }`}
    >
      {failed ? (
        <XCircle className="w-3 h-3" />
      ) : copied ? (
        <Check className="w-3 h-3" />
      ) : (
        <Copy className="w-3 h-3" />
      )}
      {failed ? "فشل النسخ" : copied ? "تم" : (label ?? "نسخ")}
    </button>
  );
}

function StepDot({
  n,
  label,
  active,
  htmlFor,
}: {
  n: number;
  label: string;
  active: boolean;
  /**
   * 96-F6 (R96 A6 #2 P1): when set, the step text renders as a <label>
   * bound to the field it names — the PaymentReferenceField recipe in
   * this file (93-C5 / F-03, A4 P3 #37). Only field steps pass it; the
   * informational steps keep the plain span. Bonus: tapping the step
   * label focuses/activates the bound field (bigger hit area).
   */
  htmlFor?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 text-xs font-bold transition-all duration-200 ${active ? "text-foreground" : "text-muted-foreground"}`}
    >
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 transition-all duration-200 shadow-sm ${
          active
            ? "bg-primary text-white shadow-primary/30"
            : "bg-muted/50 border border-border/50 text-muted-foreground"
        }`}
      >
        {n}
      </div>
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-xs font-bold cursor-pointer">
          {label}
        </Label>
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-0.5 font-medium">{label}</div>
      <div className="font-bold text-sm">{value}</div>
    </div>
  );
}

/**
 * Step-by-step explanation of the mobile transfer flow. Concise on
 * purpose — three lines that match the actions the user actually takes.
 */
function InstructionsPanel() {
  const steps = [
    "قم بتحويل الرصيد باستخدام الزر.",
    "بعد نجاح التحويل قم بإرسال الطلب.",
    "سيتم مراجعته من الإدارة.",
  ];
  return (
    <ol className="mt-3 mb-4 bg-muted/25 border border-border/45 rounded-xl p-3.5 space-y-2 text-xs leading-relaxed">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 border border-primary/30 text-primary text-[10px] font-black flex items-center justify-center">
            {i + 1}
          </span>
          <span className="text-foreground/85 pt-0.5">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Live, dynamically-generated USSD transfer code + one-tap action.
 *
 * The code recomputes on every amount/network change — no debounce,
 * no submit needed. The "تحويل الرصيد" button uses a `tel:` URL with
 * the code embedded; mobile dialers honour this for both Libyana and
 * Madar. On non-mobile environments the link still navigates to the
 * tel: URL — most desktops fall back gracefully (system handler or
 * "no app available"), and we additionally expose a copy button so
 * the user can never get stuck.
 */
function TransferCodePanel({
  network,
  amount,
  receiver,
}: {
  network: TransferNetwork;
  amount: string;
  receiver: string;
}) {
  const code = transferCode(network, amount, receiver);
  const href = code ? transferCodeTelHref(code) : null;
  const buttonClasses =
    "flex items-center justify-center gap-2 w-full h-11 rounded-xl font-bold text-sm transition-all press-spring";

  return (
    <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-primary/80">
          <PhoneCall className="w-3.5 h-3.5" />
          كود التحويل
        </div>
        {code && <CopyBtn text={code} />}
      </div>

      {/* 96-F6 (R96 A6 #19): the empty-state hint is Arabic — it used to
          sit INSIDE the dir="ltr" text-left font-mono box (left-aligned
          Arabic in an LTR-declared element, announced to screen readers
          with LTR context). The hint now renders as its own RTL element
          outside the LTR box; one persistent aria-live wrapper keeps the
          live region mounted across the swap so the generated code is
          still announced. */}
      <div aria-live="polite" className="mb-3">
        {code ? (
          <div
            dir="ltr"
            className="font-mono font-black text-base sm:text-lg tracking-wide rounded-lg bg-background/60 border border-border/40 px-3 py-2.5 break-all min-h-[44px] flex items-center text-foreground"
          >
            {code}
          </div>
        ) : (
          <div className="rounded-lg bg-background/60 border border-border/40 px-3 py-2.5 min-h-[44px] flex items-center text-muted-foreground/60 text-sm">
            أدخل المبلغ لإنشاء الكود تلقائياً
          </div>
        )}
      </div>

      {/* Disclaimer ABOVE the button — desktop users who tap the
          tel: link and don't get a dialer were hitting a dead state
          before noticing the "copy and dial manually" hint underneath.
          Surfacing it above the action sets the right expectation up
          front: tap is the fast path, copy is the universal fallback. */}
      <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
        على الجوال: اضغط الزر لفتح لوحة الاتصال. على الحاسوب: انسخ الكود وأدخله يدوياً.
      </p>

      {href ? (
        <a
          href={href}
          className={`${buttonClasses} bg-primary text-white hover:bg-primary/90 shadow-md shadow-primary/25`}
        >
          <PhoneCall className="w-4 h-4" />
          تحويل الرصيد
        </a>
      ) : (
        <button
          type="button"
          disabled
          className={`${buttonClasses} bg-muted/40 text-muted-foreground/60 cursor-not-allowed`}
        >
          <PhoneCall className="w-4 h-4" />
          تحويل الرصيد
        </button>
      )}
    </div>
  );
}

/**
 * 93-C5 / F-03 (A2 P1 #2): optional transfer-receipt reference field,
 * rendered under the amount in BOTH topup flows. Programmatic label +
 * htmlFor (A4 P3 #37 — placeholder-only names), dir="ltr" + font-mono
 * for the receipt/reference runs (typically Latin digits), maxLength 100
 * matching the backend's boundary.
 */
function PaymentReferenceField({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <div className="mt-3">
      <Label htmlFor={id} className="text-xs font-bold text-muted-foreground mb-2 block">
        رقم مرجع التحويل <span className="font-medium">(اختياري)</span>
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="text"
        maxLength={100}
        placeholder="رقم إيصال التحويل كما ورد في رسالة التحويل"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir="ltr"
        autoComplete="off"
        className="text-left font-mono h-11 rounded-xl border-border/50 focus:border-primary/45 focus:ring-2 focus:ring-primary/12 bg-card"
      />
      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
        يساعد هذا المرجع فريق المراجعة في التحقق من تحويلك ومنع احتسابه مرتين.
      </p>
    </div>
  );
}

export default function WalletPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [method, setMethod] = useState<Method>("mobile_transfer");
  const [network, setNetwork] = useState("libyana");
  const [amount, setAmount] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [senderAccount, setSenderAccount] = useState("");
  // 93-C5 / F-03 (A2 P1 #2): the transfer receipt/transaction reference.
  // The backend's whole V1-M9/B2-02 duplicate-credit dedup machinery
  // (advisory lock + in-tx check + partial unique index) is conditional
  // on a NON-EMPTY payment_reference — and this form never sent one, so
  // a user could submit the same transfer 3× (MAX_PENDING) and be
  // credited 3× for one real receipt. Optional field, ≤100 chars
  // (backend trims + rejects >100), trimmed before sending.
  const [paymentReference, setPaymentReference] = useState("");
  const [senderPhoneTouched, setSenderPhoneTouched] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedPhones, setSavedPhones] = useState<string[]>([]);
  const [rememberPhone, setRememberPhone] = useState(true);
  // ID of the topup currently being awaited in the modal.
  const [waitingTopupId, setWaitingTopupId] = useState<number | null>(null);
  // Return-to-product flow: when the user lands here from a product CTA
  // (because they couldn't afford it), we stash the product URL in
  // sessionStorage so a successful top-up can bounce them back. The
  // sessionStorage indirection is deliberate — `useListTopups` polls
  // and triggers re-renders, but the underlying URL `?return=` only
  // exists on the first arrival; sessionStorage carries it across.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    const STORAGE_KEY = "subnation_topup_return";
    const fromUrl = new URLSearchParams(window.location.search).get("return");
    if (fromUrl && fromUrl.startsWith("/")) {
      sessionStorage.setItem(STORAGE_KEY, fromUrl);
      setReturnTo(fromUrl);
      return;
    }
    setReturnTo(sessionStorage.getItem(STORAGE_KEY));
  }, []);

  // ── 96-F6 (R96 §5.1 — frontend half of topup idempotency) ─────────
  // ONE Idempotency-Key per submission INTENT, sent on every
  // POST /api/wallet/topups (the backend middleware — mounted in
  // parallel — replays the cached response for a same-key retry instead
  // of creating a second identical pending topup). The orval mutation
  // closes over the `request` headers at RENDER time, so the ref is read
  // on every render (see useCreateTopup below) and rotated ONLY at
  // explicit reset points — never mid-render:
  //   • a SUCCESSFUL submit (onSuccess resets the form ⇒ new intent)
  //   • any payload-defining edit (amount / network / method / phone /
  //     account / reference) — also guards the backend's 409
  //     same-key-with-different-body branch.
  // Rotations are guarded by an actual value change: a no-op keystroke
  // (sanitized value unchanged) bails out of setState with NO re-render,
  // which would desync the ref from the headers the mutation captured.
  const topupKeyRef = useRef<string | null>(null);
  // Lazy init — idempotent null-guard (StrictMode double-render safe).
  if (topupKeyRef.current === null) {
    topupKeyRef.current = generateIdempotencyKey();
  }
  const resetTopupKey = () => {
    topupKeyRef.current = generateIdempotencyKey();
  };
  // 96-F6 (R96 A2 P1-6): shared amount-field onChange — sanitizer +
  // key rotation. Used by BOTH topup flows' amount inputs.
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = sanitizeAmountInput(e.target.value);
    if (next !== amount) resetTopupKey();
    setAmount(next);
  };
  const applyAmountPreset = (p: number) => {
    if (String(p) !== amount) resetTopupKey();
    setAmount(String(p));
  };
  // 96-F6 (R96 §5.1): PaymentReferenceField's onChange for both flows.
  const handlePaymentReferenceChange = (v: string) => {
    if (v !== paymentReference) resetTopupKey();
    setPaymentReference(v);
  };

  // Load saved preferences on mount
  useEffect(() => {
    const prefs = getTopupPreferences();
    setNetwork(prefs.network);
    setAmount(prefs.amount);
    if (prefs.method === "mobile_transfer" || prefs.method === "lypay") {
      setMethod(prefs.method);
    }
    setSavedPhones(getSavedSenderPhones());
  }, []);

  // Save preferences when they change
  useEffect(() => {
    saveTopupPreferences(network, amount, method);
  }, [network, amount, method]);

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token]);

  // 93-C5 / F-05 (A4 #7): no error state — on a failed /api/wallet probe
  // the balance card used to silently VANISH (wallet ? card : null) and
  // the ledger below showed "لا توجد طلبات شحن بعد" — the money page
  // looked like the user never topped up and has no balance, the worst
  // place for a silent failure. isError + refetch feed explicit retry
  // branches below.
  const {
    data: wallet,
    isLoading,
    isError: walletError,
    refetch: refetchWallet,
  } = useGetWallet({
    query: { enabled: !!token, queryKey: getGetWalletQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const {
    data: topups = [],
    isLoading: topupsLoading,
    isError: topupsError,
    refetch: refetchTopups,
  } = useListTopups({
    query: { enabled: !!token, queryKey: getListTopupsQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const pendingCount = (topups as Array<{ status: string }>).filter(
    (t) => t.status === "pending",
  ).length;
  const pendingBlocked = pendingCount >= MAX_PENDING;

  // Oldest pending topup — used to set a real-data expectation in the
  // pending-block warning. Without this, "blocked" reads as "stuck"
  // when in fact the user is just queued behind their own earlier
  // requests. Showing the age of the oldest pending lets them gauge
  // how soon they'll be unblocked.
  const oldestPending = (topups as Array<{ status: string; created_at: string }>)
    .filter((t) => t.status === "pending")
    .map((t) => t.created_at)
    .sort()
    .at(0);

  // Most-recent topup (any status) for the mobile compact summary.
  // The wallet history sidebar is desktop-only — on mobile it stacks
  // below the form, so users never see "yes, my last topup is being
  // processed" until they scroll past their submission. This pins the
  // latest one near the top of the form.
  const latestTopup = (
    topups as Array<{
      id: number;
      status: string;
      amount: number;
      created_at: string;
      payment_network?: string;
    }>
  )
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .at(0);

  const topupMutation = useCreateTopup({
    request: {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        // 96-F6 (R96 §5.1): per-intent idempotency key — see topupKeyRef
        // above for the rotation contract. Read at render time; a retry
        // of an unchanged intent replays the SAME key.
        "Idempotency-Key": topupKeyRef.current,
      },
    },
    mutation: {
      onSuccess(created) {
        // 96-F6 (R96 §5.1): the intent was successfully submitted —
        // rotate the key so the next topup (fresh form) gets a new one.
        resetTopupKey();

        // Save sender phone if remember is checked
        if (rememberPhone && method === "mobile_transfer" && senderPhone) {
          saveSenderPhone(senderPhone);
          setSavedPhones(getSavedSenderPhones());
        }

        setAmount("");
        setSenderPhone("");
        setSenderAccount("");
        setPaymentReference("");
        setSenderPhoneTouched(false);
        queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });

        // Open the waiting modal — replaces the old "small success toast"
        // pattern. Modal subscribes to the topups list and reacts to
        // approval/rejection in real time.
        setWaitingTopupId(created.id);
      },
      onError(err: unknown) {
        setError(getErrorMessage(err));
      },
      onSettled() {
        setSubmitting(false);
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 97-F5 deferred one-liner (main agent): Enter must not submit while the
    // button is disabled (in-flight request / pending topup window) — same
    // predicate as the disabled button, so a stray Enter during the waiting
    // modal can't fire a 409 over the open window.
    if (submitting || topupMutation.isPending) return;

    if (pendingBlocked) {
      setError("لديك طلبات قيد المراجعة، يرجى الانتظار حتى تُعتمد");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("يرجى إدخال مبلغ صالح");
      return;
    }
    // R94-A1 #13 (P3): specific bounds + the submit path repeats the
    // onBlur rounding. A direct Enter (no blur) used to ship an
    // unrounded fraction, and sub-0.01 values passed the client check
    // then died on the backend's generic INVALID_DATA envelope.
    if (parsedAmount < 0.01) {
      setError("أقل مبلغ شحن هو 0.01 د.ل");
      return;
    }
    if (parsedAmount > 10000) {
      setError("الحد الأقصى للشحن هو 10,000 د.ل");
      return;
    }
    const normalizedAmount = Math.min(10000, Math.max(1, Math.round(parsedAmount * 2) / 2));
    if (normalizedAmount !== parsedAmount) setAmount(String(normalizedAmount));

    if (method === "mobile_transfer") {
      setSenderPhoneTouched(true);
      if (!senderPhone.trim()) {
        setError("يرجى إدخال رقم هاتف المُرسل");
        return;
      }
      const phoneErr = libyanPhoneError(senderPhone);
      if (phoneErr) {
        setError(phoneErr);
        return;
      }
      if (!isValidLibyanPhone(senderPhone)) {
        setError("رقم هاتف المُرسل غير صالح. يجب أن يبدأ بـ 091 أو 092 أو 093 أو 094");
        return;
      }
    }

    if (method === "lypay" && !senderAccount.trim()) {
      setError("يرجى إدخال رقم حساب المُرسل");
      return;
    }

    setSubmitting(true);
    // 93-C5 / F-03: trim once at the boundary (the backend trims again +
    // rejects >100 chars; maxLength on the input already bounds typing).
    const trimmedReference = paymentReference.trim().slice(0, 100);
    topupMutation.mutate({
      data: {
        amount: normalizedAmount,
        payment_method: method,
        payment_network: method === "mobile_transfer" ? network : undefined,
        sender_phone: method === "mobile_transfer" ? senderPhone || undefined : undefined,
        sender_account: method === "lypay" ? senderAccount || undefined : undefined,
        // 93-C5 / F-03: the dedup machinery is only armed when this field
        // is non-empty — send it whenever the user provided one.
        payment_reference: trimmedReference || undefined,
      },
    });
  };

  const presets =
    method === "mobile_transfer" ? (NETWORK_PRESETS[network] ?? []) : [25, 50, 100, 200];
  const senderPhoneErr = senderPhoneTouched ? libyanPhoneError(senderPhone) : null;
  if (!token) return null;

  const tier = wallet?.loyalty_tier ?? "bronze";

  return (
    <div className="max-w-5xl mx-auto px-4 py-7 page-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Wallet className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-black">المحفظة</h1>
          <p className="text-xs text-muted-foreground">شحن الرصيد وعرض السجل</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── LEFT: Balance + Form ────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Balance card */}
          {isLoading ? (
            <div className="rounded-2xl h-36 skeleton-shimmer border border-border/45" />
          ) : walletError ? (
            /* 93-C5 / F-05 (A4 #7): the card used to silently vanish on a
               failed /api/wallet probe — the money page's primary datum
               cannot just disappear. Honest error card + retry (same
               idiom as orders/loyalty error states). */
            <div className="text-center py-10 text-muted-foreground bg-card border border-status-error/22 rounded-2xl reveal-up">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
                <WifiOff className="w-6 h-6 text-status-error/70" />
              </div>
              <p className="font-black text-base mb-1.5 text-foreground/80">
                تعذّر تحميل رصيد المحفظة
              </p>
              <p className="text-xs text-muted-foreground mb-5 leading-relaxed max-w-xs mx-auto">
                حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة
              </p>
              <Button
                onClick={() => void refetchWallet()}
                className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/22 rounded-xl"
              >
                إعادة المحاولة
              </Button>
            </div>
          ) : wallet ? (
            <div className="relative overflow-hidden rounded-2xl border border-primary/22 bg-gradient-to-br from-primary/14 via-primary/5 to-card p-4 sm:p-5 shadow-xl shadow-primary/8">
              <div className="absolute inset-0 dot-grid opacity-35 pointer-events-none" />
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/10 blur-3xl pointer-events-none blob-drift" />
              <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full bg-primary/5 blur-2xl pointer-events-none" />

              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5 text-primary/65 text-xs font-bold mb-2">
                    <Wallet className="w-3.5 h-3.5" />
                    الرصيد المتاح
                  </div>
                  <div className="text-3xl sm:text-4xl font-black tabular-nums mb-3 leading-none text-foreground num-pop break-words">
                    {formatCurrency(wallet.balance ?? 0)}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          tier === "bronze"
                            ? "bg-amber-500"
                            : tier === "silver"
                              ? "bg-slate-500"
                              : tier === "gold"
                                ? "bg-status-warning"
                                : "bg-cyan-600"
                        }`}
                      />
                      <span className="text-muted-foreground text-xs">المستوى:</span>
                      <span className={`font-black text-xs ${tierColor(tier)}`}>
                        {tierLabel(tier)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <Star className="w-3 h-3 text-status-warning" />
                      <span className="font-black tabular-nums text-status-warning">
                        {wallet.loyalty_points ?? 0}
                      </span>
                      <span className="text-muted-foreground">نقطة</span>
                    </div>
                  </div>
                </div>
                <div
                  className={`shrink-0 px-3 py-2 rounded-xl border text-[11px] font-black bg-background/30 ${
                    tier === "bronze"
                      ? "border-amber-500/25 text-amber-600"
                      : tier === "silver"
                        ? "border-slate-500/25 text-slate-500"
                        : tier === "gold"
                          ? "border-status-warning/25 text-status-warning"
                          : "border-cyan-600/25 text-cyan-600"
                  }`}
                >
                  {tierLabel(tier)}
                </div>
              </div>
            </div>
          ) : null}

          {/* Pending limit warning */}
          {pendingBlocked && (
            <div className="flex items-start gap-3 p-4 bg-status-warning/8 border border-status-warning/22 rounded-2xl float-in">
              <Lock className="w-4.5 h-4.5 text-status-warning shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-status-warning">طلبات الشحن موقوفة مؤقتاً</p>
                {/* 96-F6 (R96 A6 #4 P1): /75 → full token — the translucent
                    warning text measured ≈2.07:1 on white in light mode
                    (AA fail). Background tints stay as-is. */}
                <p className="text-xs text-status-warning mt-0.5">
                  لديك{" "}
                  {formatCount(pendingCount, {
                    one: "طلب",
                    two: "طلبان",
                    few: "طلبات",
                    many: "طلباً",
                    other: "طلب",
                  })}{" "}
                  قيد المراجعة (الحد الأقصى {MAX_PENDING})
                </p>
                {oldestPending && (
                  <p className="text-[11px] text-status-warning mt-1">
                    أقدم طلب: {formatRelativeTime(oldestPending)} — تُعتمد الطلبات عادةً خلال 30
                    دقيقة.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Mobile-only latest-topup pin. Wallet history lives in the
              right-hand column on desktop (sticky), but on mobile it
              stacks below the form — this small banner gives a quick
              "last submission" signal at the top of the page so a
              user who just submitted doesn't have to scroll to know
              their request is queued. */}
          {!isLoading && latestTopup && (
            <div className="lg:hidden flex items-center gap-3 p-3 bg-card border border-border/55 rounded-xl">
              {topupStatusIcon(latestTopup.status)}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold tabular-nums">
                  آخر طلب: {formatCurrency(latestTopup.amount)}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${statusColor(latestTopup.status)}`}
                  >
                    {statusLabel(latestTopup.status)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelativeTime(latestTopup.created_at)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Form card */}
          <div
            className={`bg-card border border-border/55 rounded-2xl p-5 transition-all duration-300 ${pendingBlocked ? "opacity-50 pointer-events-none select-none" : ""}`}
          >
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
                <Plus className="w-3.5 h-3.5 text-primary" />
              </div>
              <h2 className="font-black">شحن المحفظة</h2>
              {pendingCount > 0 && !pendingBlocked && (
                <span className="mr-auto text-xs text-status-warning bg-status-warning/8 border border-status-warning/22 px-2 py-0.5 rounded-full">
                  {pendingCount}/{MAX_PENDING} معلق
                </span>
              )}
            </div>

            {/* Method tabs */}
            <div className="mb-5">
              <p className="text-xs text-muted-foreground mb-2.5 font-bold">طريقة الدفع</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    id: "mobile_transfer" as Method,
                    icon: Smartphone,
                    title: "تحويل رصيد",
                    sub: "ليبيانا / مدار",
                  },
                  { id: "lypay" as Method, icon: Building2, title: "تحويل مصرفي", sub: "LyPay" },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      // 96-F6 (R96 §5.1): switching method = new intent →
                      // rotate the key (the payload carries
                      // payment_method / payment_network).
                      if (m.id !== method) resetTopupKey();
                      setMethod(m.id);
                      setError("");
                    }}
                    className={`flex flex-col sm:flex-row items-center gap-2 p-3 rounded-xl border-2 transition-all duration-180 text-center sm:text-right press-spring min-w-0 ${
                      method === m.id
                        ? "border-primary/50 bg-primary/7 shadow-sm"
                        : "border-border/50 hover:border-border/80 bg-card"
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${method === m.id ? "bg-primary shadow-sm shadow-primary/30" : "bg-muted/60"}`}
                    >
                      <m.icon
                        className={`w-4 h-4 ${method === m.id ? "text-white" : "text-muted-foreground"}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`font-bold text-sm ${method === m.id ? "text-foreground" : "text-foreground/80"}`}
                      >
                        <span className="block leading-snug">{m.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground leading-snug">{m.sub}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Transfer Flow */}
            {method === "mobile_transfer" && (
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Step 1: Network */}
                <div>
                  <StepDot n={1} label="اختر شبكتك" active />
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {NETWORKS.map((n) => (
                      <button
                        key={n.value}
                        type="button"
                        onClick={() => {
                          // 96-F6 (R96 §5.1): network is part of the payload.
                          if (n.value !== network) resetTopupKey();
                          setNetwork(n.value);
                        }}
                        className={`py-3 rounded-xl border-2 font-bold text-sm transition-all press-spring ${
                          network === n.value
                            ? `${n.border} ${n.bg} ${n.color} shadow-sm`
                            : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border/80"
                        }`}
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/20" />

                {/* Step 2: Amount */}
                <div>
                  {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
                  <StepDot
                    n={2}
                    label="المبلغ بالدينار الليبي"
                    active
                    htmlFor="topup-amount-mobile"
                  />
                  {/* 96-F6 (R96 A2 P2-7): preset chips raised to the 44px
                      touch floor (wrap already flex-wrap). */}
                  <div className="flex gap-2 mt-3 mb-2.5 flex-wrap">
                    {presets.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => applyAmountPreset(p)}
                        className={`flex-1 min-w-[52px] min-h-11 py-2 rounded-xl text-sm font-black transition-all border press-spring ${
                          amount === String(p)
                            ? "border-primary bg-primary text-white shadow-md shadow-primary/25"
                            : "border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <Input
                    id="topup-amount-mobile"
                    /* 96-F6 (R96 A2 P1-6): type="text" + inputMode="decimal"
                       — type="number" on the Arabic-locale iOS keypad has
                       NO decimal separator, so fractional amounts (the
                       0.5-step domain) were literally untypable. The
                       sanitizer in handleAmountChange keeps digits + ONE
                       decimal point alive; min/step semantics stay enforced
                       by the onBlur rounding + handleSubmit's own bounds. */
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    enterKeyHint="done"
                    min="1"
                    max="10000"
                    step="0.5"
                    placeholder="أو أدخل مبلغاً آخر..."
                    value={amount}
                    onChange={handleAmountChange}
                    onBlur={(e) => {
                      // Native step="0.5" only enforces on the spinner;
                      // a typed "1.3" would otherwise reach the backend.
                      // Round to the nearest 0.5 + clamp to [1, 10000]
                      // when the user finishes editing.
                      const v = parseFloat(e.target.value);
                      if (!Number.isFinite(v)) return;
                      const rounded = Math.min(10000, Math.max(1, Math.round(v * 2) / 2));
                      if (rounded !== v) setAmount(String(rounded));
                    }}
                    required
                    dir="ltr"
                    className="text-left h-11 rounded-xl border-border/50 focus:border-primary/45 focus:ring-2 focus:ring-primary/12 bg-card"
                  />
                  {/* 93-C5 / F-03: optional receipt reference — arms the
                      backend's duplicate-credit dedup. */}
                  <PaymentReferenceField
                    id="topup-payment-reference-mobile"
                    value={paymentReference}
                    onChange={handlePaymentReferenceChange}
                  />
                </div>

                <div className="border-t border-border/20" />

                {/* Step 3: One-tap transfer */}
                <div>
                  <StepDot n={3} label="نفّذ التحويل" active />
                  <TransferCodePanel
                    network={network as TransferNetwork}
                    amount={amount}
                    receiver={RECEIVER_PHONE}
                  />
                </div>

                <div className="border-t border-border/20" />

                {/* Step 4: Phone */}
                <div>
                  {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
                  <StepDot n={4} label="رقم هاتف المُرسل" active htmlFor="topup-sender-phone" />
                  <p className="text-xs text-muted-foreground mt-2 mb-3">
                    أدخل رقمك الذي حوّلت منه الرصيد لتأكيد العملية.
                  </p>

                  {/* Saved phones dropdown */}
                  {savedPhones.length > 0 && (
                    /* 96-F6 (R96 A2 P2-7): saved-phone chips raised to the
                       44px touch floor — a money-verification field. */
                    <div className="flex gap-1.5 mb-3 flex-wrap">
                      {savedPhones.map((phone) => (
                        <button
                          key={phone}
                          type="button"
                          onClick={() => {
                            // 96-F6 (R96 §5.1): picking a different saved
                            // phone changes the intent → rotate the key.
                            if (phone !== senderPhone) resetTopupKey();
                            setSenderPhone(phone);
                          }}
                          className={`min-h-11 px-2.5 py-1 rounded-lg text-xs font-mono border transition-all flex items-center justify-center ${
                            senderPhone === phone
                              ? "bg-primary/15 border-primary/50 text-primary"
                              : "bg-secondary/30 border-border/50 hover:bg-secondary/50 text-muted-foreground"
                          }`}
                        >
                          {phone}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="relative">
                    <Input
                      id="topup-sender-phone"
                      type="tel"
                      /* 96-F6 (R96 A6 #2 P1): autoComplete=tel lets the OS
                         offer the user's phone numbers for this field. */
                      autoComplete="tel"
                      placeholder="091XXXXXXX"
                      value={senderPhone}
                      onChange={(e) => {
                        const d = e.target.value.replace(/\D/g, "").slice(0, 10);
                        // 96-F6 (R96 §5.1): a different (sanitized) phone
                        // is a different intent → rotate the key.
                        if (d !== senderPhone) resetTopupKey();
                        setSenderPhone(d);
                        // Surface validation as the user types once they
                        // start entering digits — used to wait for blur,
                        // which meant users tapping submit before the
                        // input lost focus only saw the "غير صالح" error
                        // after a failed submit. Live mode is gated on
                        // having typed at least 4 digits to avoid a
                        // green check on a 1-digit "0" or red error
                        // immediately on focus.
                        if (d.length >= 4) setSenderPhoneTouched(true);
                      }}
                      onBlur={() => setSenderPhoneTouched(true)}
                      required
                      dir="ltr"
                      /* 96-F6 (R96 A6 #13): the live validation error is
                         announced + bound via aria-describedby/aria-invalid
                         on the field itself. */
                      aria-invalid={senderPhoneTouched && !!senderPhoneErr}
                      aria-describedby={
                        senderPhoneTouched && senderPhoneErr
                          ? "topup-sender-phone-error"
                          : undefined
                      }
                      className={`text-left pl-10 h-11 rounded-xl bg-card transition-all ${
                        senderPhoneTouched && senderPhoneErr
                          ? "border-destructive/60 focus:ring-destructive/15"
                          : senderPhoneTouched && senderPhone.length === 10 && !senderPhoneErr
                            ? "border-status-success/55"
                            : "border-border/50 focus:border-primary/45 focus:ring-primary/12"
                      } focus:ring-2`}
                      maxLength={10}
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2">
                      {senderPhoneTouched && !senderPhoneErr && senderPhone.length === 10 && (
                        <CheckCircle className="w-4 h-4 text-status-success" />
                      )}
                      {senderPhoneTouched && senderPhoneErr && (
                        <AlertCircle className="w-4 h-4 text-destructive" />
                      )}
                    </div>
                  </div>
                  {senderPhoneTouched && senderPhoneErr && (
                    /* 96-F6 (R96 A6 #13): id the input points at via
                       aria-describedby above. */
                    <p id="topup-sender-phone-error" className="text-xs text-destructive mt-1.5">
                      {senderPhoneErr}
                    </p>
                  )}

                  {/* Remember phone checkbox */}
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberPhone}
                      onChange={(e) => setRememberPhone(e.target.checked)}
                      className="w-4 h-4 rounded border-border/60 bg-card text-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <span className="text-xs text-muted-foreground">
                      تذكر رقم الهاتف للمرات القادمة
                    </span>
                  </label>
                </div>

                <div className="border-t border-border/20" />

                {/* Step 5: Submit */}
                <div>
                  <StepDot n={5} label="أرسل الطلب" active />
                  <InstructionsPanel />
                  {error && (
                    <div
                      id="wallet-error"
                      role="alert"
                      aria-live="polite"
                      className="flex items-center gap-2.5 text-destructive text-sm bg-destructive/8 border border-destructive/18 px-4 py-3 rounded-xl mb-3 shake"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                  <Button
                    type="submit"
                    className="w-full bg-primary hover:bg-primary/90 font-bold h-11 shadow-md shadow-primary/22 cta-glow rounded-xl transition-all"
                    disabled={submitting || topupMutation.isPending}
                  >
                    {submitting || topupMutation.isPending ? "جارٍ الإرسال..." : "إرسال طلب الشحن"}
                  </Button>
                </div>
              </form>
            )}

            {/* LyPay Flow */}
            {method === "lypay" && (
              <div className="space-y-5">
                {/* Step 1: Bank info */}
                <div>
                  <StepDot n={1} label="معلومات الحساب المصرفي" active />
                  <div className="mt-3 bg-muted/25 border border-border/45 rounded-xl p-4 space-y-3.5 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <InfoRow label="اسم الحساب" value={LYPAY_INFO.account_name} />
                      <InfoRow label="البنك" value={LYPAY_INFO.bank} />
                    </div>
                    <InfoRow label="الفرع" value={LYPAY_INFO.branch} />
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border/30">
                      <InfoRow label="رقم الحساب" value={LYPAY_INFO.account_number} />
                      <CopyBtn text={LYPAY_INFO.account_number} label="نسخ" />
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border/30">
                      <div className="min-w-0">
                        <div className="text-[11px] text-muted-foreground mb-0.5 font-medium">
                          IBAN
                        </div>
                        <div dir="ltr" className="font-mono font-bold text-sm break-all text-left">
                          {LYPAY_INFO.iban}
                        </div>
                      </div>
                      <CopyBtn text={LYPAY_INFO.iban.replace(/\s/g, "")} label="نسخ" />
                    </div>
                  </div>
                </div>

                <div className="border-t border-border/20" />

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
                    <StepDot
                      n={2}
                      label="المبلغ المحوّل (د.ل)"
                      active
                      htmlFor="topup-amount-lypay"
                    />
                    {/* 96-F6 (R96 A2 P2-7): preset chips raised to the 44px
                        touch floor (wrap already flex-wrap). */}
                    <div className="flex flex-wrap gap-2 mt-3 mb-2.5">
                      {presets.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => applyAmountPreset(p)}
                          className={`flex-1 min-w-[64px] min-h-11 py-2 rounded-xl text-sm font-black transition-all border press-spring ${
                            amount === String(p)
                              ? "border-primary bg-primary text-white shadow-md shadow-primary/22"
                              : "border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <Input
                      id="topup-amount-lypay"
                      /* 96-F6 (R96 A2 P1-6): decimal keyboard — twin of the
                         mobile-transfer amount field (type="number" had no
                         decimal separator on Arabic-locale iOS keypads). */
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      enterKeyHint="done"
                      min="1"
                      max="10000"
                      step="0.5"
                      placeholder="المبلغ بالدينار الليبي"
                      value={amount}
                      onChange={handleAmountChange}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v)) return;
                        const rounded = Math.min(10000, Math.max(1, Math.round(v * 2) / 2));
                        if (rounded !== v) setAmount(String(rounded));
                      }}
                      required
                      dir="ltr"
                      className="text-left h-11 rounded-xl bg-card"
                    />
                    {/* 93-C5 / F-03: optional receipt reference — arms the
                        backend's duplicate-credit dedup (bank-transfer flow). */}
                    <PaymentReferenceField
                      id="topup-payment-reference-lypay"
                      value={paymentReference}
                      onChange={handlePaymentReferenceChange}
                    />
                  </div>

                  <div className="border-t border-border/20" />

                  <div>
                    {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
                    <StepDot
                      n={3}
                      label="رقم حسابك (المُرسل)"
                      active
                      htmlFor="topup-sender-account"
                    />
                    <Input
                      id="topup-sender-account"
                      type="text"
                      placeholder="أدخل رقم حساب المُرسل"
                      value={senderAccount}
                      onChange={(e) => {
                        // 96-F6 (R96 §5.1): account edits change the intent.
                        if (e.target.value !== senderAccount) resetTopupKey();
                        setSenderAccount(e.target.value);
                      }}
                      required
                      dir="ltr"
                      className="text-left font-mono mt-3 h-11 rounded-xl bg-card"
                    />
                  </div>

                  <div className="border-t border-border/20" />

                  <div>
                    <StepDot n={4} label="تأكيد الإرسال" active />
                    <div className="mt-3 mb-3 p-3.5 bg-status-warning/8 border border-status-warning/22 rounded-xl text-xs text-status-warning flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      تأكد من إتمام التحويل المصرفي أولاً قبل إرسال الطلب
                    </div>
                    {error && (
                      <div
                        id="wallet-error-2"
                        role="alert"
                        aria-live="polite"
                        className="flex items-center gap-2.5 text-destructive text-sm bg-destructive/8 border border-destructive/18 px-4 py-3 rounded-xl mb-3 shake"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {error}
                      </div>
                    )}
                    <Button
                      type="submit"
                      className="w-full bg-primary hover:bg-primary/90 font-bold h-11 shadow-md shadow-primary/22 cta-glow rounded-xl"
                      disabled={submitting || topupMutation.isPending}
                    >
                      {submitting || topupMutation.isPending
                        ? "جارٍ الإرسال..."
                        : "تأكيد طلب الشحن"}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Topup History ──────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="bg-card border border-border/55 rounded-2xl p-5 lg:sticky lg:top-20">
            <div className="flex items-center gap-2.5 mb-4">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-black text-sm">سجل الشحن</h2>
              {topups.length > 0 && (
                <span className="mr-auto text-xs text-muted-foreground font-medium">
                  {/* R94-A1 #11 (P3): Arabic pluralization via formatCount
                      (line 680 in this file already uses it for the pending
                      counter). */}
                  {formatCount(topups.length, {
                    one: "طلب",
                    two: "طلبان",
                    few: "طلبات",
                    many: "طلباً",
                    other: "طلب",
                  })}
                </span>
              )}
            </div>

            {topupsLoading ? (
              /* Ledger skeleton — prevents the "no topups yet" empty state
                 from flashing during the initial fetch. */
              <div className="space-y-2.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-card border border-border border-l-2 border-l-border/30 rounded-xl p-4 flex items-center gap-4"
                  >
                    <div className="w-10 h-10 rounded-xl bg-muted skeleton-shimmer shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted skeleton-shimmer rounded-lg w-2/5" />
                      <div className="h-3 bg-muted skeleton-shimmer rounded w-1/3" />
                    </div>
                    <div className="h-5 bg-muted skeleton-shimmer rounded-full w-16 shrink-0" />
                  </div>
                ))}
              </div>
            ) : topupsError ? (
              /* 93-C5 / F-05 (A4 #7): a failed ledger fetch used to render
                 the "لا توجد طلبات شحن بعد" empty state — an outage read as
                 "you never topped up" on the money page. Distinct error
                 branch with retry. */
              <div className="text-center py-10 text-muted-foreground">
                <div className="w-12 h-12 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center mx-auto mb-3.5">
                  <WifiOff className="w-5 h-5 text-status-error/70" />
                </div>
                <p className="font-bold text-sm mb-1 text-foreground/80">تعذّر تحميل سجل الشحن</p>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed max-w-[220px] mx-auto">
                  حدث خطأ في الاتصال — أعد المحاولة لعرض طلبات الشحن السابقة
                </p>
                <Button
                  onClick={() => void refetchTopups()}
                  size="sm"
                  className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/22 rounded-xl h-9"
                >
                  إعادة المحاولة
                </Button>
              </div>
            ) : topups.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <div className="w-16 h-16 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-7 h-7 opacity-25" />
                </div>
                <p className="font-black text-base mb-1.5 text-foreground/80">
                  لا توجد طلبات شحن بعد
                </p>
                <p className="text-xs text-muted-foreground max-w-[200px] mx-auto leading-relaxed">
                  ابدأ بشحن محفظتك لشراء اشتراكاتك المفضلة
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 lg:max-h-[480px] overflow-y-auto scrollbar-none">
                {(
                  topups as Array<{
                    id: number;
                    status: string;
                    amount: number;
                    payment_network: string;
                    created_at: string;
                  }>
                ).map((t, i: number) => (
                  <div
                    key={t.id}
                    className={`float-in stagger-${Math.min(i, 8)} flex items-center gap-3 p-3 bg-muted/18 border border-border/30 rounded-xl hover:bg-muted/30 transition-colors group`}
                  >
                    <div className="shrink-0">{topupStatusIcon(t.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-bold tabular-nums">
                          {formatCurrency(t.amount)}
                        </span>
                        {t.payment_network && (
                          <span className="text-[10px] text-muted-foreground font-medium">
                            · {networkLabel(t.payment_network)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${statusColor(t.status)}`}
                        >
                          {statusLabel(t.status)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDate(t.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="h-6 md:h-0" />

      <TopupWaitingModal
        topupId={waitingTopupId}
        token={token}
        onClose={() => setWaitingTopupId(null)}
        onApprovedContinue={
          returnTo
            ? () => {
                sessionStorage.removeItem("subnation_topup_return");
                setWaitingTopupId(null);
                navigate(returnTo);
              }
            : undefined
        }
      />
    </div>
  );
}
