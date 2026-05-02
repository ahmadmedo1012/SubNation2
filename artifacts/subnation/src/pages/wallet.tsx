import { useState, useEffect } from "react";
import { useGetWallet, useListTopups, useCreateTopup, getGetWalletQueryKey, getListTopupsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor, tierLabel, tierColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, Plus, Clock, CheckCircle, XCircle, AlertCircle, Star, Smartphone, Building2, Copy, Check, Lock, TrendingUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { libyanPhoneError, isValidLibyanPhone } from "@/lib/validation";

const MAX_PENDING = 3;

const LYPAY_INFO = {
  account_name: "سبنيشن ليبيا",
  iban: "LY83 0180 0000 0000 0028 7766 3",
  account_number: "0028776630001",
  bank: "بنك التجارة والتنمية",
  branch: "طرابلس - القبة",
};

const NETWORK_PRESETS: Record<string, number[]> = {
  libyana: [1, 5, 10, 20, 50],
  madar:   [1, 5, 10, 20],
};

const NETWORKS = [
  { value: "libyana", label: "ليبيانا", color: "text-green-400",  border: "border-green-500/40",  bg: "bg-green-500/10"  },
  { value: "madar",   label: "مدار",    color: "text-blue-400",   border: "border-blue-500/40",   bg: "bg-blue-500/10"  },
];

type Method = "mobile_transfer" | "lypay";

function networkLabel(net?: string | null) {
  if (net === "libyana") return "ليبيانا";
  if (net === "madar")   return "مدار";
  return net ?? "";
}

function topupIcon(status: string) {
  if (status === "approved") return <CheckCircle className="w-4 h-4 text-emerald-400" />;
  if (status === "rejected") return <XCircle className="w-4 h-4 text-red-400" />;
  return <Clock className="w-4 h-4 text-yellow-400" />;
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary/10 hover:bg-primary/20 text-primary transition-colors shrink-0"
      title={`نسخ ${label}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "تم" : "نسخ"}
    </button>
  );
}

function StepBadge({ n, label, active }: { n: number; label: string; active: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-xs font-bold transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black transition-colors ${active ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
        {n}
      </div>
      <span>{label}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className="font-bold text-sm">{value}</div>
    </div>
  );
}

function renderFeedback(success: boolean, error: string) {
  if (success) return (
    <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 rounded-xl mb-3">
      <CheckCircle className="w-4 h-4 shrink-0" />
      <span>تم إرسال طلب الشحن بنجاح! سيتم مراجعته قريباً.</span>
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-xl mb-3 shake">
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>{error}</span>
    </div>
  );
  return null;
}

export default function WalletPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [method, setMethod] = useState<Method>("mobile_transfer");
  const [network, setNetwork] = useState("libyana");
  const [amount, setAmount] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [senderAccount, setSenderAccount] = useState("");
  const [senderPhoneTouched, setSenderPhoneTouched] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  const pendingCount = (topups as any[]).filter((t: any) => t.status === "pending").length;
  const pendingBlocked = pendingCount >= MAX_PENDING;

  const topupMutation = useCreateTopup({
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
    mutation: {
      onSuccess() {
        setSuccess(true);
        setAmount("");
        setSenderPhone("");
        setSenderAccount("");
        setSenderPhoneTouched(false);
        queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        setTimeout(() => setSuccess(false), 6000);
        toast({ title: "تم إرسال الطلب", description: "سيتم مراجعة طلب الشحن خلال دقائق." });
      },
      onError(err: any) {
        setError(err?.response?.data?.error ?? "فشل في إرسال طلب الشحن.");
      },
      onSettled() { setSubmitting(false); },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (pendingBlocked) {
      setError("لديك طلبات قيد المراجعة، يرجى الانتظار حتى يتم اعتمادها");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError("يرجى إدخال مبلغ صالح");
      return;
    }

    if (method === "mobile_transfer") {
      setSenderPhoneTouched(true);
      if (!senderPhone.trim()) { setError("يرجى إدخال رقم هاتف المُرسل"); return; }
      const phoneErr = libyanPhoneError(senderPhone);
      if (phoneErr) { setError(phoneErr); return; }
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

  const presets = method === "mobile_transfer" ? NETWORK_PRESETS[network] ?? [] : [25, 50, 100, 200];
  const senderPhoneErr = senderPhoneTouched ? libyanPhoneError(senderPhone) : null;

  if (!token) return null;

  const tier = wallet?.loyalty_tier ?? "bronze";

  return (
    <div className="max-w-5xl mx-auto px-4 py-7 page-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Wallet className="w-4.5 h-4.5 text-primary" />
        </div>
        <h1 className="text-xl font-black">المحفظة</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Left: Balance + Form */}
        <div className="lg:col-span-3 space-y-4">

          {/* ── Premium Balance Card ─────────────────────────────── */}
          {isLoading ? (
            <div className="rounded-2xl h-36 skeleton-shimmer border border-border/50" />
          ) : wallet ? (
            <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/18 via-primary/6 to-card p-5">
              {/* Decorative dot grid */}
              <div className="absolute inset-0 dot-grid opacity-40 pointer-events-none" />
              {/* Glow orb */}
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-primary/12 blur-2xl pointer-events-none" />

              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5 text-primary/70 text-xs font-bold mb-1.5">
                    <Wallet className="w-3.5 h-3.5" />
                    الرصيد المتاح
                  </div>
                  <div className="text-4xl font-black tabular-nums mb-3 leading-none">
                    {formatCurrency(wallet.balance ?? 0)}
                  </div>
                  <div className="flex items-center gap-3 text-sm flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${tierColor(tier).replace("text-", "bg-")}`} />
                      <span className="text-muted-foreground text-xs">المستوى:</span>
                      <span className={`font-black text-xs ${tierColor(tier)}`}>{tierLabel(tier)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <Star className="w-3 h-3 text-yellow-400" />
                      <span className="font-bold tabular-nums">{wallet.loyalty_points ?? 0}</span>
                      <span className="text-muted-foreground">نقطة</span>
                    </div>
                  </div>
                </div>
                {/* Tier badge */}
                <div className={`shrink-0 px-3 py-1.5 rounded-xl border text-[11px] font-black ${tierColor(tier)} bg-current/10 border-current/20`}
                  style={{ color: "inherit" }}>
                  <div className={`text-[11px] font-black ${tierColor(tier)}`}>{tierLabel(tier)}</div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Pending limit banner */}
          {pendingBlocked && (
            <div className="flex items-start gap-3 p-4 bg-yellow-400/8 border border-yellow-400/25 rounded-2xl float-in">
              <Lock className="w-4.5 h-4.5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-yellow-300">طلبات الشحن موقوفة مؤقتاً</p>
                <p className="text-xs text-yellow-400/75 mt-0.5">
                  لديك {pendingCount} طلبات قيد المراجعة (الحد الأقصى {MAX_PENDING})
                </p>
              </div>
            </div>
          )}

          {/* Recharge Form */}
          <div className={`bg-card border border-border/60 rounded-2xl p-5 transition-opacity ${pendingBlocked ? "opacity-55 pointer-events-none select-none" : ""}`}>
            <div className="flex items-center gap-2 mb-5">
              <Plus className="w-4.5 h-4.5 text-primary" />
              <h2 className="font-black">شحن المحفظة</h2>
              {pendingCount > 0 && !pendingBlocked && (
                <span className="mr-auto text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded-full">
                  {pendingCount}/{MAX_PENDING} معلق
                </span>
              )}
            </div>

            {/* Method Selection */}
            <div className="mb-5">
              <p className="text-xs text-muted-foreground mb-2 font-bold">طريقة الدفع</p>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { id: "mobile_transfer" as Method, icon: Smartphone, title: "تحويل رصيد", sub: "ليبيانا / مدار" },
                  { id: "lypay"           as Method, icon: Building2,  title: "تحويل مصرفي", sub: "LyPay" },
                ].map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { setMethod(m.id); setError(""); setSuccess(false); }}
                    className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-right ${
                      method === m.id ? "border-primary bg-primary/6" : "border-border hover:border-primary/30"
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${method === m.id ? "bg-primary" : "bg-muted"}`}>
                      <m.icon className={`w-4 h-4 ${method === m.id ? "text-white" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                      <div className="font-bold text-sm">{m.title}</div>
                      <div className="text-xs text-muted-foreground">{m.sub}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Transfer Form */}
            {method === "mobile_transfer" && (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Network */}
                <div>
                  <div className="flex items-center gap-3 mb-2.5">
                    <StepBadge n={1} label="اختر شبكتك" active />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {NETWORKS.map(n => (
                      <button key={n.value} type="button" onClick={() => setNetwork(n.value)}
                        className={`py-2.5 rounded-xl border-2 font-bold text-sm transition-all ${
                          network === n.value ? `${n.border} ${n.bg} ${n.color}` : "border-border text-muted-foreground hover:text-foreground"
                        }`}>
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border-t border-border/40" />

                {/* Amount */}
                <div>
                  <div className="flex items-center gap-3 mb-2.5">
                    <StepBadge n={2} label="المبلغ (د.ل)" active />
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 mb-2.5">
                    {presets.map(p => (
                      <button key={p} type="button" onClick={() => setAmount(String(p))}
                        className={`py-1.5 rounded-lg text-sm font-black transition-all border ${
                          amount === String(p) ? "border-primary bg-primary text-white shadow-sm shadow-primary/20" : "border-border bg-secondary hover:bg-muted"
                        }`}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <Input type="number" min="1" max="10000" step="0.5"
                    placeholder="أو أدخل مبلغاً آخر..."
                    value={amount} onChange={e => setAmount(e.target.value)}
                    required dir="ltr" className="text-left" />
                </div>
                <div className="border-t border-border/40" />

                {/* Sender Phone */}
                <div>
                  <div className="flex items-center gap-3 mb-2.5">
                    <StepBadge n={3} label="رقم هاتف المُرسل" active />
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    حوّل الرصيد إلى: <span className="font-bold text-foreground">091-3456789</span> ثم أدخل رقمك أدناه
                  </p>
                  <div className="relative">
                    <Input type="tel" placeholder="091XXXXXXX"
                      value={senderPhone}
                      onChange={e => {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                        setSenderPhone(digits);
                      }}
                      onBlur={() => setSenderPhoneTouched(true)}
                      required dir="ltr"
                      className={`text-left pl-10 ${senderPhoneTouched && senderPhoneErr ? "border-destructive" : senderPhoneTouched && senderPhone.length === 10 && !senderPhoneErr ? "border-emerald-500/50" : ""}`}
                      maxLength={10}
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2">
                      {senderPhoneTouched && !senderPhoneErr && senderPhone.length === 10 && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                      {senderPhoneTouched && senderPhoneErr && <AlertCircle className="w-4 h-4 text-destructive" />}
                    </div>
                  </div>
                  {senderPhoneTouched && senderPhoneErr && (
                    <p className="text-xs text-destructive mt-1">{senderPhoneErr}</p>
                  )}
                  {!senderPhoneTouched && (
                    <p className="text-xs text-muted-foreground mt-1">ليبيانا (091/093) أو مدار (092/094)</p>
                  )}
                </div>
                <div className="border-t border-border/40" />

                {/* Submit */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <StepBadge n={4} label="أرسل الطلب" active />
                  </div>
                  {renderFeedback(success, error)}
                  <Button type="submit" className="w-full bg-primary hover:bg-primary/90 font-bold h-11 text-base shadow-md shadow-primary/20 cta-glow"
                    disabled={submitting || topupMutation.isPending}>
                    {submitting || topupMutation.isPending ? "جارٍ الإرسال..." : "إرسال طلب الشحن"}
                  </Button>
                </div>
              </form>
            )}

            {/* LyPay Form */}
            {method === "lypay" && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-3 mb-2.5">
                    <StepBadge n={1} label="معلومات الحساب" active />
                  </div>
                  <div className="bg-muted/35 border border-border/50 rounded-xl p-4 space-y-3 text-sm">
                    <InfoRow label="اسم الحساب" value={LYPAY_INFO.account_name} />
                    <InfoRow label="البنك" value={LYPAY_INFO.bank} />
                    <InfoRow label="الفرع" value={LYPAY_INFO.branch} />
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">رقم الحساب</div>
                        <div className="font-mono font-bold">{LYPAY_INFO.account_number}</div>
                      </div>
                      <CopyBtn text={LYPAY_INFO.account_number} label="رقم الحساب" />
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-border/40">
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">IBAN</div>
                        <div className="font-mono font-bold tracking-wide text-sm">{LYPAY_INFO.iban}</div>
                      </div>
                      <CopyBtn text={LYPAY_INFO.iban.replace(/\s/g, "")} label="IBAN" />
                    </div>
                  </div>
                </div>
                <div className="border-t border-border/40" />

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2.5">
                      <StepBadge n={2} label="المبلغ المحوّل (د.ل)" active />
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 mb-2.5">
                      {presets.map(p => (
                        <button key={p} type="button" onClick={() => setAmount(String(p))}
                          className={`py-1.5 rounded-lg text-sm font-black transition-all border ${
                            amount === String(p) ? "border-primary bg-primary text-white" : "border-border bg-secondary hover:bg-muted"
                          }`}>
                          {p}
                        </button>
                      ))}
                    </div>
                    <Input type="number" min="1" max="10000" step="0.5"
                      placeholder="أدخل المبلغ بالدينار الليبي"
                      value={amount} onChange={e => setAmount(e.target.value)}
                      required dir="ltr" className="text-left" />
                  </div>
                  <div className="border-t border-border/40" />

                  <div>
                    <div className="flex items-center gap-3 mb-2.5">
                      <StepBadge n={3} label="رقم حسابك (المُرسل)" active />
                    </div>
                    <Input type="text" placeholder="أدخل رقم حساب المُرسل"
                      value={senderAccount} onChange={e => setSenderAccount(e.target.value)}
                      required dir="ltr" className="text-left font-mono" />
                  </div>
                  <div className="border-t border-border/40" />

                  <div>
                    <div className="flex items-center gap-3 mb-2.5">
                      <StepBadge n={4} label="تأكيد الطلب" active />
                    </div>
                    <div className="mb-3 p-3 bg-yellow-400/8 border border-yellow-400/18 rounded-lg text-xs text-yellow-400">
                      تأكد من إتمام التحويل المصرفي أولاً قبل إرسال الطلب
                    </div>
                    {renderFeedback(success, error)}
                    <Button type="submit" className="w-full bg-primary hover:bg-primary/90 font-bold h-11 text-base shadow-md shadow-primary/20 cta-glow"
                      disabled={submitting || topupMutation.isPending}>
                      {submitting || topupMutation.isPending ? "جارٍ الإرسال..." : "تأكيد طلب الشحن"}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Right: Topup History */}
        <div className="lg:col-span-2">
          <div className="bg-card border border-border/60 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-black text-sm">سجل الشحن</h2>
              {(topups as any[]).length > 0 && (
                <span className="mr-auto text-xs text-muted-foreground bg-muted/50 border border-border/40 px-2 py-0.5 rounded-full">
                  {(topups as any[]).length}
                </span>
              )}
            </div>

            {(topups as any[]).length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <div className="w-12 h-12 rounded-2xl bg-muted mx-auto mb-3 flex items-center justify-center">
                  <Wallet className="w-5 h-5 opacity-30" />
                </div>
                <p className="text-sm font-medium mb-0.5">لا توجد عمليات شحن</p>
                <p className="text-xs text-muted-foreground/60">سيظهر تاريخ الشحن هنا</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(topups as any[]).map((t: any) => (
                  <div key={t.id} className="flex items-start gap-3 p-3 bg-muted/20 border border-border/30 rounded-xl hover:bg-muted/30 transition-colors">
                    <div className="mt-0.5 shrink-0">{topupIcon(t.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="font-black text-sm tabular-nums">{formatCurrency(t.amount)}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColor(t.status)}`}>
                          {statusLabel(t.status)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                        {t.payment_method === "mobile_transfer" ? (
                          <span>{networkLabel(t.payment_network)}</span>
                        ) : (
                          <span>تحويل مصرفي</span>
                        )}
                        <span className="opacity-40">·</span>
                        <span>{formatDate(t.created_at)}</span>
                      </div>
                      {t.admin_note && (
                        <p className="text-xs text-muted-foreground/65 mt-1 leading-tight">{t.admin_note}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
