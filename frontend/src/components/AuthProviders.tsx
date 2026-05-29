import { useAuth } from "@/lib/auth";
import { isFirebaseAuthConfigured } from "@/lib/firebase";
import { exchangeFirebaseIdToken, signInWithFirebaseGoogle } from "@/lib/firebase-auth";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useLocation } from "wouter";
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

function getReferralCodeFromUrl() {
  return new URLSearchParams(window.location.search).get("ref")?.toUpperCase() ?? undefined;
}

// ── Single provider button ─────────────────────────────────────────────────────

function ProviderButton({
  provider,
  onSuccess,
  onError,
  className,
}: {
  provider: Provider;
  onSuccess: (token: string) => void;
  onError: (msg: string) => void;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const Icon = ICONS[provider.icon] ?? (() => null);

  const handle = async () => {
    setLoading(true);
    try {
      if (provider.auth_type === "oauth_redirect") {
        window.location.href = `/api/auth/${provider.id}`;
        return;
      }

      if (provider.id === "google") {
        if (!isFirebaseAuthConfigured()) {
          onError("خدمة Firebase Google غير مفعلة حالياً");
          return;
        }

        const credential = await signInWithFirebaseGoogle();
        const idToken = await credential.user.getIdToken();
        const session = await exchangeFirebaseIdToken(idToken, getReferralCodeFromUrl());
        onSuccess(session.token);
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
        "w-full h-11 flex items-center justify-center gap-3 border border-border/60 rounded-xl bg-card hover:bg-muted/50 hover:border-border transition-all duration-150 active:scale-[0.97] font-medium text-sm disabled:opacity-60 press-spring"
      }
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon />}
      {loading ? "جارٍ التحقق..." : `المتابعة عبر ${provider.label}`}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface AuthProvidersProps {
  onSuccess?: (token: string) => void;
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
  const [providers, setProviders] = useState<Provider[]>(() =>
    includeFirebaseGoogleProvider([]),
  );
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d) => setProviders(includeFirebaseGoogleProvider(d.providers ?? [])))
      .catch(() => {
        if (isFirebaseAuthConfigured()) {
          setProviders([firebaseGoogleProvider()]);
        }
      });
  }, []);

  const handleSuccess = useCallback(
    (token: string) => {
      setToken(token);
      if (onSuccess) onSuccess(token);
      else navigate("/");
    },
    [setToken, onSuccess, navigate],
  );

  if (providers.length === 0) return null;

  return (
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
            className={buttonClassName}
          />
        );
      })}
      {error && <p className="text-xs text-destructive text-center pt-1">{error}</p>}
    </div>
  );
}
