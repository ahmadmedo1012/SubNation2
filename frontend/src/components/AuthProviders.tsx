import { useAuth } from "@/lib/auth";
import { isFirebaseAuthConfigured } from "@/lib/firebase";
import {
  FirebaseLinkConsentRequiredError,
  exchangeFirebaseIdToken,
  signInWithFirebaseGoogle,
  type LinkConsentCandidateHint,
} from "@/lib/firebase-auth";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useLocation } from "wouter";
import { apiUrl } from "@/lib/api-config";
import { fetchPublicAuthProviders } from "@/hooks/use-public-auth-providers";
import { LinkConsentModal } from "./LinkConsentModal";
import { TelegramLoginButton } from "./TelegramLoginButton";

export interface Provider {
  id: string;
  label: string;
  color: string;
  icon: string;
  auth_type: "client_side" | "oauth_redirect" | "widget";
  enabled: boolean;
  has_config: boolean;
  client_id?: string;
  app_id?: string;
  bot_username?: string;
  /** Numeric prefix of the bot token, parsed server-side. Required to
   *  build the OAuth redirect URL without exposing the full token. */
  bot_id?: string | null;
}

// ── Provider Icons ─────────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#2AABEE">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.54 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z" />
    </svg>
  );
}

const ICONS: Record<string, () => ReactElement> = {
  google: GoogleIcon,
  telegram: TelegramIcon,
  apple: AppleIcon,
};

function firebaseGoogleProvider(): Provider {
  return {
    id: "google",
    label: "Google",
    color: "#4285F4",
    icon: "google",
    auth_type: "client_side",
    enabled: true,
    has_config: true,
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  };
}

function includeFirebaseGoogleProvider(providers: Provider[]) {
  if (!isFirebaseAuthConfigured()) return providers;
  if (providers.some((provider) => provider.id === "google")) return providers;
  return [firebaseGoogleProvider(), ...providers];
}

/* R145 (D7 honesty): the renderability gate. /api/auth/providers returns
 * per-provider `enabled` + `has_config` (backend filters !enabled ||
 * !has_config server-side, auth-settings.ts) — but TWO rows can still be
 * lies at RENDER time:
 *   1. a row the backend stops filtering (or a stale 60s-cached response
 *      mid-config-change) with enabled/has_config falsy must never paint
 *      as an available option — the API contract is honored client-side
 *      too, not trusted blindly;
 *   2. a client_side Google row (live today: enabled=true, has_config=
 *      true from the DB's firebase_enabled flag, client_id=null) is only
 *      ACTIONABLE when THIS build carries the VITE_FIREBASE_* env — the
 *      live login renders it as a normal button and the click dies in
 *      ProviderButton's «Firebase Google غير مفعلة» arm. The live VLM
 *      audit (D7) read exactly that dead button as a co-equal primary.
 *      Rendering only what this client can execute = the honest list.
 *      oauth_redirect rows (apple) stay — the SERVER executes those, the
 *      backend's enabled+has_config filter is their full truth. The
 *      click-time guard in ProviderButton stays as defense-in-depth for
 *      any path this filter doesn't own. */
function renderableProviders(providers: Provider[]): Provider[] {
  return providers.filter((provider) => {
    if (provider.enabled === false || provider.has_config === false) return false;
    if (provider.id === "google" && provider.auth_type === "client_side") {
      return isFirebaseAuthConfigured();
    }
    return true;
  });
}

function getReferralCodeFromUrl() {
  return new URLSearchParams(window.location.search).get("ref")?.toUpperCase() ?? undefined;
}

// ── Single provider button ─────────────────────────────────────────────────────

function ProviderButton({
  provider,
  onSuccess,
  onError,
  onLinkConsentRequired,
  className,
}: {
  provider: Provider;
  // L1-1 (R143): the second arg is the session mint's is_new_user —
  // threaded so the default no-onSuccess navigation can route a
  // brand-new user to /onboarding instead of /.
  onSuccess: (token: string, isNewUser?: boolean) => void;
  // R111-F2 N4: ReactNode (not string) so the message can carry
  // <span lang="en"> brand wrapping — see the Firebase-Google fallback
  // below. `string` remains fully assignable at every other call-site.
  onError: (msg: ReactNode) => void;
  /**
   * F-003 (security audit 004) — invoked when the backend returns
   * 409 with reason="link_consent_required". The parent renders a
   * confirmation modal and, on confirm, re-runs the exchange with
   * the consent token.
   */
  onLinkConsentRequired: (ctx: {
    idToken: string;
    referralCode?: string;
    linkToken: string;
    hint: LinkConsentCandidateHint;
  }) => void;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const Icon = ICONS[provider.icon] ?? (() => null);

  const handle = async () => {
    setLoading(true);
    try {
      if (provider.auth_type === "oauth_redirect") {
        window.location.href = apiUrl(`/api/auth/${provider.id}`);
        return;
      }

      if (provider.id === "google") {
        if (!isFirebaseAuthConfigured()) {
          // R111-F2 N4: Latin brand names wrapped in lang="en" (same
          // treatment as WhatsApp across the auth surfaces).
          onError(
            <>
              خدمة <span lang="en">Firebase Google</span> غير مفعلة حالياً
            </>,
          );
          return;
        }

        const credential = await signInWithFirebaseGoogle();
        const idToken = await credential.user.getIdToken();
        const referralCode = getReferralCodeFromUrl();
        try {
          const session = await exchangeFirebaseIdToken(idToken, referralCode);
          onSuccess(session.token, session.is_new_user === true);
        } catch (err) {
          // F-003 — escalate to the parent so the modal can render.
          // The idToken stays in the closure; parent calls back with
          // the link token on confirm.
          if (err instanceof FirebaseLinkConsentRequiredError) {
            onLinkConsentRequired({
              idToken,
              referralCode,
              linkToken: err.linkToken,
              hint: err.candidateHint,
            });
            return;
          }
          throw err;
        }
        return;
      }
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handle}
      disabled={loading}
      className={
        className ??
        "w-full h-11 flex items-center justify-center gap-3 border border-border/60 rounded-xl bg-card hover:bg-muted/50 hover:border-border transition-all duration-150 active:scale-[0.97] font-semibold text-sm disabled:opacity-60 press-spring"
      }
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon />}
      {/* R123-E4b (P3-k): single-glyph ellipsis «…» (was ASCII "..."). */}
      {loading ? "جارٍ التحقق…" : `المتابعة عبر ${provider.label}`}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface AuthProvidersProps {
  // L1-1 (R143): the second arg is the session mint's is_new_user —
  // a page-level onSuccess can route brand-new users to /onboarding
  // (an explicit redirect target keeps precedence on the page side).
  onSuccess?: (token: string, isNewUser?: boolean) => void;
  buttonClassName?: string;
  dividerLabel?: string;
}

export function AuthProviders({ onSuccess, buttonClassName, dividerLabel }: AuthProvidersProps) {
  const { setToken } = useAuth();
  const [, navigate] = useLocation();
  // Seed with the synchronously-known Firebase Google provider so its
  // (inline-SVG) button paints on first render — before the
  // /api/auth/providers round-trip resolves. The fetch below then merges
  // the full server list (Telegram, etc.) in place.
  const [providers, setProviders] = useState<Provider[]>(() => includeFirebaseGoogleProvider([]));
  // R111-F2 N4: ReactNode so the Firebase-Google fallback message can
  // carry the <span lang="en"> brand wrapping.
  const [error, setError] = useState<ReactNode>("");
  // F-003 (security audit 004) — consent-modal state. When the
  // backend returns 409 reason=link_consent_required, we capture the
  // pending exchange + link token + masked hint and render the modal.
  // On confirm, we re-call exchangeFirebaseIdToken with the token; on
  // cancel, we reset and let the user try a different provider.
  const [pendingLink, setPendingLink] = useState<{
    idToken: string;
    referralCode?: string;
    linkToken: string;
    hint: LinkConsentCandidateHint;
  } | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    // 98-F7 (r97 F-11 raw-fetch hardening): r.ok checked BEFORE parsing
    // and the body shape validated — an error envelope (401/503 JSON) used
    // to parse "successfully" into an object without `providers`, which
    // silently degraded to the Firebase-only seed; a 503 HTML page used to
    // throw out of the .then chain. Kept raw fetch (no customFetch
    // migration): this is a public, credential-free endpoint whose failure
    // has a dedicated degraded path below.
    let cancelled = false;
    // R104 (AG2-5): shared single-flight — the page-level WhatsApp-status
    // hook consumes the SAME request (one /api/auth/providers hit per
    // auth-page view, was two). Same raw-fetch hardening contract as
    // before (r.ok / shape checked before state lands).
    fetchPublicAuthProviders()
      .then((d) => {
        if (cancelled) return;
        if (!d || !Array.isArray(d.providers)) throw new Error("PROVIDERS_BAD_SHAPE");
        if (!Array.isArray(d?.providers)) throw new Error("PROVIDERS_BAD_SHAPE");
        // R145 (D7 honesty): renderableProviders() (see its block comment)
        // drops the rows this client cannot honestly present as available —
        // the API's client_side Google row is dead without the Firebase env.
        // Applied BEFORE includeFirebaseGoogleProvider so the seed-vs-row
        // precedence is unchanged: Firebase configured ⇒ the API row is
        // renderable and the seed skips (id collision); not configured ⇒
        // the row drops and the seed is a no-op anyway.
        setProviders(includeFirebaseGoogleProvider(renderableProviders(d.providers as Provider[])));
      })
      .catch(() => {
        if (cancelled) return;
        // Offline / outage: the synchronously-seeded Firebase Google button
        // still works as the degraded single-provider list (unchanged UX).
        if (isFirebaseAuthConfigured()) {
          setProviders([firebaseGoogleProvider()]);
        } else {
          // Nothing renderable at all — an honest Arabic fallback instead
          // of a silent dead zone under the password form (the component
          // previously returned null and the user never knew why).
          setError("تعذّر تحميل طرق تسجيل الدخول — تحقّق من اتصالك ثم أعد المحاولة");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSuccess = useCallback(
    (token: string, isNewUser?: boolean) => {
      setToken(token);
      // L1-1 (R143): the orphaned onboarding journey — the backend has
      // returned is_new_user from every session mint since the page was
      // built, but no success path consumed it, so /onboarding (route +
      // complete endpoint + gates all shipped) was unreachable and the
      // welcome/value-prop surface never met a new user. The default
      // navigation now routes a brand-new user there; a page-level
      // onSuccess (an explicit ?redirect= target) keeps full precedence
      // — onboarding only when the user asked for no specific page. The
      // page itself bounces already-onboarded users home, so re-entry is
      // safe on every path.
      if (onSuccess) onSuccess(token, isNewUser);
      else navigate(isNewUser ? "/onboarding" : "/");
    },
    [setToken, onSuccess, navigate],
  );

  const handleConsentConfirm = useCallback(async () => {
    if (!pendingLink || linking) return;
    setLinking(true);
    setError("");
    try {
      const session = await exchangeFirebaseIdToken(
        pendingLink.idToken,
        pendingLink.referralCode,
        pendingLink.linkToken,
      );
      // Drop modal state BEFORE handleSuccess navigates away.
      setPendingLink(null);
      // L1-1 (R143): thread is_new_user — the link-consent commit links
      // an EXISTING account, so this is normally false; the honest value
      // rides either way.
      handleSuccess(session.token, session.is_new_user === true);
    } catch (err: unknown) {
      // The consent-token path can fail with EXPIRED / CANDIDATE_MISMATCH /
      // FIREBASE_UID_MISMATCH. Either way we close the modal and surface
      // the message; the user re-clicks the provider to start over.
      setPendingLink(null);
      setError(err instanceof Error ? err.message : "تعذّر إكمال ربط الحساب");
    } finally {
      setLinking(false);
    }
  }, [pendingLink, linking, handleSuccess]);

  const handleConsentCancel = useCallback(() => {
    if (linking) return;
    setPendingLink(null);
  }, [linking]);

  if (providers.length === 0) {
    // 98-F7: a failed providers load with no Firebase fallback renders the
    // honest Arabic error instead of a silent empty fragment (the previous
    // `return null` left a dead zone with zero explanation).
    if (error) {
      return (
        <p role="alert" className="text-xs text-destructive text-center pt-1">
          {error}
        </p>
      );
    }
    return null;
  }

  return (
    // R139 (b): the provider-stack seam stays 2.5 (10px) — pinned, not
    // drift-left. WHY: (1) the provider FAMILY extends across this
    // component's boundary — login.tsx/register.tsx wrap the WhatsApp
    // peer button at mt-2.5, so the rendered group reads [Google 10px
    // Telegram 10px WhatsApp]; widening only the intra-component seam to
    // space-y-3 would step that family 12/10 — the exact r138-g refusal
    // ("would have created 10/10/12 drift"), inverted. Moving all three
    // seams in lockstep is a page-lane decision, not this component's.
    // (2) The auth card's mb-4 (16px) rhythm separates SECTIONS (value
    // banner → auth methods); a run of same-height (h-11) same-register
    // peer buttons is ONE section, and the repo's within-family row band
    // is 2.5/3 (28 / 46 space-y hits) — 10px keeps the three buttons
    // reading as a single choice cluster instead of three separate CTAs.
    // (3) The audit's flag-word was "uniform but narrow": the uniformity
    // is the property worth keeping; 2px of air is not worth family
    // drift. Register audit same round: ProviderButton / TelegramLogin
    // Button / the WhatsApp pristine button share a byte-identical
    // resting register (border-border/60, h-11, hover:bg-muted/50 +
    // hover:border-border, press-spring + active:scale-[0.97]) — no real
    // drift found, nothing "fixed" by taste.
    <div className="space-y-2.5">
      {dividerLabel && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-xs text-muted-foreground">{dividerLabel}</span>
          <div className="flex-1 h-px bg-border/50" />
        </div>
      )}
      {providers.map((provider) => {
        if (provider.id === "telegram" && provider.bot_id) {
          return (
            <TelegramLoginButton
              key={provider.id}
              botId={provider.bot_id}
              botUsername={provider.bot_username}
              onSuccess={handleSuccess}
              onError={setError}
            />
          );
        }
        return (
          <ProviderButton
            key={provider.id}
            provider={provider}
            onSuccess={handleSuccess}
            onError={setError}
            onLinkConsentRequired={setPendingLink}
            className={buttonClassName}
          />
        );
      })}
      {error && (
        <p role="alert" className="text-xs text-destructive text-center pt-1">
          {error}
        </p>
      )}
      {pendingLink && (
        <LinkConsentModal
          hint={pendingLink.hint}
          loading={linking}
          onConfirm={handleConsentConfirm}
          onCancel={handleConsentCancel}
        />
      )}
    </div>
  );
}
