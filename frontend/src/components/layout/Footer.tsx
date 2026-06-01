import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Logo } from "./Logo";

export function Footer() {
  const [location] = useLocation();
  const { token } = useAuth();
  const isAuth = location === "/login" || location === "/register";
  if (isAuth) return null;

  return (
    <footer
      className={`relative border-t border-border/30 bg-gradient-to-b from-background via-background to-card/40 mt-12 ${
        token ? "mb-[72px] md:mb-0" : ""
      }`}
    >
      {/* Hairline brand tint at the top — barely visible but unifies
          the footer with the FlashSaleBanner / Navbar treatment. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      />

      <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        {/* Left: logo + copyright */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <Logo size="sm" />
          <span className="font-medium text-center sm:text-right opacity-85">
            © {new Date().getFullYear()} — سوق الاشتراكات الرقمية في ليبيا
          </span>
        </div>

        {/* Right: legal + support */}
        <div className="flex items-center gap-4">
          <Link href="/terms#terms">
            <span className="hover:text-foreground transition-colors cursor-pointer">
              الشروط والأحكام
            </span>
          </Link>
          <span className="w-px h-3 bg-border/50" />
          {/* Hash-based deep-link to the privacy tab. TermsPage reads
              `window.location.hash` on mount + on hashchange and switches
              the active tab. Replaces a previous setTimeout + DOM-query
              hack that silently broke when terms hadn't finished mounting. */}
          <Link href="/terms#privacy">
            <span className="hover:text-foreground transition-colors cursor-pointer">
              سياسة الخصوصية
            </span>
          </Link>
          <span className="w-px h-3 bg-border/50" />
          <Link href="/support">
            <span className="hover:text-foreground transition-colors cursor-pointer">الدعم</span>
          </Link>
        </div>
      </div>
    </footer>
  );
}
