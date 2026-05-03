import { useParams, useLocation, Link } from "wouter";
import { useGetOrder, getGetOrderQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, formatRelativeTime, statusLabel, statusColor } from "@/lib/utils";
import {
  Package, ArrowRight, Copy, CheckCircle, Info, ShoppingCart,
  Clock, Tag, ShieldCheck, ExternalLink, Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="group flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider mb-0.5">{label}</div>
        <div className="font-mono font-bold text-sm break-all leading-snug">{value}</div>
      </div>
      <button
        onClick={copy}
        className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-180 active:scale-95 ${
          copied
            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
            : "bg-muted/50 text-muted-foreground hover:bg-primary/12 hover:text-primary border border-border/40 hover:border-primary/25"
        }`}
        title={`نسخ ${label}`}
      >
        {copied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? "تم" : "نسخ"}
      </button>
    </div>
  );
}

function StatusSteps({ status }: { status: string }) {
  const steps = [
    { key: "pending",   label: "استُلم الطلب", done: true },
    { key: "completed", label: "تم التسليم",   done: status === "completed" },
  ];
  if (status === "failed" || status === "refunded") return null;
  return (
    <div className="flex items-center gap-0 my-2">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black transition-all ${
              step.done ? "bg-emerald-500/20 border-2 border-emerald-500/50 text-emerald-400" : "bg-muted/50 border-2 border-border/50 text-muted-foreground/40"
            }`}>
              {step.done ? <CheckCircle className="w-3 h-3" /> : <div className="w-1.5 h-1.5 rounded-full bg-current" />}
            </div>
            <span className={`text-[9px] font-bold whitespace-nowrap ${step.done ? "text-emerald-400" : "text-muted-foreground/35"}`}>{step.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-[2px] mb-4 mx-1 transition-all ${step.done && steps[i + 1].done ? "bg-emerald-500/40" : "bg-border/40"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function OrderDetailPage() {
  const { orderCode } = useParams<{ orderCode: string }>();
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: order, isLoading } = useGetOrder(orderCode ?? "", {
    query: { queryKey: getGetOrderQueryKey(orderCode ?? ""), enabled: !!orderCode && !!token },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const copyOrderCode = () => {
    if (!order?.order_code) return;
    navigator.clipboard.writeText(order.order_code);
    toast({ title: "تم نسخ رقم الطلب" });
  };

  if (!token) { navigate("/login"); return null; }

  if (isLoading) return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="h-4 skeleton-shimmer rounded w-28 mb-6" />
      <div className="bg-card border border-border/60 rounded-2xl overflow-hidden space-y-px">
        <div className="h-32 skeleton-shimmer" />
        <div className="h-24 skeleton-shimmer" />
        <div className="h-20 skeleton-shimmer" />
      </div>
    </div>
  );

  if (!order) return (
    <div className="max-w-2xl mx-auto px-4 py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted/60 border border-border/40 mx-auto mb-4 flex items-center justify-center">
        <Package className="w-7 h-7 text-muted-foreground/30" />
      </div>
      <p className="font-bold text-lg mb-1">الطلب غير موجود</p>
      <p className="text-sm text-muted-foreground mb-5">تأكد من رقم الطلب أو عُد لقائمة طلباتك</p>
      <Button onClick={() => navigate("/orders")} variant="outline" className="gap-2">
        <ArrowRight className="w-4 h-4" /> العودة للطلبات
      </Button>
    </div>
  );

  const hasDelivery = !!(order.delivered_email || order.delivered_password || order.delivered_extra_details);
  const discountAmount = (order as any).discount_amount;
  const couponCode = (order as any).coupon_code;
  const originalAmount = discountAmount ? (order.amount ?? 0) + discountAmount : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-7 page-in">
      {/* Back */}
      <button
        onClick={() => navigate("/orders")}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm mb-5 transition-colors press-spring group"
      >
        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" />
        الطلبات
      </button>

      <div className="space-y-3">

        {/* ── Header card ─────────────────────────────────────── */}
        <div className="bg-card border border-border/55 rounded-2xl overflow-hidden shadow-lg shadow-black/10 float-in">
          {/* Status color bar */}
          <div className={`h-1 w-full ${
            order.status === "completed" ? "bg-gradient-to-l from-emerald-500/80 to-emerald-400/20" :
            order.status === "failed" || order.status === "refunded" ? "bg-gradient-to-l from-red-500/80 to-red-400/20" :
            "bg-gradient-to-l from-yellow-500/60 to-yellow-400/10"
          }`} />

          <div className="p-5">
            {/* Product + status */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                {/* Product image */}
                {(order as any).product_image_url ? (
                  <div className="w-12 h-12 rounded-xl bg-muted/50 border border-border/40 overflow-hidden shrink-0">
                    <img src={(order as any).product_image_url} alt={order.product_name ?? ""} className="w-full h-full object-contain p-1.5" />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-muted/50 border border-border/40 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5 text-muted-foreground/30" />
                  </div>
                )}
                <div>
                  <h1 className="font-black text-base leading-tight">{order.product_name}</h1>
                  <button
                    onClick={copyOrderCode}
                    className="flex items-center gap-1 mt-0.5 text-muted-foreground/55 hover:text-primary text-[11px] font-mono transition-colors group/code"
                  >
                    <span>{order.order_code}</span>
                    <Copy className="w-2.5 h-2.5 opacity-0 group-hover/code:opacity-100 transition-opacity" />
                  </button>
                </div>
              </div>
              <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border ${statusColor(order.status ?? "")}`}>
                {statusLabel(order.status ?? "")}
              </span>
            </div>

            {/* Progress steps */}
            <StatusSteps status={order.status ?? ""} />

            {/* Price row */}
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-border/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {order.created_at && (
                  <span title={formatDate(order.created_at)}>{formatRelativeTime(order.created_at)}</span>
                )}
              </div>
              <div className="text-right">
                {originalAmount && (
                  <div className="text-xs text-muted-foreground/50 line-through tabular-nums text-left">
                    {formatCurrency(originalAmount)}
                  </div>
                )}
                <div className="font-black text-lg tabular-nums text-primary">{formatCurrency(order.amount ?? 0)}</div>
              </div>
            </div>

            {/* Coupon badge */}
            {couponCode && discountAmount && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/20 text-xs text-emerald-400">
                <Tag className="w-3 h-3 shrink-0" />
                <span>كوبون <span className="font-mono font-black">{couponCode}</span></span>
                <span className="mr-auto font-black">وفّرت {formatCurrency(discountAmount)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Delivery credentials ────────────────────────────── */}
        {hasDelivery ? (
          <div className="bg-card border border-border/55 rounded-2xl overflow-hidden float-in stagger-1">
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border/30 bg-emerald-500/5">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div>
                <div className="font-black text-sm">بيانات الحساب</div>
                <div className="text-[10px] text-muted-foreground/60">انسخ بياناتك بأمان</div>
              </div>
            </div>

            <div className="divide-y divide-border/20">
              {order.delivered_email && <CopyField label="البريد الإلكتروني" value={order.delivered_email} />}
              {order.delivered_password && <CopyField label="كلمة المرور" value={order.delivered_password} />}
              {order.delivered_extra_details && (
                <div className="px-4 py-3.5 text-sm text-muted-foreground leading-relaxed">
                  {order.delivered_extra_details}
                </div>
              )}
            </div>

            {order.delivered_usage_terms && (
              <div className="mx-4 mb-4 flex gap-2.5 text-sm bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-3.5">
                <Info className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <span className="text-yellow-400/90 leading-relaxed">{order.delivered_usage_terms}</span>
              </div>
            )}
          </div>
        ) : (
          order.status !== "failed" && order.status !== "refunded" && (
            <div className="bg-card border border-border/55 rounded-2xl p-6 text-center float-in stagger-1">
              <div className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/40 mx-auto mb-3 flex items-center justify-center">
                <Clock className="w-5 h-5 text-muted-foreground/35" />
              </div>
              <p className="font-bold text-sm mb-1">قيد الإعداد</p>
              <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-xs mx-auto">
                سيتم تسليم بيانات الحساب فور اكتمال الطلب. ستصلك إشعار عند الجاهزية.
              </p>
            </div>
          )
        )}

        {/* ── Failed/Refunded state ───────────────────────────── */}
        {(order.status === "failed" || order.status === "refunded") && (
          <div className="bg-card border border-red-500/20 rounded-2xl p-5 text-center float-in stagger-1">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 mx-auto mb-3 flex items-center justify-center">
              <Package className="w-5 h-5 text-red-400/60" />
            </div>
            <p className="font-bold text-sm mb-1 text-red-400">
              {order.status === "refunded" ? "تم الاسترداد" : "فشل الطلب"}
            </p>
            <p className="text-xs text-muted-foreground/60">
              {order.status === "refunded"
                ? "تم إعادة المبلغ إلى محفظتك"
                : "يرجى التواصل مع الدعم الفني إن احتجت المساعدة"
              }
            </p>
          </div>
        )}

        {/* ── Actions ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2.5 float-in stagger-2">
          <Link href="/">
            <Button className="w-full bg-primary hover:bg-primary/90 font-bold shadow-md shadow-primary/20 press-spring gap-1.5">
              <Sparkles className="w-4 h-4" />
              تصفح المزيد
            </Button>
          </Link>
          <Button variant="outline" onClick={() => navigate("/orders")} className="press-spring gap-1.5">
            <ShoppingCart className="w-4 h-4" />
            كل طلباتي
          </Button>
        </div>

        {/* Support link */}
        <div className="text-center py-1">
          <Link href="/support">
            <button className="text-xs text-muted-foreground/50 hover:text-primary transition-colors inline-flex items-center gap-1">
              <ExternalLink className="w-3 h-3" />
              مشكلة في هذا الطلب؟ تواصل مع الدعم
            </button>
          </Link>
        </div>

      </div>
    </div>
  );
}
