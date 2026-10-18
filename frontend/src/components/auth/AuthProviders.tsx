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
import { getErrorMessage } from "@/lib/errors";
import { fetchPublicAuthProviders } from "@/hooks/usePublicAuthProviders";
import { Skeleton } from "@/components/ui/Skeleton";
// R167-C (F19): LinkConsentModal stayed at the components root (the
// shared chrome family) when this component moved into components/auth/
// — the sibling import became a parent one. TelegramLoginButton moved
// WITH it, so that sibling import is unchanged.
import { LinkConsentModal } from "../LinkConsentModal";
import { TelegramLoginButton } from "./TelegramLoginButton";
// R167-C (F17): the brand glyphs (byte-identical paths) live in
// components/brand/ now — this file previously hand-drew both.
import { GoogleGlyph } from "@/components/brand/GoogleGlyph";
import { TelegramGlyph } from "@/components/brand/TelegramGlyph";

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
  /** R154 (P2): true when the operator configured BotFather's OIDC
   *  Client ID + Secret — the modern Authorization Code + PKCE flow
   *  replaces the legacy widget redirect for THIS deployment. */
  oidc_enabled?: boolean;
}

// ── Provider Icons ─────────────────────────────────────────────────────────────
// R167-C (F17): google/telegram ride the shared brand glyphs
// (components/brand/) — the default 18px matches the pre-extraction
// inline SVGs byte-for-byte. Apple stays a local single-site icon.

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.54 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z" />
    </svg>
  );
}

const ICONS: Record<string, () => ReactElement> = {
  google: GoogleGlyph,
  telegram: TelegramGlyph,
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
      // R148 (error-copy sweep): raw extractor leaked ApiError's
      // "HTTP 4xx …" prefix into this Arabic error slot — routed through
      // getErrorMessage (the R144-C1 profile.tsx idiom; server Arabic
      // passes, technical English collapses to Arabic network copy).
      onError(getErrorMessage(err) || "حدث خطأ غير متوقع");
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
  // R157: whether the /api/auth/providers round-trip settled (success OR
  // error). While it runs, a skeleton row reserves the next provider's
  // slot — Telegram used to pop the card taller ~100-800ms after paint
  // (the first screen every guest sees).
  const [settled, setSettled] = useState(false);
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
        // R145 (D7 honesty): renderableProviders() (see its block comment)
        // drops the rows this client cannot honestly present as available —
        // the API's client_side Google row is dead without the Firebase env.
        // Applied BEFORE includeFirebaseGoogleProvider so the seed-vs-row
        // precedence is unchanged: Firebase configured ⇒ the API row is
        // renderable and the seed skips (id collision); not configured ⇒
        // the row drops and the seed is a no-op anyway.
        setProviders(includeFirebaseGoogleProvider(renderableProviders(d.providers as Provider[])));
        setSettled(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSettled(true);
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
      // R148 (error-copy sweep): same class as :211 — getErrorMessage maps
      // the consent-path codes (EXPIRED / CANDIDATE_MISMATCH /
      // FIREBASE_UID_MISMATCH) to their Arabic copy instead of the raw
      // HTTP-prefixed message.
      setError(getErrorMessage(err) || "تعذّر إكمال ربط الحساب");
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
    // R157: no seed either (Firebase unconfigured) — two skeleton rows
    // hold the card's height while the fetch runs, instead of a dead
    // zone that grows when the server list lands.
    if (!settled) {
      return (
        <div className="space-y-2.5" aria-busy="true">
          <Skeleton className="h-11 rounded-xl border border-border/60" />
          <Skeleton className="h-11 rounded-xl border border-border/60" />
        </div>
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
              /* R154 (P2): the modern OIDC transport when the operator
                 configured BotFather's OIDC credentials — phone-free
                 registration by design; the legacy widget redirect
                 stays the fallback until then. */
              oidc={!!provider.oidc_enabled}
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
      {/* R157: while the providers round-trip runs, one skeleton row
          reserves the next slot (Telegram arrives from the server list
          after the seeded Google button) — the auth card stopped
          popping taller after paint. */}
      {!settled && <Skeleton className="h-11 rounded-xl border border-border/60" />}
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
