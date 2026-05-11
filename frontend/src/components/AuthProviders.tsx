import { useAuth } from "@/lib/auth";
import { isFirebaseAuthConfigured } from "@/lib/firebase";
import { exchangeFirebaseIdToken, signInWithFirebaseGoogle } from "@/lib/firebase-auth";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useLocation } from "wouter";

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

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
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
  github: GitHubIcon,
  facebook: FacebookIcon,
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

// ── Google client-side login helper ───────────────────────────────────────────

function requestGoogleCredential(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const init = () => {
      (window as any).google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: any) => {
          if (response.credential) resolve(response.credential);
          else reject(new Error("لم يتم إكمال تسجيل الدخول"));
        },
        cancel_on_tap_outside: true,
      });
      (window as any).google.accounts.id.prompt((n: any) => {
        if (n.isSkippedMoment() || n.isDismissedMoment()) {
          reject(new Error("تم إلغاء تسجيل الدخول"));
        }
      });
    };

    if ((window as any).google?.accounts?.id) {
      init();
    } else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.onload = init;
      script.onerror = () => reject(new Error("تعذّر تحميل مكتبة Google"));
      document.head.appendChild(script);
    }
  });
}

// ── Telegram Widget helper ─────────────────────────────────────────────────────

function openTelegramLogin(botUsername: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("انتهت مهلة تسجيل Telegram")), 120_000);

    (window as any).__tgLoginCallback = (data: Record<string, string>) => {
      clearTimeout(timeout);
      delete (window as any).__tgLoginCallback;
      resolve(data);
    };

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.dataset.telegramLogin = botUsername;
    script.dataset.size = "large";
    script.dataset.onauth = "__tgLoginCallback(user)";
    script.dataset.requestAccess = "write";
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("تعذّر تحميل مكتبة Telegram"));
    };

    const container = document.createElement("div");
    container.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    container.appendChild(script);
    document.body.appendChild(container);
    setTimeout(() => document.body.removeChild(container), 5000);
  });
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
        // Redirect to backend OAuth start URL — no async needed
        window.location.href = `/api/auth/${provider.id}`;
        return;
      }

      if (provider.id === "google") {
        if (isFirebaseAuthConfigured()) {
          const credential = await signInWithFirebaseGoogle();
          const session = await exchangeFirebaseIdToken(
            await credential.user.getIdToken(),
            getReferralCodeFromUrl(),
          );
          onSuccess(session.token);
          return;
        }

        const clientId = provider.client_id ?? import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!clientId) {
          onError("لم يتم إعداد Google Client ID");
          return;
        }
        const credential = await requestGoogleCredential(clientId);
        const res = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "فشل التحقق من Google");
        onSuccess(data.token);
        return;
      }

      if (provider.id === "telegram") {
        if (!provider.bot_username) {
          onError("لم يتم إعداد بوت Telegram");
          return;
        }
        const userData = await openTelegramLogin(provider.bot_username);
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(userData),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "فشل تسجيل الدخول عبر Telegram");
        onSuccess(data.token);
        return;
      }
    } catch (err: any) {
      onError(err.message ?? "حدث خطأ غير متوقع");
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
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState("");
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d) => setProviders(includeFirebaseGoogleProvider(d.providers ?? [])))
      .catch(() => {
        // Fallback: if env var is set, show Google
        if (import.meta.env.VITE_GOOGLE_CLIENT_ID || isFirebaseAuthConfigured()) {
          setProviders([firebaseGoogleProvider()]);
        }
      })
      .finally(() => setFetched(true));
  }, []);

  const handleSuccess = useCallback(
    (token: string) => {
      setToken(token);
      if (onSuccess) onSuccess(token);
      else navigate("/");
    },
    [setToken, onSuccess, navigate],
  );

  if (!fetched || providers.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {dividerLabel && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-xs text-muted-foreground/60">{dividerLabel}</span>
          <div className="flex-1 h-px bg-border/50" />
        </div>
      )}
      {providers.map((provider) => (
        <ProviderButton
          key={provider.id}
          provider={provider}
          onSuccess={handleSuccess}
          onError={setError}
          className={buttonClassName}
        />
      ))}
      {error && <p className="text-xs text-destructive text-center pt-1">{error}</p>}
    </div>
  );
}
