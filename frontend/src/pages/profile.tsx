import { AuthProviders } from "@/components/AuthProviders";
import { CopyButton } from "@/components/CopyButton";
import { FirebasePhoneSignIn } from "@/components/FirebasePhoneSignIn";
import { SessionManager } from "@/components/SessionManager";
import { Button } from "@/components/ui/button";
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
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";

const TIER_GRADIENTS: Record<string, string> = {
  bronze: "from-amber-600/14 via-card to-card border-amber-600/20",
  silver: "from-slate-400/14 via-card to-card border-slate-400/20",
  gold: "from-yellow-400/14 via-card to-card border-yellow-400/20",
  platinum: "from-cyan-400/14 via-card to-card border-cyan-400/20",
};

type ProfileUser = MeUser & {
  linked_identities?: Array<{ provider: string; provider_uid?: string }>;
  firebase_uid?: string | null;
  display_name?: string | null;
};

export default function ProfilePage() {
  const { token, logout } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [linkedProviders, setLinkedProviders] = useState<any[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token, navigate]);

  const { data: userData, isLoading } = useGetMe({
    query: { enabled: !!token, retry: false, queryKey: getGetMeQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const user = userData as ProfileUser | undefined;

  // Fetch linked providers
  useEffect(() => {
    if (token) {
      fetchLinkedProviders();
    }
  }, [token]);

  const fetchLinkedProviders = async () => {
    setLoadingProviders(true);
    try {
      const res = await fetch("/api/auth/providers/linked", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setLinkedProviders(data.providers || []);
      }
    } catch (err) {
      console.error("Failed to fetch linked providers:", err);
    } finally {
      setLoadingProviders(false);
    }
  };

  const handleUnlinkProvider = async (provider: string, providerUid: string) => {
    setUnlinkingProvider(providerUid);
    try {
      const res = await fetch("/api/auth/providers/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, provider_uid: providerUid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "فشل فصل مزود المصادقة");

      toast({ title: "تم فصل الحساب", description: "تم فصل مزود المصادقة بنجاح." });
      await fetchLinkedProviders();
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشلت العملية",
        variant: "destructive",
      });
    } finally {
      setUnlinkingProvider(null);
    }
  };

  const tier = user?.loyalty_tier ?? "bronze";
  if (!token) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-7 page-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <User className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-black">حسابي</h1>
          <p className="text-xs text-muted-foreground">إدارة بيانات ومعلومات حسابك</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* ── User identity card ──────────────────────────────── */}
        {isLoading ? (
          <div className="rounded-2xl h-36 skeleton-shimmer border border-border/45" />
        ) : user ? (
          <div
            className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-lg shadow-black/8 ${TIER_GRADIENTS[tier] ?? TIER_GRADIENTS.bronze}`}
          >
            <div className="absolute inset-0 dot-grid opacity-25 pointer-events-none" />
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-primary/7 blur-2xl pointer-events-none blob-drift" />

            <div className="relative flex items-start gap-4">
              {/* Avatar */}
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/8 border border-primary/20 flex items-center justify-center shrink-0 shadow-inner">
                <span className="text-2xl font-black text-primary select-none">
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
                  <span
                    className={`text-[11px] font-black px-2.5 py-1 rounded-full border ${tierColor(tier)} bg-current/8 border-current/18`}
                    style={{ color: "inherit" }}
                  >
                    <span className={tierColor(tier)}>{tierLabel(tier)}</span>
                  </span>
                </div>

                {/* Identity — display name OR phone OR provider label */}
                {user.display_name && (
                  <div className="text-sm font-bold mb-1.5 truncate">{user.display_name}</div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3" dir="ltr">
                  {user.phone?.startsWith("tg_") ? (
                    <>
                      <Smartphone className="w-3 h-3" />
                      <span>حساب Telegram</span>
                    </>
                  ) : (
                    <>
                      <Phone className="w-3 h-3" />
                      <span>{user.phone}</span>
                    </>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-background/35 border border-border/30 rounded-xl px-3 py-2">
                    <div className="text-[10px] text-muted-foreground mb-0.5 font-medium">
                      الرصيد
                    </div>
                    <div className="font-black text-sm text-primary tabular-nums">
                      {formatCurrency(user.wallet_balance ?? 0)}
                    </div>
                  </div>
                  <div className="bg-background/35 border border-border/30 rounded-xl px-3 py-2">
                    <div className="text-[10px] text-muted-foreground mb-0.5 font-medium">
                      النقاط
                    </div>
                    <div className="font-black text-sm text-yellow-400 tabular-nums flex items-center gap-1">
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
                  <div className="text-[10px] text-muted-foreground font-medium mb-0.5">
                    رمز الإحالة
                  </div>
                  <div className="font-mono font-black tracking-widest text-sm">
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
              color: "text-blue-400",
              bg: "bg-blue-400/10",
              border: "border-blue-400/20",
            },
            {
              href: "/loyalty",
              icon: Crown,
              label: "الولاء",
              color: "text-yellow-400",
              bg: "bg-yellow-400/10",
              border: "border-yellow-400/20",
            },
            {
              href: "/referrals",
              icon: Gift,
              label: "الإحالات",
              color: "text-emerald-400",
              bg: "bg-emerald-400/10",
              border: "border-emerald-400/20",
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
            <h2 className="font-black">الحسابات المرتبطة</h2>
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
                      <Mail className="w-4 h-4 text-blue-400" />
                    ) : id.provider === "firebase.com" ? (
                      <Smartphone className="w-4 h-4 text-emerald-400" />
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
                      <div className="text-xs font-bold">
                        {id.provider === "google.com"
                          ? "Google"
                          : id.provider === "firebase.com"
                            ? "رقم الهاتف"
                            : id.provider === "telegram.org"
                              ? "Telegram"
                              : id.provider}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {id.email || id.phone || id.providerUid}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded-full font-bold">
                      نشط
                    </div>
                    <button
                      onClick={() => handleUnlinkProvider(id.provider, id.providerUid)}
                      disabled={unlinkingProvider === id.providerUid}
                      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 disabled:cursor-not-allowed p-1"
                      title="فصل الحساب"
                    >
                      {unlinkingProvider === id.providerUid ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Unlink className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}

            {!loadingProviders &&
              linkedProviders.length === 0 &&
              !user?.linked_identities?.length && (
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-black text-primary mb-1">حماية حسابك</div>
                      <div className="text-[10px] text-muted-foreground leading-relaxed">
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
                    buttonClassName="w-full h-9 text-xs rounded-lg border border-border/60 bg-background"
                    onSuccess={() => {
                      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
                      fetchLinkedProviders();
                    }}
                  />
                )}
                {!linkedProviders.find((i) => i.provider === "firebase.com") && (
                  <FirebasePhoneSignIn />
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Session Management ───────────────────────────────── */}
        <SessionManager />

        {/* ── Security Options ────────────────────────────────── */}

        {/* ── Danger zone ─────────────────────────────────────── */}
        <div className="bg-card border border-border/55 rounded-2xl p-5 float-in stagger-3">
          <h2 className="font-black text-xs text-muted-foreground mb-3 uppercase tracking-wider">
            خيارات الحساب
          </h2>
          <Button
            variant="outline"
            onClick={() => {
              logout();
              navigate("/");
            }}
            className="w-full h-10 border-destructive/25 text-destructive hover:bg-destructive/7 hover:border-destructive/45 font-bold transition-all rounded-xl gap-2"
          >
            <LogOut className="w-4 h-4" />
            تسجيل الخروج
          </Button>
        </div>

        <div className="h-4 md:h-0" />
      </div>
    </div>
  );
}
