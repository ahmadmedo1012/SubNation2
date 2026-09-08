import { useEffect, useState } from "react";
import { Zap, X, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

interface FlashSale {
  title: string;
  discount_percent: number;
  ends_at: string;
}

/**
 * Site-wide flash-sale strip.
 *
 * 94-C3 (A3 P2-11/P2-12 + A7 P2-CLS):
 *   • Height reservation — the banner is lazy-mounted AFTER
 *     `/api/flash-sale` resolves, so on a cold load it pushed the whole
 *     page down by ~44px (+0.05 CLS on every page while a sale runs).
 *     The end-timestamp of a seen sale is cached in localStorage; while
 *     that window is still open the component renders an invisible
 *     44px block up-front and the real banner swaps into it 1:1.
 *   • Timer hard-stop at zero — mirrors the flash-sales page's
 *     useCountdown fix (one interval, cleared the moment the window
 *     closes) instead of ticking `0` forever.
 *   • Polling stops once the banner is hidden (dismissed/expired) —
 *     the old loop kept hitting `/api/flash-sale` every 60s forever.
 */

/** Rendered banner height: py-2 (16) + one ~28px content row. Both the
 * reservation placeholder and the banner itself are at least this tall
 * so the swap is pixel-stable. */
const BANNER_RESERVED_H = 44;

/** localStorage: end timestamp (ms) of the last-seen active sale. Written
 * whenever a sale renders, read on mount to decide the reservation. */
const SALE_ENDS_KEY = "sn_flash_sale_ends";

function readCachedSaleEnd(): number | null {
  try {
    const raw = window.localStorage.getItem(SALE_ENDS_KEY);
    if (!raw) return null;
    const t = Number(raw);
    return Number.isFinite(t) && t > Date.now() ? t : null;
  } catch {
    return null;
  }
}

function cacheSaleEnd(t: number): void {
  try {
    window.localStorage.setItem(SALE_ENDS_KEY, String(t));
  } catch {
    // private mode / storage full — reservation just won't trigger
  }
}

function clearCachedSaleEnd(): void {
  try {
    window.localStorage.removeItem(SALE_ENDS_KEY);
  } catch {
    // ignore
  }
}

export function FlashSaleBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [flashSale, setFlashSale] = useState<FlashSale | null>(null);
  const [timeLeft, setTimeLeft] = useState({ h: 0, m: 0, s: 0 });
  const [urgent, setUrgent] = useState(false);
  const [expired, setExpired] = useState(false);
  // CLS reservation — only starts true when a cached sale window says
  // a banner is likely about to mount (see file header).
  const [reserved, setReserved] = useState(() => readCachedSaleEnd() !== null);

  // ── Poll /api/flash-sale every 60s while the banner is visible ────
  useEffect(() => {
    // 94-C3 (A3 P2-12): dismissed/expired is terminal for this mount —
    // stop paying the network cost of polling a hidden banner.
    if (dismissed || expired) return;
    const load = async () => {
      try {
        const r = await fetch("/api/flash-sale");
        if (!r.ok) return;
        const d = await r.json();
        if (d.flash_sale) {
          setFlashSale(d.flash_sale);
          cacheSaleEnd(new Date(d.flash_sale.ends_at).getTime());
        } else {
          // Definitive "no active sale" — drop any stale reservation
          // from a previous visit. A banner already on screen is left
          // alone (its own countdown ends it).
          setReserved(false);
          clearCachedSaleEnd();
        }
      } catch {
        // network blip — next 60s tick retries
      }
    };
    void load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [dismissed, expired]);

  // ── 1s countdown — hard stop at zero (flash-sales.tsx parity) ─────
  useEffect(() => {
    if (!flashSale || expired) return;
    const update = () => {
      const diff = new Date(flashSale.ends_at).getTime() - Date.now();
      if (diff <= 0) {
        // Expired: stop the timer instead of re-rendering `0` every
        // second forever — the exact fix documented in flash-sales.tsx.
        // `expired` is a dependency below, so this re-run lands in the
        // early-return branch and the cleanup clears the interval —
        // one clock, zero orphan ticks.
        setExpired(true);
        clearCachedSaleEnd();
        return;
      }
      setTimeLeft({
        h: Math.floor(diff / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
      setUrgent(diff < 3600000);
    };
    update(); // paint the first value immediately
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [flashSale?.ends_at, expired]);

  if (expired || dismissed) return null;

  if (!flashSale) {
    // Pre-fetch height reservation: holds the banner's slot while the
    // first poll is in flight so the late-mounted banner can't push
    // the page content down (A7 P2 CLS finding).
    return reserved ? (
      <div
        aria-hidden="true"
        data-testid="flash-sale-reserved"
        style={{ minHeight: BANNER_RESERVED_H }}
      />
    ) : null;
  }

  return (
    <div
      className={`relative overflow-hidden border-b py-2 px-4 min-h-[44px] transition-all duration-500 ${
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
              className={`w-2.5 h-2.5 sm:w-3 sm:h-3 fill-current ${
                urgent ? "text-primary-foreground" : "text-primary-text"
              }`}
            />
          </div>
          <span
            className={`text-[11px] sm:text-xs font-black hidden sm:inline ${
              urgent ? "text-primary-text" : "text-primary-text/80"
            }`}
          >
            عرض محدود
          </span>
        </div>

        {/* Center: title — clickable, goes to the flash-sales page so the
            trailing "go" arrow delivers the destination it promises */}
        <Link href="/flash-sales" className="flex-1 min-w-0">
          <div className="text-center text-xs sm:text-sm font-bold text-foreground/90 truncate cursor-pointer hover:text-primary-text transition-colors flex items-center justify-center gap-1 sm:gap-2">
            <span className="truncate">{flashSale.title}</span>
            <span className="text-primary-text font-black shrink-0">
              {/* 93-C8 (A11 §5): «خصم N%» — the dominant site order. */}— خصم{" "}
              {flashSale.discount_percent}%
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
                  {/* 94-C3 (A3 P2-11): 7px/50% was unreadable on small
                      screens — the unit is functional copy, not decor. */}
                  <span className="text-[10px] opacity-70 leading-none">{seg.label}</span>
                </div>
              </div>
            ))}
          </div>

          {/* 94-C3 (A3 P1-3): 32×32 → 44×44 hit box; -my-2 keeps the
              strip at its compact height. */}
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              clearCachedSaleEnd();
            }}
            className="-my-2 -mx-1 flex h-11 w-11 items-center justify-center touch-target rounded-md hover:bg-card/60 text-muted-foreground hover:text-muted-foreground transition-colors"
            aria-label="إغلاق الشريط"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
