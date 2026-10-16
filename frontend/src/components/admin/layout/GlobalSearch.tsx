import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useAuth } from "@/lib/auth";
// R122 (A2-P2): GlobalSearch's three raw fetches ride the session-aware
// wrapper (401 → global toast + redirect instead of a silent "no
// results").
import { adminFetchJson } from "@/lib/admin-session";
// R125 (A6 B-9): formatCount feeds the search palette's sr-only result
// announcement (Arabic plural forms — «نتيجة واحدة» / «3 نتائج»).
import { formatCount, formatCurrency } from "@/lib/utils";
import {
  displayUserName,
  displayUserPhone,
  userFromRow,
  type AdminUserShape,
} from "@/lib/admin/user-display";
import { type AdminOrder, type AdminProduct, type AdminUser } from "@workspace/api-client-react";
import { Loader2, Package, Search, ShoppingBag, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trapTabKey } from "./focus-trap";

// R137 (1-f decomposition): extracted verbatim from pages/admin/layout.tsx —
// the ⌘K global search palette. A self-contained FEATURE component in the
// CopilotPanel (R124-I5) precedent: its state is overlay-LOCAL (query,
// results, debounce, the keyboard highlight — nothing outside the palette
// reads it), so it moves as a unit with its own hooks; the page owns only
// the open flag (showSearch) and passes onClose. The move only changes its
// address — zero behavior, zero markup change.

// ── Global search component ──────────────────────────────────────────────────

/** R125 (A6 B-9): Arabic plural forms for the palette's sr-only result
 * count announcement (formatCount idiom — «نتيجة واحدة» / «نتيجتان» /
 * «3 نتائج»). */
const SEARCH_RESULT_FORMS = {
  zero: "نتائج",
  one: "نتيجة واحدة",
  two: "نتيجتان",
  few: "نتائج",
  many: "نتيجة",
  other: "نتيجة",
};

export function GlobalSearch({ onClose }: { onClose: () => void }) {
  const { hasAdminPermission } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    orders: AdminOrder[];
    users: AdminUser[];
    products: AdminProduct[];
  }>({
    orders: [],
    users: [],
    products: [],
  });
  const [loading, setLoading] = useState(false);
  // R125 (A6 B-9): the query the CURRENT results answer. Separates
  // "not searched yet" (the 220ms debounce window — keep whatever is
  // on screen, never flash a premature «لا نتائج") from "searched and
  // empty" (the honest no-results message + its live announcement).
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  // R130 (A3-F3): the last completed round hit a real fetch failure
  // (non-abort, non-401) — the palette must never answer an outage with
  // the definitive «لا نتائج لـ "q"» (the B5-04 false-empty class,
  // surviving in the one overlay whose whole job is truth under time
  // pressure).
  const [searchFailed, setSearchFailed] = useState(false);
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  // R125 (A6 B-9): the palette overlays — needed for the Tab trap and
  // for focus-return bookkeeping below.
  const overlayRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const headers = useAdminHeaders();
  // 94-C2 (A2 P2-3): the footer promises «↵ اختيار» — this index backs
  // that promise with real ↑/↓/↵ navigation over the flattened result
  // list (the promise was previously a dead hint).
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    // R125 (A6 B-9): capture the invoker (the ⌘K trigger / sidebar
    // button) BEFORE moving focus into the input, then return focus
    // to it on unmount — Esc, backdrop click and Enter-navigate all
    // used to unmount the focused input and drop keyboard users onto
    // <body> (the top of the tab order). The Enter-navigate case is
    // still covered downstream: ScrollToTop's location effect focuses
    // #main-content AFTER this cleanup runs.
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, []);

  // R122 (A2-P2): the palette used to promise orders/users/products
  // results to EVERY admin, but all three endpoints are permission-
  // scoped (orders/users/inventory — backend routes/admin/index.ts) — a
  // scoped operator typed a real query and got «لا نتائج» for sections
  // they can never open (empty ≠ unauthorized). Same hasAdminPermission
  // idiom as the nav filter: only the sections the operator can
  // actually open are fetched and offered.
  const canSearchOrders = hasAdminPermission("orders");
  const canSearchUsers = hasAdminPermission("users");
  const canSearchProducts = hasAdminPermission("inventory");
  const anySection = canSearchOrders || canSearchUsers || canSearchProducts;
  // The placeholder tells the truth about what THIS operator can
  // search (the old fixed copy named all three regardless of scope).
  const searchPlaceholder = [
    canSearchOrders && "الطلبات",
    canSearchUsers && "المستخدمين",
    canSearchProducts && "المنتجات",
  ]
    .filter(Boolean)
    .join("، ");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults({ orders: [], users: [], products: [] });
      setResultsFor(null);
      setSearchFailed(false);
      return;
    }
    // 94-C2 (A2 P2-3): every new keystroke aborts the previous request
    // — "abc"→"abcd" previously raced two overlapping fetches, and a
    // late-resolving OLDER response overwrote the newer results while
    // its finally() cleared the loading flag early.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      // 94-C2 (A2 P2-3): r.ok checked BEFORE parsing — an error body
      // (401/500 JSON envelope) previously parsed to a non-array and
      // silently became "لا نتائج" during an outage.
      // R122 (A2-P2): the session-aware wrapper owns the r.ok guard +
      // the global 401 handler now; every failure shape (error
      // envelope, session expiry, abort) collapses to [] here — the
      // scope filter above already keeps unreachable sections out of
      // the request set entirely.
      let fetchFailed = false;
      const jsonList = async (url: string): Promise<unknown[]> => {
        try {
          const d = await adminFetchJson<unknown>(url, {
            headers,
            signal: controller.signal,
          });
          return Array.isArray(d) ? d : [];
        } catch (e) {
          /* R130 (A3-F3): aborts are the debounce contract and session
             expiry is the global handler's — everything else is an
             outage. Remember it: the round renders the honest
             «تعذّر البحث» line instead of asserting the record does not
             exist. */
          const status = (e as { status?: number })?.status;
          const aborted = e instanceof DOMException && e.name === "AbortError";
          if (!aborted && status !== 401) {
            fetchFailed = true;
          }
          return [];
        }
      };
      // R122 (A2-P2): only the scoped-in sections are fetched — a
      // 403-ing section never gets asked.
      Promise.all([
        canSearchOrders
          ? jsonList(`/api/admin/orders?search=${encodeURIComponent(q)}`)
          : Promise.resolve([]),
        canSearchUsers
          ? jsonList(`/api/admin/users?search=${encodeURIComponent(q)}`)
          : Promise.resolve([]),
        canSearchProducts
          ? jsonList(`/api/admin/products?search=${encodeURIComponent(q)}`)
          : Promise.resolve([]),
      ])
        .then(([orders, users, products]) => {
          if (controller.signal.aborted) return;
          setResults({
            orders: (orders as AdminOrder[]).slice(0, 4),
            users: (users as AdminUser[]).slice(0, 4),
            products: (products as AdminProduct[]).slice(0, 4),
          });
          setSearchFailed(fetchFailed);
          setResultsFor(q);
        })
        .catch(() => {
          /* aborted or network — the next keystroke owns the state */
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, headers, canSearchOrders, canSearchUsers, canSearchProducts]);

  const total = results.orders.length + results.users.length + results.products.length;

  // 94-C2 (A2 P2-3): flat result list with its navigation action —
  // drives both the highlight and the Enter key. Clamped safely when
  // results shrink (typing narrows the list mid-navigation).
  const safeActive = Math.min(activeIndex, Math.max(0, total - 1));

  const goTo = (href: string) => {
    navigate(href);
    onClose();
  };

  // 94-C2 (A2 P2-3): result clicks KEEP the query — the orders page
  // consumes ?search= on arrival (server-side search, users'/orders'
  // pages read it on mount) instead of dropping what the operator
  // just searched for.
  const goToOrders = () => goTo(`/admin/orders?search=${encodeURIComponent(query.trim())}`);
  const goToUsers = () => goTo(`/admin/users?search=${encodeURIComponent(query.trim())}`);
  const goToProducts = () => goTo(`/admin/products?search=${encodeURIComponent(query.trim())}`);

  const flatResults = [
    ...results.orders.map(() => "order" as const),
    ...results.users.map(() => "user" as const),
    ...results.products.map(() => "product" as const),
  ];
  const runActive = () => {
    const kind = flatResults[safeActive];
    if (kind === "order") goToOrders();
    else if (kind === "user") goToUsers();
    else if (kind === "product") goToProducts();
  };

  // Reset the highlight whenever the result set changes (new query).
  useEffect(() => {
    setActiveIndex(0);
  }, [total]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (total === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.min(total - 1, Math.min(i, total - 1) + 1));
    } else if (e.key === "ArrowUp") {
      if (total === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, Math.min(i, total - 1) - 1));
    } else if (e.key === "Enter") {
      if (total > 0) {
        e.preventDefault();
        runActive();
      }
    }
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="بحث سريع"
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[8vh] sm:pt-[12vh] px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      // R125 (A6 B-9): the Tab half of the aria-modal promise — focus
      // cycles inside the palette instead of walking into the page
      // behind it (Esc + backdrop + Enter were already handled).
      onKeyDown={(e) => {
        if (overlayRef.current) trapTabKey(overlayRef.current, e);
      }}
    >
      {/* R139 (precision): the palette card joins the modal family's
          "declare elevation once" register (the app-dialog shell's R124-A3
          #10 rule): shadow-2xl → shadow-sm — over the dark blurred scrim a
          wide spread was invisible, so the border is the edge device and
          shadow-sm is the single contact shadow. bg-black/65 → /70 on the
          scrim above mirrors the same family's overlay value (the admin
          mobile drawer rides it too this round — one scrim across every
          modal). */}
      <div className="bg-card border border-border rounded-2xl shadow-sm w-full max-w-lg max-h-[84vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Input */}
        {/* R143 (L2-6): the combobox input row carries the palette's
            focus treatment — the bare outline-none below suppressed the
            global focus outline with no replacement, and Tab is
            trapped inside the palette (trapTabKey), so keyboard focus
            landed on ring-less tabbables. The focus-within idiom mirrors
            CopilotComposer's composite field (ring-ring — the ONE
            focus system's token, 2px + ring-offset-background). */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background">
          {loading ? (
            <Loader2 className="w-4 h-4 text-muted-foreground shrink-0 animate-spin" />
          ) : (
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            // R122 (A2-P2): scope-honest placeholder — only the sections
            // this operator can open are named.
            placeholder={`بحث في ${searchPlaceholder}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            /* R133 (A4-F8): role="combobox" promised a name it never had
               — a placeholder is not an accessible name (4.1.2). */
            aria-label={`بحث في ${searchPlaceholder}`}
            aria-expanded={total > 0}
            aria-controls="global-search-results"
            aria-activedescendant={total > 0 ? `global-search-option-${safeActive}` : undefined}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground text-right"
          />
          {/* R139 (precision): bg-muted/50 → /60 — the esc chip joins the
              kbd register every other ⌘K/esc/↵ chip in the shell rides
              (SearchTriggers + the sidebar footer + this palette's own
              footer row). */}
          <kbd className="text-3xs font-mono text-muted-foreground bg-muted/60 border border-border/60 px-1.5 py-0.5 rounded shrink-0">
            esc
          </kbd>
        </div>

        {/* R125 (A6 B-9): sr-only polite mirror of the result state —
            typing used to be silent until the operator arrowed; the
            loading → results / no-results transitions now announce
            (4.1.3). Gated on resultsFor so the 220ms debounce window
            never announces a premature «لا نتائج». */}
        <div className="sr-only" aria-live="polite" role="status">
          {query.trim().length >= 2
            ? loading
              ? "جارٍ البحث…"
              : resultsFor === query.trim()
                ? total === 0
                  ? searchFailed
                    ? "تعذّر البحث — أعد المحاولة"
                    : `لا نتائج لـ "${query.trim()}"`
                  : formatCount(total, SEARCH_RESULT_FORMS)
                : ""
            : ""}
        </div>

        {/* Results — R125 (A6 B-9): the no-results message is a
            role="status" OUTSIDE the listbox (APG listbox children are
            options/groups only), and only renders once a search for
            THIS query has actually completed. R130 (A3-F3): a failed
            round renders the honest failure line — never the definitive
            «لا نتائج» over an outage. */}
        {query.length >= 2 && !loading && resultsFor === query.trim() && total === 0 ? (
          <div role="status" className="py-10 text-center text-muted-foreground text-sm">
            {searchFailed ? (
              <>تعذّر البحث — تحقّق من الاتصال وأعد المحاولة</>
            ) : (
              <>
                {/* R122 (A2-P2): scoped-out sections are never fetched —
                    this empty copy only ever speaks for the sections that
                    WERE searched (an admin with no search scope never
                    reaches the palette; see the triggers in AdminLayout). */}
                لا نتائج لـ "{query}"
              </>
            )}
          </div>
        ) : (
          query.length >= 2 && (
            <div id="global-search-results" role="listbox" className="max-h-72 overflow-y-auto">
              {/* R125 (A6 B-9): each section wrapper is role="group"
                  with an aria-label — the legal non-option listbox
                  child — and the visible header is aria-hidden so the
                  group name is not double-read. */}
              {results.orders.length > 0 && (
                <div className="p-2" role="group" aria-label="الطلبات">
                  <div
                    aria-hidden="true"
                    className="px-3 py-1 text-3xs font-bold text-muted-foreground"
                  >
                    الطلبات
                  </div>
                  {results.orders.map((o, i) => (
                    <button
                      key={o.id}
                      id={`global-search-option-${i}`}
                      role="option"
                      aria-selected={safeActive === i}
                      onClick={goToOrders}
                      /* R143 (L2-6): visible focus for DIRECT keyboard
                         focus (Tab lands on these buttons — the trap
                         keeps focus inside the palette); the arrow-key
                         highlight stays the calm-active fill below
                         (aria-selected — the r139 selected-state
                         vocabulary, untouched). Ring idiom mirrors the
                         shared Button base. */
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-right outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                        safeActive === i ? "bg-primary/15" : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{o.product_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {o.order_code} · {displayUserName(userFromRow(o))}
                        </div>
                      </div>
                      {/* R125 (A6 B-6): money value on dark card — raw
                          text-primary is 3.76:1; the text-primary-text
                          token (5.75:1) is the storefront sweep's
                          class applied here. */}
                      <span className="font-bold text-primary-text text-xs tabular-nums shrink-0">
                        {formatCurrency(o.amount)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {results.users.length > 0 && (
                <div className="p-2" role="group" aria-label="المستخدمون">
                  <div
                    aria-hidden="true"
                    className="px-3 py-1 text-3xs font-bold text-muted-foreground"
                  >
                    المستخدمون
                  </div>
                  {results.users.map((u, i) => {
                    const flatIdx = results.orders.length + i;
                    return (
                      <button
                        key={u.id}
                        id={`global-search-option-${flatIdx}`}
                        role="option"
                        aria-selected={safeActive === flatIdx}
                        onClick={goToUsers}
                        /* R139 (precision): the keyboard highlight migrates to
                           the calm-active fill — bg-primary/15, no ring (the
                           r138 selected-state vocabulary; the ring was a
                           competing edge device next to the ONE focus
                           system).
                           R143 (L2-6): focus-visible:ring-2 + ring-ring for
                           DIRECT focus (Tab-trapped tabbables) — the
                           selected-state fill above stays the arrow-key
                           treatment; the two devices never co-render. */
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-right outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                          safeActive === flatIdx ? "bg-primary/15" : "hover:bg-muted/40"
                        }`}
                      >
                        <div className="w-7 h-7 rounded-lg bg-status-info/10 flex items-center justify-center shrink-0">
                          <Users className="w-3.5 h-3.5 text-status-info" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* R154 (P3-D): placeholder-safe — the real phone
                              or the honest «no phone linked» line, never a
                              raw tg_/f_ placeholder. */}
                          <div className="font-mono text-sm font-bold">
                            {displayUserName(u as unknown as AdminUserShape)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {displayUserPhone(u as unknown as AdminUserShape)} ·{" "}
                            {formatCurrency(u.wallet_balance)} رصيد · {u.order_count} طلب
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {results.products.length > 0 && (
                <div className="p-2" role="group" aria-label="المنتجات">
                  <div
                    aria-hidden="true"
                    className="px-3 py-1 text-3xs font-bold text-muted-foreground"
                  >
                    المنتجات
                  </div>
                  {results.products.map((p, i) => {
                    const flatIdx = results.orders.length + results.users.length + i;
                    return (
                      <button
                        key={p.id}
                        id={`global-search-option-${flatIdx}`}
                        role="option"
                        aria-selected={safeActive === flatIdx}
                        onClick={goToProducts}
                        /* R139 (precision): same calm-active fill as the two
                           sibling option rows above — one selected-state
                           vocabulary down the whole flattened list.
                           R143 (L2-6): focus-visible ring for DIRECT
                           keyboard focus, mirroring the sibling rows. */
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-right outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                          safeActive === flatIdx ? "bg-primary/15" : "hover:bg-muted/40"
                        }`}
                      >
                        {/* R139 (precision): the product thumbnail well joins
                            the image-shelf family — bg-muted → bg-muted/60
                            (ProductCard's media plane, the empty-state tile:
                            one well family); border-border/40 → /35, the
                            tile family's edge. */}
                        <div className="w-7 h-7 rounded-lg bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden border border-border/35">
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.name || "صورة منتج"}
                              loading="lazy"
                              decoding="async"
                              /* R-140-a (image discipline): alt — the old
                                 `?? ""` fallback could render an EMPTY
                                 alt on a content image when the search
                                 payload ships a blank name; || gives it
                                 the honest «صورة منتج» floor instead.
                                 width/height mirror the catalog art's
                                 measured 450×450 intrinsic (all 45
                                 /products/*.webp, the R132 L4-F9 census
                                 re-probed this round) — the fixed w-7
                                 h-7 well already pins CLS at zero. */
                              width={450}
                              height={450}
                              className="w-full h-full object-contain p-1"
                            />
                          ) : (
                            <Package className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{p.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatCurrency(p.price)} · {p.stock_count} وحدة
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )
        )}

        {/* Idle hint */}
        {query.length < 2 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            {/* R122 (A2-P2): the idle hint names only the scoped-in
                sections; a no-section admin gets the honest scope
                message instead of a promise the palette cannot keep. */}
            {anySection
              ? `ابحث باسم المنتج، رقم الطلب، أو رقم الهاتف`
              : "البحث السريع يتطلب صلاحية عرض الطلبات أو المستخدمين أو المنتجات"}
          </div>
        )}

        {/* Footer */}
        {/* 94-C2 (A2 P2-3): the hints now tell the truth — ↑/↓ move the
            highlight, ↵ opens the highlighted result (keeping the query). */}
        {/* 96-F7 (R96 M13): hidden below sm — the ↑↓/↵/esc/⌘K promises
            are keyboard-only and dead weight on touch devices (no
            hardware keyboard to fulfill them; the backdrop tap closes). */}
        <div className="hidden sm:flex px-4 py-2 border-t border-border bg-muted/10 items-center gap-4 text-3xs text-muted-foreground">
          <span>
            <kbd className="font-mono bg-muted/60 px-1 rounded border border-border/40">↑↓</kbd>{" "}
            تنقّل
          </span>
          <span>
            <kbd className="font-mono bg-muted/60 px-1 rounded border border-border/40">↵</kbd>{" "}
            اختيار
          </span>
          <span>
            <kbd className="font-mono bg-muted/60 px-1 rounded border border-border/40">esc</kbd>{" "}
            إغلاق
          </span>
          <span className="mr-auto">
            <kbd className="font-mono bg-muted/60 px-1 rounded border border-border/40">⌘K</kbd> فتح
          </span>
        </div>
      </div>
    </div>
  );
}
