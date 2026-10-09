import { AuthProviders } from "@/components/AuthProviders";
import { CopyButton } from "@/components/CopyButton";
import { SessionManager } from "@/components/SessionManager";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { useConfirm } from "@/hooks/use-confirm";
import { useOnScreen } from "@/hooks/use-on-screen";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { formatCurrency, tierColor, tierLabel } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, type User as MeUser, useGetMe } from "@workspace/api-client-react";
import {
  AlertCircle,
  ChevronLeft,
  Crown,
  Gift,
  Link as LinkIcon,
  LogOut,
  Mail,
  Phone,
  Shield,
  Smartphone,
  Star,
  Unlink,
  User,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";

const TIER_GRADIENTS: Record<string, string> = {
  bronze: "from-amber-600/14 via-card to-card border-amber-600/20",
  silver: "from-slate-400/14 via-card to-card border-slate-400/20",
  gold: "from-yellow-400/14 via-card to-card border-yellow-400/20",
  platinum: "from-cyan-400/14 via-card to-card border-cyan-400/20",
};

// 98-F9: the ProfileUser intersection type is GONE — the generated User
// contract now carries linked_identities + display_name (spec round-98
// closed the gap that forced this local re-declaration), and firebase_uid
// was never read anywhere. Plain MeUser typing below.

/**
 * 96-F6 (R96 A2 P2-8): display name for a linked provider — used by the
 * row render AND the unlink confirmation copy so the dialog names the
 * exact provider being detached («فصل Telegram؟» not «فصل الحساب؟»).
 */
function providerDisplayName(provider: string): string {
  if (provider === "google.com") return "Google";
  if (provider === "firebase.com") return "رقم الهاتف";
  if (provider === "telegram.org") return "Telegram";
  return provider;
}

export default function ProfilePage() {
  const { token, logout } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // 96-F6 (R96 A2 P2-8): destructive-confirm dialog for unlinking an
  // auth provider — the house standard (SessionManager + every admin
  // page) instead of a bare 24px icon tap firing immediately.
  const { confirm, ConfirmDialog } = useConfirm();

  const [linkedProviders, setLinkedProviders] = useState<any[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  // R94-A1 #8 (P2 — the fifth error-as-empty site F-05 missed): a failed
  // linked-providers fetch (401/5xx, or a non-JSON body that makes
  // res.json() throw) used to leave the list empty, which rendered the
  // «اربط حسابك لحمايته» advice card to a user who ALREADY has two
  // linked providers. An explicit error state + retry replaces the
  // false advice.
  const [providersError, setProvidersError] = useState(false);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);

  useEffect(() => {
    // R122 (A11-F3): preserve the return path on the guest redirect —
    // the commerce flows' `?redirect=` idiom (cart/PDP/checkout);
    // login.tsx honors same-origin internal paths only. The path is
    // read INSIDE the effect (not from the useLocation subscription) so
    // the redirect itself can't re-fire the effect and eat the target
    // (checkout.tsx:548 idiom, generalized).
    if (!token) {
      const { pathname, search } = window.location;
      navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
    }
  }, [token, navigate]);

  // R115 (A8 #4): the me-query failure branch — the identity card used
  // to render as `user ? card : null`: a failed /auth/me (retry:false)
  // silently vanished balance, points, referral code and tier with NO
  // error state and NO retry — the exact "money-datum silent vanish"
  // pattern 93-C5/F-05 fixed on wallet/loyalty/referrals/orders (see
  // wallet.tsx:~806). Outage ≠ empty: honest error card + retry.
  const {
    data: userData,
    isLoading,
    isError: meError,
    refetch: refetchMe,
  } = useGetMe({
    query: { enabled: !!token, retry: false, queryKey: getGetMeQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const user = userData as MeUser | undefined;

  // R115-A10: pause the identity card's drifting blob when the card
  // leaves the viewport (enabled re-arms the observer once /me lands
  // and the card mounts — the ref is null on the first effect run).
  const tierGlow = useOnScreen<HTMLDivElement>(!!user);

  // Fetch linked providers. Round-3 (8-f §6): no abort + a stale-response
  // race — a slow response from a previous token could land after a
  // logout/login flip and render the WRONG account's provider list.
  // AbortController + cancelled flag close the race. `providersVersion`
  // lets unlink/link handlers trigger a refetch without re-defining the
  // fetch function (the old pattern's missing dep).
  const [providersVersion, setProvidersVersion] = useState(0);
  const refetchProviders = useCallback(() => setProvidersVersion((v) => v + 1), []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      setLoadingProviders(true);
      setProvidersError(false);
      try {
        const res = await fetch("/api/auth/providers/linked", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setLinkedProviders(data.providers || []);
        } else {
          // 401/5xx — the list stays untouched (stale-but-real beats
          // fake-empty) and the explicit error card replaces the
          // link-your-account advice.
          setProvidersError(true);
        }
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          console.error("Failed to fetch linked providers:", err);
          if (!cancelled) setProvidersError(true);
        }
      } finally {
        if (!cancelled) setLoadingProviders(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [token, providersVersion]);

  const handleUnlinkProvider = async (provider: string, providerUid: string) => {
    // 96-F6 (R96 A2 P2-8): unlinking can lock the account out of its
    // only sign-in method — confirm first (destructive treatment), with
    // the provider named in the copy.
    const displayName = providerDisplayName(provider);
    const ok = await confirm({
      title: `فصل ${displayName}؟`,
      description:
        "لن تتمكن من الدخول عبر هذه الطريقة بعد الفصل. تأكد من بقاء طريقة دخول أخرى مرتبطة بحسابك قبل المتابعة.",
      confirmLabel: "فصل",
      cancelLabel: "إلغاء",
      destructive: true,
    });
    if (!ok) return;

    setUnlinkingProvider(providerUid);
    try {
      const res = await fetch("/api/auth/providers/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, provider_uid: providerUid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "فشل فصل مزود المصادقة");

      toast({ title: "تم فصل الحساب", description: `تم فصل ${displayName} بنجاح.` });
      await refetchProviders();
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        /* R124-I4 (A10 #7): the vague «فشلت العملية» fallback is below
           the app's error-copy bar — names the failed action + recovery,
           matching the R111-F2 family (loyalty.tsx / support.tsx). */
        description: err instanceof Error ? err.message : "تعذّر فصل الحساب — حاول مرة أخرى",
        variant: "destructive",
      });
    } finally {
      setUnlinkingProvider(null);
    }
  };

  const tier = user?.loyalty_tier ?? "bronze";
  // R122 (A1-P2): guests get the form-shaped RouteSkeleton instead of a
  // bare null — checkout.tsx's R115-I1 guard (the white frame between
  // the lazy-skeleton swap-out and the redirect tick read as a blank
  // page on slow links). Same "list-narrow" shape ROUTE_SHAPES maps
  // /profile to (R123-E4b: the page root is max-w-2xl), so the swap-in
  // is a content-fill, not a layout jump.
  if (!token) return <RouteSkeleton shape="list-narrow" />;

  return (
    <div className="max-w-2xl mx-auto px-4 py-7 page-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <User className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">حسابي</h1>
          <p className="text-xs text-muted-foreground">إدارة بيانات ومعلومات حسابك</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* ── User identity card ──────────────────────────────── */}
        {isLoading ? (
          <div className="rounded-2xl h-36 skeleton-shimmer border border-border/45" />
        ) : meError ? (
          /* R115 (A8 #4): a failed /auth/me probe must not quietly remove
             the identity card — same error-card idiom as the wallet
             balance card (93-C5 / F-05). */
          <FetchErrorCard
            size="section"
            title="تعذّر تحميل بيانات حسابك"
            description="حدث خطأ في الاتصال — رصيدك ونقاطك سليمة، أعد المحاولة لعرضهما"
            onRetry={() => void refetchMe()}
          />
        ) : user ? (
          <div
            ref={tierGlow.ref}
            className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-lg shadow-black/8 ${TIER_GRADIENTS[tier] ?? TIER_GRADIENTS.bronze}`}
          >
            <div className="absolute inset-0 dot-grid opacity-25 pointer-events-none" />
            <div
              className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-primary/7 blur-2xl pointer-events-none blob-drift"
              style={tierGlow.style}
            />

            <div className="relative flex items-start gap-4">
              {/* Avatar */}
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/8 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
                <span className="text-2xl font-bold text-primary select-none">
                  {/* Prefer first character of display_name (Telegram /
                      Google users). Fall back to last 2 phone digits
                      for legacy phone-only accounts. Avoid the literal
                      "tg_" prefix from showing through. */}
                  {user.display_name?.trim()?.charAt(0)?.toUpperCase() ||
                    (!user.phone?.startsWith("tg_") &&
                    !user.phone?.startsWith("fb_") &&
                    !user.phone?.startsWith("gh_")
                      ? (user.phone?.slice(-2) ?? "U")
                      : "U")}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                {/* Tier badge */}
                <div className="mb-2">
                  {/* R123-E4b (P3-g): the dead `style={{ color: "inherit" }}`
                      is gone — it overrode the tierColor class on the
                      OUTER span, so bg-current/8 + border-current/18
                      rendered with the INHERITED (neutral) currentColor
                      and the tier tint only ever reached the label text.
                      The class now drives currentColor for the whole
                      badge: tinted text + tinted bg/border. */}
                  <span
                    className={`text-2xs font-bold px-2.5 py-1 rounded-full border ${tierColor(tier)} bg-current/8 border-current/18`}
                  >
                    {tierLabel(tier)}
                  </span>
                </div>

                {/* Identity — display name OR phone OR provider label */}
                {user.display_name && (
                  <div className="text-sm font-bold mb-1.5 truncate">{user.display_name}</div>
                )}
                {/* R122 (A1-P3): the row used to carry dir="ltr" — correct
                    for the 09XXXXXXXX phone run, but it leaked onto the
                    Arabic Telegram branch and reversed its word order
                    («Telegram حساب» is what an RTL reader saw). The row
                    now inherits the page's RTL base; direction is scoped
                    per branch — the digit run stays LTR, and the Latin
                    brand token is isolated in its own LTR span (the
                    app's mixed-direction idiom, same shape as the
                    lang="en" spans on home's brand chips). */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                  {user.phone?.startsWith("tg_") ? (
                    <>
                      <Smartphone className="w-3 h-3" />
                      <span>
                        حساب{" "}
                        <span lang="en" dir="ltr">
                          Telegram
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <Phone className="w-3 h-3" />
                      <span dir="ltr">{user.phone}</span>
                    </>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-background/35 border border-border/30 rounded-xl px-3 py-2">
                    <div className="text-3xs text-muted-foreground mb-0.5 font-semibold">
                      الرصيد
                    </div>
                    {/* R124-I4 (A5 #1): money value rode the raw surface
                        token (3.93:1 dark — text-sm is not large text);
                        text-primary-text = the checkout totals idiom. */}
                    <div className="font-bold text-sm text-primary-text tabular-nums">
                      {formatCurrency(user.wallet_balance ?? 0)}
                    </div>
                  </div>
                  <div className="bg-background/35 border border-border/30 rounded-xl px-3 py-2">
                    <div className="text-3xs text-muted-foreground mb-0.5 font-semibold">
                      النقاط
                    </div>
                    <div className="font-bold text-sm text-status-warning tabular-nums flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      {user.loyalty_points ?? 0}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Referral code strip */}
            {user.referral_code && (
              <div className="relative mt-4 pt-3.5 border-t border-border/20 flex items-center justify-between gap-3">
                <div>
                  <div className="text-3xs text-muted-foreground font-semibold mb-0.5">
                    رمز الإحالة
                  </div>
                  {/* R122 (A1 P2-4): tracking-widest was a silent no-op — the
                      global Arabic letter-spacing guard (index.css:917)
                      zeroes the five tracking utilities app-wide, so the
                      SAME referral code rendered with 0.2em spacing on
                      /referrals and 0 here. Arbitrary form unified to
                      tracking-[0.2em] for LTR mono runs. */}
                  <div dir="ltr" className="font-mono font-bold tracking-[0.2em] text-sm text-left">
                    {user.referral_code}
                  </div>
                </div>
                <CopyButton text={user.referral_code} label="نسخ" />
              </div>
            )}
          </div>
        ) : null}

        {/* ── Quick links ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            {
              href: "/wallet",
              icon: Wallet,
              label: "المحفظة",
              color: "text-primary",
              bg: "bg-primary/10",
              border: "border-primary/20",
            },
            {
              href: "/orders",
              icon: Shield,
              label: "طلباتي",
              color: "text-status-info",
              bg: "bg-status-info/10",
              border: "border-status-info/20",
            },
            {
              href: "/loyalty",
              icon: Crown,
              label: "الولاء",
              color: "text-status-warning",
              bg: "bg-status-warning/10",
              border: "border-status-warning/20",
            },
            {
              href: "/referrals",
              icon: Gift,
              label: "الإحالات",
              color: "text-status-success",
              bg: "bg-status-success/10",
              border: "border-status-success/20",
            },
          ].map((item) => (
            <Link key={item.href} href={item.href}>
              <div
                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border bg-card hover:border-border/80 hover:shadow-md hover:shadow-black/8 hover:-translate-y-0.5 transition-all cursor-pointer group press-spring text-center ${item.border}`}
              >
                <div
                  className={`w-10 h-10 rounded-xl ${item.bg} border ${item.border} flex items-center justify-center group-hover:scale-105 transition-transform duration-200`}
                >
                  <item.icon className={`w-4.5 h-4.5 ${item.color}`} />
                </div>
                <span className="text-xs font-bold text-foreground/80">{item.label}</span>
                <ChevronLeft className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </Link>
          ))}
        </div>

        {/* ── Linked Accounts ─────────────────────────────────── */}
        <div className="bg-card border border-border/55 rounded-2xl p-5 float-in stagger-1">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
              <LinkIcon className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="font-bold">الحسابات المرتبطة</h2>
          </div>

          <div className="space-y-3">
            {!loadingProviders &&
              linkedProviders.map((id) => (
                <div
                  key={`${id.provider}-${id.providerUid}`}
                  className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/20"
                >
                  <div className="flex items-center gap-3">
                    {id.provider === "google.com" ? (
                      <Mail className="w-4 h-4 text-status-info" />
                    ) : id.provider === "firebase.com" ? (
                      <Smartphone className="w-4 h-4 text-status-success" />
                    ) : id.provider === "telegram.org" ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="#2AABEE"
                        aria-hidden="true"
                      >
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
                      </svg>
                    ) : (
                      <User className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="text-xs font-bold">{providerDisplayName(id.provider)}</div>
                      <div className="text-3xs text-muted-foreground">
                        {id.email || id.phone || id.providerUid}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-3xs bg-status-success/10 text-status-success px-2 py-0.5 rounded-full font-bold">
                      نشط
                    </div>
                    {/* 96-F6 (R96 A2 P2-8): unlink was a 24px unlabeled icon
                       that fired IMMEDIATELY — a destructive
                       account-security action (could lock the account out
                       of its only sign-in method). Now: 44px target +
                       visible «فصل» label + useConfirm (destructive) in
                       handleUnlinkProvider. */}
                    <button
                      type="button"
                      onClick={() => void handleUnlinkProvider(id.provider, id.providerUid)}
                      disabled={unlinkingProvider === id.providerUid}
                      aria-label={`فصل ${providerDisplayName(id.provider)}`}
                      className="h-11 min-w-11 px-3 rounded-xl text-xs font-bold text-muted-foreground hover:text-destructive hover:bg-destructive/8 hover:border-destructive/25 border border-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 press-spring"
                    >
                      {unlinkingProvider === id.providerUid ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Unlink className="w-4 h-4" />
                      )}
                      <span>فصل</span>
                    </button>
                  </div>
                </div>
              ))}

            {!loadingProviders && providersError && (
              /* R94-A1 #8: the fetch failed — show the failure, not the
                 «link your account» advice (that advice is false for a
                 user whose providers exist but didn't load). */
              <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-status-error/22 bg-status-error/8">
                <div className="flex items-center gap-2.5 min-w-0">
                  <AlertCircle className="w-4 h-4 text-status-error shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-status-error mb-0.5">
                      تعذّر تحميل الحسابات المرتبطة
                    </p>
                    <p className="text-3xs text-muted-foreground leading-relaxed">
                      حدث خطأ في الاتصال — حساباتك المرتبطة سليمة، أعد المحاولة لعرضها.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={refetchProviders}
                  className="shrink-0 text-xs font-bold text-status-error border border-status-error/25 px-3 py-1.5 rounded-xl hover:bg-status-error/10 transition-colors press-spring"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}

            {!loadingProviders &&
              !providersError &&
              linkedProviders.length === 0 &&
              !user?.linked_identities?.length && (
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      {/* R124-I4 (A5 #1): 11px bold heading on the raw
                          surface token — text-primary-text (AA-safe). */}
                      <div className="text-xs font-bold text-primary-text mb-1">حماية حسابك</div>
                      <div className="text-3xs text-muted-foreground leading-relaxed">
                        اربط حسابك بطريقة دخول إضافية (Google، رقم الهاتف، أو Telegram) لتسهيل
                        الوصول وحماية حسابك إذا فقدت إحدى الطرق.
                      </div>
                    </div>
                  </div>
                </div>
              )}

            {/* Link-more block — single source of truth. Renders the
                provider link buttons that aren't already in the
                linkedProviders list. Telegram appears automatically
                via AuthProviders when admin enables it. */}
            {!loadingProviders && linkedProviders.length < 2 && (
              <div className="pt-1 space-y-2">
                {!linkedProviders.find((i) => i.provider === "google.com") && (
                  <AuthProviders
                    /* R122 (A1 P2-7): h-9 (36px) → h-11 — the component's
                       own default (AuthProviders.tsx) and the app's 44px
                       tap-target floor; this was the only sub-floor
                       override in the app. */
                    buttonClassName="w-full h-11 text-xs rounded-lg border border-border/60 bg-background"
                    onSuccess={() => {
                      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
                      refetchProviders();
                    }}
                  />
                )}
                {/* Linking a new phone via Firebase Phone OTP was removed
                    when that flow was permanently retired. Existing users
                    with a "firebase.com" identity continue to display
                    above; no new ones can be created. */}
              </div>
            )}
          </div>
        </div>

        {/* ── Session Management ───────────────────────────────── */}
        <SessionManager />

        {/* ── Security Options ────────────────────────────────── */}

        {/* ── Danger zone ─────────────────────────────────────── */}
        <div className="bg-card border border-border/55 rounded-2xl p-5 float-in stagger-3">
          {/* 96-F6 (R96 A6 #1, profile.tsx site): uppercase + tracking-wider
              removed — letter-spacing breaks Arabic letter joining (the
              header text «خيارات الحساب» is Arabic; the classes were a
              Latin design-system carry-over). */}
          <h2 className="font-bold text-xs text-muted-foreground mb-3">خيارات الحساب</h2>
          <Button
            variant="outline"
            onClick={() => {
              logout();
              navigate("/");
            }}
            /* R124-I4 (A4 F1): h-10 (40px) → min-h-11 — the 44px floor
               every sibling control here already rides (destructive-ish
               account action on a mobile-visible page). */
            className="w-full min-h-11 border-destructive/25 text-destructive hover:bg-destructive/7 hover:border-destructive/45 font-bold transition-all rounded-xl gap-2"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </Button>
        </div>

        <div className="h-4 md:h-0" />
      </div>

      {/* 96-F6 (R96 A2 P2-8): the useConfirm dialog instance — one mount,
          reused for every unlink confirmation. */}
      <ConfirmDialog />
    </div>
  );
}
