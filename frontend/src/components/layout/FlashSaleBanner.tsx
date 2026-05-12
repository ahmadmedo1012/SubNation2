import { useState, useEffect } from "react";
import { Zap, X, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

interface FlashSale {
  title: string;
  discount_percent: number;
  ends_at: string;
}

export function FlashSaleBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [flashSale, setFlashSale] = useState<FlashSale | null>(null);
  const [timeLeft, setTimeLeft] = useState({ h: 0, m: 0, s: 0 });
  const [urgent, setUrgent] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/flash-sale");
        if (!r.ok) return;
        const d = await r.json();
        if (d.flash_sale) setFlashSale(d.flash_sale);
      } catch {}
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!flashSale) return;
    const update = () => {
      const diff = new Date(flashSale.ends_at).getTime() - Date.now();
      if (diff <= 0) {
        setExpired(true);
        return;
      }
      setTimeLeft({
        h: Math.floor(diff / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
      setUrgent(diff < 3600000);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [flashSale?.ends_at]);

  if (!flashSale || expired || dismissed) return null;

  return (
    <div
      className={`relative overflow-hidden border-b py-2 px-4 transition-all duration-500 ${
        urgent
          ? "bg-gradient-to-l from-primary/25 via-primary/14 to-primary/5 border-primary/35"
          : "bg-gradient-to-l from-primary/15 via-primary/8 to-transparent border-primary/18"
      }`}
    >
      {/* Animated glow */}
      {urgent && (
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-pulse pointer-events-none" />
      )}

      <div className="relative max-w-6xl mx-auto flex items-center gap-2 sm:gap-3">
        {/* Left: icon + label */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md sm:rounded-lg flex items-center justify-center shrink-0 transition-colors ${
              urgent ? "bg-primary" : "bg-primary/20 border border-primary/30"
            }`}
          >
            <Zap
              className={`w-2.5 h-2.5 sm:w-3 sm:h-3 fill-current ${urgent ? "text-white" : "text-primary-text"}`}
            />
          </div>
          <span
            className={`text-[11px] sm:text-xs font-black hidden sm:inline ${urgent ? "text-primary-text" : "text-primary-text/80"}`}
          >
            عرض محدود
          </span>
        </div>

        {/* Center: title — clickable */}
        <Link href="/" className="flex-1 min-w-0">
          <div className="text-center text-xs sm:text-sm font-bold text-foreground/90 truncate cursor-pointer hover:text-primary-text transition-colors flex items-center justify-center gap-1 sm:gap-2">
            <span className="truncate">{flashSale.title}</span>
            <span className="text-primary-text font-black shrink-0">
              — {flashSale.discount_percent}% خصم
            </span>
            <ArrowLeft className="w-3 h-3 text-primary-text shrink-0 hidden sm:inline" />
          </div>
        </Link>

        {/* Right: countdown + dismiss */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={`flex items-center gap-0.5 sm:gap-1 ${urgent ? "text-primary-text" : "text-muted-foreground"}`}
          >
            {[
              { val: timeLeft.h, label: "س" },
              { val: timeLeft.m, label: "د" },
              { val: timeLeft.s, label: "ث" },
            ].map((seg, i) => (
              <div key={i} className="flex items-center gap-0.5 sm:gap-1">
                {i > 0 && <span className="font-black opacity-40 text-[10px]">:</span>}
                <div
                  className={`flex flex-col items-center min-w-[22px] sm:min-w-[26px] px-0.5 sm:px-1 py-0.5 rounded border transition-colors ${
                    urgent ? "bg-primary/15 border-primary/35" : "bg-card/60 border-border/60"
                  }`}
                >
                  <span className="font-black tabular-nums text-[11px] sm:text-xs leading-tight">
                    {String(seg.val).padStart(2, "0")}
                  </span>
                  <span className="text-[7px] opacity-50 leading-none">{seg.label}</span>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded-md hover:bg-card/60 text-muted-foreground hover:text-muted-foreground transition-colors"
            aria-label="إغلاق الشريط"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
