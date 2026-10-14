import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { Button } from "@/components/ui/button";
import { TopupWaitingModal } from "@/components/TopupWaitingModal";
// R136 (FE-1 decomposition): the page's self-contained subcomponents and
// pure helpers moved to @/components/wallet/* (verbatim moves — the
// money path, the 96-F6/98-F2 idempotency-key machinery, every state
// atom and every handler stay HERE; the extracts render the
// byte-identical DOM they rendered inline yesterday). Import surface:
//   • topup-intent-key / topup-preferences / topup-meta — the page's
//     pure modules (intent-key lifecycle, localStorage prefs + the
//     MAX_PENDING cap, topup metadata + the amount sanitizer)
//   • BalanceCard / PendingLimitBanner / LatestTopupPin — the left
//     column's status sections (probe + viewport-pause stay here)
//   • MethodTabs / MobileTransferForm / LyPayFlow — the topup form
//     card (every input's onChange calls a page-owned handler)
//   • TopupHistoryCard / WalletStatementCard — the two lists
//     (LedgerEntryRow / TransferCodePanel / PaymentReferenceField ride
//     along inside their consumers)
import {
  loadTopupIntentKey,
  persistTopupIntentKey,
  topupIntentFingerprint,
} from "@/components/wallet/topup-intent-key";
import {
  MAX_PENDING,
  getSavedSenderPhones,
  getTopupPreferences,
  saveSenderPhone,
  saveTopupPreferences,
} from "@/components/wallet/topup-preferences";
import {
  NETWORK_PRESETS,
  type Method,
  readInitialMethodFromUrl,
  sanitizeAmountInput,
} from "@/components/wallet/topup-meta";
import { BalanceCard } from "@/components/wallet/BalanceCard";
import { LatestTopupPin } from "@/components/wallet/LatestTopupPin";
import { LyPayFlow } from "@/components/wallet/LyPayFlow";
import { MethodTabs } from "@/components/wallet/MethodTabs";
import { MobileTransferForm } from "@/components/wallet/MobileTransferForm";
import { PendingLimitBanner } from "@/components/wallet/PendingLimitBanner";
import { TopupHistoryCard } from "@/components/wallet/TopupHistoryCard";
import { WalletStatementCard } from "@/components/wallet/WalletStatementCard";
import { useOnScreen } from "@/hooks/use-on-screen";
import { useSocket } from "@/hooks/use-socket";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { formatCount, sanitizeInternalPath } from "@/lib/utils";
import { isValidLibyanPhone, libyanPhoneError } from "@/lib/validation";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  getGetWalletLedgerQueryKey,
  getGetWalletQueryKey,
  getListTopupsQueryKey,
  useCreateTopup,
  useGetMe,
  useGetWallet,
  useGetWalletLedger,
  useListTopups,
} from "@workspace/api-client-react";
import { Plus, ShoppingBag, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

export default function WalletPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  // R116-S2 (P3): page-scoped realtime — the SAME pattern as
  // order-detail (the reference mount). The /api/auth/me query is the
  // SHARED key Navbar/home already populate (60 s staleTime → cache
  // hit, no extra request); `me?.id` arms the socket once the identity
  // is known. The topup-updated handler in use-socket invalidates
  // getListTopups/getGetWallet, so a pending→approved flip lands
  // in-page (balance card + topup list) the moment the admin decides —
  // even after the waiting modal was dismissed. connectSocket() is a
  // module-level singleton (off/on dedupe), so a user navigating
  // order-detail → wallet never opens a second socket.
  const { data: me } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), enabled: !!token, staleTime: 60_000 },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });
  useSocket(me?.id);

  // A9-3 (R126-L6): seeded from ?method= at mount (URL wins over stored
  // prefs — an explicit shared/stateful link is the stronger intent).
  const [initialMethod] = useState(readInitialMethodFromUrl);
  const [method, setMethod] = useState<Method>(initialMethod.method);
  const methodSeededFromUrlRef = useRef(initialMethod.fromUrl);
  const [network, setNetwork] = useState("libyana");
  const [amount, setAmount] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [senderAccount, setSenderAccount] = useState("");
  // 93-C5 / F-03 (A2 P1 #2): the transfer receipt/transaction reference.
  // The backend's whole V1-M9/B2-02 duplicate-credit dedup machinery
  // (advisory lock + in-tx check + partial unique index) is conditional
  // on a NON-EMPTY payment_reference — and this form never sent one, so
  // a user could submit the same transfer 3× (MAX_PENDING) and be
  // credited 3× for one real receipt. Optional field, ≤100 chars
  // (backend trims + rejects >100), trimmed before sending.
  const [paymentReference, setPaymentReference] = useState("");
  const [senderPhoneTouched, setSenderPhoneTouched] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedPhones, setSavedPhones] = useState<string[]>([]);
  const [rememberPhone, setRememberPhone] = useState(true);
  // ID of the topup currently being awaited in the modal.
  const [waitingTopupId, setWaitingTopupId] = useState<number | null>(null);
  // Return-to-product flow: when the user lands here from a product CTA
  // (because they couldn't afford it), we stash the product URL in
  // sessionStorage so a successful top-up can bounce them back. The
  // sessionStorage indirection is deliberate — `useListTopups` polls
  // and triggers re-renders, but the underlying URL `?return=` only
  // exists on the first arrival; sessionStorage carries it across.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    const STORAGE_KEY = "subnation_topup_return";
    // R123-E4a (P3-c): the guard now mirrors login.tsx's ?redirect=
    // sanitizer (slash-prefix + //reject + same-origin) — the old
    // startsWith("/")-only check let a protocol-relative //evil.com
    // through. The restored value is sanitized too: entries written
    // before R123 passed only the weak check.
    const fromUrl = sanitizeInternalPath(new URLSearchParams(window.location.search).get("return"));
    if (fromUrl) {
      sessionStorage.setItem(STORAGE_KEY, fromUrl);
      setReturnTo(fromUrl);
      return;
    }
    setReturnTo(sanitizeInternalPath(sessionStorage.getItem(STORAGE_KEY)));
  }, []);

  // ── 96-F6 (R96 §5.1 — frontend half of topup idempotency) ─────────
  // ONE Idempotency-Key per submission INTENT, sent on every
  // POST /api/wallet/topups (the backend middleware — mounted in
  // parallel — replays the cached response for a same-key retry instead
  // of creating a second identical pending topup). The orval mutation
  // closes over the `request` headers at RENDER time, so the ref is read
  // on every render (see useCreateTopup below) and rotated ONLY at
  // explicit reset points — never mid-render:
  //   • a SUCCESSFUL submit (onSuccess resets the form ⇒ new intent)
  //   • any payload-defining edit (amount / network / method / phone /
  //     account / reference) — also guards the backend's 409
  //     same-key-with-different-body branch.
  // Rotations are guarded by an actual value change: a no-op keystroke
  // (sanitized value unchanged) bails out of setState with NO re-render,
  // which would desync the ref from the headers the mutation captured.
  //
  // 98-F2 (R98-09): the current key ALSO lives in sessionStorage under
  // subnation_topupkey ({k, t, f} — TTL 10 min + amount|method|phone
  // fingerprint, see the helpers' docblock in
  // components/wallet/topup-intent-key.ts) so a refresh after a
  // network-level failure re-submits with the SAME header (replay)
  // instead of a freshly minted one. Every rotation re-persists under
  // the intent's NEW fingerprint (rotations are always captured AFTER
  // the field change they correspond to — see the explicit arguments
  // at each call site; the closure state at rotation time is stale by
  // one setState).
  const topupKeyRef = useRef<string | null>(null);
  // G-2 (R142): the orval mutationFn closes over the `request` object at
  // RENDER time — a key rotated in the SAME synchronous handler as
  // mutate() (the submit-time fractional→whole normalization below)
  // shipped the PRE-rotation key with the POST-normalization body. That
  // was the one window where a network-failure-after-commit + refresh
  // retry could mint a second pending topup (lypay without a reference
  // has no DB dedup). The request object is now a STABLE ref whose
  // headers are read AT FETCH TIME (createTopup's getHeaders runs when
  // the mutation executes, not when the hook rendered) and synced at
  // every key-mutation point: lazy init, every resetTopupKey rotation,
  // the mount restore, and belt-and-suspenders right before mutate().
  // Authorization is re-synced per render (token parity with the old
  // per-render literal — same values, same empty-string deletion
  // behavior in customFetch's Round-3 auth gate).
  const topupRequestRef = useRef<{ headers: Record<string, string> }>({
    headers: {},
  });
  topupRequestRef.current.headers.Authorization = token ? `Bearer ${token}` : "";
  const syncTopupRequestKey = () => {
    topupRequestRef.current.headers["Idempotency-Key"] = topupKeyRef.current ?? "";
  };
  // Lazy init — idempotent null-guard (StrictMode double-render safe).
  // In-memory only: the mount restore below decides what the DURABLE
  // key for this visit is.
  if (topupKeyRef.current === null) {
    topupKeyRef.current = generateIdempotencyKey();
    syncTopupRequestKey();
  }
  const resetTopupKey = (nextFingerprint: string) => {
    topupKeyRef.current = generateIdempotencyKey();
    persistTopupIntentKey(nextFingerprint, topupKeyRef.current);
    syncTopupRequestKey();
  };
  // 96-F6 (R96 A2 P1-6): shared amount-field onChange — sanitizer +
  // key rotation. Used by BOTH topup flows' amount inputs.
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = sanitizeAmountInput(e.target.value);
    if (next !== amount) {
      // 98-F2: persist under the POST-edit fingerprint (the new amount).
      resetTopupKey(topupIntentFingerprint(next, method, senderPhone));
    }
    setAmount(next);
  };
  const applyAmountPreset = (p: number) => {
    if (String(p) !== amount) {
      resetTopupKey(topupIntentFingerprint(String(p), method, senderPhone));
    }
    setAmount(String(p));
  };
  // 96-F6 (R96 §5.1): PaymentReferenceField's onChange for both flows.
  // The reference is payload-relevant (rotation) but NOT part of the
  // task's fingerprint contract (amount|method|phone) — the rotation
  // alone already prevents the 409 same-key-different-body branch.
  const handlePaymentReferenceChange = (v: string) => {
    if (v !== paymentReference) {
      resetTopupKey(topupIntentFingerprint(amount, method, senderPhone));
    }
    setPaymentReference(v);
  };
  // ── R136 (FE-1): the extracts' input handlers — every one of the
  // wallet extracts' interactive controls calls a handler HERE (values
  // + callbacks flow down; the extracts never touch a raw setter), so
  // each payload-defining edit still hits its 96-F6/98-F2 rotation
  // point in the ONE place that owns the key.
  // MethodTabs' onSelect: 96-F6 (R96 §5.1) — switching method = new
  // intent → rotate the key (the payload carries payment_method /
  // payment_network). 98-F2: persist under the post-switch fingerprint.
  const handleMethodChange = (m: Method) => {
    if (m !== method) {
      resetTopupKey(topupIntentFingerprint(amount, m, senderPhone));
    }
    setMethod(m);
    setError("");
  };
  // MobileTransferForm's network buttons: 96-F6 (R96 §5.1) — network
  // is part of the payload. 98-F2: network is not part of the
  // fingerprint contract (amount|method|phone) — the rotation itself
  // still fires (new body → new key).
  const handleNetworkChange = (value: string) => {
    if (value !== network) {
      resetTopupKey(topupIntentFingerprint(amount, method, senderPhone));
    }
    setNetwork(value);
  };
  // Both flows' amount onBlur: R116-S2 (P2) — native step=1 only
  // enforces on the spinner — a typed "24.9" would otherwise reach the
  // backend AND disagree with the USSD code the panel above told the
  // user to dial. Round to the nearest whole dinar + clamp [1, 10000]
  // when the user finishes editing.
  const handleAmountBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    const rounded = Math.min(10000, Math.max(1, Math.round(v)));
    if (rounded !== v) setAmount(String(rounded));
  };
  // MobileTransferForm's saved-phone chips: 96-F6 (R96 §5.1) — picking
  // a different saved phone changes the intent → rotate the key.
  // 98-F2: the picked phone IS part of the fingerprint — persist
  // under it.
  const handleSavedPhonePick = (phone: string) => {
    if (phone !== senderPhone) {
      resetTopupKey(topupIntentFingerprint(amount, method, phone));
    }
    setSenderPhone(phone);
  };
  // MobileTransferForm's sender-phone input:
  const handleSenderPhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 10);
    // 96-F6 (R96 §5.1): a different (sanitized) phone is a different
    // intent → rotate the key. 98-F2: the new phone is part of the
    // fingerprint — persist under the post-edit value.
    if (d !== senderPhone) {
      resetTopupKey(topupIntentFingerprint(amount, method, d));
    }
    setSenderPhone(d);
    // Surface validation as the user types once they start entering
    // digits — used to wait for blur, which meant users tapping submit
    // before the input lost focus only saw the "غير صالح" error after
    // a failed submit. Live mode is gated on having typed at least 4
    // digits to avoid a green check on a 1-digit "0" or red error
    // immediately on focus.
    if (d.length >= 4) setSenderPhoneTouched(true);
  };
  // The same input's onBlur (and nothing else): mark touched for the
  // live validation binding.
  const handleSenderPhoneTouched = () => setSenderPhoneTouched(true);
  // The remember-phone checkbox (form-local convenience state — rides
  // the same values+callbacks contract as the money fields).
  const handleRememberPhoneChange = (checked: boolean) => setRememberPhone(checked);
  // LyPayFlow's sender-account input: 96-F6 (R96 §5.1) — account edits
  // change the intent. 98-F2: the account is not part of the
  // fingerprint contract — the rotation itself still fires.
  const handleSenderAccountChange = (v: string) => {
    if (v !== senderAccount) {
      resetTopupKey(topupIntentFingerprint(amount, method, senderPhone));
    }
    setSenderAccount(v);
  };

  // Load saved preferences on mount
  useEffect(() => {
    const prefs = getTopupPreferences();
    setNetwork(prefs.network);
    setAmount(prefs.amount);
    // A9-3 (R126-L6): an explicit ?method= seed outranks the stored
    // preference — the prefs effect must not clobber the URL's choice.
    if (
      !methodSeededFromUrlRef.current &&
      (prefs.method === "mobile_transfer" || prefs.method === "lypay")
    ) {
      setMethod(prefs.method);
    }
    setSavedPhones(getSavedSenderPhones());
    // 98-F2 (R98-09): restore the topup intent key across refresh — a
    // stored entry still inside its TTL whose fingerprint matches the
    // RESTORED state (prefs amount/method + the blank phone field —
    // sender phones are never auto-restored into the form) is reused
    // verbatim; otherwise the lazy-init key above becomes the durable
    // one (persisted so the NEXT refresh can match it). Idempotent for
    // StrictMode's double effect-run: the second run re-reads the entry
    // the first run wrote and lands on the same key.
    const restoredMethod =
      prefs.method === "mobile_transfer" || prefs.method === "lypay"
        ? (prefs.method as Method)
        : "mobile_transfer";
    const fingerprint = topupIntentFingerprint(prefs.amount, restoredMethod, "");
    const restored = loadTopupIntentKey(fingerprint);
    if (restored) {
      topupKeyRef.current = restored;
      syncTopupRequestKey();
    } else if (topupKeyRef.current) {
      // Non-null by the lazy init above (render ran before this effect).
      persistTopupIntentKey(fingerprint, topupKeyRef.current);
    }
  }, []);

  // Save preferences when they change
  useEffect(() => {
    saveTopupPreferences(network, amount, method);
  }, [network, amount, method]);

  // A9-3 (R126-L6): mirror the active topup method tab into ?method=
  // (home.tsx's R98-04 replaceState idiom — same logical page, invisible
  // to wouter, no history spam). The default tab strips the param; the
  // ?return= deep-link param (and anything else a visitor carries) is
  // preserved untouched — only the method key is owned here.
  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      if (method === "mobile_transfer") qs.delete("method");
      else qs.set("method", method);
      const query = qs.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
    } catch {
      // Exotic embedding contexts without history API — the tab still
      // works in-memory; only the URL reflection is lost.
    }
  }, [method]);

  useEffect(() => {
    // R122 (A11-F3): the guest redirect now PRESERVES the return path
    // (the commerce flows' `?redirect=` idiom — cart/PDP/checkout already
    // do this; login.tsx honors same-origin internal paths only). A
    // post-login user lands back on the wallet deep link they opened
    // from WhatsApp instead of the bare home feed. The path is read
    // INSIDE the effect, not from the useLocation subscription — the
    // redirect itself changes the location, so a `location` dep would
    // re-fire the effect onto /login and eat the original target
    // (checkout.tsx:548's constant-target idiom, generalized).
    if (!token) {
      const { pathname, search } = window.location;
      navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
    }
    // wouter's navigate is a stable reference — listing it is free and
    // keeps exhaustive-deps honest (r111 lint parity).
  }, [token, navigate]);

  // 93-C5 / F-05 (A4 #7): no error state — on a failed /api/wallet probe
  // the balance card used to silently VANISH (wallet ? card : null) and
  // the ledger below showed "لا توجد طلبات شحن بعد" — the money page
  // looked like the user never topped up and has no balance, the worst
  // place for a silent failure. isError + refetch feed explicit retry
  // branches below.
  const {
    data: wallet,
    isLoading,
    isError: walletError,
    refetch: refetchWallet,
  } = useGetWallet({
    query: { enabled: !!token, queryKey: getGetWalletQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  // R115-A10: pause the balance card's drifting blob when the card
  // leaves the viewport (enabled re-arms the observer once the wallet
  // probe lands and the card mounts — the ref is null before that).
  const balanceGlow = useOnScreen<HTMLDivElement>(!!wallet);

  const {
    data: topups = [],
    isLoading: topupsLoading,
    isError: topupsError,
    refetch: refetchTopups,
  } = useListTopups(undefined, {
    // R123-E2: params arg added by the codegen regen (R120 page param) —
    // undefined = page 1, byte-identical to the pre-regen request.
    query: { enabled: !!token, queryKey: getListTopupsQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  // R115 (A8 P2): the wallet STATEMENT — GET /api/wallet/ledger via the
  // generated hook (the endpoint + DTOs landed in the R115 OpenAPI regen;
  // the manual-fetch detour loyalty.tsx uses is unnecessary here — this
  // page already rides the orval client for wallet/topups).
  const {
    data: ledger = [],
    isLoading: ledgerLoading,
    isError: ledgerError,
    refetch: refetchLedger,
  } = useGetWalletLedger(undefined, {
    query: { enabled: !!token, queryKey: getGetWalletLedgerQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const pendingCount = (topups as Array<{ status: string }>).filter(
    (t) => t.status === "pending",
  ).length;
  const pendingBlocked = pendingCount >= MAX_PENDING;

  // Oldest pending topup — used to set a real-data expectation in the
  // pending-block warning. Without this, "blocked" reads as "stuck"
  // when in fact the user is just queued behind their own earlier
  // requests. Showing the age of the oldest pending lets them gauge
  // how soon they'll be unblocked.
  const oldestPending = (topups as Array<{ status: string; created_at: string }>)
    .filter((t) => t.status === "pending")
    .map((t) => t.created_at)
    .sort()
    .at(0);

  // Most-recent topup (any status) for the mobile compact summary.
  // The wallet history sidebar is desktop-only — on mobile it stacks
  // below the form, so users never see "yes, my last topup is being
  // processed" until they scroll past their submission. This pins the
  // latest one near the top of the form.
  const latestTopup = (
    topups as Array<{
      id: number;
      status: string;
      amount: number;
      created_at: string;
      payment_network?: string;
    }>
  )
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .at(0);

  const topupMutation = useCreateTopup({
    // G-2 (R142): the STABLE request object — see topupRequestRef above.
    // Its headers are read at fetch time, so every rotation (including
    // the submit-time normalization rotation) is on the wire for the
    // mutate() that follows it in the SAME synchronous handler.
    request: topupRequestRef.current,
    mutation: {
      onSuccess(created) {
        // 96-F6 (R96 §5.1): the intent was successfully submitted —
        // rotate the key so the next topup (fresh form) gets a new one.
        // 98-F2 (R98-09): the rotation is persisted under the POST-RESET
        // fingerprint (amount/phone cleared by this handler — method is
        // untouched), so a refresh before the next submit can't replay
        // the just-consumed key onto the emptied form.
        resetTopupKey(topupIntentFingerprint("", method, ""));

        // Save sender phone if remember is checked
        if (rememberPhone && method === "mobile_transfer" && senderPhone) {
          saveSenderPhone(senderPhone);
          setSavedPhones(getSavedSenderPhones());
        }

        setAmount("");
        setSenderPhone("");
        setSenderAccount("");
        setPaymentReference("");
        setSenderPhoneTouched(false);
        queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        // R115: the statement below may already reflect this submit (an
        // approval that landed between submit and response) — refresh it
        // with the same money-cache pair.
        queryClient.invalidateQueries({ queryKey: getGetWalletLedgerQueryKey() });

        // Open the waiting modal — replaces the old "small success toast"
        // pattern. Modal subscribes to the topups list and reacts to
        // approval/rejection in real time.
        setWaitingTopupId(created.id);
      },
      onError(err: unknown) {
        setError(getErrorMessage(err));
      },
      onSettled() {
        setSubmitting(false);
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 97-F5 deferred one-liner (main agent): Enter must not submit while the
    // button is disabled (in-flight request / pending topup window) — same
    // predicate as the disabled button, so a stray Enter during the waiting
    // modal can't fire a 409 over the open window.
    if (submitting || topupMutation.isPending) return;

    if (pendingBlocked) {
      setError("لديك طلبات قيد المراجعة، يرجى الانتظار حتى تُعتمد");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("يرجى إدخال مبلغ صالح");
      return;
    }
    // R116-S2 (P2): whole-dinar floor. USSD transfer codes can only
    // carry integers — a fractional topup dialed a FLOORED code while
    // submitting the fraction (guaranteed mismatch on every fractional
    // amount). The client floor is 1 LYD (mirrored by the blur snap
    // below); the old «0.01» claim was unreachable fiction — the
    // submit-time snap clamped everything to ≥1 anyway.
    if (parsedAmount < 1) {
      setError("أقل مبلغ شحن هو 1 د.ل");
      return;
    }
    if (parsedAmount > 10000) {
      setError("الحد الأقصى للشحن هو 10,000 د.ل");
      return;
    }
    // R116-S2 (P2): Math.round to the nearest WHOLE dinar (was the
    // 0.5-step snap) — matches the USSD code the user was told to dial.
    const normalizedAmount = Math.min(10000, Math.max(1, Math.round(parsedAmount)));
    if (normalizedAmount !== parsedAmount) {
      setAmount(String(normalizedAmount));
      // The submit-time normalization changed the payload → a DIFFERENT
      // intent. Rotate the Idempotency-Key under the POST-normalization
      // fingerprint so this submission can never replay onto the
      // fractional intent a previous key was minted for (96-F6/98-F2
      // rotation contract; the backend's 409 same-key-different-body
      // branch stays unreachable).
      resetTopupKey(topupIntentFingerprint(String(normalizedAmount), method, senderPhone));
    }

    if (method === "mobile_transfer") {
      setSenderPhoneTouched(true);
      if (!senderPhone.trim()) {
        setError("يرجى إدخال رقم هاتف المُرسل");
        return;
      }
      const phoneErr = libyanPhoneError(senderPhone);
      if (phoneErr) {
        setError(phoneErr);
        return;
      }
      if (!isValidLibyanPhone(senderPhone)) {
        setError("رقم هاتف المُرسل غير صالح. يجب أن يبدأ بـ 091 أو 092 أو 093 أو 094");
        return;
      }
      // R123-E4a (P1): the backend hard-requires payment_reference for
      // mobile_transfer (B4-R1, backend wallet.ts:380-389) — the receipt
      // is both the dedup key and the reviewer's evidence. Same
      // error-toast idiom as the sender-phone guard above.
      if (!paymentReference.trim()) {
        setError("يرجى إدخال رمز التحويل من رسالة التحويل");
        return;
      }
    }

    if (method === "lypay" && !senderAccount.trim()) {
      setError("يرجى إدخال رقم حساب المُرسل");
      return;
    }

    setSubmitting(true);
    // 93-C5 / F-03: trim once at the boundary (the backend trims again +
    // rejects >100 chars; maxLength on the input already bounds typing).
    const trimmedReference = paymentReference.trim().slice(0, 100);
    // G-2 (R142): belt-and-suspenders — the stable request object already
    // syncs at every rotation point, but the pre-mutate sync guarantees
    // the wire key matches topupKeyRef.current even if a future rotation
    // path forgets to call syncTopupRequestKey.
    syncTopupRequestKey();
    topupMutation.mutate({
      data: {
        amount: normalizedAmount,
        payment_method: method,
        payment_network: method === "mobile_transfer" ? network : undefined,
        sender_phone: method === "mobile_transfer" ? senderPhone || undefined : undefined,
        sender_account: method === "lypay" ? senderAccount || undefined : undefined,
        // 93-C5 / F-03: the dedup machinery is only armed when this field
        // is non-empty — send it whenever the user provided one.
        payment_reference: trimmedReference || undefined,
      },
    });
  };

  // R-140-j (keyboard/focus): focus RETURN for the waiting modal. Radix's
  // FocusScope restores focus to the element that held it when the dialog
  // OPENED — but the submit trigger had already lost focus to <body> by
  // then (the CTA's native `disabled` during the in-flight POST drops
  // focus the moment the flight starts), so Radix's own restore is a
  // body no-op. Re-land focus on the trigger AFTER Radix's restore pass
  // (setTimeout(0) fires after the unmount commit) so a keyboard user
  // closes the money modal exactly where the next topup starts. Scoped
  // to #wallet-topup-card so BOTH method flows' submit CTAs qualify
  // (the lypay twin's button lives in the same card); when the card is
  // inert (MAX_PENDING freeze, see below) focus() is a no-op and the
  // banner above — announced via role=status — explains why.
  const restoreTopupTriggerFocus = () => {
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>("#wallet-topup-card button[type='submit']")
        ?.focus();
    }, 0);
  };

  const presets =
    method === "mobile_transfer" ? (NETWORK_PRESETS[network] ?? []) : [25, 50, 100, 200];
  const senderPhoneErr = senderPhoneTouched ? libyanPhoneError(senderPhone) : null;
  // R122 (A1-P2): guests get the list-shaped RouteSkeleton instead of
  // a bare null — mirrors checkout.tsx's R115-I1 guard: between the
  // lazy-skeleton swap-out and the redirect tick, a null render painted
  // a blank white frame on the money page (deep links shared over
  // WhatsApp — the dominant local channel — read as a broken page on
  // slow links). Same "list" shape ROUTE_SHAPES maps /wallet to, so the
  // swap-in is a content-fill, not a layout jump.
  if (!token) return <RouteSkeleton shape="list" />;

  return (
    <div className="max-w-5xl mx-auto px-4 py-7 page-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Wallet className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">المحفظة</h1>
          <p className="text-xs text-muted-foreground">شحن الرصيد وعرض السجل</p>
        </div>
      </div>

      {/* L1-2 (R143): the checkout-return affordance. The ONLY path from a
          failed checkout to topup stashes `/wallet?return=/checkout` here
          (PaymentMethodCard's «اشحن المحفظة ثم عُد لإتمام الطلب» link), but
          the sole consumer was TopupWaitingModal's onApprovedContinue — an
          approval landing after dismissal / navigation / tab-death dead-ended
          the journey: the buyer had to manually re-find /cart → /checkout,
          while the un-consumed intent sat in sessionStorage until some
          FUTURE topup's modal fired it (possibly onto a stale basket). This
          banner surfaces the way back while the intent is armed and the
          latest topup is approved (checkout re-validates everything on
          arrival — the link is an affordance, never a promise the cart is
          still buyable). Both actions CONSUME the entry, so it can never
          fire on a stale intent later. */}
      {returnTo && waitingTopupId === null && latestTopup?.status === "approved" && (
        <div
          role="status"
          aria-live="polite"
          className="mb-5 p-3.5 bg-status-success/10 border border-status-success/25 rounded-xl flex flex-wrap items-center gap-3 reveal-up"
        >
          <div className="w-9 h-9 rounded-lg bg-status-success/12 border border-status-success/25 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-4 h-4 text-status-success" aria-hidden="true" />
          </div>
          <p className="flex-1 min-w-0 text-sm font-bold">
            تم اعتماد طلب الشحن — يمكنك متابعة عملية الشراء التي بدأتها.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              className="min-h-11"
              onClick={() => {
                sessionStorage.removeItem("subnation_topup_return");
                setReturnTo(null);
                navigate(returnTo);
              }}
            >
              متابعة الشراء
            </Button>
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem("subnation_topup_return");
                setReturnTo(null);
              }}
              className="min-h-11 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              إخفاء
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── LEFT: Balance + Form ────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Balance card — R136 (FE-1): the markup moved verbatim to
              components/wallet/BalanceCard; the useGetWallet probe and
              the R115-A10 useOnScreen viewport pause stay HERE (the
              loading/error/refetch + the blob's ref/style flow down). */}
          <BalanceCard
            wallet={wallet}
            loading={isLoading}
            error={walletError}
            onRetry={() => void refetchWallet()}
            glowRef={balanceGlow.ref}
            glowStyle={balanceGlow.style}
          />

          {/* Pending limit warning — R136 (FE-1): moved verbatim to
              PendingLimitBanner (the counts flow down as values). */}
          {pendingBlocked && (
            <PendingLimitBanner pendingCount={pendingCount} oldestPending={oldestPending} />
          )}

          {/* Mobile-only latest-topup pin — R136 (FE-1): moved verbatim
              to LatestTopupPin (the derivation + the !isLoading guard
              stay HERE — the same topups list keys the pending gate). */}
          {!isLoading && latestTopup && <LatestTopupPin topup={latestTopup} />}

          {/* Form card */}
          <div
            id="wallet-topup-card"
            /* R139 (precision): /55 → /60 — the family resting edge
               (the balance hero above and the statement below ride the
               same value; one seam weight on the page). */
            className={`bg-card border border-border/60 rounded-2xl p-5 transition-all duration-300 ${pendingBlocked ? "opacity-50 pointer-events-none select-none" : ""}`}
            /* R-140-j (keyboard/focus): the visual freeze now carries its
               real semantic. pointer-events-none blocks the MOUSE only —
               keyboard focus ignored it, so a keyboard user could Tab
               INTO the visually-dead form and type into a frozen money
               flow (submit was still reachable, answering with the
               «لديك طلبات قيد المراجعة» error). React 19's inert removes
               the subtree from the tab order + the a11y tree for AT
               users too — completing what the opacity already said. The
               PendingLimitBanner above (role=status) announces WHY. */
            inert={pendingBlocked}
          >
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
                <Plus className="w-3.5 h-3.5 text-primary" />
              </div>
              <h2 className="font-bold">شحن المحفظة</h2>
              {pendingCount > 0 && !pendingBlocked && (
                <span className="mr-auto text-xs text-status-warning bg-status-warning/8 border border-status-warning/22 px-2 py-0.5 rounded-full">
                  {/* R123-E4a (P2): pending terminology — a topup pending is
                      «قيد المراجعة» (an admin action), not «معلق»; the
                      row badges say statusLabel("pending") = «قيد
                      الانتظار»… which on THIS page denotes the same
                      admin-reviewed state, so the chip joins the banner
                      above on the canonical «قيد المراجعة». The count
                      rides formatCount with full noun phrases
                      (طلب/طلبان/طلبات قيد المراجعة), the same idiom as
                      the banner's «لديك … قيد المراجعة». */}
                  {formatCount(pendingCount, {
                    one: "طلب قيد المراجعة",
                    two: "طلبان قيد المراجعة",
                    few: "طلبات قيد المراجعة",
                    many: "طلباً قيد المراجعة",
                    other: "طلب قيد المراجعة",
                  })}{" "}
                  من {MAX_PENDING}
                </span>
              )}
            </div>

            {/* Method tabs — R136 (FE-1): the markup moved verbatim to
                MethodTabs; the 96-F6/98-F2 switch rotation stays HERE
                in handleMethodChange (values + callback flow down). */}
            <MethodTabs method={method} onSelect={handleMethodChange} />

            {/* Mobile Transfer Flow — R136 (FE-1): the markup moved
                verbatim to MobileTransferForm; every input's onChange/
                onBlur calls a page-owned handler above so the
                key-rotation contract is untouched. */}
            {method === "mobile_transfer" && (
              <MobileTransferForm
                network={network}
                amount={amount}
                presets={presets}
                paymentReference={paymentReference}
                senderPhone={senderPhone}
                senderPhoneTouched={senderPhoneTouched}
                senderPhoneErr={senderPhoneErr}
                savedPhones={savedPhones}
                rememberPhone={rememberPhone}
                error={error}
                submitting={submitting}
                mutationPending={topupMutation.isPending}
                onSubmit={handleSubmit}
                onNetworkChange={handleNetworkChange}
                onAmountChange={handleAmountChange}
                onAmountPreset={applyAmountPreset}
                onAmountBlur={handleAmountBlur}
                onReferenceChange={handlePaymentReferenceChange}
                onSavedPhonePick={handleSavedPhonePick}
                onSenderPhoneChange={handleSenderPhoneChange}
                onSenderPhoneTouched={handleSenderPhoneTouched}
                onRememberPhoneChange={handleRememberPhoneChange}
              />
            )}

            {/* LyPay Flow — R136 (FE-1): the markup moved verbatim to
                LyPayFlow (same page-owned handler contract as the
                mobile twin). */}
            {method === "lypay" && (
              <LyPayFlow
                amount={amount}
                presets={presets}
                paymentReference={paymentReference}
                senderAccount={senderAccount}
                error={error}
                submitting={submitting}
                mutationPending={topupMutation.isPending}
                onSubmit={handleSubmit}
                onAmountChange={handleAmountChange}
                onAmountPreset={applyAmountPreset}
                onAmountBlur={handleAmountBlur}
                onReferenceChange={handlePaymentReferenceChange}
                onSenderAccountChange={handleSenderAccountChange}
              />
            )}
          </div>
        </div>

        {/* ── RIGHT: Topup History — R136 (FE-1): moved verbatim to
            TopupHistoryCard (the useListTopups query stays HERE — the
            pending gate and the latest-topup pin key off it too). */}
        <TopupHistoryCard
          topups={topups}
          loading={topupsLoading}
          error={topupsError}
          onRetry={() => void refetchTopups()}
        />
      </div>

      {/* R115 (A8 P2): the wallet STATEMENT — additive, below the topup
          requests list. Full-width under the grid so the sticky topup
          card keeps its behavior (a sticky card + tall sibling in one
          column would overlap while scrolling). R136 (FE-1): the markup
          moved verbatim to WalletStatementCard (+ LedgerEntryRow); the
          useGetWalletLedger query stays HERE. */}
      <WalletStatementCard
        entries={ledger}
        loading={ledgerLoading}
        error={ledgerError}
        onRetry={() => void refetchLedger()}
      />

      <div className="h-6 md:h-0" />

      <TopupWaitingModal
        topupId={waitingTopupId}
        token={token}
        /* R-140-j: both dismiss paths re-land focus on the submit
           trigger — see restoreTopupTriggerFocus above. */
        onClose={() => {
          setWaitingTopupId(null);
          restoreTopupTriggerFocus();
        }}
        onApprovedContinue={
          returnTo
            ? () => {
                sessionStorage.removeItem("subnation_topup_return");
                setWaitingTopupId(null);
                navigate(returnTo);
              }
            : undefined
        }
      />
    </div>
  );
}
