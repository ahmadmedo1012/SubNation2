import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import { formatCount, formatCurrency } from "@/lib/utils";
import { useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import {
  approveTopup,
  customFetch,
  getListAdminTopupsQueryKey,
  rejectTopup,
} from "@workspace/api-client-react";
import { RefreshCw, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE decomposition): the page's self-contained subcomponents and
// pure helpers moved to @/components/admin/topups/* (verbatim moves —
// the money path stays HERE: every state atom, the single approve/
// reject mutations with their per-click Idempotency-Key, the bulk +
// approve-all loops, and the single-approve confirm gate; the extracts
// render the byte-identical DOM they rendered inline yesterday).
// Import surface:
//   • topups-queue-meta — the page's pure module (the AdminTopupRow
//     type, the STATUS_FILTERS tab list, the frozen page size, the
//     Arabic plural forms, and the 401 session-expiry predicate the
//     money loops break on)
//   • TopupCard / TopupCardSkeleton — the queue rows (MethodBadge /
//     NetworkBadge ride along inside TopupCard)
//   • RejectModal / BulkConfirmModal — the two money-dialog shells
//     (their ephemeral note draft is field-local; the approve/reject
//     POST fires only through the page-owned onConfirm handlers)
//   • TopupsHeader — the stat strip (pending chip + honest count lines)
//   • TopupsToolbar / StatusFilterTabs — search, the bulk action
//     buttons, select-all, approve-all and the status tab bar
//   • TopupsEmptyStates — the partial-window and hard empty branches
import {
  isSessionExpiredError,
  STATUS_FILTERS,
  TOPUP_COUNT_FORMS,
  TOPUPS_PAGE_SIZE,
  type AdminTopupRow,
} from "@/components/admin/topups/topups-queue-meta";
import { TopupCard } from "@/components/admin/topups/TopupCard";
import { TopupCardSkeleton } from "@/components/admin/topups/TopupCardSkeleton";
import { RejectModal } from "@/components/admin/topups/RejectModal";
import { BulkConfirmModal } from "@/components/admin/topups/BulkConfirmModal";
import { TopupsHeader } from "@/components/admin/topups/TopupsHeader";
import { TopupsToolbar } from "@/components/admin/topups/TopupsToolbar";
import {
  TopupsHardEmptyState,
  TopupsPartialEmptyState,
} from "@/components/admin/topups/TopupsEmptyStates";

export default function AdminTopupsPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("finance");
  const jsonHeaders = useAdminHeaders({ json: true });
  const headers = useAdminHeaders();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // R120-B4 (A2-F7): the layout's «قيد الانتظار فقط» context action (the
  // R124-C2 statusLabel-aligned label) deep-links
  // /admin/topups?status=pending — the initial filter now consumes the
  // param (validated against the real filter values; anything else falls
  // back to the queue's default "pending" view).
  const [statusFilter, setStatusFilter] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("status") ?? "";
    return STATUS_FILTERS.some((s) => s.value === fromUrl) ? fromUrl : "pending";
  });
  // R124-I5 (A6 F14a): the money queue's search. The frozen list route
  // (routes/admin/topups.ts) supports ?status=&page=&limit= but NO
  // ?search= — so the filter runs client-side over the ACCUMULATED
  // pages, with the honest partial-window hint while more pages exist
  // (the products.tsx category-filter discipline). 300ms debounce per
  // the admin search idiom (orders/users/products) so typing pauses,
  // not keystrokes, drive the re-filter.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<"approve" | "reject" | "approveAll" | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  // B5-01 (round-92 audit): approveAll busy state + live progress — see
  // the approveAll comment below.
  const [isApproveAllBusy, setIsApproveAllBusy] = useState(false);
  const [approveAllProgress, setApproveAllProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  // 93-C6 / F-07 (A5 T-1/S-1): the single "موافقة" button credits a
  // wallet in ONE TAP — it now opens the shared useConfirm dialog
  // (amount + user + payment reference) before the POST fires, the
  // same friction the reject modal already had. Asymmetric money
  // friction fixed: the money-CREATING action was the unconfirmed one.
  const { confirm, ConfirmDialog } = useConfirm();

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: "Escape",
      handler: () => {
        // 94-C2 (A2 P3-7): ESC during an in-flight reject no longer
        // closes the modal + re-arms the row buttons while the POST is
        // still running (double-action window). The modal itself guards
        // ESC/backdrop with `loading` — this global handler defers to it.
        if (rejectTarget) {
          const rejecting = processingId === rejectTarget.id;
          if (!rejecting) {
            setRejectTarget(null);
            setProcessingId(null);
          }
        }
        // Don't dismiss the bulk confirm mid-loop: the money requests
        // are already in flight and the modal carries the live progress
        // counter — closing it would strand the busy state with no
        // visible indicator (the cancel button is disabled while
        // loading for the same reason).
        if (bulkAction && !isBulkProcessing && !isApproveAllBusy) {
          setBulkAction(null);
        }
      },
      description: "إغلاق النافذة",
    },
  ]);

  // R126-L3 (A1-10) + 94-C2 (A2 P1-1): the money queue is an
  // accumulating infinite query over the frozen `?page=&limit=`
  // contract — now with the backend `?status=` param riding the ACTIVE
  // TAB (a per-tab query key, the tickets.tsx statusFilter idiom).
  // Previously the fetch pulled ALL statuses and the tabs filtered
  // client-side, so the PENDING tab over a partial window could read
  // the hard «لا توجد طلبات قيد الانتظار» while pending rows older
  // than the newest 100 sat on unloaded pages — and the header chip /
  // tab count read 0 against the sidebar badge's server truth. With
  // the server-side filter, page 1 of the pending tab IS the pending
  // head: the tab can never false-empty while a pending row exists,
  // and its counts describe the server-filtered window. The key keeps
  // the "/api/admin/topups" prefix so the existing invalidations
  // (approve/reject/bulk loops/socket) still refresh the accumulated
  // pages of every tab.
  const topupsListParams = { status: statusFilter || undefined, limit: TOPUPS_PAGE_SIZE };
  const {
    data: topupsPages,
    isLoading,
    // 93-C6 / F-07 (A5 S-2): a failed load previously fell through to
    // "لا توجد طلبات معلقة" — the money queue LOOKED empty during an
    // outage (the worst possible page for that).
    isError,
    error,
    refetch,
    // 94-C2 (A2 P1-1): append controls + the implicit "more may exist"
    // flag (a full page).
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<AdminTopupRow[], Error>({
    queryKey: ["/api/admin/topups", "load-more", topupsListParams],
    queryFn: ({ pageParam, signal }) =>
      customFetch<AdminTopupRow[]>(
        `/api/admin/topups?page=${pageParam}&limit=${TOPUPS_PAGE_SIZE}${statusFilter ? `&status=${statusFilter}` : ""}`,
        {
          signal,
          headers,
        },
      ),
    initialPageParam: 1,
    // Frozen contract (A2 P1-1): plain-array body — a full page means
    // the next page MIGHT exist; a short page is the definite end.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === TOPUPS_PAGE_SIZE ? allPages.length + 1 : undefined,
    enabled: !!adminToken && canView,
    // Round-4 (perf P1-3): the admin-room socket listener invalidates
    // topups on every `admin-stats-update` push (approve/reject) —
    // 5-min fallback only (was 20 s).
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  // R125-I2 (A5-F2): memoized — `.flat()` mints a fresh array identity
  // on every render, which defeated the useMemo chain below (and every
  // card's `topup` prop identity) on each keystroke. topupsPages only
  // changes identity on query updates. The `?? []` fallback keeps a
  // STABLE empty identity inside the memo — a fresh `[]` per render was
  // the exact trap orders.tsx:647-654 and users.tsx:446-449 fixed.
  const allTopups = useMemo(
    () => (topupsPages?.pages ?? []).flat() as AdminTopupRow[],
    [topupsPages],
  );

  // 94-C2 (A2 P1-1): the queue total is only provably known when a
  // single short page arrived — otherwise «عرض N» (never «إجمالاً
  // N» for a truncated window).
  const knownTotal = (topupsPages?.pages.length ?? 0) <= 1 && allTopups.length < TOPUPS_PAGE_SIZE;

  const invalidate = () =>
    // Base key (no params) so the accumulating infinite query — and any
    // other consumer under /api/admin/topups — refreshes on approve/
    // reject/bulk loops.
    queryClient.invalidateQueries({ queryKey: getListAdminTopupsQueryKey() });

  // F-008 (security audit 004) — every state-changing admin call to
  // /api/admin/topups/:id/{approve,reject} carries an Idempotency-Key
  // header. The backend middleware
  // (backend/src/middlewares/idempotency.ts) caches the response per
  // (admin, route, key) for 24 h, so a network retry / accidental
  // double-click cannot double-credit the wallet. We use useMutation
  // directly (not the generated useApproveTopup / useRejectTopup
  // hooks) because the generated hooks fix the variable type to
  // `{id, data}`, which doesn't accommodate the per-call
  // idempotencyKey we need to thread through.
  const approveMutation = useMutation({
    mutationKey: ["approveTopup"],
    mutationFn: ({
      id,
      data,
      idempotencyKey,
    }: {
      id: number;
      data: { admin_note?: string };
      idempotencyKey: string;
    }) =>
      approveTopup(id, data, {
        headers: withIdempotencyKey(headers, idempotencyKey),
      }),
    onSuccess(_, vars) {
      setProcessingId(null);
      invalidate();
      const t = allTopups.find((x) => x.id === vars.id);
      // R124-I5 (A6 F1): success variant — the single approve/reject are
      // money actions and were the only blue-default toasts on the page
      // while their bulk equivalents (below) render green.
      toast({
        title: "تمت الموافقة",
        // R134 (the R126-A1-13 close-out): the actor preposition is
        // unified — approve and reject describe the SAME actor-action
        // pair, so both read «من» (the transfer came FROM the user's
        // phone); «لـ» implied crediting the phone, which approve does
        // not do.
        description: t
          ? `${formatCurrency(t.amount)} من ${t.user_phone}`
          : "تمت الموافقة على الطلب",
        variant: "success",
      });
    },
    onError(err: unknown) {
      setProcessingId(null);
      // 93-C6 / F-07 (SIM P1 + A5 S-1): the error envelope is parsed —
      // C1's backend now returns 409 DUPLICATE_PAYMENT_REFERENCE with
      // a full Arabic explanation (sibling topup ids) and 409 CONFLICT
      // for concurrent-state races; the generic "حاول مرة أخرى" hid
      // all of it.
      toast({
        title: "فشلت الموافقة",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationKey: ["rejectTopup"],
    mutationFn: ({
      id,
      data,
      idempotencyKey,
    }: {
      id: number;
      data: { admin_note?: string };
      idempotencyKey: string;
    }) =>
      rejectTopup(id, data, {
        headers: withIdempotencyKey(headers, idempotencyKey),
      }),
    onSuccess(_, vars) {
      setProcessingId(null);
      setRejectTarget(null);
      invalidate();
      const t = allTopups.find((x) => x.id === vars.id);
      // R124-I5 (A6 F1): same success variant as the approve toast above
      // (parity with the green bulk-reject summary at the bottom of the
      // file) — the action completed; the queue is safer for it.
      toast({
        title: "تم الرفض",
        description: t ? `${formatCurrency(t.amount)} من ${t.user_phone}` : "تم رفض الطلب",
        variant: "success",
      });
    },
    onError(err: unknown) {
      setProcessingId(null);
      // 93-C6 / F-07: same envelope-parsing as approve (see above).
      toast({
        title: "فشل الرفض",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  // R124-I5 (A6 F14a): the status tab now rides the SERVER-side
  // ?status= param (R126-L3 A1-10) — only the debounced SEARCH stays
  // client-side over the accumulated pages of the active tab (the
  // route supports no ?search=). Lives ABOVE the adminToken
  // early-return (rules of hooks).
  const topups = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return allTopups;
    return allTopups.filter((t) =>
      // Search by reference / phone / user: the operator's lookup keys
      // for a single topup in the queue (payment reference, sender +
      // user phone, and the display name when present).
      [
        t.payment_reference,
        t.user_phone,
        t.sender_phone,
        t.sender_account,
        t.user_display_name,
      ].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [allTopups, debouncedSearch]);
  // R125-I2 (A5-F2): the inline per-render aggregates moved up here
  // into the memo chain — pendingTopups/statusCounts previously
  // re-filtered the full accumulated set on EVERY render (each
  // keystroke, each processingId/selectedIds flip). Lives ABOVE the
  // adminToken early-return (rules of hooks — same as `topups`).
  const pendingTopups = useMemo(() => allTopups.filter((t) => t.status === "pending"), [allTopups]);
  const selectedPendingCount = useMemo(
    () => pendingTopups.reduce((n, t) => (selectedIds.has(t.id) ? n + 1 : n), 0),
    [pendingTopups, selectedIds],
  );
  const allPendingSelected =
    pendingTopups.length > 0 && selectedPendingCount === pendingTopups.length;

  const statusCounts = useMemo(
    () =>
      allTopups.reduce((acc: Record<string, number>, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {}),
    [allTopups],
  );

  // R126-L3 (A1-10): with the per-tab server-side fetch, the loaded
  // window speaks only for the ACTIVE tab's status. On the pending
  // tab this is the server-filtered pending head (a real count, never
  // a false 0 while pending rows exist); on the all-tab it is the
  // within-window count as before; on other tabs it is not claimable
  // — 0 keeps the chip + bulk bar hidden instead of lying, and the
  // sidebar badge (layout's server stats) carries the global truth.
  const pendingCount = statusCounts["pending"] ?? 0;

  const searchActive = debouncedSearch.trim() !== "";

  // R125-I2 (A5-F2): useCallback-stable handlers so the memoized
  // TopupCard bails on keystroke/selection re-renders (the orders.tsx
  // :936-953 idiom). Declared BEFORE the !adminToken early return —
  // hooks must run unconditionally (rules of hooks; setters + the
  // memoized inputs are stable so hoisting is behavior-neutral for the
  // authenticated render). allTopups is itself memoized and `confirm` +
  // the mutation `.mutate` are stable across renders, so these
  // identities survive unrelated state flips; a data update re-mints
  // them, which is correct (the rows re-render with fresh data then).
  const handleApprove = useCallback(
    async (id: number) => {
      // 93-C6 / F-07 (A5 T-1): confirm BEFORE the money moves. The
      // amount, user, and payment reference are all already on the card
      // — surface them in one dialog so an accidental tap (or a
      // touch-screen double-fire on a list where REJECT sits beside
      // approve) can never credit a wallet.
      const t = allTopups.find((x) => x.id === id);
      if (!t) return;
      const ok = await confirm({
        title: "تأكيد الموافقة",
        description: `سيتم إضافة ${formatCurrency(t.amount)} إلى محفظة ${t.user_phone}${t.sender_phone ? ` · المُرسل: ${t.sender_phone}` : ""}${t.payment_reference ? ` · رمز التحويل: ${t.payment_reference}` : ""}.`,
        confirmLabel: "موافقة",
      });
      if (!ok) return;
      setProcessingId(id);
      // F-008: one Idempotency-Key per click. React Query reuses these
      // variables on internal retries, so the key survives a transient
      // network failure and the backend replays the cached response
      // instead of double-crediting.
      approveMutation.mutate({
        id,
        data: { admin_note: "تمت الموافقة" },
        idempotencyKey: generateIdempotencyKey(),
      });
    },
    [allTopups, confirm, approveMutation],
  );

  const handleReject = useCallback(
    (note: string) => {
      if (!rejectTarget) return;
      setProcessingId(rejectTarget.id);
      rejectMutation.mutate({
        id: rejectTarget.id,
        data: { admin_note: note || "مرفوض" },
        idempotencyKey: generateIdempotencyKey(),
      });
    },
    [rejectTarget, rejectMutation],
  );

  const handleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    // R125-I2: rides the memoized pendingTopups (was a fresh filter per
    // call — same work, now shared with the header aggregates).
    const allSelected = pendingTopups.every((t) => selectedIds.has(t.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingTopups.map((t) => t.id)));
    }
  }, [pendingTopups, selectedIds]);

  if (!adminToken) return null;

  // R122 (A2-P2): the bulk loops accept the operator's optional note
  // (BulkConfirmModal's new field) — empty keeps the old boilerplate
  // fallback so the ledger always carries SOME reason.
  const handleBulkAction = async (action: "approve" | "reject", note = "") => {
    setIsBulkProcessing(true);
    const ids = Array.from(selectedIds);
    let successCount = 0;
    const failures: Array<{ id: number; reason: string }> = [];
    // R123 (E3 P3h): the session-expiry exit breaks and returns INSIDE
    // try/finally — the old fallthrough also reset the flags, but only
    // after firing invalidate() + a per-failure toast into the redirect
    // (noise on top of the global «انتهت الجلسة» toast).
    let sessionExpired = false;
    try {
      // 93-C6 / F-07 (A5 T-2): the selected-bulk loop now parses each
      // failure body (approveAll, one function below, already did) —
      // count-only feedback ("فشل 2 من 5") hid the 409
      // DUPLICATE_PAYMENT_REFERENCE / CONFLICT reasons behind a generic
      // toast while the adjacent approveAll summarized them properly.

      // F-008 (security audit 004): one Idempotency-Key per topup, NOT
      // one for the whole bulk. The backend dedup is per-(admin, route,
      // key); a single key shared across N approvals would let only the
      // first call commit and the next N-1 would replay the first
      // response, leaving the rest of the topups untouched. Each topup
      // is its own logical action — generate a fresh key per iteration.
      // R127-L1 (B1 §3.2): the loop rides the GENERATED fetchers now
      // (approveTopup/rejectTopup — the same calls the single-item
      // mutations above make). The per-iteration key survives verbatim
      // via fetcher options.headers (customFetch merges it after its own
      // Content-Type); the !r.ok hand-parse + the network catch COLLAPSE
      // into one catch — getErrorMessage already speaks ApiError fluently
      // (data.error Arabic-first, code map, HTTP-prefix strip), so the
      // R126-L3 Arabic-reason routing is preserved by construction.
      const fetcher = action === "approve" ? approveTopup : rejectTopup;
      const fallbackNote =
        note.trim() || (action === "approve" ? "تمت الموافقة الجماعية" : "مرفوض جماعياً");
      for (const id of ids) {
        try {
          await fetcher(
            id,
            { admin_note: fallbackNote },
            {
              headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),
            },
          );
          successCount++;
        } catch (e) {
          // 93-C6 / F-07 (A5 S-3): session expired mid-loop — customFetch
          // has already toasted + redirected; stop the money loop quietly.
          if (isSessionExpiredError(e)) {
            sessionExpired = true;
            break;
          }
          failures.push({
            id,
            // R126-L3 (A2/A8) preserved: the Arabic guard maps the
            // ApiError body's code/error to Arabic and collapses
            // message-less bodies (proxy 502s) to the generic Arabic
            // line instead of a bare English "HTTP 502".
            reason: getErrorMessage(e),
          });
        }
      }

      if (sessionExpired) return;
      setSelectedIds(new Set());
      invalidate();
      if (failures.length > 0) {
        toast({
          title:
            successCount > 0
              ? `${action === "approve" ? "تمت الموافقة الجماعية" : "تم الرفض الجماعي"} — ${successCount} من ${ids.length}`
              : "خطأ",
          description: `فشلت ${failures.length} من ${ids.length} — ${failures
            .map((f) => `#${f.id}: ${f.reason}`)
            .join("، ")}`,
          variant: "destructive",
        });
      }
      // Only announce success when at least one item actually succeeded —
      // the unconditional toast used to show "✓ تمت الموافقة 0/N" right
      // after the failure toast on a total failure.
      if (successCount > 0 && failures.length === 0) {
        toast({
          title: action === "approve" ? "تمت الموافقة الجماعية" : "تم الرفض الجماعي",
          // B14-5 / A8-F19 (R127-L11, the held site): the count rides
          // formatCount + this file's own TOPUP_COUNT_FORMS — the frozen
          // «N طلب» read «3 طلب تمت معالجته». The X/Y prefix is dropped:
          // this arm only fires with failures.length === 0, i.e.
          // successCount === ids.length, so «N/N» carried no extra
          // information (the partial-failure toast above keeps the
          // honest «N من M» shape).
          description: `تمت معالجة ${formatCount(successCount, TOPUP_COUNT_FORMS)}`,
          variant: "success",
        });
      }
    } finally {
      // R123 (E3 P3h): the flags reset on EVERY exit path — including
      // the session-expiry return above.
      setBulkAction(null);
      setIsBulkProcessing(false);
    }
  };

  // B5-01 (round-92 audit): approveAll previously ran its sequential
  // money loop with NO busy state — the "موافقة الكل" button stayed
  // enabled, so a double-click started TWO parallel loops, each
  // generating fresh Idempotency-Keys per iteration, which the backend
  // per-(admin, route, key) dedupe cannot correlate. The confirmation
  // is the file's own BulkConfirmModal (replacing the raw
  // window.confirm), the loop is single-entry (re-click guard +
  // disabled button), the modal/button carry a live "جاري done/total"
  // counter for long queues, and per-item failures are collected and
  // summarized in ONE toast with per-item reasons instead of two
  // count-only toasts.
  const approveAll = async (note = "") => {
    if (isApproveAllBusy) return; // re-click guard (double-loop prevention)
    const pending = allTopups.filter((t) => t.status === "pending");
    if (pending.length === 0) return;
    setIsApproveAllBusy(true);
    setApproveAllProgress({ done: 0, total: pending.length });
    let approvedCount = 0;
    const failures: Array<{ id: number; reason: string }> = [];
    // R123 (E3 P3h): the session-expiry exit rides the same
    // sessionExpired + try/finally shape as handleBulkAction above —
    // the flags reset on EVERY exit path and no summary toast/
    // invalidate fires into the redirect.
    let sessionExpired = false;
    try {
      // R127-L1 (B1 §3.2): the approveAll loop rides the generated
      // approveTopup fetcher — same shape as handleBulkAction above
      // (per-iteration idempotency key via options.headers, 401 break
      // via the ApiError duck-type, one getErrorMessage catch).
      for (const [index, t] of pending.entries()) {
        try {
          await approveTopup(
            t.id,
            {
              // R122 (A2-P2): the operator's bulk-confirm note rides every
              // row — empty keeps the boilerplate fallback (see
              // handleBulkAction).
              admin_note: note.trim() || "تمت الموافقة الجماعية",
            },
            {
              // Same per-iteration key generation as handleBulkAction above.
              headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),
            },
          );
          approvedCount++;
        } catch (e) {
          // 93-C6 / F-07 (A5 S-3): session expired mid-loop — abort the
          // money loop (the global handler has toasted + redirected);
          // nothing further is submitted or summarized.
          if (isSessionExpiredError(e)) {
            sessionExpired = true;
            break;
          }
          // R126-L3 (A2/A8) preserved: getErrorMessage maps the ApiError
          // body to Arabic — no bare "HTTP 502" fragments in the money
          // summary toast.
          failures.push({
            id: t.id,
            reason: getErrorMessage(e),
          });
        }
        setApproveAllProgress({ done: index + 1, total: pending.length });
      }
      if (sessionExpired) return;
      invalidate();
      // Summary toast: "X نجحت / Y فشلت" + per-item failure reasons.
      if (failures.length === 0) {
        toast({
          title: `تمت الموافقة على ${formatCount(approvedCount, TOPUP_COUNT_FORMS)}`,
          variant: "success",
        });
      } else {
        toast({
          title:
            approvedCount > 0
              ? `تمت الموافقة على ${approvedCount} من ${pending.length} طلب`
              : "خطأ",
          description: `نجحت ${approvedCount} · فشلت ${failures.length} — ${failures
            .map((f) => `#${f.id}: ${f.reason}`)
            .join("، ")}`,
          variant: "destructive",
        });
      }
    } finally {
      // R123 (E3 P3h): the flags reset on EVERY exit path — including
      // the session-expiry return above (previously duplicated inline).
      setBulkAction(null);
      setIsApproveAllBusy(false);
      setApproveAllProgress(null);
      setSelectedIds(new Set());
    }
  };

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="finance" />;
  }

  return (
    <AdminLayout onRefresh={() => refetch()} badges={{ pendingTopups: pendingCount }}>
      {/* Reject modal — F3-03 (R111): always mounted, Radix owns the
          open/close lifecycle (focus trap + return + close animation);
          `open` is driven by rejectTarget exactly like the old
          conditional render. */}
      <RejectModal
        topup={rejectTarget}
        open={!!rejectTarget}
        onConfirm={handleReject}
        onCancel={() => {
          setRejectTarget(null);
          setProcessingId(null);
        }}
        loading={!!rejectTarget && processingId === rejectTarget.id}
      />

      {/* Bulk action confirmation modal — also backs the approveAll
          flow (B5-01: replaced its raw window.confirm). */}
      <BulkConfirmModal
        open={bulkAction !== null}
        action={bulkAction === "approveAll" ? "approve" : (bulkAction ?? "approve")}
        count={bulkAction === "approveAll" ? pendingCount : selectedPendingCount}
        // R122 (A2-P2): the modal's optional note threads into whichever
        // loop the confirm fires (bulk approve/reject or approveAll).
        onConfirm={(note) =>
          bulkAction === "approveAll"
            ? void approveAll(note)
            : bulkAction === "approve" || bulkAction === "reject"
              ? void handleBulkAction(bulkAction, note)
              : undefined
        }
        onCancel={() => setBulkAction(null)}
        loading={bulkAction === "approveAll" ? isApproveAllBusy : isBulkProcessing}
        progress={bulkAction === "approveAll" ? approveAllProgress : null}
      />

      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <TopupsHeader
            pendingCount={pendingCount}
            knownTotal={knownTotal}
            statusFilter={statusFilter}
            searchActive={searchActive}
            allTopups={allTopups}
            topups={topups}
            pendingTopups={pendingTopups}
          />

          {/* flex-wrap: bulk actions + status tabs overflow the 375px
              viewport without it (select-all + approve-all + reject + 4
              status chips on one row). */}
          <TopupsToolbar
            search={search}
            setSearch={setSearch}
            selectedPendingCount={selectedPendingCount}
            setBulkAction={setBulkAction}
            handleSelectAll={handleSelectAll}
            allPendingSelected={allPendingSelected}
            pendingTopups={pendingTopups}
            pendingCount={pendingCount}
            isApproveAllBusy={isApproveAllBusy}
            approveAllProgress={approveAllProgress}
            hasNextPage={hasNextPage}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            allTopups={allTopups}
          />
        </div>

        {/* R124-I5 (A6 F14a): partial-window honesty — the client-side
            search only sees the ACCUMULATED pages; while load-more
            remains, say so instead of letting «لا نتائج» claim the whole
            history (the products.tsx capped-window hint idiom). */}
        {searchActive && hasNextPage && !isLoading && !isError && (
          <p className="text-3xs text-muted-foreground">
            البحث يعمل على الطلبات المعروضة فقط — حمّل المزيد لتوسيع النطاق
          </p>
        )}

        {/* List */}
        {/* 93-C6 / F-07 (A5 S-2): refresh of an already-rendered queue
            failed — keep the stale cards, surface the failure inline. */}
        {isError && allTopups.length > 0 && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span className="min-w-0">{getErrorMessage(error)}</span>
            <button
              type="button"
              onClick={() => refetch()}
              className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <TopupCardSkeleton key={i} />
            ))}
          </div>
        ) : isError && allTopups.length === 0 ? (
          /* 93-C6 / F-07 (A5 S-2): a failed load is NOT an empty money
             queue — an outage/expired session previously rendered "لا
             توجد طلبات معلقة" and the operator believed the queue was
             clear (the worst false-empty in the panel). */
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل طلبات الشحن"
            description={`${getErrorMessage(error)} — تحقّق من شبكتك ثم أعد المحاولة`}
            onRetry={() => refetch()}
          />
        ) : topups.length === 0 ? (
          searchActive && hasNextPage ? (
            <TopupsPartialEmptyState
              debouncedSearch={debouncedSearch}
              isFetchingNextPage={isFetchingNextPage}
              isLoading={isLoading}
              fetchNextPage={fetchNextPage}
              setSearch={setSearch}
            />
          ) : (
            <TopupsHardEmptyState
              searchActive={searchActive}
              debouncedSearch={debouncedSearch}
              statusFilter={statusFilter}
              setSearch={setSearch}
            />
          )
        ) : (
          <div className="space-y-2.5">
            {/* R125-I2 (A5-F2): the memoized row component — see the
                TopupCard block comment above the component definition. */}
            {topups.map((t, i: number) => (
              <TopupCard
                key={t.id}
                topup={t}
                idx={i}
                isSelected={selectedIds.has(t.id)}
                isProcessing={processingId === t.id}
                isRejecting={processingId === t.id && rejectTarget?.id === t.id}
                onSelect={handleSelect}
                onApprove={handleApprove}
                onReject={setRejectTarget}
              />
            ))}
          </div>
        )}

        {/* 94-C2 (A2 P1-1): "load more" appends the next page of the
            frozen `?page=N+1&limit=` contract in place — the pending
            rows hidden behind the old silent 100-row cap become
            reachable without wiping the operator's selections. The
            button hides once a short page arrives. */}
        {hasNextPage && !isLoading && !isError && (
          <div className="flex justify-center pt-1">
            <LoadMoreButton busy={isFetchingNextPage} onClick={() => void fetchNextPage()} />
          </div>
        )}
      </div>
      {/* 93-C6 / F-07: the single-approve confirmation dialog mount
          (useConfirm idiom — styled AlertDialog, ESC/rtl-correct). */}
      <ConfirmDialog />
    </AdminLayout>
  );
}

// AUD103-6-F2 (r103): admin form labels programmatically associated with their controls.
