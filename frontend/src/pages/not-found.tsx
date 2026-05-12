import { Link } from "wouter";
import { Home, ArrowLeft, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-4 text-center">
      <div className="space-y-8 max-w-sm w-full">
        {/* Illustration */}
        <div className="relative mx-auto w-40 h-40 flex items-center justify-center select-none">
          <div className="absolute inset-0 rounded-full bg-primary/4 border border-primary/8 animate-pulse" />
          <div className="absolute inset-4 rounded-full bg-primary/6 border border-primary/12" />
          <div className="relative flex flex-col items-center">
            <Compass className="w-10 h-10 text-primary/40 mb-1" />
            <span className="text-4xl font-black text-primary/25 tracking-tighter">٤٠٤</span>
          </div>
        </div>

        {/* Text */}
        <div>
          <h1 className="text-2xl font-black mb-3">الصفحة غير موجودة</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            يبدو أن هذه الصفحة لا وجود لها أو ربما تم نقلها.
            <br />
            تأكد من الرابط أو عد إلى الرئيسية.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/">
            <button className="flex items-center gap-2 bg-primary hover:bg-primary/90 active:scale-95 text-white font-bold px-6 py-3 rounded-xl transition-all duration-150 shadow-lg shadow-primary/20 w-full sm:w-auto">
              <Home className="w-4 h-4" />
              العودة للرئيسية
            </button>
          </Link>
          <button
            onClick={() => window.history.back()}
            className="flex items-center gap-2 bg-secondary/60 hover:bg-secondary border border-border text-muted-foreground hover:text-foreground font-medium px-6 py-3 rounded-xl transition-all duration-150 w-full sm:w-auto"
          >
            <ArrowLeft className="w-4 h-4" />
            الصفحة السابقة
          </button>
        </div>

        {/* Quick links */}
        <div className="pt-2 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground mb-3 uppercase tracking-widest">
            روابط سريعة
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { href: "/", label: "المتجر" },
              { href: "/wallet", label: "المحفظة" },
              { href: "/orders", label: "طلباتي" },
              { href: "/support", label: "الدعم" },
            ].map((l) => (
              <Link key={l.href} href={l.href}>
                <span className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border/50 hover:border-border bg-secondary/30 hover:bg-secondary/60 transition-all cursor-pointer">
                  {l.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
