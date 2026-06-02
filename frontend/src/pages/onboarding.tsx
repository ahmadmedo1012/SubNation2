import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { getGetMeQueryKey, useGetMe } from "@workspace/api-client-react";
import { ShieldCheck, ShoppingBag, Sparkles, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

/**
 * Post-signup welcome screen.
 *
 * History: was previously a 5-step "wizard" that collected display
 * name, 2FA preference, and account-link choices — but every input
 * was decorative (no `onChange`, no submit) and `handleCompleteOnboarding`
 * always POSTed an empty body. Users who typed their name across the
 * flow then found it discarded after step 5, eroding first-session
 * trust on the very first interaction post-signup.
 *
 * Current shape: a 2-step informational welcome that:
 *   1. Establishes the value proposition (instant delivery, secure pay,
 *      Libyan dinar) so freshly-signed-up users know what they get.
 *   2. Hands them clear next-actions (browse / wallet / orders).
 *
 * Profile editing already lives at /profile and works correctly. Any
 * missing bits (display name, 2FA, account links) are reachable from
 * there — this screen no longer pretends to collect them. The
 * `onboarded_at` flag is still flipped via the same backend endpoint
 * so the gate condition that redirects already-onboarded users to /
 * keeps working unchanged.
 */
export function OnboardingPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<1 | 2>(1);
  const [completing, setCompleting] = useState(false);
  const { data: user } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: getGetMeQueryKey(),
    },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    if (user && (user as { onboarded_at?: string }).onboarded_at) {
      navigate("/");
    }
  }, [token, user, navigate]);

  const completeAndGo = async (target: string) => {
    if (completing) return;
    setCompleting(true);
    try {
      await fetch("/api/auth/onboarding/complete", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
    } catch {
      // Non-fatal — the gate also tolerates a missing `onboarded_at`
      // and just shows this page again. Sentry's network instrumentation
      // captures the actual error.
    } finally {
      navigate(target);
    }
  };

  if (!token) return null;
  if (user && (user as { onboarded_at?: string }).onboarded_at) return null;

  return (
    <div
      className="min-h-[100dvh] bg-background flex items-center justify-center p-4 relative overflow-hidden"
      dir="rtl"
    >
      {/* Ambient glow layers — match the auth pages for visual continuity. */}
      <div className="absolute top-[-10%] right-[15%] w-80 h-80 bg-primary/5 rounded-full blur-[80px] pointer-events-none blob-drift" />
      <div className="absolute bottom-[-5%] left-[10%] w-64 h-64 bg-primary/4 rounded-full blur-[60px] pointer-events-none blob-drift-slow" />
      <div className="absolute inset-0 dot-grid opacity-20 pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Progress dots — 2 steps */}
        <div className="flex items-center justify-center gap-1.5 mb-5">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                s === step ? "w-8 bg-primary" : "w-4 bg-muted/60"
              }`}
            />
          ))}
        </div>

        <div className="bg-card border border-border/55 rounded-3xl p-6 sm:p-7 shadow-2xl shadow-black/20 reveal-up">
          {step === 1 ? (
            <div className="space-y-5">
              <div className="text-center space-y-2.5">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/12 border border-primary/22 mx-auto">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                <h1 className="text-2xl font-black leading-tight">
                  مرحباً بك في <span className="text-gradient-animated">SubNation</span>
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  سوق الاشتراكات الرقمية في ليبيا — بالدينار الليبي، تسليم فوري، ودعم محلي.
                </p>
              </div>

              <div className="space-y-2.5">
                <FeatureRow
                  icon={Truck}
                  title="تسليم فوري"
                  description="تصلك بيانات الاشتراك فور تأكيد الدفع."
                />
                <FeatureRow
                  icon={ShieldCheck}
                  title="دفع آمن بمحفظتك"
                  description="اشحن مرة، اشترِ بدون تكرار بيانات الدفع."
                />
                <FeatureRow
                  icon={ShoppingBag}
                  title="كتالوج كامل"
                  description="نتفلكس، ديزني+، سبوتيفاي، بلايستيشن وأكثر."
                />
              </div>

              <Button
                onClick={() => setStep(2)}
                className="w-full h-12 font-bold rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/22 cta-glow"
              >
                التالي
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="text-center space-y-2.5">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-status-success/12 border border-status-success/22 mx-auto">
                  <ShoppingBag className="w-6 h-6 text-status-success" />
                </div>
                <h2 className="text-xl font-black">جاهز للبدء</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  اختر إلى أين تتوجّه — يمكنك دائماً العودة لإعدادات حسابك من صفحة الملف الشخصي.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <Button
                  onClick={() => completeAndGo("/")}
                  disabled={completing}
                  className="w-full h-12 font-bold rounded-xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/22"
                >
                  تصفّح الكتالوج
                </Button>
                <Button
                  variant="outline"
                  onClick={() => completeAndGo("/wallet")}
                  disabled={completing}
                  className="w-full h-12 font-bold rounded-xl"
                >
                  شحن المحفظة أولاً
                </Button>
              </div>

              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={completing}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                السابق
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-4">
          يمكنك تخطّي هذه الشاشة في أي وقت من{" "}
          <button
            type="button"
            onClick={() => completeAndGo("/")}
            disabled={completing}
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            هنا
          </button>
        </p>
      </div>
    </div>
  );
}

function FeatureRow({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Truck;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/20 border border-border/40">
      <div className="w-9 h-9 rounded-lg bg-primary/8 border border-primary/15 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="font-bold text-sm">{title}</div>
        <div className="text-xs text-muted-foreground leading-relaxed">{description}</div>
      </div>
    </div>
  );
}

export default OnboardingPage;
