import { Button } from "@/components/ui/button";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { useOnScreen } from "@/hooks/useOnScreen";
import { useSeo } from "@/hooks/useSeo";
import { useAuth } from "@/lib/auth";
import { getGetMeQueryKey, useGetMe, customFetch } from "@workspace/api-client-react";
import { ShieldCheck, ShoppingBag, Sparkles, Truck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  // R158-IMPL-D (P3): the last non-admin page without useSeo — the
  // fallback home title rode the URL (routes.tsx), so a screen-reader
  // hop into the post-signup welcome announced the WRONG page
  // (RouteAnnouncer reads document.title, the R146 audit-frontend-pages
  // F4 class). profile.tsx's block shape; a transitional post-auth
  // page needs no index — robotsForPath already noindexed the path,
  // the page-level block makes it explicit + titled.
  const seoBlock = useSeo({
    title: "مرحباً بك — SubNation",
    description:
      "مرحباً بك في SubNation — سوق الاشتراكات الرقمية في ليبيا: تسليم فوري، دفع آمن، وبالدينار الليبي.",
    path: "/onboarding",
    robots: "noindex,follow",
  });
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<1 | 2>(1);
  const [completing, setCompleting] = useState(false);
  // R160 (audit F2): the step swap unmounts the focused «التالي» button
  // (focus fell to <body>) and the h1 swap is unaudible — RouteAnnouncer
  // stays silent because the ROUTE never changes. Move focus to the
  // incoming step's h1 (tabIndex={-1} on both) on every step CHANGE;
  // the mounted guard keeps the first paint from stealing page focus.
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);
  // R115-A10: pause the ambient blobs when the card scrolls away.
  const glow = useOnScreen<HTMLDivElement>();
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
      // R122 (A11-F3): preserve the return path (commerce-flows'
      // `?redirect=` idiom) so a post-login user still lands on the
      // welcome screen the signup flow intended for them.
      navigate(`/login?redirect=${encodeURIComponent("/onboarding")}`);
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
      // R144-C1 (L16-3): rides customFetch — same method/auth; a non-2xx
      // now throws into the catch (the old code resolved silently on
      // !ok — the gate re-shows this page either way), and the previously
      // UNBOUNDED POST gains the 20 s budget.
      await customFetch("/api/auth/onboarding/complete", {
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

  /* R123-E4b (P3-e): the guest guard used to `return null` — a blank
     flash between the lazy chunk's "form" skeleton swapping out and
     the login-redirect effect ticking, on the only guarded page that
     lacked a guest skeleton (checkout/wallet/profile/orders all render
     one). Same "form" shape ROUTE_SHAPES maps /onboarding to. */
  if (!token) return <RouteSkeleton shape="form" />;
  if (user && (user as { onboarded_at?: string }).onboarded_at) return null;

  return (
    <div
      ref={glow.ref}
      className="min-h-[100dvh] bg-background flex items-center justify-center p-4 relative overflow-hidden"
      dir="rtl"
    >
      {seoBlock}
      {/* Ambient glow layers — match the auth pages for visual continuity. */}
      <div
        className="absolute top-[-10%] right-[15%] w-80 h-80 bg-primary/5 rounded-full blur-[80px] pointer-events-none blob-drift"
        style={glow.style}
      />
      <div
        className="absolute bottom-[-5%] left-[10%] w-64 h-64 bg-primary/4 rounded-full blur-[60px] pointer-events-none blob-drift-slow"
        style={glow.style}
      />
      <div className="absolute inset-0 dot-grid opacity-20 pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Progress dots — 2 steps */}
        {/* R160 (audit F7): the decorative dots row carries step
            semantics (role=group + the current «الخطوة N من 2» label) —
            the Western digits follow the DESIGN.md digit rule. */}
        <div
          role="group"
          aria-label={`الخطوة ${step} من 2`}
          className="flex items-center justify-center gap-1.5 mb-5"
        >
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                s === step ? "w-8 bg-primary" : "w-4 bg-muted/60"
              }`}
            />
          ))}
        </div>

        <div className="relative overflow-hidden bg-card border border-border/60 rounded-3xl p-6 sm:p-7 shadow-2xl reveal-up">
          {/* R139 (precision): the welcome card joins the r138-g auth
              atmosphere family — this page's own docblock says "match the
              auth pages for visual continuity", and login/register ride
              exactly this layer pair: .ambient-wash (two-point static
              radial, index.css owns the alphas) + .hairline-glow (the
              lit top edge the chrome family shares). The page-level
              blob-drift layers + dot-grid above STAY — login/register
              kept theirs too; the card wash is the page's ONE r138
              atmosphere moment (static, GPU-free, pointer-events-none;
              overflow-hidden clips both layers to the rounded-3xl
              corners). shadow-black/20 → bare shadow-2xl: the color
              override was login's R116-S1 retirement (25% black forced
              under the light-theme card). R143 (L2-2): border/55 → /60 —
              the auth family joins the r139 resting-edge sweep
              (category.tsx:382's rule; the /55 ban pins now cover
              LOGIN/REGISTER/ONBOARDING). */}
          <div className="absolute inset-0 ambient-wash pointer-events-none" />
          <div className="hairline-glow" />
          {step === 1 ? (
            <div className="space-y-5">
              <div className="text-center space-y-2.5">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/12 border border-primary/22 mx-auto">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                {/* R124-I4 (A3 #7): gradient text is on the REFUSE list —
                    emphasis comes from weight/size (the h1 already carries
                    both); the brand accent rides the text-safe token.
                    R128-A4 (F-3): leading-tight removed — the base h1–h4
                    1.3 Arabic-safe floor (index.css) owns the leading. */}
                <h1 ref={stepHeadingRef} tabIndex={-1} className="text-2xl font-bold">
                  مرحباً بك في <span className="text-primary-text">SubNation</span>
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  سوق الاشتراكات الرقمية في ليبيا — بالدينار الليبي، تسليم فوري، ودعم محلي.
                </p>
              </div>

              <div className="space-y-2.5">
                <FeatureRow
                  icon={Truck}
                  title="تسليم فوري"
                  description="في أغلب الحالات تصلك بيانات الاشتراك فور تأكيد الدفع، وخلال 24 ساعة كحد أقصى."
                />
                <FeatureRow
                  icon={ShieldCheck}
                  title="دفع آمن بمحفظتك"
                  description="اشحن مرة، اشترِ بدون تكرار بيانات الدفع."
                />
                <FeatureRow
                  icon={ShoppingBag}
                  title="كتالوج كامل"
                  /* R122 (A1 P2-2): بلايستيشن removed — the gaming category
                     was archived 2026-09-19 and R120-B1 (A7-F5) scrubbed it
                     from home's hero/SEO with the rationale "a chip that
                     filters to an empty grid misleads shoppers"; this
                     first-run screen kept naming a brand the live catalog
                     no longer sells.
                     L1-3/L4-1 (R143): شاهد removed too — the R122-era
                     verification claim for it was falsified by the
                     R142 I-4 probe (search=شاهد → 0 rows); swapped
                     for باراماونت+ (Paramount+, stocked, per the
                     I-4 precedent at catalog-filters.ts:114-119). */
                  description="نتفلكس، ديزني+، باراماونت+، سبوتيفاي وأكثر."
                />
              </div>

              {/* R124-I4 (A3 #6): cta-glow (zero-offset pulsing halo)
                  removed — the gradient fill + press-spring already carry
                  the affordance (the R116-S1 CTA recipe's own rationale). */}
              <Button
                onClick={() => setStep(2)}
                /* R139 (precision): canonical CTA (R116-S1) — size="lg"
                   owns the 48px geometry + the variant recipe (fill,
                   elevation, hover, press-spring, ONE focus ring); the
                   hand-rolled w-full h-12 + bg-primary + hover:bg-
                   primary/90 + shadow-lg shadow-primary/22 stack dies.
                   Label/handler byte-identical. */
                size="lg"
                className="w-full font-bold"
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
                {/* R-140-l (semantics): step 2's title is an h1, not an
                    h2 — the two steps are mutually-exclusive VIEWS of
                    this route, and the rendered page must carry exactly
                    one h1 on every view (step 1 names itself above; a
                    lone h2 with no h1 in the tree was an orphaned
                    level). Classes verbatim — h1 and h2 share the same
                    h1–h4 leading floor (index.css), so the tag swap is
                    pixel-neutral; heading order stays sequential per
                    rendered view. */}
                <h1 ref={stepHeadingRef} tabIndex={-1} className="text-xl font-bold">
                  جاهز للبدء
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  اختر إلى أين تتوجّه — يمكنك دائماً العودة لإعدادات حسابك من صفحة حسابك.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <Button
                  onClick={() => completeAndGo("/")}
                  disabled={completing}
                  /* R139 (precision): canonical CTA (R116-S1) — same
                     conversion as «التالي» above. */
                  size="lg"
                  className="w-full font-bold"
                >
                  تصفّح الكتالوج
                </Button>
                <Button
                  variant="outline"
                  onClick={() => completeAndGo("/wallet")}
                  disabled={completing}
                  /* R139 (precision): canonical CTA (R116-S1) — the
                     outline twin rides the same recipe; the bare w-full
                     h-12 hand-roll dies. */
                  size="lg"
                  className="w-full font-bold"
                >
                  شحن المحفظة أولاً
                </Button>
              </div>

              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={completing}
                /* R122 (A1 P2-7): py-1 was ~28px tall — inline-flex +
                   min-h-11 rides the 44px tap-target floor (the التالي
                   CTAs above are h-12). */
                className="w-full inline-flex items-center justify-center min-h-11 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                السابق
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-2xs text-muted-foreground mt-4">
          يمكنك تخطّي هذه الشاشة في أي وقت من{" "}
          <button
            type="button"
            onClick={() => completeAndGo("/")}
            disabled={completing}
            /* R160 (audit F3): the skip control rode ~17px inside its
               text-2xs paragraph — the R122 class the sibling «السابق»
               already fixed (min-h-11). It completes onboarding AND
               navigates: a first-session money-adjacent action. The
               negative margin keeps the paragraph's rhythm while the
               hit area reaches the 44px floor (the order-detail
               code-button idiom). */
            className="inline-flex items-center min-h-11 px-2 -my-3 underline underline-offset-2 hover:text-foreground transition-colors"
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
      {/* R139 (precision): the benefit tiles already speak the family's
          weight+size register — title font-bold text-sm over a text-xs
          muted description, ink untouched (emphasis is weight+size, NOT
          color); the tile itself is the nested-row register (bg-muted/20
          + /40) and the icon stage keeps its primary tint (the
          page-header tile family r138 left on cart/orders/notifications).
          Verified — byte-identical. */}
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
