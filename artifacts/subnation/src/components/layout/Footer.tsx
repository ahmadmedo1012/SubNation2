import { Link, useLocation } from "wouter";

export function Footer() {
  const [location] = useLocation();
  const isAuth = location === "/login" || location === "/register";
  if (isAuth) return null;

  return (
    <footer className="border-t border-border/30 bg-card/40 mt-12 mb-16 md:mb-0">
      <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground/50">
        <span className="font-medium">© {new Date().getFullYear()} SubNation — سوق الاشتراكات الرقمية في ليبيا</span>
        <div className="flex items-center gap-4">
          <Link href="/terms">
            <span className="hover:text-muted-foreground transition-colors cursor-pointer">الشروط والأحكام</span>
          </Link>
          <span className="w-px h-3 bg-border/50" />
          <Link href="/terms">
            <span className="hover:text-muted-foreground transition-colors cursor-pointer" onClick={() => setTimeout(() => {
              const el = document.querySelector('[data-tab="privacy"]');
              if (el) (el as HTMLButtonElement).click();
            }, 100)}>سياسة الخصوصية</span>
          </Link>
          <span className="w-px h-3 bg-border/50" />
          <Link href="/support">
            <span className="hover:text-muted-foreground transition-colors cursor-pointer">الدعم</span>
          </Link>
        </div>
      </div>
    </footer>
  );
}
