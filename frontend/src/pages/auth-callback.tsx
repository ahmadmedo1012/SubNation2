import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";

export default function AuthCallbackPage() {
  const { setToken } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const error = params.get("auth_error");

    if (token) {
      setToken(token);
      navigate("/");
    } else if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`);
    } else {
      navigate("/login");
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">جارٍ تسجيل الدخول...</p>
      </div>
    </div>
  );
}
