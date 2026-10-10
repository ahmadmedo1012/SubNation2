import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/CopyButton";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { EmptyState } from "@/components/admin/EmptyState";
import { TableSkeleton as SharedTableSkeleton } from "@/components/admin/TableSkeleton";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import { formatCount, formatCurrency, formatDate, statusLabel } from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
import { displayUserName, userFromRow } from "@/lib/admin/user-display";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  getListAdminOrdersQueryKey,
  listAdminOrders,
  type AdminOrder,
} from "@workspace/api-client-react";
import {
  BadgePercent,
  BarChart2,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  ShoppingBag,
  Square,
  Tag,
  Ticket,
  TrendingUp,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AdminLayout } from "./layout";

/** API may return extra delivery / coupon fields */
type AdminOrderRow = AdminOrder & {
  coupon_code?: string;
  discount_amount?: number;
  /** B6-03 (R116): the list no longer decrypts credentials — this flag
   *  is the availability signal; the plaintext comes from
   *  GET /api/admin/orders/:id/credentials on first reveal. */
  has_credentials?: boolean;
};

/** GET /api/admin/orders/:id/credentials response (B6-03). */
interface OrderCredentials {
  id: number;
  order_code: string;
  status: string;
  has_credentials: boolean;
  delivered_email: string | null;
  delivered_password: string | null;
  delivered_extra_details: string | null;
  /** R117 (A1-P6): true when the raw columns are populated but every
   *  decrypt returned null — an ENCRYPTION_KEY mismatch, not "no
   *  data". The backend only emits it on that exact condition. */
  decrypt_failed?: boolean;
}

// R124-I5 (A6 F2): bulk-action + filter-tab labels derive from
// statusLabel — the same map that feeds the row badges (the tickets.tsx
// pattern). The tabs previously hand-rolled a THIRD vocabulary mix
// («معلق»/«فاشل»/«مسترجع» tabs vs «قيد الانتظار»/«فشل»/«مُسترد» badges
// vs «مسترجع» bulk entries) — one status can never show two different
// Arabic words on one page (the status-badge invariant).
const BULK_STATUSES = (["completed", "pending", "failed", "refunded"] as const).map((s) => ({
  value: s,
  label: statusLabel(s),
  /* R125-I2 (A6-B4): the raw -400 label hues collapse to 1.53-2.77:1
   * on the shipped light admin theme — the --status-* token family
   * (the StatusBadge ink) is contrast-safe in BOTH themes. Icons/dots
   * keep their raw hues elsewhere; these are TEXT labels. */
  color:
    s === "completed"
      ? "text-status-success"
      : s === "pending"
        ? "text-status-warning"
        : s === "failed"
          ? "text-status-error"
          : "text-status-info",
}));

const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  ...(["completed", "pending", "failed", "refunded"] as const).map((s) => ({
    value: s,
    label: statusLabel(s),
  })),
];

const DATE_RANGES = [
  { label: "الكل", days: 0 },
  { label: "اليوم", days: 1 },
  { label: "7 أيام", days: 7 },
  { label: "30 يوم", days: 30 },
];

/** 94-C2 (A2 P1-1 + P2-2): server-side page size for the orders
 *  list. The backend (routes/admin/orders.ts) clamps limit to
 *  [1, 200] (default 100) and supports `page` + `search`. Round-93
 *  made history reachable with page-swapping التالي/السابق controls;
 *  round-94 replaces them with the accumulating "load more" pattern
 *  (frozen contract: 1-based `page` + `limit`, response body stays a
 *  plain array) so fetched rows — and the operator's row selections —
 *  survive, while the server-side `?search=` (LIKE across order code /
 *  phone / email / name / product) reaches orders BEYOND the loaded
 *  window: the old client-side filter searched only what was already
 *  on screen, so an older order was "غير موجود" until you paged to it. */
const ORDERS_PAGE_SIZE = 100;

/** Arabic plural forms for the orders counter (formatCount — the
 *  shared Arabic-plural helper had zero admin usage, A2 P3-4). */
const ORDER_COUNT_FORMS = {
  zero: "طلبات",
  one: "طلب",
  two: "طلبان",
  few: "طلبات",
  many: "طلبًا",
  other: "طلب",
};

// Arabic labels for the RefundService failure codes the 207 partial
// body carries (backend/src/services/refund.service.ts RefundErrorCode).
const REFUND_FAILURE_LABELS: Record<string, string> = {
  ORDER_NOT_FOUND: "الطلب غير موجود",
  NOT_REFUNDABLE: "الطلب غير قابل للاسترداد",
  ALREADY_REFUNDED: "مُسترد مسبقاً",
  USER_NOT_FOUND: "المستخدم غير موجود",
  CONCURRENCY_ERROR: "تعارض تزامني",
};

function isWithinDays(dateStr: string, days: number) {
  if (!days) return true;
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

function TableSkeleton() {
  return (
    <SharedTableSkeleton
      rows={7}
      cells={[
        "w-24 shrink-0",
        "w-28",
        "flex-1",
        "w-16 shrink-0",
        "rounded-full w-14 shrink-0",
        "w-20 shrink-0",
      ]}
    />
  );
}

// 96-F7 (R96 M7): delivery credentials (email / password) render MASKED
// (••••••) with an eye toggle to reveal + the shared CopyButton per
// value (the topups.tsx idiom, on the canonical 44px component). Both
// the mobile card expansion and the desktop expanded row previously
// printed them in plain mono text — shoulder-surfing exposure in
// public, and no way to copy a long password from a phone. The reveal
// state lives INSIDE the component, so it resets (re-masks) when the
// row collapses. stopPropagation on the root keeps the copy/eye taps
// from toggling the parent row expansion (the mobile card's onClick).
function MaskedCredential({ label, value }: { label: string; value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div
      className="flex items-center gap-2 min-w-0 flex-wrap text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-muted-foreground shrink-0">{label}: </span>
      <span dir="ltr" className="font-mono font-bold min-w-0 break-all text-left">
        {revealed ? value : "••••••"}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? `إخفاء ${label}` : `إظهار ${label}`}
        aria-pressed={revealed}
        className="p-2 -m-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
      <CopyButton text={value} size="sm" />
    </div>
  );
}

/* ── R118-B2 (A6 F-8): memoized order rows ──────────────────────────────
 * The search box is a CONTROLLED input — every keystroke re-rendered the
 * whole page and (with rows inlined in the map closures) recomputed up to
 * 200 desktop <tr> subtrees + 200 mobile cards: ~400 row subtrees with
 * fresh inline handlers/className closures each keystroke (the network is
 * debounced at 300ms, but the RENDER path was not). The rows are now
 * module-level React.memo components whose props are stable across a
 * keystroke (order refs come from the memoized allOrders array;
 * isSelected/expanded/credsFailed are primitives; creds is the cached
 * per-order object; the two callbacks are useCallBack-stable) — so a
 * keystroke re-renders the search box and NOTHING else. Selection /
 * expansion flips bust exactly ONE row.
 *
 * Shared prop contract for both layouts. */
interface OrderRowProps {
  order: AdminOrderRow;
  /** Position in `filtered` — drives the desktop zebra striping
   *  (idx % 2). Optional: the mobile card has no zebra. */
  idx?: number;
  isSelected: boolean;
  expanded: boolean;
  /** B6-03 (R116): cached per-order credentials payload (undefined until
   * the first expansion's audited fetch resolves). */
  creds?: OrderCredentials;
  credsFailed: boolean;
  onToggleSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
}

/** Desktop table row: the visible <tr> plus its expansion <tr>. */
const DesktopOrderRow = React.memo(function DesktopOrderRow({
  order,
  idx,
  isSelected,
  expanded,
  creds,
  credsFailed,
  onToggleSelect,
  onToggleExpand,
}: OrderRowProps) {
  return (
    <React.Fragment>
      <tr
        className={`border-b border-border/30 transition-colors hover:bg-muted/20 cursor-pointer group ${
          isSelected ? "bg-primary/3" : (idx ?? 0) % 2 !== 0 ? "bg-muted/[0.035]" : ""
        }`}
      >
        <td className="px-4 py-2.5">
          {/* F3-08 (R111): name + aria-pressed on the row selector (was an
              icon-only button — the selection state feeding the bulk
              refund was visual-only). */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(order.id);
            }}
            aria-label={`تحديد الطلب ${order.order_code} للإجراء الجماعي`}
            aria-pressed={isSelected}
            /* R120-B4 (A2-F13): p-2 -m-1 ≈ 28px hit area (the expand
               chevron's fix) — the ~14px icon-only target fed the bulk
               refund selection on touch devices. */
            className="p-2 -m-1 rounded-lg text-muted-foreground hover:text-primary transition-colors"
          >
            {isSelected ? (
              <CheckSquare className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
          </button>
        </td>
        <td
          className="px-4 py-2.5 font-mono text-xs text-muted-foreground"
          onClick={() => onToggleExpand(order.id)}
        >
          {order.order_code}
        </td>
        <td
          className="px-4 py-2.5 font-mono text-xs font-bold"
          onClick={() => onToggleExpand(order.id)}
        >
          {displayUserName(userFromRow(order))}
        </td>
        <td
          className="px-4 py-2.5 font-semibold text-sm max-w-40 truncate"
          onClick={() => onToggleExpand(order.id)}
        >
          {order.product_name}
        </td>
        <td
          /* R125-I2 (A6-B6): money cell — raw --primary on a dark card is
           * 3.76:1 (under the 4.5:1 text floor; dark is the admin
           * default). --primary-text is the text-safe variant (5.75:1
           * dark / 5.30 light — button.tsx:35-37 documents raw
           * text-primary as surface-only). */
          className="px-4 py-2.5 font-bold text-primary-text text-sm tabular-nums"
          onClick={() => onToggleExpand(order.id)}
        >
          {formatCurrency(order.amount)}
        </td>
        <td className="px-4 py-2.5" onClick={() => onToggleExpand(order.id)}>
          {/* R116: shared StatusBadge (STATUS_TONE) replaces the deprecated
              statusColor() — 93-C7 follow-up. */}
          <StatusBadge
            variant={STATUS_TONE[order.status as keyof typeof STATUS_TONE] ?? UNKNOWN_STATUS_TONE}
            size="sm"
          >
            {statusLabel(order.status)}
          </StatusBadge>
        </td>
        <td
          className="px-4 py-2.5 text-muted-foreground text-xs tabular-nums"
          onClick={() => onToggleExpand(order.id)}
        >
          {order.created_at ? formatDate(order.created_at) : "—"}
        </td>
        {/* F3-02 (R111 WCAG 2.1.1): the toggle is now a real <button>
            (Enter/Space work natively) with aria-expanded + a state-aware
            accessible name; the other cells keep their onClick for the
            mouse-affordance of tapping anywhere on the row.
            stopPropagation keeps a click on the chevron from
            double-firing the td handler. */}
        <td className="px-4 py-2.5 text-muted-foreground transition-colors">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(order.id);
            }}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? `إخفاء بيانات تسليم الطلب ${order.order_code}`
                : `عرض بيانات تسليم الطلب ${order.order_code}`
            }
            className="p-1.5 -m-1 rounded-lg text-muted-foreground group-hover:text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/10">
          <td colSpan={8} className="px-4 py-3 border-b border-border/30">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
              {/* B6-03 (R116): values render from the per-order credentials
                  fetch (the list no longer decrypts) — masking + copy UX
                  unchanged (96-F7). */}
              {order.has_credentials && !creds && !credsFailed && (
                <span className="text-muted-foreground">جارٍ تحميل بيانات التسليم…</span>
              )}
              {order.has_credentials && credsFailed && (
                <span className="text-destructive">تعذّر تحميل بيانات التسليم</span>
              )}
              {/* R117 (A1-P6): raw columns populated but every decrypt
                  null — the operator needs the ENCRYPTION_KEY signal,
                  not a misleading "no data". */}
              {order.has_credentials && creds?.decrypt_failed && (
                <span role="alert" className="text-destructive font-bold">
                  تعذّر فك التشفير — راجع مطابقة ENCRYPTION_KEY مع مفتاح التشفير الأصلي
                </span>
              )}
              {creds?.delivered_email && (
                <MaskedCredential label="البريد" value={creds.delivered_email} />
              )}
              {creds?.delivered_password && (
                <MaskedCredential label="كلمة المرور" value={creds.delivered_password} />
              )}
              {creds?.delivered_extra_details && (
                <div>
                  <span className="text-muted-foreground">تفاصيل: </span>
                  <span>{creds.delivered_extra_details}</span>
                </div>
              )}
              {order.coupon_code && (
                <div>
                  <span className="text-muted-foreground">الكوبون: </span>
                  <span className="font-mono font-bold text-status-success">
                    {order.coupon_code}
                  </span>
                  {(order.discount_amount ?? 0) > 0 && (
                    <span className="text-muted-foreground mr-1">
                      (خصم {formatCurrency(order.discount_amount ?? 0)})
                    </span>
                  )}
                </div>
              )}
              {!order.has_credentials && !creds?.delivered_extra_details && !order.coupon_code && (
                <span className="text-muted-foreground">لا توجد بيانات تسليم</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
});

/** Mobile card: the list card plus its inline expansion. */
const MobileOrderCard = React.memo(function MobileOrderCard({
  order,
  isSelected,
  expanded,
  creds,
  credsFailed,
  onToggleSelect,
  onToggleExpand,
}: OrderRowProps) {
  return (
    <div
      className={`bg-card border rounded-2xl p-4 cursor-pointer transition-colors ${
        isSelected ? "border-primary/40 bg-primary/3" : "border-border/60 hover:border-border"
      }`}
      onClick={() => onToggleExpand(order.id)}
    >
      <div className="flex items-start gap-2 mb-2">
        {/* F3-08 (R111): same name + aria-pressed fix as the desktop row
            selector. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(order.id);
          }}
          aria-label={`تحديد الطلب ${order.order_code} للإجراء الجماعي`}
          aria-pressed={isSelected}
          /* R120-B4 (A2-F13): same p-2 -m-1 hit-area fix as the desktop
             row selector. */
          className="mt-0.5 p-2 -m-1 rounded-lg text-muted-foreground hover:text-primary transition-colors shrink-0"
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-primary" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">{order.product_name}</div>
          <div className="font-mono text-xs text-muted-foreground mt-0.5">
            {displayUserName(userFromRow(order))}
          </div>
        </div>
        <div className="text-right shrink-0">
          {/* R125-I2 (A6-B6): money cell — --primary-text (see the desktop
           * row's money-cell note). */}
          <div className="font-bold text-primary-text tabular-nums">
            {formatCurrency(order.amount)}
          </div>
          {/* R116: shared StatusBadge (STATUS_TONE) replaces the
              deprecated statusColor() — 93-C7 follow-up. */}
          <StatusBadge
            variant={STATUS_TONE[order.status as keyof typeof STATUS_TONE] ?? UNKNOWN_STATUS_TONE}
            size="sm"
            className="mt-1"
          >
            {statusLabel(order.status)}
          </StatusBadge>
        </div>
      </div>
      {/* F3-02 (R111 WCAG 2.1.1): the mobile card was a mouse-only onClick
          div — the meta row is now the keyboard-reachable expand toggle
          (real <button>, Enter/Space native, aria-expanded + state-aware
          name, chevron affordance). The card keeps its onClick so taps
          anywhere still expand. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand(order.id);
        }}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? `إخفاء بيانات تسليم الطلب ${order.order_code}`
            : `عرض بيانات تسليم الطلب ${order.order_code}`
        }
        className="w-full flex items-center gap-2 text-2xs text-muted-foreground border-t border-border/30 pt-2 mt-2 text-right hover:text-foreground transition-colors"
      >
        <span className="font-mono">{order.order_code}</span>
        {order.created_at && (
          <>
            <span>·</span>
            <span>{formatDate(order.created_at)}</span>
          </>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 ms-auto transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded &&
        order.has_credentials &&
        (credsFailed ? (
          <div className="mt-2 pt-2 border-t border-border/30 text-xs text-destructive">
            تعذّر تحميل بيانات التسليم
          </div>
        ) : creds ? (
          <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
            {creds.delivered_email && (
              <MaskedCredential label="البريد" value={creds.delivered_email} />
            )}
            {creds.delivered_password && (
              <MaskedCredential label="كلمة المرور" value={creds.delivered_password} />
            )}
            {creds.decrypt_failed && (
              /* R117 (A1-P6): mobile card parity — the decrypt-failure
                 signal must reach the phone too, not just the desktop
                 row. */
              <span role="alert" className="text-xs text-destructive font-bold">
                تعذّر فك التشفير — راجع مطابقة ENCRYPTION_KEY مع مفتاح التشفير الأصلي
              </span>
            )}
            {!creds.delivered_email && !creds.delivered_password && !creds.decrypt_failed && (
              <span className="text-xs text-muted-foreground">لا توجد بيانات تسليم</span>
            )}
          </div>
        ) : (
          <div className="mt-2 pt-2 border-t border-border/30 text-xs text-muted-foreground">
            جارٍ تحميل بيانات التسليم…
          </div>
        ))}
    </div>
  );
});

export default function AdminOrdersPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  const jsonHeaders = useAdminHeaders({ json: true });
  const headers = useAdminHeaders();
  const [, navigate] = useLocation();
  // 94-C2 (A2 P2-3): the GlobalSearch palette deep-links here via
  // /admin/orders?search=… — useSearch keeps the box in sync on mount
  // AND on same-route navigations.
  const searchParam = useSearch();
  const { toast } = useToast();
  const qc = useQueryClient();
  // R123 (E3 P3a): two-way URL filter sync (?status= / ?days=) — the
  // settings.tsx ?tab= idiom: URL → state on mount/param change, state
  // → URL via replaceState (filter flips don't spam the history stack).
  // A shared orders link can now pin a status/date view.
  const [statusFilter, setStatusFilter] = useState(
    () => new URLSearchParams(window.location.search).get("status") ?? "",
  );
  // 94-C2 (A2 P2-2): search is SERVER-side (?search= LIKE) — the raw
  // input state feeds a 300ms debounce below; only the debounced value
  // enters the query key, so one request per typing pause.
  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get("search") ?? "",
  );
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState(() => {
    const raw = Number.parseInt(new URLSearchParams(window.location.search).get("days") ?? "0", 10);
    return DATE_RANGES.some((d) => d.days === raw) ? raw : 0;
  });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showStats, setShowStats] = useState(true);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  // R120-B4 (A2-F19): the bulk-status menu trigger — ESC returns focus
  // here when the menu closes (keyboard users rejoin where they left).
  const bulkMenuTriggerRef = useRef<HTMLButtonElement>(null);
  // ── B6-03 (R116): credentials-on-demand ──────────────────────────────
  // The list no longer ships decrypted credentials. The plaintext is
  // fetched from GET /api/admin/orders/:id/credentials the FIRST time an
  // order's expansion is opened, then cached per order id for the page's
  // lifetime (re-expansions are instant and never re-hit the audited
  // endpoint). A failure is remembered too — retry spam on a dead
  // endpoint would re-log audit rows for nothing.
  const [credentialsCache, setCredentialsCache] = useState<Map<number, OrderCredentials>>(
    () => new Map(),
  );
  const [failedCredentialIds, setFailedCredentialIds] = useState<Set<number>>(() => new Set());
  const credentialsInFlight = useRef<Set<number>>(new Set());

  const ensureOrderCredentials = useCallback(
    async (orderId: number) => {
      if (
        credentialsCache.has(orderId) ||
        failedCredentialIds.has(orderId) ||
        credentialsInFlight.current.has(orderId)
      ) {
        return;
      }
      credentialsInFlight.current.add(orderId);
      try {
        const r = await fetch(`/api/admin/orders/${orderId}/credentials`, { headers });
        if (isAdminUnauthorized(r, `/api/admin/orders/${orderId}/credentials`)) return;
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const body = (await r.json().catch(() => null)) as OrderCredentials | null;
        if (!body) throw new Error("bad credentials payload");
        setCredentialsCache((prev) => new Map(prev).set(orderId, body));
      } catch {
        setFailedCredentialIds((prev) => new Set(prev).add(orderId));
        toast({
          title: "تعذّر تحميل بيانات التسليم",
          description: "حاول فتح الطلب مرة أخرى",
          variant: "destructive",
        });
      } finally {
        credentialsInFlight.current.delete(orderId);
      }
    },
    [credentialsCache, failedCredentialIds, headers, toast],
  );

  // Expanding a row with credentials triggers the one-time fetch —
  // declared AFTER allOrders is defined (hook order is stable: this is
  // the same position every render).
  // 94-C2 (A2 P1-1): page accumulation lives in useInfiniteQuery — no
  // local `page` state (the round-93 prev/next controls are replaced by
  // the append-in-place «تحميل المزيد» button below).
  // B5-05 (round-92 audit): the raw window.confirm for the destructive
  // bulk actions (refund!) is replaced by the shared styled AlertDialog
  // hook used by admins.tsx / promotions.tsx — same message text.
  const { confirm, ConfirmDialog } = useConfirm();

  const listParams = { search: debouncedSearch.trim() || undefined, limit: ORDERS_PAGE_SIZE };
  const {
    data: ordersPages,
    isLoading,
    // 93-C6 / F-07 (A5 S-2/O-1, round-93): `isError`/`error` were never
    // destructured — a failed load (401/500/network) left data=[] and
    // the page rendered the "لا توجد طلبات" empty state, i.e. a
    // support queue that LOOKED empty during an outage.
    isError,
    error,
    refetch,
    // 94-C2 (A2 P1-1): append controls (fetchNextPage) + the server's
    // implicit "more may exist" flag (a full page).
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<AdminOrder[], Error>({
    // Key keeps the "/api/admin/orders" prefix so the existing
    // invalidations (bulk-status, dashboard socket pushes…) still
    // refresh this query; the debounced `search` in the key restarts
    // at page 1 and aborts the in-flight request via the queryFn's
    // AbortSignal (94-C2 debounce + abort, A2 P2-2).
    queryKey: ["/api/admin/orders", "load-more", listParams],
    queryFn: ({ pageParam, signal }) =>
      listAdminOrders({ ...listParams, page: pageParam as number }, { signal, headers }),
    initialPageParam: 1,
    // Frozen contract (A2 P1-1): the body is a plain array with no
    // total meta — a full page means the next page MIGHT exist; the
    // first short/empty page is the definite end.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === ORDERS_PAGE_SIZE ? allPages.length + 1 : undefined,
    enabled: !!adminToken,
    // Round-4 (perf P1-3): the admin-room socket listener invalidates
    // orders on every `admin-stats-update` push — 5-min fallback only.
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  // Same relaxed widening the page always used for the delivered-* /
  // coupon_* extra fields the generated AdminOrder type doesn't carry.
  // R118-B2 (A6 F-8): memoized — `.flat()` mints a fresh array identity
  // on every render, which would defeat the useMemo chain below (and
  // every row's `order` prop identity) on each keystroke. ordersPages
  // only changes identity on query updates.
  const allOrders = useMemo(
    () => (ordersPages?.pages ?? []).flat() as AdminOrderRow[],
    [ordersPages],
  );

  // B6-03 (R116): expanding a row whose list entry carries the
  // has_credentials flag triggers the one-time audited fetch. The gate
  // conditions inside ensureOrderCredentials (cache / failed / in-flight)
  // make repeat calls safe no-ops while allOrders identity changes per
  // refetch.
  useEffect(() => {
    if (expandedRow === null) return;
    const row = allOrders.find((o) => o.id === expandedRow);
    if (row?.has_credentials) {
      void ensureOrderCredentials(row.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedRow, ensureOrderCredentials]);

  // A single short page is the only case where the total is provably
  // known — otherwise the honest count is «عرض N» (A2 P1-1).
  const knownTotal = (ordersPages?.pages.length ?? 0) <= 1 && allOrders.length < ORDERS_PAGE_SIZE;
  const loadErrorMessage = isError ? getErrorMessage(error) : null;

  // ── R118-B2 (A6 F-8): memoized filter/aggregate chain ─────────────
  // The search box is controlled state — every keystroke re-rendered
  // the page and recomputed these chains (statusCounts / byStatus /
  // byDate / todayCount / revenue + coupon aggregates) plus every row
  // subtree for nothing (the server search only runs after the 300ms
  // debounce). All of it is now derived through useMemo keyed on
  // [allOrders, statusFilter, dateRange] so a keystroke skips the work
  // entirely; the memoized row components below skip the DOM side.
  // Lives ABOVE the adminToken early-return (rules of hooks).
  const statusCounts = useMemo(
    () =>
      allOrders.reduce((acc: Record<string, number>, o) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      }, {}),
    [allOrders],
  );

  const filtered = useMemo(() => {
    const byStatus = statusFilter ? allOrders.filter((o) => o.status === statusFilter) : allOrders;
    const byDate = dateRange
      ? byStatus.filter((o) => o.created_at && isWithinDays(o.created_at, dateRange))
      : byStatus;
    // 94-C2 (A2 P2-2): search already ran on the server — only the status
    // tab and date quick-filter stay client-side over the accumulated
    // pages (keeping status local preserves the tab counts' honesty over
    // the loaded set — the risk.tsx P3-1 lesson).
    return byDate;
  }, [allOrders, statusFilter, dateRange]);

  const todayCount = useMemo(
    () =>
      allOrders.filter((o) => {
        if (!o.created_at) return false;
        const d = new Date(o.created_at);
        const now = new Date();
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        );
      }).length,
    // `new Date()` per render would be fine correctness-wise but keeps
    // the memo forever-fresh; one snapshot per allOrders change matches
    // the old behavior (recomputed on data updates).
    [allOrders],
  );

  const totalRevenue = useMemo(
    () => filtered.reduce((sum: number, o) => sum + (Number(o.amount) || 0), 0),
    [filtered],
  );

  // Coupon stats from ALL orders (not filtered) for the overview panel
  const { couponOrders, totalDiscounts, totalRevenueAll, topCoupons, uniqueCouponCount } =
    useMemo(() => {
      const couponOrders = allOrders.filter((o) => o.coupon_code);
      const totalDiscounts = couponOrders.reduce(
        (sum: number, o) => sum + (Number(o.discount_amount) || 0),
        0,
      );
      const totalRevenueAll = allOrders.reduce(
        (sum: number, o) => sum + (Number(o.amount) || 0),
        0,
      );
      // Top coupon codes: { code, uses, totalDiscount }
      const couponMap = couponOrders.reduce(
        (acc: Record<string, { uses: number; totalDiscount: number }>, o) => {
          const c = o.coupon_code as string;
          if (!acc[c]) acc[c] = { uses: 0, totalDiscount: 0 };
          acc[c].uses++;
          acc[c].totalDiscount += Number(o.discount_amount) || 0;
          return acc;
        },
        {},
      );
      const topCoupons = (
        Object.entries(couponMap) as Array<[string, { uses: number; totalDiscount: number }]>
      )
        .map(([code, v]) => ({ code, ...v }))
        .sort((a, b) => b.uses - a.uses)
        .slice(0, 4);
      const uniqueCouponCount = Object.keys(couponMap).length;
      return { couponOrders, totalDiscounts, totalRevenueAll, topCoupons, uniqueCouponCount };
    }, [allOrders]);

  // B5-02 (round-92 audit): the bulk-status endpoint (including bulk
  // refund — a money action) used to complete SILENTLY on success: the
  // error path toasted, the success path only refetched the table. The
  // backend also returns an explicit 207 partial shape when some
  // refunds can't be applied
  // (`{ updated, failed: [{ orderId, code, message }] }` —
  // backend/src/routes/admin/orders.ts); that body was never parsed,
  // so a half-failed batch looked like full success. Both are handled
  // below: a success toast with counts, and per-failure reasons on 207.
  const applyBulkStatus = async (status: string) => {
    if (selectedIds.size === 0) return;
    const isRefund = status === "refunded";
    // 93-C6 / F-07 (A5 O-3): the refund confirm now shows the TOTAL
    // LYD to be returned (computable from the selected rows), not just
    // a count — the money amount is the number an operator verifies.
    const selectedRows = allOrders.filter((o) => selectedIds.has(o.id));
    const totalRefund = selectedRows.reduce((sum: number, o) => sum + (Number(o.amount) || 0), 0);
    const confirmMessage = isRefund
      ? `تأكيد استرداد ${selectedIds.size} طلب؟ سيتم استرداد المبالغ للمستخدمين (إجمالي ${formatCurrency(totalRefund)}).`
      : `تأكيد تغيير حالة ${selectedIds.size} طلب؟`;
    const confirmed = await confirm({
      title: isRefund ? "استرداد جماعي للطلبات" : "تغيير الحالة الجماعي",
      description: confirmMessage,
      confirmLabel: isRefund ? "استرداد" : "تغيير الحالة",
      destructive: isRefund,
    });
    if (!confirmed) return;
    setBulkUpdating(true);
    setBulkStatusOpen(false);
    const requestedCount = selectedIds.size;
    try {
      // F-008 (security audit 004) + 99-C8 (R99-A2 P3 — comment honesty):
      // the key is minted per CLICK (per HTTP attempt — there is no
      // auto-retry, so the two coincide). The middleware layer is best-
      // effort here; the REAL double-refund protection is server-side:
      // RefundService's per-order status-machine guard refuses any order
      // not in a refundable state, so a same-click network replay or an
      // accidental double-click cannot refund twice.
      const r = await fetch("/api/admin/orders/bulk-status", {
        method: "PATCH",
        headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),
        body: JSON.stringify({ ids: Array.from(selectedIds), status }),
      });
      // 93-C6 / F-07 (A5 S-3): a 401 mid-work is a session expiry, not
      // a retryable failure — the global handler toasts + redirects;
      // no misleading "حاول مرة أخرى" toast on top.
      if (isAdminUnauthorized(r, "/api/admin/orders/bulk-status")) return;
      if (!r.ok) {
        // 93-C6 / F-07 (A5 O-2): the failure body carries the backend
        // code (409 CONCURRENCY_ERROR / 403 RBAC…) — parse it instead
        // of `throw String(r.status)` so the catch can surface the
        // Arabic reason instead of "حاول مرة أخرى" for a conflict the
        // operator cannot retry away.
        const body = (await r.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(getErrorMessage(body) || `فشل تنفيذ العملية (HTTP ${r.status})`);
      }
      // 207 (Multi-Status) — Response.ok is true for it, so the partial
      // body must be parsed explicitly, never swallowed.
      const body = (await r.json().catch(() => null)) as {
        updated?: number;
        failed?: Array<{ orderId: number; code?: string; message?: string }>;
      } | null;
      const updated = body?.updated ?? requestedCount;
      const failed = body?.failed ?? [];
      if (failed.length > 0) {
        // RefundService failure codes → Arabic reasons.
        const reasons = failed
          .map(
            (f) =>
              `#${f.orderId}: ${REFUND_FAILURE_LABELS[f.code ?? ""] ?? f.message ?? "سبب غير معروف"}`,
          )
          .join("، ");
        toast({
          title: `تم تحديث ${updated} من ${requestedCount} طلب`,
          description: `فشلت ${failed.length}: ${reasons}`,
          variant: "destructive",
        });
      } else {
        // Success feedback parity with the single-approve toast on
        // topups: money actions announce what happened, with counts.
        // `updated < requested` on non-refund statuses means the
        // backend skipped refunded/missing ids — surface the gap.
        const skipped = Math.max(0, requestedCount - updated);
        toast({
          title: isRefund ? `تم استرداد ${updated} طلب` : `تم تحديث حالة ${updated} طلب`,
          description: isRefund
            ? "أُعيدت مبالغ الطلبات إلى محافظ المستخدمين"
            : `${statusLabel(status)}${skipped > 0 ? ` · تخطي ${skipped} طلب` : ""}`,
          variant: "success",
        });
      }
      setSelectedIds(new Set());
      // R124-I5 (A6 F11): the explicit refetch() + the base-key
      // invalidateQueries fired TWO identical list requests per bulk
      // action (the invalidate already re-fetches every active query
      // under the key). The invalidate alone is the refresh — the same
      // single-invalidation shape every other admin page uses
      // (users.tsx / topups.tsx / products.tsx).
      // 93-C6 / F-07: invalidate the BASE key (no params) so every
      // cached page + the dashboard's recent-orders query refresh,
      // not just the current page's exact key.
      qc.invalidateQueries({ queryKey: getListAdminOrdersQueryKey() });
    } catch (err) {
      toast({
        title: "خطأ",
        description:
          err instanceof Error && err.message ? err.message : "فشل تنفيذ العملية، حاول مرة أخرى",
        variant: "destructive",
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  // Keyboard shortcut: / to focus search, Esc to clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as Element)?.tagName)) {
        e.preventDefault();
        document.getElementById("orders-search")?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // 94-C2 (A2 P2-2): 300ms debounce feeding the server-side search
  // (same pattern as users.tsx) — one request per typing pause, not per
  // keystroke; the in-flight request is aborted by the query key change
  // (AbortSignal passed through listAdminOrders → customFetch → fetch).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // 94-C2 (A2 P2-3): GlobalSearch deep-links (?search=…) — sync the box
  // when the URL search changes without clobbering local typing (the
  // operator may have edited the box after arriving).
  // R123 (E3 P3a): ?status= / ?days= land the same way — without
  // clobbering a filter the operator already picked locally.
  useEffect(() => {
    const q = new URLSearchParams(searchParam);
    const s = q.get("search") ?? "";
    setSearch((prev) => (prev === s ? prev : s));
    const st = q.get("status") ?? "";
    if (STATUS_FILTERS.some((x) => x.value === st)) {
      setStatusFilter((prev) => (prev === st ? prev : st));
    }
    const rawDays = Number.parseInt(q.get("days") ?? "0", 10);
    const days = DATE_RANGES.some((d) => d.days === rawDays) ? rawDays : 0;
    setDateRange((prev) => (prev === days ? prev : days));
  }, [searchParam]);

  // R123 (E3 P3a): filters → URL (replaceState — flips don't spam the
  // history stack; empty/zero values drop the param entirely).
  const syncFilterParams = (status: string, days: number) => {
    const url = new URL(window.location.href);
    if (status) url.searchParams.set("status", status);
    else url.searchParams.delete("status");
    if (days > 0) url.searchParams.set("days", String(days));
    else url.searchParams.delete("days");
    window.history.replaceState(null, "", url.toString());
  };

  // Redirect effect AFTER all hooks so hook order is identical every
  // render (rules-of-hooks). The null return below keeps the guard
  // semantics: unauthenticated admins render nothing until the
  // redirect lands.
  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  // R118-B2 (A6 F-8): the row callbacks are useCallback-stable so the
  // memoized row components bail out on keystroke re-renders (selection /
  // expansion flips bust exactly ONE row via its boolean prop).
  // R118 fix: declared BEFORE the !adminToken early return — hooks must
  // run unconditionally (rules-of-hooks); setters are stable so hoisting
  // is behavior-neutral for the authenticated render.
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: number) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  }, []);

  if (!adminToken) return null;

  // R120-B4 (A2-F4): refund visibility follows the backend's OWN gate —
  // the bulk-status PATCH answers 403 for `refunded` unless the acting
  // admin carries the finance scope (routes/admin/orders.ts A6-01). The
  // option is HIDDEN for orders-only operators instead of offered and
  // 403'd mid-flow after the operator already curated a selection.
  const canBulkRefund = hasAdminPermission("finance");

  // R120-B4 (A2-F18): one CSV download ritual shared by both export
  // paths (the two copies were byte-identical except the filename).
  const downloadCsv = (rows: (string | number)[][], filename: string) => {
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const orderCsvRows = (list: AdminOrderRow[]): (string | number)[][] => {
    const csvHeaders = ["رقم الطلب", "المستخدم", "المنتج", "المبلغ", "الحالة", "التاريخ"];
    return [
      csvHeaders,
      ...list.map((o) => [
        o.order_code ?? "",
        o.user_phone ?? "",
        (o.product_name ?? "").replace(/,/g, "؛"),
        o.amount ?? 0,
        statusLabel(o.status),
        o.created_at ? formatDate(o.created_at) : "",
      ]),
    ];
  };

  const exportCSV = () => {
    downloadCsv(orderCsvRows(filtered), `orders_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // R126-L3 (A4 quick-win): select-all membership honesty. The branch
  // condition used to compare `selectedIds.size === filtered.length` —
  // a SIZE test — while the rendered checkbox state one line down
  // (and its aria-pressed) uses MEMBERSHIP (`filtered.every(o =>
  // selectedIds.has(o.id))`). The selection legitimately carries ids
  // OUTSIDE the current filter (rows selected before a search/status
  // narrow), so the two could disagree: with 3 hidden-but-selected ids
  // and 3 visible-unselected rows the unchecked button CLEARED the
  // selection instead of selecting the visible rows; with extra hidden
  // ids alongside a fully-selected window the checked button re-ran the
  // select branch (a no-op set) and the operator could never deselect.
  // The toggle now branches on the SAME membership flag it renders.
  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((o) => o.id)));
  };

  const exportSelected = () => {
    const sel = filtered.filter((o) => selectedIds.has(o.id));
    downloadCsv(orderCsvRows(sel), `orders_selected_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold mb-0.5">الطلبات</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {/* 94-C2 (A2 P1-1): honest count. «إجمالاً» is only true
                  when the whole result set provably fits one page; an
                  accumulating list is labeled with what it actually
                  shows («عرض N»), never a grand total it can't know. */}
              <span>
                {knownTotal
                  ? `${formatCount(allOrders.length, ORDER_COUNT_FORMS)} إجمالاً`
                  : `عرض ${formatCount(allOrders.length, ORDER_COUNT_FORMS)} (الأحدث أولاً)`}
              </span>
              {todayCount > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span className="text-primary-text font-bold">{todayCount} اليوم</span>
                </>
              )}
              {filtered.length !== allOrders.length && (
                <>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  <span className="text-status-success font-bold tabular-nums">
                    {formatCurrency(totalRevenue)}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            {/* Search */}
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                id="orders-search"
                placeholder="بحث... ( / )"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9 h-9 w-full sm:w-56 text-sm"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="مسح البحث"
                  /* 93-C6 / F-07 (A5 S-6): bare w-3 icon ≈ 12px target —
                     p-2 lifts the tappable area to ~28px (the audit's
                     CopyButton recommendation). */
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Export */}
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={selectedIds.size > 0 ? exportSelected : exportCSV}
              disabled={filtered.length === 0}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {selectedIds.size > 0 ? `تصدير (${selectedIds.size})` : "تصدير CSV"}
              </span>
            </Button>
          </div>
        </div>

        {/* Stats Panel */}
        {!isLoading && allOrders.length > 0 && (
          <div className="bg-card border border-border/60 rounded-2xl overflow-hidden float-in stagger-1">
            <button
              onClick={() => setShowStats((s) => !s)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/10 transition-colors"
            >
              <div className="flex items-center gap-2 text-sm font-bold">
                <BarChart2 className="w-4 h-4 text-primary" />
                إحصائيات الطلبات والكوبونات
              </div>
              <div className="flex items-center gap-3">
                {!showStats && (
                  <span className="text-xs text-muted-foreground font-normal">
                    {couponOrders.length} طلب بكوبون · خصم {formatCurrency(totalDiscounts)}
                  </span>
                )}
                {showStats ? (
                  <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </div>
            </button>

            {showStats && (
              <div className="border-t border-border/50 p-4 space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Total revenue */}
                  <div className="bg-muted/20 rounded-2xl p-3 border border-border/40">
                    <div className="flex items-center gap-1.5 text-2xs text-muted-foreground mb-1.5">
                      <TrendingUp className="w-3 h-3" />
                      إجمالي الإيرادات
                    </div>
                    <div className="font-bold text-base tabular-nums text-primary-text">
                      {formatCurrency(totalRevenueAll)}
                    </div>
                    <div className="text-3xs text-muted-foreground mt-0.5">
                      {formatCount(allOrders.length, ORDER_COUNT_FORMS)}
                    </div>
                  </div>

                  {/* Total discounts */}
                  <div className="bg-status-success/5 rounded-2xl p-3 border border-status-success/15">
                    <div className="flex items-center gap-1.5 text-2xs text-status-success/80 mb-1.5">
                      <BadgePercent className="w-3 h-3" />
                      إجمالي الخصومات
                    </div>
                    <div className="font-bold text-base tabular-nums text-status-success">
                      {formatCurrency(totalDiscounts)}
                    </div>
                    <div className="text-3xs text-muted-foreground mt-0.5">
                      {totalRevenueAll + totalDiscounts > 0
                        ? `${(((totalDiscounts || 0) / ((totalRevenueAll || 0) + (totalDiscounts || 0))) * 100).toFixed(1)}% من المبيعات`
                        : "—"}
                    </div>
                  </div>

                  {/* Orders with coupons */}
                  <div className="bg-muted/20 rounded-2xl p-3 border border-border/40">
                    <div className="flex items-center gap-1.5 text-2xs text-muted-foreground mb-1.5">
                      <Ticket className="w-3 h-3" />
                      طلبات بكوبون
                    </div>
                    <div className="font-bold text-base tabular-nums">{couponOrders.length}</div>
                    <div className="text-3xs text-muted-foreground mt-0.5">
                      {allOrders.length > 0
                        ? `${(((couponOrders.length || 0) / allOrders.length) * 100).toFixed(0)}% من الكل`
                        : "—"}
                    </div>
                  </div>

                  {/* Unique coupons */}
                  <div className="bg-muted/20 rounded-2xl p-3 border border-border/40">
                    <div className="flex items-center gap-1.5 text-2xs text-muted-foreground mb-1.5">
                      <Tag className="w-3 h-3" />
                      كوبونات مستخدمة
                    </div>
                    <div className="font-bold text-base tabular-nums">{uniqueCouponCount}</div>
                    <div className="text-3xs text-muted-foreground mt-0.5">كود فريد</div>
                  </div>
                </div>

                {/* Top coupons table */}
                {topCoupons.length > 0 && (
                  <div>
                    <p className="text-2xs font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Tag className="w-3 h-3" />
                      أكثر الكوبونات استخداماً
                    </p>
                    <div className="space-y-1.5">
                      {topCoupons.map((c, i) => {
                        const maxUses = topCoupons[0].uses;
                        const barWidth = maxUses > 0 ? (c.uses / maxUses) * 100 : 0;
                        return (
                          <div key={c.code} className="flex items-center gap-3 group">
                            <span className="text-3xs font-bold text-muted-foreground w-4 shrink-0 text-center">
                              {i + 1}
                            </span>
                            <span className="font-mono font-bold text-xs text-status-success bg-status-success/10 border border-status-success/20 px-2 py-0.5 rounded-md shrink-0 min-w-[80px] text-center">
                              {c.code}
                            </span>
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                              <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-status-success/60 rounded-full transition-all duration-500"
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                              <span className="text-xs font-bold tabular-nums shrink-0">
                                {c.uses}×
                              </span>
                            </div>
                            <span className="text-xs font-bold text-status-success tabular-nums shrink-0 hidden sm:block">
                              -{formatCurrency(c.totalDiscount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {topCoupons.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    لم يُستخدم أي كوبون بعد
                  </p>
                )}

                {/* 94-C2 (A2 P1-1): these aggregates are computed
                    from the LOADED rows (accumulated pages); once the
                    list is capped, say so instead of letting "إجمالي
                    الإيرادات" silently describe a slice. The dashboard
                    KPI reads /admin/stats — the server-side truth. */}
                {!knownTotal && (
                  <p className="text-3xs text-muted-foreground pt-1 border-t border-border/30 mt-1">
                    الإحصاءات تعكس الطلبات المعروضة (
                    {formatCount(allOrders.length, ORDER_COUNT_FORMS)}) — الإجماليات الكاملة في لوحة
                    التحكم
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/8 border border-primary/20 rounded-2xl animate-in fade-in slide-in-from-top-1 duration-150 flex-wrap">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            {/* R125-I2 (A6-B6): --primary-text (raw --primary is 3.76:1
                on dark — the text floor is 4.5:1; the Zap icon keeps
                text-primary: icons only need the 3:1 non-text floor). */}
            <span className="text-sm font-bold text-primary-text">{selectedIds.size} طلب محدد</span>
            <div className="flex gap-2 mr-auto flex-wrap items-center">
              {/* Bulk status dropdown */}
              {/* R120-B4 (A2-F19): menu semantics on the hand-rolled
                  dropdown — role="menu"/menuitem, ESC closes + returns
                  focus to the trigger, ↑/↓ move between items, focus
                  lands on the first item on open. A repo Radix
                  DropdownMenu primitive does not exist (components/ui
                  ships only alert-dialog/app-dialog) and adding one is
                  out of scope — this is the minimal ARIA + keyboard
                  contract instead. */}
              <div className="relative">
                <Button
                  ref={bulkMenuTriggerRef}
                  aria-haspopup="menu"
                  aria-expanded={bulkStatusOpen}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setBulkStatusOpen((v) => !v)}
                  disabled={bulkUpdating}
                >
                  {bulkUpdating ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" /> جارٍ التحديث...
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" /> تغيير الحالة
                    </>
                  )}
                </Button>
                {bulkStatusOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setBulkStatusOpen(false)} />
                    <div
                      role="menu"
                      aria-label="تغيير الحالة الجماعي"
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setBulkStatusOpen(false);
                          bulkMenuTriggerRef.current?.focus();
                        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          const items = Array.from(
                            e.currentTarget.querySelectorAll<HTMLButtonElement>(
                              '[role="menuitem"]',
                            ),
                          );
                          if (items.length === 0) return;
                          const idx = items.indexOf(document.activeElement as HTMLButtonElement);
                          const next =
                            e.key === "ArrowDown"
                              ? items[(idx + 1 + items.length) % items.length]
                              : items[(idx - 1 + items.length) % items.length];
                          next?.focus();
                        }
                      }}
                      className="absolute left-0 top-full mt-1 z-30 bg-card border border-border/60 rounded-2xl shadow-xl overflow-hidden min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
                    >
                      {BULK_STATUSES.filter(
                        // R120-B4 (A2-F4): the refund entry is
                        // finance-gated (see canBulkRefund above) — it
                        // renders only when the operator can actually
                        // execute it.
                        (s) => s.value !== "refunded" || canBulkRefund,
                      ).map((s, i) => (
                        <button
                          key={s.value}
                          role="menuitem"
                          autoFocus={i === 0}
                          onClick={() => applyBulkStatus(s.value)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold hover:bg-muted/40 focus:bg-muted/40 focus:outline-none transition-colors text-right ${s.color}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.color.replace("text-", "bg-")}`}
                          />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={exportSelected}
              >
                <Download className="w-3 h-3" /> تصدير
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="w-3 h-3 ml-1" /> إلغاء
              </Button>
            </div>
          </div>
        )}

        {/* Filters row */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Status filter tabs with counts */}
          <div className="flex gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1 overflow-x-auto scrollbar-none">
            {STATUS_FILTERS.map((s) => {
              const count = s.value ? (statusCounts[s.value] ?? 0) : allOrders.length;
              const active = statusFilter === s.value;
              return (
                <button
                  key={s.value}
                  onClick={() => {
                    setStatusFilter(s.value);
                    syncFilterParams(s.value, dateRange);
                  }}
                  /* R124-I5 (A6 F10): the active chip was purely visual —
                     aria-pressed exposes the toggle state to assistive
                     tech (the coupons.tsx chip-bar idiom). */
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                    active
                      ? "bg-card shadow-sm text-foreground font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                  {count > 0 && (
                    <span
                      className={`text-3xs font-bold px-1 rounded ${active ? "text-muted-foreground" : "text-muted-foreground"}`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Date range quick-filter */}
          <div className="flex items-center gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1">
            <Calendar className="w-3 h-3 text-muted-foreground mx-1" />
            {DATE_RANGES.map((dr) => (
              <button
                key={dr.days}
                onClick={() => {
                  setDateRange(dr.days);
                  syncFilterParams(statusFilter, dr.days);
                }}
                /* R124-I5 (A6 F10): same toggle-state exposure as the
                   status chips. */
                aria-pressed={dateRange === dr.days}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                  dateRange === dr.days
                    ? "bg-card shadow-sm text-foreground font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {dr.label}
              </button>
            ))}
          </div>

          {(search || statusFilter || dateRange > 0) && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                setDateRange(0);
                // R123 (E3 P3a): the clear-all also clears the URL params.
                syncFilterParams("", 0);
              }}
              className="text-xs text-muted-foreground hover:text-primary-text transition-colors"
            >
              مسح الكل
            </button>
          )}

          <span className="text-xs text-muted-foreground mr-auto">{filtered.length} نتيجة</span>
        </div>

        {/* 93-C6 / F-07 (A5 S-2): refresh of an already-rendered list
            failed — keep the stale rows, surface the failure inline
            (referrals.tsx banner idiom) instead of pretending nothing
            happened. */}
        {isError && allOrders.length > 0 && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span className="min-w-0">{loadErrorMessage ?? "تعذّر تحديث قائمة الطلبات"}</span>
            <button
              type="button"
              onClick={() => refetch()}
              className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <TableSkeleton />
        ) : isError && allOrders.length === 0 ? (
          /* 93-C6 / F-07 (A5 S-2): a failed load is NOT an empty store.
             The referrals.tsx error-card idiom — an outage/expired
             session previously masqueraded as "لا توجد طلبات" and the
             header told the operator the support queue was empty. */
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل الطلبات"
            description={loadErrorMessage ?? "حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"}
            onRetry={() => refetch()}
          />
        ) : filtered.length === 0 ? (
          hasNextPage ? (
            /* R115 (A9 P2): zero matches over PARTIAL data — the status
               and date tabs filter CLIENT-SIDE over the accumulated
               pages, so a tab can read «لا توجد طلبات» while matching
               rows sit on unloaded pages (hasNextPage=true). The hard
               empty state was a false claim; keep the load-more visible
               + the honest incompleteness hint instead. */
            <div className="text-center py-14 text-muted-foreground bg-card border border-border/60 rounded-2xl space-y-3">
              <ShoppingBag className="w-10 h-10 mx-auto opacity-20" />
              <p className="text-sm font-bold text-foreground/80">
                لا طلبات مطابقة ضمن الصفحات المحمّلة
              </p>
              <p className="text-xs">قد تكون النتائج غير مكتملة — حمّل المزيد لعرض الكل</p>
              <div className="flex justify-center gap-2 flex-wrap">
                <LoadMoreButton
                  spinner={RefreshCw}
                  busy={isFetchingNextPage}
                  disabled={isLoading}
                  onClick={() => void fetchNextPage()}
                />
                {(search || statusFilter || dateRange > 0) && (
                  <button
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("");
                      setDateRange(0);
                      // R123 (E3 P3a): the clear-all also clears the URL params.
                      syncFilterParams("", 0);
                    }}
                    className="text-xs text-primary-text hover:underline mt-1.5"
                  >
                    مسح الفلاتر
                  </button>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title="لا توجد طلبات"
              action={
                search || statusFilter || dateRange > 0 ? (
                  <button
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("");
                      setDateRange(0);
                      // R123 (E3 P3a): the clear-all also clears the URL params.
                      syncFilterParams("", 0);
                    }}
                    className="text-xs text-primary-text hover:underline mt-1"
                  >
                    مسح الفلاتر
                  </button>
                ) : undefined
              }
            />
          )
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-card border border-border/60 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b border-border bg-card/85 supports-[backdrop-filter]:bg-card/65 backdrop-blur-md">
                      {/* 96-F7 (R96 A6 #15): scope="col" so screen readers
                          announce the header↔cell relation on vertical
                          sweeps instead of a bare "خلية". */}
                      <th scope="col" className="px-4 py-3 w-8">
                        {/* F3-08 (R111 WCAG 1.1.1 + 4.1.2): the icon-only
                            select-all carried no accessible name and no
                            state — the input to the bulk-refund money
                            action was visual-only. */}
                        <button
                          onClick={toggleSelectAll}
                          aria-label="تحديد كل الطلبات المعروضة للإجراء الجماعي"
                          aria-pressed={allFilteredSelected}
                          /* R120-B4 (A2-F13): same p-2 -m-1 hit-area fix
                             as the row selectors. */
                          className="p-2 -m-1 rounded-lg text-muted-foreground hover:text-primary transition-colors"
                        >
                          {allFilteredSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-primary" />
                          ) : (
                            <Square className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </th>
                      <th
                        scope="col"
                        className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
                      >
                        رقم الطلب
                      </th>
                      <th
                        scope="col"
                        className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
                      >
                        المستخدم
                      </th>
                      <th
                        scope="col"
                        className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
                      >
                        المنتج
                      </th>
                      <th
                        scope="col"
                        className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
                      >
                        المبلغ
                      </th>
                      <th
                        scope="col"
                        className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
                      >
                        الحالة
                      </th>
                      <th
                        scope="col"
                        className="text-right px-4 py-3 font-semibold text-muted-foreground text-2xs"
                      >
                        التاريخ
                      </th>
                      <th scope="col" className="w-8 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((order, idx: number) => (
                      <DesktopOrderRow
                        key={order.id}
                        order={order}
                        idx={idx}
                        isSelected={selectedIds.has(order.id)}
                        expanded={expandedRow === order.id}
                        creds={credentialsCache.get(order.id)}
                        credsFailed={failedCredentialIds.has(order.id)}
                        onToggleSelect={toggleSelect}
                        onToggleExpand={toggleExpand}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-border bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {formatCount(filtered.length, ORDER_COUNT_FORMS)}
                  {search && ` · نتائج "${search}"`}
                  {/* R125-I2 (A1-10): honest partial-window wording — the
                      footer sums the ACCUMULATED pages; «إجمالي» claims a
                      total the window can't prove while more pages exist
                      (the same honest-counts convention as the header's
                      «عرض N» and the coupon panel's caveat). */}
                  {filtered.length > 0 &&
                    (knownTotal
                      ? ` · إجمالي ${formatCurrency(totalRevenue)}`
                      : ` · مجموع المعروض ${formatCurrency(totalRevenue)}`)}
                </span>
                <span className="hidden sm:inline text-muted-foreground">
                  انقر على الصف لعرض بيانات التسليم
                </span>
              </div>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {filtered.map((order) => (
                <MobileOrderCard
                  key={order.id}
                  order={order}
                  isSelected={selectedIds.has(order.id)}
                  expanded={expandedRow === order.id}
                  creds={credentialsCache.get(order.id)}
                  credsFailed={failedCredentialIds.has(order.id)}
                  onToggleSelect={toggleSelect}
                  onToggleExpand={toggleExpand}
                />
              ))}
            </div>

            {/* 94-C2 (A2 P1-1): "load more" appends the next page in
                place (frozen contract: ?page=N+1&limit=…, body stays a
                plain array) — replacing the round-93 page-swapping
                controls so accumulated rows and their selections
                survive. The button hides once a short page arrives. */}
            {hasNextPage && (
              <div className="flex justify-center pt-1">
                <LoadMoreButton
                  spinner={RefreshCw}
                  busy={isFetchingNextPage}
                  disabled={isLoading}
                  onClick={() => void fetchNextPage()}
                />
              </div>
            )}
          </>
        )}
      </div>
      <ConfirmDialog />
    </AdminLayout>
  );
}
