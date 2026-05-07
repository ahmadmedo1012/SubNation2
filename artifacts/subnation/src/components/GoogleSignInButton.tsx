import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";

function requestGoogleCredential(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!(window as any).google?.accounts?.id) {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.onload = () => initAndPrompt();
      script.onerror = () => reject(new Error("تعذّر تحميل مكتبة Google"));
      document.head.appendChild(script);
    } else {
      initAndPrompt();
    }

    function initAndPrompt() {
      (window as any).google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: any) => {
          if (response.credential) resolve(response.credential);
          else reject(new Error("لم يتم إكمال تسجيل الدخول"));
        },
        cancel_on_tap_outside: true,
      });
      (window as any).google.accounts.id.prompt((notification: any) => {
        if (notification.isSkippedMoment() || notification.isDismissedMoment()) {
          reject(new Error("تم إلغاء تسجيل الدخول"));
        }
      });
    }
  });
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

interface GoogleSignInButtonProps {
  className?: string;
  label?: string;
}

export function GoogleSignInButton({ className, label = "المتابعة عبر Google" }: GoogleSignInButtonProps) {
  const { setToken } = useAuth();
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleClick = async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError("تسجيل الدخول عبر Google غير مفعّل حالياً");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const credential = await requestGoogleCredential(clientId);
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "فشل التحقق من Google");
      setToken(data.token);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={className ?? "w-full h-11 flex items-center justify-center gap-3 border border-border/60 rounded-xl bg-card hover:bg-muted/50 hover:border-border transition-all duration-180 active:scale-[0.97] font-medium text-sm disabled:opacity-60 press-spring"}
      >
        <GoogleIcon />
        {loading ? "جارٍ التحقق..." : label}
      </button>
      {error && (
        <p className="text-xs text-destructive text-center">{error}</p>
      )}
    </div>
  );
}
