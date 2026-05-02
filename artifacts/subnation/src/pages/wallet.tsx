import { useState } from "react";
import { useGetWallet, useListTopups, useCreateTopup, getGetWalletQueryKey, getListTopupsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, formatDate, statusLabel, statusColor, tierLabel, tierColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, Plus, Clock, CheckCircle, XCircle, AlertCircle, Star } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const NETWORKS = [
  { value: "madar", label: "مدار", color: "text-blue-400" },
  { value: "libyana", label: "ليبيانا", color: "text-green-400" },
];

export default function WalletPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [network, setNetwork] = useState("madar");
  const [senderPhone, setSenderPhone] = useState("");
  const [reference, setReference] = useState("");
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
        setReference("");
        queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        setTimeout(() => setSuccess(false), 5000);
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

  const handleTopup = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    topupMutation.mutate({
      data: {
        amount: parseFloat(amount),
        payment_network: network,
        sender_phone: senderPhone || undefined,
        payment_reference: reference || undefined,
      },
    });
  };

  const statusIcon = (status: string) => {
    if (status === "approved") return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    if (status === "rejected") return <XCircle className="w-4 h-4 text-red-400" />;
    return <Clock className="w-4 h-4 text-yellow-400" />;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-black mb-6">المحفظة</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Balance Card */}
        <div>
          {isLoading ? (
            <div className="bg-card border border-border rounded-2xl p-6 animate-pulse h-48" />
          ) : wallet && (
            <div className="bg-gradient-to-bl from-primary/20 via-card to-card border border-primary/20 rounded-2xl p-6 mb-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <Wallet className="w-4 h-4" />
                <span>الرصيد المتاح</span>
              </div>
              <div className="text-4xl font-black mb-4">{formatCurrency(wallet.balance ?? 0)}</div>
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">المستوى: </span>
                  <span className={`font-bold ${tierColor(wallet.loyalty_tier ?? "bronze")}`}>
                    {tierLabel(wallet.loyalty_tier ?? "bronze")}
                  </span>
                </div>
                <div>
                  <Star className="w-3.5 h-3.5 inline text-yellow-400 ml-1" />
                  <span className="font-bold">{wallet.loyalty_points ?? 0} نقطة</span>
                </div>
              </div>
            </div>
          )}

          {/* Topup Form */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <h2 className="font-black mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              شحن المحفظة
            </h2>

            <div className="mb-4 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground leading-relaxed">
              قم بالتحويل على الرقم <span className="font-bold text-foreground">091-XXXXXXX</span> وأرسل تفاصيل التحويل. سيتم مراجعة طلبك خلال دقائق.
            </div>

            <form onSubmit={handleTopup} className="space-y-3">
              <div>
                <Label>شبكة الدفع</Label>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  {NETWORKS.map(n => (
                    <button
                      key={n.value}
                      type="button"
                      onClick={() => setNetwork(n.value)}
                      className={`py-2.5 rounded-lg border font-bold text-sm transition-all ${network === n.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground hover:text-foreground"}`}
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="amount">المبلغ (د.ل)</Label>
                <Input id="amount" type="number" min="5" max="10000" step="0.5" placeholder="مثال: 50" value={amount} onChange={e => setAmount(e.target.value)} required dir="ltr" className="text-left mt-1.5" />
              </div>
              <div>
                <Label htmlFor="senderPhone">رقم هاتف المُرسل (اختياري)</Label>
                <Input id="senderPhone" type="tel" placeholder="09XXXXXXXX" value={senderPhone} onChange={e => setSenderPhone(e.target.value)} dir="ltr" className="text-left mt-1.5" />
              </div>
              <div>
                <Label htmlFor="reference">رقم المرجع / الرسالة (اختياري)</Label>
                <Input id="reference" type="text" placeholder="رقم التأكيد" value={reference} onChange={e => setReference(e.target.value)} dir="ltr" className="text-left mt-1.5" />
              </div>

              {success && (
                <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg">
                  <CheckCircle className="w-4 h-4" />
                  <span>تم إرسال طلب الشحن. سيتم مراجعته قريباً.</span>
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full bg-primary hover:bg-primary/90 font-bold" disabled={topupMutation.isPending}>
                {topupMutation.isPending ? "جارٍ الإرسال..." : "إرسال طلب الشحن"}
              </Button>
            </form>
          </div>
        </div>

        {/* Topup History */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <h2 className="font-black mb-4">سجل الشحن</h2>
          {topups.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Wallet className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">لا توجد طلبات شحن بعد</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {topups.map((t: any) => (
                <div key={t.id} className="flex items-start justify-between gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-start gap-2">
                    {statusIcon(t.status)}
                    <div>
                      <div className="font-bold text-sm">{formatCurrency(t.amount)}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t.payment_network === "madar" ? "مدار" : "ليبيانا"}
                        {t.sender_phone && ` — ${t.sender_phone}`}
                      </div>
                      <div className="text-xs text-muted-foreground">{t.created_at ? formatDate(t.created_at) : ""}</div>
                      {t.admin_note && <div className="text-xs text-yellow-400 mt-1">{t.admin_note}</div>}
                    </div>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor(t.status)}`}>{statusLabel(t.status)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
