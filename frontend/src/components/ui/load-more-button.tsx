import { ChevronDown, Loader2, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * R124-I8 (A8 finding 3): the shared append-in-place «تحميل المزيد»
 * button — the 94-C2 (A2 P1-1) infinite-scroll affordance that was
 * hand-rolled 8× across storefront orders and the admin list pages.
 *
 * Pure extraction: variant/labels/default classes are the exact
 * majority strings, and the busy spinner stays a per-site prop because
 * the 8 sites split 4×Loader2 / 4×RefreshCw with no majority to
 * standardize on (zero behavior change rule).
 *
 * Button shape (identical everywhere): outline Button, disabled while
 * a page is in flight (or a parent load is running), ChevronDown +
 * «تحميل المزيد» at rest, spinner + «جارٍ التحميل…» while busy.
 * The surrounding `hasNextPage` gate / wrapper div stays at the call
 * site — it is page state, not button chrome.
 */

export interface LoadMoreButtonProps {
  /** True while the next page is in flight — swaps label for spinner. */
  busy: boolean;
  /** Typically `() => void fetchNextPage()`. */
  onClick: () => void;
  /**
   * Extra disabled conditions beyond `busy` (e.g. a parent isLoading)
   * — the button disables on `busy || disabled`.
   */
  disabled?: boolean;
  /**
   * Busy spinner. Defaults to Loader2; the admin orders/users/alerts
   * pages drifted to RefreshCw and pass it explicitly.
   */
  spinner?: LucideIcon;
  /** Button size — "sm" is the family default (orders' history row uses "default"). */
  size?: "default" | "sm";
  /**
   * Passed straight to Button. Defaults to the admin-family
   * "h-9 gap-1.5"; the storefront orders sites ride "min-h-11 gap-1.5"
   * (R124-I4 A4-F1 44px tap floor).
   */
  className?: string;
  /** Icon size classes — "w-3.5 h-3.5" everywhere except the
   * storefront history list's w-4 pair. */
  iconClassName?: string;
}

export function LoadMoreButton({
  busy,
  onClick,
  disabled,
  spinner: Spinner = Loader2,
  size = "sm",
  className = "h-9 gap-1.5",
  iconClassName = "w-3.5 h-3.5",
}: LoadMoreButtonProps) {
  return (
    <Button
      variant="outline"
      size={size}
      className={className}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy ? (
        <>
          <Spinner className={`${iconClassName} animate-spin`} /> جارٍ التحميل…
        </>
      ) : (
        <>
          <ChevronDown className={iconClassName} /> تحميل المزيد
        </>
      )}
    </Button>
  );
}
