import { WifiOff, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * R124-I8 (A8 finding 2): the shared fetch-failure card — the
 * "an API outage is NOT the empty state" idiom (93-C5 / F-05 and the
 * B4/B5 P1 error-branch family) that was hand-rolled 18× across
 * storefront + admin pages before this extraction.
 *
 * Shape: tinted error tile (WifiOff) → bold Arabic headline → muted
 * explanation → «إعادة المحاولة» retry. Every prop default and every
 * class string below is the exact pre-extraction rendering of the
 * majority site of its family — this is a pure extraction, not a
 * redesign; wording variants (title/description) are per-site props
 * and were deliberately NOT unified.
 *
 * Sites that drifted too far off the three families to prop-ize were
 * left in place (documented in the R124-I8 worklog): product/order-detail
 * (two-button rows), admin/dashboard (role="alert" + inner wrapper),
 * admin/promotions + admin/security (p-8 / outline-button variants).
 * R125-I7 (A7 B-4) closed the ledger's home entry — home's grid error
 * converged on this card (the R128 sweep verified: no bespoke grid
 * error branch remains in home.tsx).
 */

/** Visual scale of the card — the three drifted-identical families. */
export type FetchErrorCardSize = "page" | "section" | "compact";

const SIZE_STYLES: Record<
  FetchErrorCardSize,
  {
    /** Outer card. */
    card: string;
    /** Icon tile. */
    tile: string;
    /** Tile icon classes (color + size). */
    icon: string;
    /** Headline <p>. */
    title: string;
    /** Explanation <p>. */
    description: string;
    /** The family's canonical retry button. */
    retry: { className: string; size: "default" | "sm" | "lg" };
  }
> = {
  // Full list/panel error — storefront page-level + every admin table
  // page (orders, topups, users, tickets, referrals, admins, alerts…).
  page: {
    card: "text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-2xl",
    tile: "w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center",
    icon: "w-8 h-8 text-status-error/70",
    title: "font-bold text-lg mb-1.5 text-foreground/80",
    description: "text-sm mb-7 max-w-xs mx-auto leading-relaxed",
    retry: {
      className:
        "bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold",
      size: "default",
    },
  },
  // Card-in-page error — a section whose siblings keep rendering
  // (profile identity card, wallet balance card, support ticket list).
  section: {
    card: "text-center py-10 text-muted-foreground bg-card border border-status-error/22 rounded-2xl reveal-up",
    tile: "w-14 h-14 mx-auto mb-4 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center",
    icon: "w-6 h-6 text-status-error/70",
    title: "font-bold text-base mb-1.5 text-foreground/80",
    description: "text-xs text-muted-foreground mb-5 leading-relaxed max-w-xs mx-auto",
    retry: {
      className: "bg-primary hover:bg-primary/90 shadow-md shadow-primary/22 rounded-xl",
      size: "default",
    },
  },
  // Widget-in-card error — a list inside a panel whose header/stats
  // stay alive (wallet ledger, wallet topup history, loyalty ledger).
  compact: {
    card: "text-center py-10 text-muted-foreground",
    tile: "w-12 h-12 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center mx-auto mb-3.5",
    icon: "w-5 h-5 text-status-error/70",
    title: "font-bold text-sm mb-1 text-foreground/80",
    description: "text-xs text-muted-foreground mb-4 leading-relaxed max-w-[240px] mx-auto",
    // min-h-11 (R124-I1 A4 P2): these retries are the only recovery
    // action on the money pages — the fixed h-9 (36px) sat under the
    // app-wide 44px tap floor.
    retry: {
      className: "bg-primary hover:bg-primary/90 shadow-md shadow-primary/22 rounded-xl min-h-11",
      size: "sm",
    },
  },
};

export interface FetchErrorCardProps {
  /** Bold Arabic headline, e.g. «تعذّر تحميل الطلبات». */
  title: ReactNode;
  /**
   * Muted second line. ReactNode so callers can interpolate a server
   * message (`${getErrorMessage(error)} — تحقّق من شبكتك ثم أعد المحاولة`).
   */
  description?: ReactNode;
  /**
   * Retry callback — its presence gates the button. Sites whose error
   * branch has no recovery action simply omit it.
   */
  onRetry?: () => void;
  /** Visual scale — see SIZE_STYLES. Defaults to "page". */
  size?: FetchErrorCardSize;
  /**
   * Tile icon. WifiOff at every extracted site; order-detail's bespoke
   * XCircle card was left in place rather than prop-ized for one use.
   */
  icon?: LucideIcon;
  /**
   * Appended (cn/twMerge) to the size's card classes — e.g. py-20,
   * px-4, reveal-up, flex-1 where a page drifted off the family pad.
   */
  className?: string;
  /** Appended to the size's title classes (e.g. text-sm on support). */
  titleClassName?: string;
  /** Appended to the size's description classes (e.g. max-w-[220px]). */
  descriptionClassName?: string;
  /** Icon inside the retry button (the admin RefreshCw idiom). */
  retryIcon?: LucideIcon;
  /** Retry label — «إعادة المحاولة» at every extracted site. */
  retryLabel?: ReactNode;
  /**
   * REPLACES the size's default retry classes (unlike the props above,
   * which append): the few sites that drifted off their family's
   * button carry their own full string.
   */
  retryClassName?: string;
  /** Overrides the size's default retry Button size. */
  retrySize?: "default" | "sm" | "lg";
}

export function FetchErrorCard({
  title,
  description,
  onRetry,
  size = "page",
  icon: Icon = WifiOff,
  className,
  titleClassName,
  descriptionClassName,
  retryIcon: RetryIcon,
  retryLabel = "إعادة المحاولة",
  retryClassName,
  retrySize,
}: FetchErrorCardProps) {
  const styles = SIZE_STYLES[size];
  return (
    // R125 (A6 B-8): role="alert" — a full-page/section load failure was
    // silent to screen readers (only the hand-rolled stale-refresh
    // banners announced; the shared card never did). Assertive by
    // design: this component renders ONLY in error branches.
    <div role="alert" className={cn(styles.card, className)}>
      <div className={styles.tile}>
        <Icon className={styles.icon} />
      </div>
      <p className={cn(styles.title, titleClassName)}>{title}</p>
      {description !== undefined && (
        <p className={cn(styles.description, descriptionClassName)}>{description}</p>
      )}
      {onRetry && (
        <Button
          onClick={onRetry}
          size={retrySize ?? styles.retry.size}
          className={retryClassName ?? styles.retry.className}
        >
          {RetryIcon && <RetryIcon className="w-3.5 h-3.5" />}
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
