import { useState } from "react";
import { useGetWallet, useListTopups, useCreateTopup, getGetWalletQueryKey, getListTopupsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor, tierLabel, tierColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, Plus, Clock, CheckCircle, XCircle, AlertCircle, Star, Smartphone, Building2, Copy, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// ── Constants ────────────────────────────────────────────────────────────────

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
  { value: "libyana", label: "ليبيانا", color: "text-green-400", border: "border-green-500/40", bg: "bg-green-500/10" },
  { value: "madar", label: "مدار", color: "text-blue-400", border: "border-blue-500/40", bg: "bg-blue-500/10" },
];

type Method = "mobile_transfer" | "lypay";

// ── Helpers ───────────────────────────────────────────────────────────────────

function methodLabel(method: string) {
  if (method === "lypay") return "LyPay";
  return "تحويل رصيد";
}

function networkLabel(net?: string | null) {
  if (net === "libyana") return "ليبيانا";
  if (net === "madar") return "مدار";
  return net ?? "";
}

function topupIcon(status: string) {
  if (status === "approved") return <CheckCircle className="w-4 h-4 text-emerald-400" />;
  if (status === "rejected") return <XCircle className="w-4 h-4 text-red-400" />;
  return <Clock className="w-4 h-4 text-yellow-400" />;
}

// ── Copy Button ───────────────────────────────────────────────────────────────

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
      className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
      title={`نسخ ${label}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "تم النسخ" : "نسخ"}
    </button>
  );
}

// ── Step Indicator ────────────────────────────────────────────────────────────

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

// ── Main Page ─────────────────────────────────────────────────────────────────

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
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const { data: wallet, isLoading } = useGetWallet({
    query: { enabled: !!token, queryKey: getGetWalletQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const { data: topups = [] } = useListTopups({
    query: { enabled: !!token, queryKey: getListTopupsQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const topupMutation = useCreateTopup({
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
    mutation: {
      onSuccess() {
        setSuccess(true);
        setAmount("");
        setSenderPhone("");
        setSenderAccount("");
        queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        setTimeout(() => setSuccess(false), 6000);
        toast({ title: "تم إرسال الطلب", description: "سيتم مراجعة طلب الشحن خلال دقائق." });
      },
      onError(err: any) {
        setError(err?.response?.data?.error ?? "فشل في إرسال طلب الشحن.");
      },
    },
  });

  if (!token) {
    navigate("/login");
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError("يرجى إدخال مبلغ صالح");
      return;
    }
    if (method === "mobile_transfer" && !senderPhone.trim()) {
      setError("يرجى إدخال رقم هاتف المُرسل");
      return;
    }
    if (method === "lypay" && !senderAccount.trim()) {
      setError("يرجى إدخال رقم حساب المُرسل");
      return;
    }

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

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-black mb-6">المحفظة</h1>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Balance + Form */}
        <div className="lg:col-span-3 space-y-4">
          {/* Balance Card */}
          {isLoading ? (
            <div className="bg-card border border-border rounded-2xl p-6 animate-pulse h-36" />
          ) : wallet && (
            <div className="bg-gradient-to-bl from-primary/20 via-card to-card border border-primary/20 rounded-2xl p-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Wallet className="w-4 h-4" />
                <span>الرصيد المتاح</span>
              </div>
              <div className="text-4xl font-black mb-3">{formatCurrency(wallet.balance ?? 0)}</div>
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">المستوى: </span>
                  <span className={`font-bold ${tierColor(wallet.loyalty_tier ?? "bronze")}`}>{tierLabel(wallet.loyalty_tier ?? "bronze")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-yellow-400" />
                  <span className="font-bold">{wallet.loyalty_points ?? 0} نقطة</span>
                </div>
              </div>
            </div>
          )}

          {/* Recharge Form Card */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <Plus className="w-5 h-5 text-primary" />
              <h2 className="font-black text-lg">شحن المحفظة</h2>
            </div>

            {/* Method Selection */}
            <div className="mb-6">
              <p className="text-xs text-muted-foreground mb-2 font-bold uppercase tracking-wide">اختر طريقة الدفع</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { setMethod("mobile_transfer"); setError(""); setSuccess(false); }}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-right ${method === "mobile_transfer" ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${method === "mobile_transfer" ? "bg-primary" : "bg-muted"}`}>
                    <Smartphone className={`w-4 h-4 ${method === "mobile_transfer" ? "text-white" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <div className="font-bold text-sm">تحويل رصيد</div>
                    <div className="text-xs text-muted-foreground">ليبيانا / مدار</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => { setMethod("lypay"); setError(""); setSuccess(false); }}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-right ${method === "lypay" ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${method === "lypay" ? "bg-primary" : "bg-muted"}`}>
                    <Building2 className={`w-4 h-4 ${method === "lypay" ? "text-white" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <div className="font-bold text-sm">تحويل مصرفي</div>
                    <div className="text-xs text-muted-foreground">LyPay</div>
                  </div>
                </button>
              </div>
            </div>

            {/* ── Mobile Transfer Form ───────────────────────────────── */}
            {method === "mobile_transfer" && (
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Step 1: Network */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <StepBadge n={1} label="اختر شبكتك" active={true} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {NETWORKS.map(n => (
                      <button key={n.value} type="button" onClick={() => setNetwork(n.value)}
                        className={`py-3 rounded-xl border-2 font-bold text-sm transition-all ${network === n.value ? `${n.border} ${n.bg} ${n.color}` : "border-border text-muted-foreground hover:text-foreground"}`}>
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/50" />

                {/* Step 2: Amount */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <StepBadge n={2} label="اختر المبلغ (د.ل)" active={true} />
                  </div>
                  <div className="grid grid-cols-5 gap-2 mb-3">
                    {presets.map(p => (
                      <button key={p} type="button" onClick={() => setAmount(String(p))}
                        className={`py-2 rounded-lg text-sm font-black transition-all border ${amount === String(p) ? "border-primary bg-primary text-white" : "border-border bg-secondary hover:bg-muted"}`}>
                        {p}
                      </button>
                    ))}
                  </div>
                  <Input
                    type="number" min="1" max="10000" step="0.5"
                    placeholder="أو أدخل مبلغاً آخر..."
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    required dir="ltr"
                    className="text-left"
                  />
                </div>

                <div className="border-t border-border/50" />

                {/* Step 3: Sender Phone */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <StepBadge n={3} label="رقم هاتف المُرسل" active={true} />
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    حوّل الرصيد إلى: <span className="font-bold text-foreground">091-3456789</span> ثم أدخل رقمك أدناه
                  </p>
                  <Input
                    type="tel"
                    placeholder="09XXXXXXXX"
                    value={senderPhone}
                    onChange={e => setSenderPhone(e.target.value)}
                    required dir="ltr" className="text-left"
                  />
                </div>

                <div className="border-t border-border/50" />

                {/* Step 4: Submit */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <StepBadge n={4} label="أرسل الطلب" active={true} />
                  </div>
                  {renderFeedback(success, error)}
                  <Button type="submit" className="w-full bg-primary hover:bg-primary/90 font-bold h-12 text-base" disabled={topupMutation.isPending}>
                    {topupMutation.isPending ? "جارٍ الإرسال..." : "إرسال طلب الشحن"}
                  </Button>
                </div>
              </form>
            )}

            {/* ── LyPay Form ─────────────────────────────────────────── */}
            {method === "lypay" && (
              <div className="space-y-5">
                {/* Step 1: Account Info */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <StepBadge n={1} label="معلومات الحساب المصرفي" active={true} />
                  </div>
                  <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-3 text-sm">
                    <InfoRow label="اسم الحساب" value={LYPAY_INFO.account_name} />
                    <InfoRow label="البنك" value={LYPAY_INFO.bank} />
                    <InfoRow label="الفرع" value={LYPAY_INFO.branch} />
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">رقم الحساب</div>
                        <div className="font-mono font-bold text-sm">{LYPAY_INFO.account_number}</div>
                      </div>
                      <CopyBtn text={LYPAY_INFO.account_number} label="رقم الحساب" />
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-border/50">
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">IBAN</div>
                        <div className="font-mono font-bold text-sm tracking-wide">{LYPAY_INFO.iban}</div>
                      </div>
                      <CopyBtn text={LYPAY_INFO.iban.replace(/\s/g, "")} label="IBAN" />
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <CopyBtn
                      text={`اسم الحساب: ${LYPAY_INFO.account_name}\nالبنك: ${LYPAY_INFO.bank}\nرقم الحساب: ${LYPAY_INFO.account_number}\nIBAN: ${LYPAY_INFO.iban}`}
                      label="كل التفاصيل"
                    />
                    <span className="text-xs text-muted-foreground flex items-center">نسخ كل التفاصيل</span>
                  </div>
                </div>

                <div className="border-t border-border/50" />

                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Step 2: Amount */}
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <StepBadge n={2} label="المبلغ المحوّل (د.ل)" active={true} />
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      {presets.map(p => (
                        <button key={p} type="button" onClick={() => setAmount(String(p))}
                          className={`py-2 rounded-lg text-sm font-black transition-all border ${amount === String(p) ? "border-primary bg-primary text-white" : "border-border bg-secondary hover:bg-muted"}`}>
                          {p}
                        </button>
                      ))}
                    </div>
                    <Input
                      type="number" min="1" max="10000" step="0.5"
                      placeholder="أدخل المبلغ بالدينار الليبي"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      required dir="ltr" className="text-left"
                    />
                  </div>

                  <div className="border-t border-border/50" />

                  {/* Step 3: Sender Account */}
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <StepBadge n={3} label="رقم حسابك (المُرسل)" active={true} />
                    </div>
                    <Input
                      type="text"
                      placeholder="أدخل رقم حساب المُرسل"
                      value={senderAccount}
                      onChange={e => setSenderAccount(e.target.value)}
                      required dir="ltr" className="text-left font-mono"
                    />
                  </div>

                  <div className="border-t border-border/50" />

                  {/* Step 4: Submit */}
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <StepBadge n={4} label="تأكيد الطلب" active={true} />
                    </div>
                    <div className="mb-3 p-3 bg-yellow-400/10 border border-yellow-400/20 rounded-lg text-xs text-yellow-400">
                      تأكد من إتمام التحويل المصرفي أولاً قبل إرسال الطلب
                    </div>
                    {renderFeedback(success, error)}
                    <Button type="submit" className="w-full bg-primary hover:bg-primary/90 font-bold h-12 text-base" disabled={topupMutation.isPending}>
                      {topupMutation.isPending ? "جارٍ الإرسال..." : "تأكيد طلب الشحن"}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Right: Topup History */}
        <div className="lg:col-span-2">
          <div className="bg-card border border-border rounded-2xl p-6 h-full">
            <h2 className="font-black mb-4">سجل الشحن</h2>
            {topups.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Wallet className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">لا توجد طلبات شحن بعد</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[600px] overflow-y-auto">
                {topups.map((t: any) => (
                  <div key={t.id} className="flex items-start justify-between gap-2 p-3 bg-muted/30 rounded-xl">
                    <div className="flex items-start gap-2">
                      {topupIcon(t.status)}
                      <div>
                        <div className="font-black text-sm">{formatCurrency(t.amount)}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {t.payment_method === "lypay" ? "LyPay" : networkLabel(t.payment_network)}
                          {t.sender_phone && ` · ${t.sender_phone}`}
                          {t.sender_account && ` · ${t.sender_account}`}
                        </div>
                        <div className="text-xs text-muted-foreground">{t.created_at ? formatDate(t.created_at) : ""}</div>
                        {t.admin_note && <div className="text-xs text-yellow-400 mt-1">{t.admin_note}</div>}
                      </div>
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border shrink-0 ${statusColor(t.status)}`}>{statusLabel(t.status)}</span>
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

// ── Small helpers ─────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}

function renderFeedback(success: boolean, error: string) {
  if (success) return (
    <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 rounded-xl mb-3">
      <CheckCircle className="w-4 h-4 shrink-0" />
      <span>تم إرسال طلب الشحن. سيتم مراجعته خلال دقائق.</span>
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-xl mb-3">
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>{error}</span>
    </div>
  );
  return null;
}
