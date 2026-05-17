import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

export function Footer() {
  const [location] = useLocation();
  const { token } = useAuth();
  const isAuth = location === "/login" || location === "/register";
  if (isAuth) return null;

  return (
    <footer
      className={`border-t border-border/25 bg-background mt-12 ${
        token ? "mb-[72px] md:mb-0" : ""
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="font-medium">
          © {new Date().getFullYear()} SubNation — سوق الاشتراكات الرقمية في ليبيا
        </span>
        <div className="flex items-center gap-4">
          <Link href="/terms#terms">
            <span className="hover:text-foreground transition-colors cursor-pointer">
              الشروط والأحكام
            </span>
          </Link>
          <span className="w-px h-3 bg-border/40" />
          {/*
            Hash-based deep-link to the privacy tab. TermsPage reads
            `window.location.hash` on mount (and on hash change) and
            switches the active tab accordingly. Replaces a previous
            setTimeout + DOM-query hack that silently broke when the
            terms route hadn't finished mounting.
          */}
          <Link href="/terms#privacy">
            <span className="hover:text-foreground transition-colors cursor-pointer">
              سياسة الخصوصية
            </span>
          </Link>
          <span className="w-px h-3 bg-border/40" />
          <Link href="/support">
            <span className="hover:text-foreground transition-colors cursor-pointer">
              الدعم
            </span>
          </Link>
        </div>
      </div>
    </footer>
  );
}
