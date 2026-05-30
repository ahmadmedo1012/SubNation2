import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TopupWaitingModal } from "@/components/TopupWaitingModal";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import {
  RECEIVER_PHONE,
  transferCode,
  transferCodeTelHref,
  type TransferNetwork,
} from "@/lib/transfer-code";
import {
  formatCurrency,
  formatDate,
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
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

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

// Get saved topup preferences
function getTopupPreferences() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.TOPUP_PREFERENCES);
    return saved ? JSON.parse(saved) : { network: "libyana", amount: "" };
  } catch {
    return { network: "libyana", amount: "" };
  }
}

// Save topup preferences
function saveTopupPreferences(network: string, amount: string) {
  localStorage.setItem(STORAGE_KEYS.TOPUP_PREFERENCES, JSON.stringify({ network, amount }));
}

const LYPAY_INFO = {
  account_name: "سبنيشن ليبيا",
  iban: "LY83 0180 0000 0000 0028 7766 3",
  account_number: "0028776630001",
  bank: "بنك التجارة والتنمية",
  branch: "طرابلس - القبة",
};

const NETWORK_PRESETS: Record<string, number[]> = {
  libyana: [1, 5, 10, 20, 50],
  madar: [1, 5, 10, 20],
};

const NETWORKS = [
  {
    value: "libyana",
    label: "ليبيانا",
    color: "text-green-300",
    border: "border-green-500/45",
    bg: "bg-green-500/10",
    activeBg: "bg-green-500",
  },
  {
    value: "madar",
    label: "مدار",
    color: "text-blue-300",
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
  if (status === "approved") return <CheckCircle className="w-4 h-4 text-emerald-400" />;
  if (status === "rejected") return <XCircle className="w-4 h-4 text-red-400" />;
  return <Clock className="w-4 h-4 text-yellow-400 pulse-dot" />;
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handle}
      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-180 press-spring border ${
        copied
          ? "bg-emerald-500/12 text-emerald-400 border-emerald-500/25"
          : "bg-primary/8 text-primary border-primary/20 hover:bg-primary/15"
      }`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "تم" : (label ?? "نسخ")}
    </button>
  );
}

function StepDot({ n, label, active }: { n: number; label: string; active: boolean }) {
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
      <span>{label}</span>
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
  const [copied, setCopied] = useState(false);
  const code = transferCode(network, amount, receiver);
  const ready = code !== null;

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail on insecure contexts — silent fallback,
      // the user still has the visible code on screen.
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-primary/80">
          <PhoneCall className="w-3.5 h-3.5" />
          كود التحويل
        </div>
        {ready && (
          <button
            type="button"
            onClick={handleCopy}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border transition-all press-spring ${
              copied
                ? "bg-emerald-500/12 text-emerald-400 border-emerald-500/25"
                : "bg-card text-muted-foreground border-border/50 hover:text-foreground"
            }`}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "تم" : "نسخ"}
          </button>
        )}
      </div>

      <div
        dir="ltr"
        className={`font-mono font-black text-base sm:text-lg tracking-wide rounded-lg bg-background/60 border border-border/40 px-3 py-2.5 mb-3 break-all min-h-[44px] flex items-center ${
          ready ? "text-foreground" : "text-muted-foreground/60"
        }`}
        aria-live="polite"
      >
        {ready ? code : "أدخل المبلغ لإنشاء الكود تلقائياً"}
      </div>

      <a
        href={ready ? transferCodeTelHref(code!) : undefined}
        aria-disabled={!ready}
        onClick={(e) => {
          if (!ready) e.preventDefault();
        }}
        className={`flex items-center justify-center gap-2 w-full h-11 rounded-xl font-bold text-sm transition-all press-spring shadow-md ${
          ready
            ? "bg-primary text-white hover:bg-primary/90 shadow-primary/25"
            : "bg-muted/40 text-muted-foreground/60 cursor-not-allowed shadow-none"
        }`}
      >
        <PhoneCall className="w-4 h-4" />
        تحويل الرصيد
      </a>

      <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
        إذا لم يفتح الزر تطبيق الاتصال، انسخ الكود وألصقه يدوياً في لوحة الاتصال.
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
  const [senderPhoneTouched, setSenderPhoneTouched] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedPhones, setSavedPhones] = useState<string[]>([]);
  const [rememberPhone, setRememberPhone] = useState(true);
  // ID of the topup currently being awaited in the modal.
  const [waitingTopupId, setWaitingTopupId] = useState<number | null>(null);

  // Load saved preferences on mount
  useEffect(() => {
    const prefs = getTopupPreferences();
    setNetwork(prefs.network);
    setAmount(prefs.amount);
    setSavedPhones(getSavedSenderPhones());
  }, []);

  // Save preferences when they change
  useEffect(() => {
    saveTopupPreferences(network, amount);
  }, [network, amount]);

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token]);

  const { data: wallet, isLoading } = useGetWallet({
    query: { enabled: !!token, queryKey: getGetWalletQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const { data: topups = [] } = useListTopups({
    query: { enabled: !!token, queryKey: getListTopupsQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const pendingCount = (topups as Array<{ status: string }>).filter(
    (t) => t.status === "pending",
  ).length;
  const pendingBlocked = pendingCount >= MAX_PENDING;

  const topupMutation = useCreateTopup({
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
    mutation: {
      onSuccess(created) {
        // Save sender phone if remember is checked
        if (rememberPhone && method === "mobile_transfer" && senderPhone) {
          saveSenderPhone(senderPhone);
          setSavedPhones(getSavedSenderPhones());
        }

        setAmount("");
        setSenderPhone("");
        setSenderAccount("");
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

    if (pendingBlocked) {
      setError("لديك طلبات قيد المراجعة، يرجى الانتظار حتى تُعتمد");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError("يرجى إدخال مبلغ صالح");
      return;
    }

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
    topupMutation.mutate({
      data: {
        amount: parsedAmount,
        payment_method: method,
        payment_network: method === "mobile_transfer" ? network : undefined,
        sender_phone: method === "mobile_transfer" ? senderPhone || undefined : undefined,
        sender_account: method === "lypay" ? senderAccount || undefined : undefined,
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
                              ? "bg-slate-400"
                              : tier === "gold"
                                ? "bg-yellow-400"
                                : "bg-cyan-400"
                        }`}
                      />
                      <span className="text-muted-foreground text-xs">المستوى:</span>
                      <span className={`font-black text-xs ${tierColor(tier)}`}>
                        {tierLabel(tier)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <Star className="w-3 h-3 text-yellow-400" />
                      <span className="font-black tabular-nums text-yellow-400">
                        {wallet.loyalty_points ?? 0}
                      </span>
                      <span className="text-muted-foreground">نقطة</span>
                    </div>
                  </div>
                </div>
                <div
                  className={`shrink-0 px-3 py-2 rounded-xl border text-[11px] font-black bg-background/30 ${
                    tier === "bronze"
                      ? "border-amber-500/25 text-amber-400"
                      : tier === "silver"
                        ? "border-slate-400/25 text-slate-300"
                        : tier === "gold"
                          ? "border-yellow-400/25 text-yellow-400"
                          : "border-cyan-400/25 text-cyan-400"
                  }`}
                >
                  {tierLabel(tier)}
                </div>
              </div>
            </div>
          ) : null}

          {/* Pending limit warning */}
          {pendingBlocked && (
            <div className="flex items-start gap-3 p-4 bg-yellow-400/7 border border-yellow-400/22 rounded-2xl float-in">
              <Lock className="w-4.5 h-4.5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-yellow-300">طلبات الشحن موقوفة مؤقتاً</p>
                <p className="text-xs text-yellow-400/70 mt-0.5">
                  لديك {pendingCount} طلبات قيد المراجعة (الحد الأقصى {MAX_PENDING})
                </p>
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
                <span className="mr-auto text-xs text-yellow-400 bg-yellow-400/8 border border-yellow-400/18 px-2 py-0.5 rounded-full">
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
                        onClick={() => setNetwork(n.value)}
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
                  <StepDot n={2} label="المبلغ بالدينار الليبي" active />
                  <div className="flex gap-2 mt-3 mb-2.5 flex-wrap">
                    {presets.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setAmount(String(p))}
                        className={`flex-1 min-w-[52px] py-2 rounded-xl text-sm font-black transition-all border press-spring ${
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
                    type="number"
                    min="1"
                    max="10000"
                    step="0.5"
                    placeholder="أو أدخل مبلغاً آخر..."
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    dir="ltr"
                    className="text-left h-11 rounded-xl border-border/50 focus:border-primary/45 focus:ring-2 focus:ring-primary/12 bg-card"
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
                  <StepDot n={4} label="رقم هاتف المُرسل" active />
                  <p className="text-xs text-muted-foreground mt-2 mb-3">
                    أدخل الرقم الذي حوّلت منه الرصيد لتأكيد العملية.
                  </p>

                  {/* Saved phones dropdown */}
                  {savedPhones.length > 0 && (
                    <div className="flex gap-1.5 mb-3 flex-wrap">
                      {savedPhones.map((phone) => (
                        <button
                          key={phone}
                          type="button"
                          onClick={() => setSenderPhone(phone)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono border transition-all ${
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
                      type="tel"
                      placeholder="091XXXXXXX"
                      value={senderPhone}
                      onChange={(e) => {
                        const d = e.target.value.replace(/\D/g, "").slice(0, 10);
                        setSenderPhone(d);
                      }}
                      onBlur={() => setSenderPhoneTouched(true)}
                      required
                      dir="ltr"
                      className={`text-left pl-10 h-11 rounded-xl bg-card transition-all ${
                        senderPhoneTouched && senderPhoneErr
                          ? "border-destructive/60 focus:ring-destructive/15"
                          : senderPhoneTouched && senderPhone.length === 10 && !senderPhoneErr
                            ? "border-emerald-500/50"
                            : "border-border/50 focus:border-primary/45 focus:ring-primary/12"
                      } focus:ring-2`}
                      maxLength={10}
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2">
                      {senderPhoneTouched && !senderPhoneErr && senderPhone.length === 10 && (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      )}
                      {senderPhoneTouched && senderPhoneErr && (
                        <AlertCircle className="w-4 h-4 text-destructive" />
                      )}
                    </div>
                  </div>
                  {senderPhoneTouched && senderPhoneErr && (
                    <p className="text-xs text-destructive mt-1.5">{senderPhoneErr}</p>
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
                  <div className="mt-3">
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
                      {submitting || topupMutation.isPending
                        ? "جارٍ الإرسال..."
                        : "إرسال طلب الشحن"}
                    </Button>
                  </div>
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
                        <div className="font-mono font-bold text-sm break-all">
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
                    <StepDot n={2} label="المبلغ المحوّل (د.ل)" active />
                    <div className="flex flex-wrap gap-2 mt-3 mb-2.5">
                      {presets.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setAmount(String(p))}
                          className={`flex-1 min-w-[64px] py-2 rounded-xl text-sm font-black transition-all border press-spring ${
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
                      type="number"
                      min="1"
                      max="10000"
                      step="0.5"
                      placeholder="المبلغ بالدينار الليبي"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                      dir="ltr"
                      className="text-left h-11 rounded-xl bg-card"
                    />
                  </div>

                  <div className="border-t border-border/20" />

                  <div>
                    <StepDot n={3} label="رقم حسابك (المُرسل)" active />
                    <Input
                      type="text"
                      placeholder="أدخل رقم حساب المُرسل"
                      value={senderAccount}
                      onChange={(e) => setSenderAccount(e.target.value)}
                      required
                      dir="ltr"
                      className="text-left font-mono mt-3 h-11 rounded-xl bg-card"
                    />
                  </div>

                  <div className="border-t border-border/20" />

                  <div>
                    <StepDot n={4} label="تأكيد الإرسال" active />
                    <div className="mt-3 mb-3 p-3.5 bg-yellow-400/7 border border-yellow-400/18 rounded-xl text-xs text-yellow-400 flex items-center gap-2">
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
                  {topups.length} طلب
                </span>
              )}
            </div>

            {topups.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground bg-card border border-border/50 rounded-2xl">
                <div className="w-16 h-16 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-7 h-7 opacity-25" />
                </div>
                <p className="font-black text-base mb-1.5 text-foreground/80">
                  لا توجد طلبات شحن بعد
                </p>
                <p className="text-xs text-muted-foreground mb-5 max-w-[200px] mx-auto leading-relaxed">
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
      />
    </div>
  );
}
