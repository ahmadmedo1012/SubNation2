import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { EmptyState } from "@/components/admin/EmptyState";
// R137 (FE) decomposition: the page's presentational sections and pure
// helpers moved to @/components/admin/users/* (verbatim moves — the
// money path, the 99-M3 save-intent Idempotency-Key machinery, every
// state atom and every handler stay HERE; the extracts render the
// byte-identical DOM they rendered inline yesterday). Import surface:
//   • user-directory-meta — the page's pure module (the EditUserForm
//     contract, the tier/sort option lists, the tier→badge tone map,
//     the load-more page size, the Arabic count forms and
//     describeSaveError)
//   • UsersToolbar / UsersFilterPanel / UsersStatsStrip — the header
//     (search box + filter toggle + CSV export), the ?filters= panel
//     and the loaded-sample summary cards (every control calls a
//     page-owned handler)
//   • UserEditDialog — the wallet/points money-edit shell (the form
//     atoms, handleSave and the 99-M3 intent key stay here; every
//     input calls a page-owned handler)
//   • UsersTableSkeleton / UsersDesktopTable / MobileUserCard — the
//     directory table (the memo rows + the provider pill row ride
//     along inside their consumers)
import {
  type EditUserForm,
  SORT_OPTIONS,
  TIER_FILTERS,
  USERS_PAGE_SIZE,
  describeSaveError,
} from "@/components/admin/users/user-directory-meta";
import { UsersTableSkeleton } from "@/components/admin/users/UsersTableSkeleton";
import { UsersToolbar } from "@/components/admin/users/UsersToolbar";
import { UsersFilterPanel } from "@/components/admin/users/UsersFilterPanel";
import { UsersStatsStrip } from "@/components/admin/users/UsersStatsStrip";
import { UserEditDialog } from "@/components/admin/users/UserEditDialog";
import { UsersDesktopTable } from "@/components/admin/users/UsersDesktopTable";
import { MobileUserCard } from "@/components/admin/users/MobileUserCard";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { AdminSessionExpiredError, adminFetch, isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
// R128 (B3-F2): the shared guarded CSV escaper (was the local csvCell).
import { csvCell } from "@/lib/csv";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import { formatCurrency, formatDate, tierLabel } from "@/lib/utils";
import {
  displayUserName,
  displayUserPhone,
  telegramIdentityLine,
  type AdminUserShape,
} from "@/lib/admin/user-display";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  getListAdminUsersQueryKey,
  type AdminUser,
} from "@workspace/api-client-react";
import { RefreshCw, Users, WifiOff } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
// R123 (E3 P3a): two-way URL filter sync follows the settings.tsx ?tab=
// idiom — useSearch re-renders on ?tier=/?sort=/?filters= changes.
import { useLocation, useSearch } from "wouter";
// R123 (E3 P3c): the wallet-edit dialog's dirty guard (below).
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";

export default function AdminUsersPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("users");
  const jsonHeaders = useAdminHeaders({ json: true });
  const headers = useAdminHeaders();
  const [, navigate] = useLocation();
  // R123 (E3 P3a): the URL is the second source of truth for the filter
  // panel (see the sync effects below).
  const searchParam = useSearch();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState(
    // 94-C2 (A2 P2-3): the GlobalSearch palette deep-links here with
    // ?search= — prefill the box (and the debounced mirror so the
    // first query already carries it, no double fetch).
    () => new URLSearchParams(window.location.search).get("search") ?? "",
  );
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  // R123 (E3 P3a): tier/sort/panel state initializes from the URL
  // (validated against the real option values; garbage falls back to
  // the defaults) so a shared directory link can pin a view.
  const [tierFilter, setTierFilter] = useState(() => {
    const t = new URLSearchParams(window.location.search).get("tier") ?? "";
    return TIER_FILTERS.some((x) => x.value === t) ? t : "";
  });
  const [sortBy, setSortBy] = useState(() => {
    const s = new URLSearchParams(window.location.search).get("sort") ?? "";
    return SORT_OPTIONS.some((x) => x.value === s) ? s : "wallet_desc";
  });
  const [showFilters, setShowFilters] = useState(
    () => new URLSearchParams(window.location.search).get("filters") === "1",
  );
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  // 99-M3 (R99-A2 P1 — money): ONE Idempotency-Key per SAVE INTENT, not per
  // HTTP attempt. The key used to be minted inline inside the fetch call —
  // a lost HTTP response (network drop after the server committed) followed
  // by the admin clicking "حفظ" again minted a FRESH key, and unlike every
  // other admin money route (topup/refund/referral — each protected by a
  // per-record status guard), the wallet-adjustment PATCH has no record
  // guard in AdjustmentService: the second request double-applied the delta
  // (add → double-credit, subtract → double-debit). The ref survives across
  // attempts of the same intent and is cleared only on a DEFINITIVE
  // resolution (success or a non-IN_FLIGHT rejection). 409
  // IDEMPOTENCY_IN_FLIGHT keeps it — the same-key request is still
  // executing server-side and the retry must replay, not re-execute.
  const saveIntentKeyRef = useRef<string | null>(null);
  const [form, setForm] = useState<EditUserForm>({
    wallet_mode: "add",
    wallet_value: "",
    // (r110) see EditUserForm.note — the wallet/points edit reason.
    note: "",
    loyalty_points: "",
  });
  // 93-C6 / F-07 (A5 S-1): the wallet save is a money action — it now
  // requires an explicit confirmation with a resulting-balance
  // preview (same useConfirm idiom as the orders bulk refund).
  const { confirm, ConfirmDialog } = useConfirm();

  // R123 (E3 P3c): an open wallet-edit dialog with a typed amount, an
  // edited points value, or a drafted note is un-submitted MONEY work
  // — the same beforeunload guard the other long admin forms ride
  // (openEdit re-seeds the form, so "unchanged" flips back to clean).
  // Sits ABOVE the logged-out early return like every other hook, and
  // mirrors the pointsChangedNow derivation below (kept local here —
  // that const is declared after the return, so the hook cannot
  // reference it without a TDZ crash).
  const draftPointsChanged =
    editingUser != null &&
    form.loyalty_points.trim() !== "" &&
    Math.max(0, parseInt(form.loyalty_points) || 0) !==
      (Number(editingUser.loyalty_points ?? 0) || 0);
  useDirtyGuard(
    editingUser != null &&
      (form.wallet_value.trim() !== "" || form.note.trim() !== "" || draftPointsChanged),
  );

  // 300ms debounce (same pattern as admin/referrals) so the users
  // query doesn't fire per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // R123 (E3 P3a): URL → filters (a ?tier=/?sort=/?filters= change lands
  // without clobbering a filter the operator already picked locally —
  // the settings.tsx ?tab= contract). Deliberately BEFORE the early
  // return below: a logged-out render must not skip a hook.
  useEffect(() => {
    const q = new URLSearchParams(searchParam);
    const t = q.get("tier");
    if (t && TIER_FILTERS.some((x) => x.value === t)) {
      setTierFilter((prev) => (prev === t ? prev : t));
    }
    const s = q.get("sort");
    if (s && SORT_OPTIONS.some((x) => x.value === s)) {
      setSortBy((prev) => (prev === s ? prev : s));
    }
    const open = q.get("filters") === "1";
    setShowFilters((prev) => (prev === open ? prev : open));
  }, [searchParam]);

  // R123 (E3 P3a): filters → URL (replaceState — flips don't spam the
  // history stack; default/hidden values drop the param entirely).
  const syncFilterParams = (tier: string, sort: string, filtersOpen: boolean) => {
    const url = new URL(window.location.href);
    if (tier) url.searchParams.set("tier", tier);
    else url.searchParams.delete("tier");
    if (sort && sort !== "wallet_desc") url.searchParams.set("sort", sort);
    else url.searchParams.delete("sort");
    if (filtersOpen) url.searchParams.set("filters", "1");
    else url.searchParams.delete("filters");
    window.history.replaceState(null, "", url.toString());
  };

  const {
    data: usersPages,
    isLoading,
    // 93-C6 / F-07 (A5 S-2): a failed load previously fell through to
    // the "لا يوجد مستخدمون" empty state — an outage made the whole
    // user directory LOOK empty.
    isError,
    error,
    refetch,
    // 94-C2 (A2 P1-1): append controls + the implicit "more may
    // exist" flag (a full page).
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<AdminUser[], Error>({
    // Key keeps the "/api/admin/users" prefix so the existing
    // invalidations still refresh the accumulated pages; `search` in
    // the key restarts at page 1 and aborts the in-flight request via
    // the queryFn's AbortSignal (94-C2).
    queryKey: ["/api/admin/users", "load-more", { search: debouncedSearch.trim() || undefined }],
    queryFn: ({ pageParam, signal }) => {
      const qs = new URLSearchParams({
        page: String(pageParam),
        limit: String(USERS_PAGE_SIZE),
      });
      const s = debouncedSearch.trim();
      if (s) qs.set("search", s);
      return customFetch<AdminUser[]>(`/api/admin/users?${qs.toString()}`, { signal, headers });
    },
    initialPageParam: 1,
    // Frozen contract (A2 P1-1): plain-array body — a full page means
    // the next page MIGHT exist; a short page is the definite end.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === USERS_PAGE_SIZE ? allPages.length + 1 : undefined,
    enabled: !!adminToken && canView,
    // Round-4 (perf P1-3): the admin-room socket listener invalidates
    // users on every `admin-stats-update` push (wallet/loyalty writes
    // change user rows) — 5-min fallback only.
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  // R124-I5 (A6 F4 — R118-B2): `.flat()` mints a fresh array identity per
  // render, defeating the memo chain below (and every row's `user` prop
  // identity) on each keystroke; usersPages only changes on query updates.
  const users: AdminUser[] = useMemo(() => (usersPages?.pages ?? []).flat(), [usersPages]);
  // 94-C2 (A2 P1-1): the directory size is only provably known when a
  // single short page arrived — «عرض N» otherwise.
  const knownTotal = (usersPages?.pages.length ?? 0) <= 1 && users.length < USERS_PAGE_SIZE;

  // R124-I5 (A6 F4 — R118-B2): the summary aggregates + the client-side
  // tier filter/sort are derived through useMemo keyed on
  // [users, tierFilter, sortBy] so a keystroke skips the re-sort/reduce
  // entirely (they only recompute when data or a filter actually changes).
  // Lives ABOVE the adminToken early-return (rules of hooks).
  const totalWallet = useMemo(
    () => users.reduce((sum: number, u) => sum + (u.wallet_balance ?? 0), 0),
    [users],
  );
  const totalSpend = useMemo(
    () => users.reduce((sum: number, u) => sum + (u.lifetime_spend ?? 0), 0),
    [users],
  );

  const sorted = useMemo(() => {
    const tierFiltered = tierFilter ? users.filter((u) => u.loyalty_tier === tierFilter) : users;
    return [...tierFiltered].sort((a, b) => {
      switch (sortBy) {
        case "wallet_desc":
          return (b.wallet_balance ?? 0) - (a.wallet_balance ?? 0);
        case "spend_desc":
          return (b.lifetime_spend ?? 0) - (a.lifetime_spend ?? 0);
        case "orders_desc":
          return (b.order_count ?? 0) - (a.order_count ?? 0);
        case "points_desc":
          return (b.loyalty_points ?? 0) - (a.loyalty_points ?? 0);
        case "created_asc":
          return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
        default:
          return 0;
      }
    });
  }, [users, tierFilter, sortBy]);

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  // R124-I5 (A6 F4 — R118-B2): the edit callback is useCallback-stable so
  // the memoized row components bail out on keystroke re-renders. It only
  // touches stable setters + the save-intent ref, so [] deps are honest.
  // Declared BEFORE the !adminToken early return — hooks must run
  // unconditionally (rules-of-hooks); behavior-neutral for the authed path.
  const openEdit = useCallback((user: AdminUser) => {
    setEditingUser(user);
    // 99-M3: a newly opened edit dialog is a NEW save intent — a stale key
    // from a previous save of the same user would replay THAT adjustment's
    // cached response instead of applying this edit.
    saveIntentKeyRef.current = null;
    setForm({
      wallet_mode: "add",
      wallet_value: "",
      // (r110) a fresh note per edit intent — a stale reason from a
      // previous save must not silently justify the next adjustment.
      note: "",
      loyalty_points: String(user.loyalty_points),
    });
  }, []);

  if (!adminToken) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser || !adminToken) return;
    // 93-C6 / F-07 (A5 U-1): a typo'd wallet amount used to be SILENTLY
    // DROPPED (parseFloat NaN → the field was omitted from the body
    // while loyalty still saved, and the toast still said "تم الحفظ").
    // A non-numeric value now blocks the submit outright.
    const walletInput = form.wallet_value.trim();
    const walletValue = walletInput === "" ? null : Number.parseFloat(walletInput);
    if (walletValue !== null && (!Number.isFinite(walletValue) || walletValue < 0)) {
      toast({
        title: "المبلغ غير صالح",
        description: "أدخل مبلغ محفظة رقميًا صحيحًا (0 أو أكثر) قبل الحفظ",
        variant: "destructive",
      });
      return;
    }
    // R115: loyalty_points rides the body ONLY when it actually
    // changed — the dialog pre-fills the current balance, so the old
    // "send whatever is in the box" behavior shipped an unchanged
    // points value on EVERY save (which the R115 backend now treats as
    // a points edit: mandatory note + finance scope). Unchanged ⇒ not
    // an edit ⇒ nothing to justify.
    const currentPoints = Number(editingUser.loyalty_points ?? 0) || 0;
    const pointsInput = form.loyalty_points.trim();
    const nextPoints = Math.max(0, parseInt(pointsInput) || 0);
    const pointsChanged = pointsInput !== "" && nextPoints !== currentPoints;
    const moneyFieldPresent = walletValue !== null || pointsChanged;
    // (r110 + R115) Contract parity with the backend note guard: a
    // wallet field OR a points change without a ≥3-char note is a
    // guaranteed 400 — the disabled submit covers the click path; this
    // guard covers programmatic / novalidate submits (same layering as
    // the numeric-wallet guard above) and mirrors the backend
    // semantics exactly: required ONLY when money fields are present.
    if (moneyFieldPresent && form.note.trim().length < 3) {
      toast({
        title: "سبب التعديل مطلوب",
        description: "أدخل سببًا لتعديل المحفظة أو النقاط (3 أحرف على الأقل) قبل الحفظ",
        variant: "destructive",
      });
      return;
    }
    // R115: an untouched form (no wallet amount, unchanged points) is
    // not a save — the backend would 400 «لا توجد تعديلات»; block it
    // client-side with the same honest wording.
    if (!moneyFieldPresent) {
      toast({
        title: "لا توجد تعديلات",
        description: "عدّل رصيد المحفظة أو نقاط الولاء قبل الحفظ",
        variant: "destructive",
      });
      return;
    }
    // 93-C6 / F-07 (A5 S-1, round-93): money adjustment requires an
    // explicit confirmation BEFORE the PATCH fires — with the resulting
    // balance preview so a typo like 50-vs-5.00 is visible before it
    // lands ("set" especially overwrites a wallet in one tap).
    // R126-L3 (A2-5): the confirm now covers BOTH LYD-bearing fields.
    // Points are LYD-convertible money (100:1 — the form itself says
    // so at the hint below), and a points-only edit used to slip past
    // this gate because it was keyed on `walletValue !== null` alone —
    // a fat-fingered 100,000-point set (= 1,000 د.ل) landed in one
    // unconfirmed tap while every adjacent money path confirmed.
    if (walletValue !== null || pointsChanged) {
      // R154 (P3-D): placeholder-safe user label — the confirm copy never
      // addresses the operator by a raw tg_/f_ placeholder.
      const userLabel = displayUserName(editingUser as unknown as AdminUserShape);
      // R126-L3 (A2-5): the points leg of the confirm — the delta + its
      // dinar equivalent (the same "كل 100 نقطة = 1 د.ل" idiom the
      // form hint uses), so both currencies are named honestly when
      // both ride the PATCH.
      const pointsSentence = `سيتم تحديد نقاط ولاء ${userLabel} إلى ${nextPoints} (الحالية: ${currentPoints}) — القيمة بالدينار عند التحويل: ${formatCurrency(nextPoints / 100)} (كل 100 نقطة = 1 د.ل).`;
      let description: string;
      if (walletValue !== null) {
        const currentBalance = Number(editingUser.wallet_balance ?? 0) || 0;
        const nextBalance =
          form.wallet_mode === "set"
            ? walletValue
            : form.wallet_mode === "add"
              ? currentBalance + walletValue
              : currentBalance - walletValue;
        const actionText =
          form.wallet_mode === "set"
            ? `سيتم تحديد رصيد محفظة ${userLabel} إلى ${formatCurrency(walletValue)} (الرصيد الحالي: ${formatCurrency(currentBalance)}).`
            : form.wallet_mode === "add"
              ? `سيتم إضافة ${formatCurrency(walletValue)} إلى محفظة ${userLabel} (الرصيد الحالي: ${formatCurrency(currentBalance)}).`
              : `سيتم خصم ${formatCurrency(walletValue)} من محفظة ${userLabel} (الرصيد الحالي: ${formatCurrency(currentBalance)}).`;
        const negativeWarning =
          form.wallet_mode === "subtract" && nextBalance < 0
            ? " تنبيه: المبلغ يتجاوز الرصيد الحالي وسيُرفض التحديث."
            : "";
        description = `${actionText} الرصيد الجديد: ${formatCurrency(nextBalance)}.${negativeWarning}${pointsChanged ? ` ${pointsSentence}` : ""}`;
      } else {
        // Points-only edit — the equivalent confirm the comment above
        // always promised (A2-5): set-preview + LYD equivalent, no
        // wallet leg to enumerate.
        description = pointsSentence;
      }
      const ok = await confirm({
        title: walletValue !== null ? "تأكيد تعديل المحفظة" : "تأكيد تعديل النقاط",
        description,
        confirmLabel: "تنفيذ التعديل",
        destructive: form.wallet_mode === "subtract",
      });
      if (!ok) return;
    }
    setSaving(true);
    // 99-M3 (R99-A2 P1 — money): mint the intent key ONCE per save intent
    // and reuse it across every attempt of that intent (network retries,
    // re-clicks after a lost response). A fresh key per attempt pierces the
    // idempotency layer when the first attempt actually committed server-
    // side — AdjustmentService has no per-record guard, so the delta would
    // apply twice.
    const intentKey = saveIntentKeyRef.current ?? generateIdempotencyKey();
    saveIntentKeyRef.current = intentKey;
    const body: Record<string, number | string> = {};
    if (walletValue !== null) {
      if (form.wallet_mode === "set") body.wallet_balance = walletValue;
      else if (form.wallet_mode === "add") body.wallet_adjustment = walletValue;
      else body.wallet_adjustment = -walletValue;
    }
    if (pointsChanged) {
      // 96-F7 (R96 M14): the input's min="0" doesn't stop a typed "-5"
      // from surviving programmatic submits — the save path clamps to
      // ≥0 so a negative points value can never reach the PATCH (the
      // wallet field got this guard in round-93; points didn't — r94
      // P3-13).
      body.loyalty_points = nextPoints;
    }
    // (r110 + R115) The note rides the PATCH exactly when a money
    // field does (wallet OR points) — trimmed and capped at 500 to
    // mirror what AdjustmentService/insertPointsLedgerEntry persist on
    // the ledger rows.
    if (moneyFieldPresent) {
      body.note = form.note.trim().slice(0, 500);
    }
    // R115: loyalty_tier is deliberately NEVER sent — the backend 400s
    // any tier edit (tiers derive from net spend, Part 11); a 400's
    // own Arabic message is surfaced below via describeSaveError.
    try {
      // L13-1 (R143): adminFetch threads the shared 20 s timeout
      // (D-3's site-level residual — a dead NAT link used to keep the
      // money modal's `saving` + `dismissable={!saving}` armed until the
      // browser's ~300 s TCP timeout; the intent key keeps the MONEY
      // safe, the retry UX was the casualty). Bodies/headers/401
      // handling are byte-identical; an expired-session 401 now throws
      // the AdminSessionExpiredError sentinel after the global toast +
      // redirect — the catch stays quiet on it (the old inline
      // isAdminUnauthorized check returned before any toast).
      const res = await adminFetch(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        // F-008 (security audit 004): one Idempotency-Key per SAVE INTENT
        // (99-M3) — stable across retries so the middleware replays the
        // cached response instead of re-executing. The key spans wallet +
        // loyalty fields because they ride one PATCH — one logical save
        // action from the admin's POV.
        headers: withIdempotencyKey(jsonHeaders, intentKey),
        body: JSON.stringify(body),
      });
      // 93-C6 / F-07 (A5 S-3): 401 mid-form = session expiry, not a
      // failed save — the global handler toasts + redirects.
      if (isAdminUnauthorized(res, `/api/admin/users/${editingUser.id}`)) return;
      // 93-C6 / F-07 (SIM P1): safe body parse — a non-JSON error body
      // (proxy HTML) used to throw a JSON SyntaxError into the toast.
      const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      // Round-4 (org §6a): money-path admin save — getErrorMessage maps
      // the backend `code` (INSUFFICIENT_PERMISSIONS, NEGATIVE_BALANCE,
      // CONFLICT points-race…) to Arabic instead of the bare "خطأ"
      // fallback.
      if (!res.ok) {
        // 99-M3 (R99-A2 P1 — money): keep the intent key ONLY on 409
        // IDEMPOTENCY_IN_FLIGHT — the same-key request is still executing
        // server-side and a retry must replay it. Any other rejection is
        // definitive: the intent is resolved and the next save mints fresh.
        if (data?.code !== "IDEMPOTENCY_IN_FLIGHT") saveIntentKeyRef.current = null;
        // R115: prefer the backend's own Arabic message — the route's
        // specific guardrails (loyalty note/scope/tier rejection,
        // points bounds, CONFLICT points-race…) are the actionable text;
        // the generic code map stays the fallback.
        throw new Error(describeSaveError(data) || "خطأ");
      }
      // R124-I5 (A6 F1): success variant — wallet save is a money
      // action; green like the topup approvals.
      toast({
        title: "تم الحفظ",
        description: `تم تحديث بيانات ${displayUserName(editingUser as unknown as AdminUserShape)}`,
        variant: "success",
      });
      // 99-M3: success is a terminal resolution — the intent key must not
      // survive to answer a future save of the same user with a stale replay.
      saveIntentKeyRef.current = null;
      // 94-C2: base key — refreshes the accumulating infinite query
      // (prefix match), not just one param-specific cache entry.
      queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      // R125-I4 (A4-B-3): stats co-invalidation — a wallet/points save
      // changes total_wallet_balance, and /admin/stats has no
      // write-side invalidation (30s server cache). R125-I6 landed the
      // backend `admin-stats-update` emit for users PATCH; the socket
      // handler refreshes BOTH the stats key and this users list
      // family on OTHER open tabs (SocketInitializer.tsx — the
      // R126-L3 key-set), while the invalidations here cover the
      // ACTING tab immediately.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setEditingUser(null);
    } catch (err: unknown) {
      // L13-1 (R143): the expired-session sentinel — the global handler
      // already toasted + redirected; stay quiet (finally still clears
      // `saving` so the modal regains its dismiss affordance).
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "خطأ",
        // 93-C6 / F-07 (SIM P1): route through getErrorMessage so the
        // response envelope (and network-level TypeErrors) surface as
        // Arabic, never silently.
        description: describeSaveError(err) || getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const hasFilters = tierFilter !== "" || sortBy !== "wallet_desc";

  // R137 (FE) decomposition: the extracted toolbar / filter panel call
  // these page-owned handlers — the ?filters=/?tier=/?sort= URL sync
  // (syncFilterParams) rides every flip exactly as it did inline.
  // R123 (E3 P3a): the panel toggle is URL-synced (?filters=).
  const toggleFilters = () => {
    setShowFilters((v) => {
      syncFilterParams(tierFilter, sortBy, !v);
      return !v;
    });
  };
  // R123 (E3 P3a): tier flips write ?tier= back.
  const selectTierFilter = (value: string) => {
    setTierFilter(value);
    syncFilterParams(value, sortBy, showFilters);
  };
  // R123 (E3 P3a): sort flips write ?sort= back.
  const selectSortBy = (value: string) => {
    setSortBy(value);
    syncFilterParams(tierFilter, value, showFilters);
  };
  const resetPanelFilters = () => {
    setTierFilter("");
    setSortBy("wallet_desc");
    // R123 (E3 P3a): the reset clears the URL params too.
    syncFilterParams("", "wallet_desc", showFilters);
  };

  // R125-I4 (A1-1): the ONE «مسح الفلاتر» handler — clears the state
  // AND the URL. The old empty-state CTA called setSearch/setTierFilter
  // without syncFilterParams, so ?tier= (and ?sort=) survived in the
  // address bar and a refresh silently resurrected a filter the
  // operator believes they removed — state divergence on the directory
  // that lists wallet balances. The ?search= deep-link param rides the
  // same resurrection class (it re-prefills on mount) — strip it too.
  // Shared by the hard EmptyState CTA and the partial-window block.
  const clearAllFilters = () => {
    setSearch("");
    setTierFilter("");
    setSortBy("wallet_desc");
    syncFilterParams("", "wallet_desc", showFilters);
    const url = new URL(window.location.href);
    if (url.searchParams.has("search")) {
      url.searchParams.delete("search");
      window.history.replaceState(null, "", url.toString());
    }
  };

  // R120-B4 (A2-F4): wallet + loyalty-points mutations require the
  // finance scope on the backend (PATCH /api/admin/users/:id — B1-3
  // pattern: wallet_adjustment/balance AND loyalty_points both gate on
  // requirePermission("finance")). The form used to stay fully editable
  // for a users-only operator and 403 after the confirm dialog — the
  // fields are now disabled with the honest reason up front.
  const canEditMoney = hasAdminPermission("finance");

  // R137 (FE) decomposition: the extracted money-edit dialog's input
  // handlers — every extract input calls one of these page-owned
  // wrappers around the form atom (the atom, the 99-M3 intent key and
  // handleSave stay here).
  const setWalletMode = (mode: EditUserForm["wallet_mode"]) =>
    setForm((f) => ({ ...f, wallet_mode: mode }));
  const setWalletValue = (value: string) => setForm((f) => ({ ...f, wallet_value: value }));
  const setEditNote = (value: string) => setForm((f) => ({ ...f, note: value }));
  const setEditPoints = (value: string) => setForm((f) => ({ ...f, loyalty_points: value }));
  const closeEditDialog = () => setEditingUser(null);

  // (r110 + R115) Money-edit note gate: the backend 400s any wallet OR
  // points mutation whose note is <3 trimmed chars. "Money field
  // present" mirrors handleSave's parse — a wallet amount in the input
  // or a points value that differs from the user's current balance is
  // what puts wallet_*/loyalty_points in the PATCH body — so the submit
  // stays enabled for nothing-changed states (blocked there with an
  // honest «لا توجد تعديلات» toast instead of a silent server 400).
  const walletFieldPresent = form.wallet_value.trim() !== "";
  const editingPointsNow =
    editingUser != null && form.loyalty_points.trim() !== ""
      ? Math.max(0, parseInt(form.loyalty_points) || 0)
      : null;
  const pointsChangedNow =
    editingUser != null &&
    editingPointsNow != null &&
    editingPointsNow !== (Number(editingUser.loyalty_points ?? 0) || 0);
  const noteRequired = walletFieldPresent || pointsChangedNow;
  const noteValid = form.note.trim().length >= 3;

  /**
   * R126-L3 (A2-3): RFC-4180 CSV cell quoting for the users export.
   *
   * The export embeds grouped currency strings (formatCurrency →
   * `"1,234.50 د.ل"`) whose embedded ASCII comma used to ride a bare
   * `r.join(",")` — any wallet balance / lifetime spend ≥ 1,000 LYD
   * split its cell in two and shifted every field after it for that
   * row.
   *
   * R128 (B3-F2): the escaper moved to lib/csv.ts as the ONE shared
   * `csvCell` (security.tsx's audit/auth exports carried a quote-only
   * twin) and gained the formula-injection guard — a leading
   * =/+/-/@/tab/CR gets the OWASP apostrophe prefix. Pinned by
   * users-csv-export.test.tsx + lib/__tests__/csv.test.ts.
   */
  const exportUsersCSV = () => {
    const csvHeaders = [
      "رقم الهاتف",
      "هوية تيليجرام",
      "الرصيد",
      "المستوى",
      "النقاط",
      "الإجمالي المنفق",
      "الطلبات",
      "تاريخ التسجيل",
    ];
    const rows = sorted.map((u) => [
      // R154 (P3-D): placeholder-safe — the real phone or the honest
      // «no phone linked» line, never a raw tg_/f_ placeholder; the
      // Telegram identity (username · id) joins as its own column.
      displayUserPhone(u as unknown as AdminUserShape),
      telegramIdentityLine(u as unknown as AdminUserShape) ?? "",
      // R120-B4 (A5-F13): the shared currency formatter (grouping + د.ل)
      // — the same string the table renders, so the CSV never presents
      // an ungrouped 1234.50 the UI never showed. (The dashboard's
      // chart CSV still uses raw toFixed(2) — its copy is another
      // agent's file; noted in the R120-B4 report.)
      // R126-L3 (A2-3): the grouped string's ASCII comma is why every
      // cell now rides csvCell (RFC-4180 quoting) — the join below can
      // never shift columns again.
      formatCurrency(u.wallet_balance ?? 0),
      tierLabel(u.loyalty_tier ?? ""),
      u.loyalty_points ?? 0,
      formatCurrency(u.lifetime_spend ?? 0),
      u.order_count ?? 0,
      u.created_at ? formatDate(u.created_at) : "",
    ]);
    const csv = [csvHeaders, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="users" />;
  }

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-5">
        {/* Header */}
        <UsersToolbar
          usersCount={users.length}
          knownTotal={knownTotal}
          tierFilter={tierFilter}
          search={search}
          showFilters={showFilters}
          hasFilters={hasFilters}
          showExport={!isLoading && sorted.length > 0}
          onSearchChange={setSearch}
          onToggleFilters={toggleFilters}
          onExport={exportUsersCSV}
        />

        {/* Filter panel */}
        {showFilters && (
          <UsersFilterPanel
            tierFilter={tierFilter}
            sortBy={sortBy}
            hasFilters={hasFilters}
            knownTotal={knownTotal}
            onTierChange={selectTierFilter}
            onSortChange={selectSortBy}
            onReset={resetPanelFilters}
          />
        )}

        {/* Summary stats strip — 94-C2 (A2 P1-1): the labels describe
            the LOADED sample, never a grand total (the old «إجمالي
            المستخدمين/الأرصدة/الإنفاق» cards presented the first page
            as the whole directory). */}
        {!isLoading && users.length > 0 && !search && (
          <UsersStatsStrip
            usersCount={users.length}
            totalWallet={totalWallet}
            totalSpend={totalSpend}
          />
        )}

        {/* Edit dialog — 94-C2 (A2 P2-5): the money-action shell is
            the shared AppDialog (focus trap, ESC, aria) with
            dismissable={!saving} so a stray tap mid-PATCH can't destroy
            the form; the submit button lives in the dialog footer and
            associates with the form via form="user-edit-form". */}
        <UserEditDialog
          editingUser={editingUser}
          form={form}
          saving={saving}
          canEditMoney={canEditMoney}
          noteRequired={noteRequired}
          noteValid={noteValid}
          editingPointsNow={editingPointsNow}
          onWalletModeChange={setWalletMode}
          onWalletValueChange={setWalletValue}
          onNoteChange={setEditNote}
          onPointsChange={setEditPoints}
          onClose={closeEditDialog}
          onSubmit={handleSave}
        />

        {/* 93-C6 / F-07 (A5 S-2): refresh of an already-rendered list
            failed — keep the stale rows, surface the failure inline. */}
        {isError && users.length > 0 && (
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

        {/* Table */}
        {isLoading ? (
          <UsersTableSkeleton />
        ) : isError && users.length === 0 ? (
          /* 93-C6 / F-07 (A5 S-2): a failed load is NOT "no users" — the
             referrals.tsx error-card idiom (an outage/expired session
             previously masqueraded as the empty state). */
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل المستخدمين"
            description={`${getErrorMessage(error)} — تحقّق من شبكتك ثم أعد المحاولة`}
            onRetry={() => refetch()}
          />
        ) : sorted.length === 0 ? (
          /* R125-I4 (A1-7): a tier can read empty while matching users
             sit on UNLOADED pages — the tier filter runs client-side
             over the accumulated pages (hasNextPage=true), so the hard
             EmptyState asserted global emptiness over a partial window
             (the exact R115 A9 P2 false-empty orders killed). The
             orders.tsx partial-empty block: load-more stays visible +
             the honest incompleteness hint. Search-empty stays on the
             hard state (server-side, honest). */
          tierFilter && hasNextPage ? (
            <div className="text-center py-14 text-muted-foreground bg-card border border-border/60 rounded-2xl space-y-3">
              <Users className="w-10 h-10 mx-auto opacity-20" />
              <p className="text-sm font-bold text-foreground/80">
                لا مستخدمين بمستوى {tierLabel(tierFilter)} ضمن الصفحات المحمّلة
              </p>
              <p className="text-xs">قد تكون النتائج غير مكتملة — حمّل المزيد لعرض الكل</p>
              <div className="flex justify-center gap-2 flex-wrap">
                <LoadMoreButton
                  spinner={RefreshCw}
                  busy={isFetchingNextPage}
                  disabled={isLoading}
                  onClick={() => void fetchNextPage()}
                />
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-primary-text hover:underline mt-1.5"
                >
                  مسح الفلاتر
                </button>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title={
                search
                  ? `لا نتائج لـ "${search}"`
                  : tierFilter
                    ? /* A1-11: «لا مستخدمين» — منصوب بعد لا */
                      `لا مستخدمين بمستوى ${tierLabel(tierFilter)}`
                    : "لا يوجد مستخدمون"
              }
              action={
                search || tierFilter ? (
                  <button
                    onClick={clearAllFilters}
                    className="text-xs text-primary-text hover:underline mt-2"
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
            <UsersDesktopTable rows={sorted} onEdit={openEdit} />

            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {sorted.map((user) => (
                <MobileUserCard key={user.id} user={user} onEdit={openEdit} />
              ))}
            </div>

            {/* 94-C2 (A2 P1-1): "load more" appends the next page of the
                frozen `?page=N+1&limit=` contract in place — users past
                the silent 100-row cap become reachable. The button hides
                once a short page arrives. */}
            {hasNextPage && (
              <div className="flex justify-center pt-1">
                <LoadMoreButton
                  spinner={RefreshCw}
                  busy={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                />
              </div>
            )}
          </>
        )}
      </div>
      {/* 93-C6 / F-07: the wallet-adjust confirmation dialog mount
          (useConfirm idiom — styled AlertDialog, ESC/rtl-correct). */}
      <ConfirmDialog />
    </AdminLayout>
  );
}
