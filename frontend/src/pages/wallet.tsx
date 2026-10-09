import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/CopyButton";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { TopupWaitingModal } from "@/components/TopupWaitingModal";
import { useOnScreen } from "@/hooks/use-on-screen";
import { useSocket } from "@/hooks/use-socket";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey } from "@/lib/idempotency";
import {
  RECEIVER_PHONE,
  transferCode,
  transferCodeTelHref,
  type TransferNetwork,
} from "@/lib/transfer-code";
import {
  formatCurrency,
  formatDate,
  formatRelativeTime,
  statusLabel,
  tierColor,
  tierLabel,
} from "@/lib/utils";
import { STATUS_TONE, StatusBadge, UNKNOWN_STATUS_TONE } from "@/components/ui/status-badge";
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
  type GetWalletLedger200Item,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  ArrowLeftRight,
  Building2,
  CheckCircle,
  Clock,
  Lock,
  PhoneCall,
  Plus,
  Smartphone,
  Star,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { formatCount, sanitizeInternalPath } from "@/lib/utils";

const MAX_PENDING = 3;

// LocalStorage keys
const STORAGE_KEYS = {
  SENDER_PHONES: "subnation_saved_sender_phones",
  TOPUP_PREFERENCES: "subnation_topup_preferences",
};

// Get saved sender phones from localStorage
function getSavedSenderPhones(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SENDER_PHONES);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

// Save sender phone to localStorage
function saveSenderPhone(phone: string) {
  const phones = getSavedSenderPhones();
  if (!phones.includes(phone)) {
    phones.unshift(phone);
    if (phones.length > 5) phones.pop(); // Keep only last 5
    localStorage.setItem(STORAGE_KEYS.SENDER_PHONES, JSON.stringify(phones));
  }
}

// Get saved topup preferences. `method` is included so a user who
// previously chose LyPay doesn't have to re-pick mobile_transfer
// every visit — the wallet form remembers their last choice.
function getTopupPreferences() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.TOPUP_PREFERENCES);
    return saved
      ? JSON.parse(saved)
      : { network: "libyana", amount: "", method: "mobile_transfer" };
  } catch {
    return { network: "libyana", amount: "", method: "mobile_transfer" };
  }
}

// Save topup preferences
function saveTopupPreferences(network: string, amount: string, method: string) {
  localStorage.setItem(STORAGE_KEYS.TOPUP_PREFERENCES, JSON.stringify({ network, amount, method }));
}

const LYPAY_INFO = {
  account_name: "سبنيشن ليبيا",
  iban: "LY83 0180 0000 0000 0028 7766 3",
  account_number: "0028776630001",
  bank: "بنك التجارة والتنمية",
  branch: "طرابلس - القبة",
};

// ── 98-F2 (R98-09 / r98 frontend-deep §2 — P3): durable topup intent key ─────
//
// The topup Idempotency-Key used to live in a useRef ONLY — it died with
// the component, so a refresh / back-navigation after a NETWORK-level
// failure (response lost, topup possibly created server-side) minted a
// FRESH key on the re-submit: the header became useless exactly when it
// was needed (the backend still holds the second line of defense — the
// uniq_wallet_topups_payment_reference constraint + composite dedup —
// so this is defense-in-depth parity with the buy-key/checkout-key
// patterns from 96-F4 / 97-F5).
//
// Storage contract (mirrors product.tsx's subnation_buykey, 97-F5):
//   • slot:   sessionStorage "subnation_topupkey" — per-tab retry token,
//     never durable state; every access try/catch-guarded (quota/
//     private-mode degrades to the in-memory 96-F6 behavior);
//   • TTL:    a key older than 10 minutes is a stale intent → ignored;
//   • fingerprint: amount | method | phone — binds the key to WHAT is
//     being topped up so a stale intent is never replayed onto changed
//     data (the full body also carries network/account/reference — those
//     still ROTATE the key via the 96-F6 field-change points below,
//     which keeps the backend's 409 same-key-different-body branch
//     unreachable);
//   • restore: on mount, AFTER the saved preferences are applied — a
//     stored entry still inside its TTL whose fingerprint matches the
//     restored state (prefs amount/method + empty phone) is reused so
//     the re-submit replays the server's cached response instead of
//     creating a second pending topup. An intent whose phone was typed
//     (never restored from prefs by design) simply re-mints — the
//     payment_reference dedup covers that residual.
const TOPUP_KEY_SLOT = "subnation_topupkey";
/** 98-F2 (R98-09): retry-token TTL — mirrors the buy-key guidance. */
const TOPUP_KEY_TTL_MS = 10 * 60 * 1000;

interface StoredTopupIntent {
  /** The Idempotency-Key header value. */
  k: string;
  /** Date.now() at mint time — the TTL stamp. */
  t: number;
  /** Intent fingerprint — amount | method | phone. */
  f: string;
}

function topupIntentFingerprint(amount: string, method: string, phone: string): string {
  return `${amount}|${method}|${phone.trim()}`;
}

function loadTopupIntentKey(fingerprint: string): string | null {
  try {
    const raw = sessionStorage.getItem(TOPUP_KEY_SLOT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTopupIntent>;
    if (typeof parsed.k !== "string" || !parsed.k) return null;
    if (typeof parsed.t !== "number" || Number.isNaN(parsed.t)) return null;
    if (Date.now() - parsed.t > TOPUP_KEY_TTL_MS) return null;
    if (parsed.f !== fingerprint) return null;
    return parsed.k;
  } catch {
    // corrupt entry / storage unavailable — degrade to a fresh key
    return null;
  }
}

function persistTopupIntentKey(fingerprint: string, key: string): void {
  try {
    const entry: StoredTopupIntent = { k: key, t: Date.now(), f: fingerprint };
    sessionStorage.setItem(TOPUP_KEY_SLOT, JSON.stringify(entry));
  } catch {
    // degraded: in-memory-only key (96-F6 behavior) — never throw on the money path
  }
}

const NETWORK_PRESETS: Record<string, number[]> = {
  libyana: [1, 5, 10, 20, 50, 100],
  madar: [1, 5, 10, 20, 50, 100],
};

const NETWORKS = [
  {
    value: "libyana",
    label: "ليبيانا",
    // R94-A1 #5 (P2, WCAG AA): green-300/blue-300 on white cards
    // measured 1.40:1 / 2.30:1 in the light theme — the selected network
    // name was near-invisible. The shared --status-* tokens are
    // theme-aware; the bg tint stays brand-hued (non-text decoration —
    // the AA text carries the state).
    // R124-I1 (A3 P2, WCAG 1.4.11): the selected border is the visible
    // state boundary and must clear 3:1 in BOTH themes. The raw
    // green-500/45 / blue-500/45 borders measured 2.55:1 / 1.96:1 on the
    // dark chip (light worse) — the theme-aware --status-* pair at the
    // Input recipe's calibrated /75 alpha (input.tsx A4-F12) measures
    // ≈5.2:1 dark / ≈3.5:1 light (success) and ≈3.5:1 in both (info).
    color: "text-status-success",
    border: "border-status-success/75",
    bg: "bg-green-500/10",
    activeBg: "bg-green-500",
  },
  {
    value: "madar",
    label: "مدار",
    color: "text-status-info",
    border: "border-status-info/75",
    bg: "bg-blue-500/10",
    activeBg: "bg-blue-500",
  },
];

type Method = "mobile_transfer" | "lypay";

function networkLabel(net?: string | null) {
  if (net === "libyana") return "ليبيانا";
  if (net === "madar") return "مدار";
  return net ?? "";
}

function topupStatusIcon(status: string) {
  if (status === "approved") return <CheckCircle className="w-4 h-4 text-status-success" />;
  if (status === "rejected") return <XCircle className="w-4 h-4 text-status-error" />;
  return <Clock className="w-4 h-4 text-status-warning pulse-dot" />;
}

/**
 * R124-I1 (A1 P3): a pending TOPUP is «قيد المراجعة» — an admin review
 * action, exactly as the pending banner, the form chip and
 * TopupWaitingModal («قيد المراجعة من الإدارة») already say. The shared
 * statusLabel() maps pending to «قيد الانتظار» for ORDER/referral
 * waiting states (correct there), which left one screen saying two
 * words for one topup state. The topup rows and the mobile latest-topup
 * pin resolve through here so the concept keeps one word on this page.
 */
function topupStatusLabel(status: string): string {
  return status === "pending" ? "قيد المراجعة" : statusLabel(status);
}

/**
 * 96-F6 (R96 A2 P1-6): amount-field sanitizer for the type="text" +
 * inputMode="decimal" inputs below. An Arabic-locale virtual keyboard can
 * deliver Arabic-Indic (٠-٩) or Persian (۰-۹) digits and locale decimal
 * separators (٫ / ,); paste can deliver letters and multiple dots. Only
 * digits and ONE decimal point survive — mirrors the sender-phone digit
 * sanitizer in step 4. R116-S2 (P2): the whole-dinar rounding stays in
 * onBlur + handleSubmit (unchanged contract, new integer domain).
 */
function sanitizeAmountInput(raw: string): string {
  let s = raw
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    // Locale decimal separators (Arabic ٫, Latin comma) → dot
    .replace(/[٫,]/g, ".");
  s = s.replace(/[^0-9.]/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    // Collapse to a single decimal point (keep the first).
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  }
  return s;
}

/**
 * A numbered step marker for the topup flows.
 *
 * R125-I7 (A7 B-7, the R124-A1 F2 collapse): every call site used to
 * pass a hardcoded `active` — all five dots rendered as "current",
 * the inactive branch was dead code, and the prop claimed a
 * where-am-I signal the form never derived (onboarding's twin dots
 * DO derive theirs). The dots are now honestly what they always
 * rendered: a flat numbered legend (1 الشبكة، 2 المبلغ…) — no
 * progress semantics, no dead branch, identical visuals. The
 * primary-filled numbered circle is the legend's marker style.
 */
function StepDot({
  n,
  label,
  htmlFor,
}: {
  n: number;
  label: string;
  /**
   * 96-F6 (R96 A6 #2 P1): when set, the step text renders as a <label>
   * bound to the field it names — the PaymentReferenceField recipe in
   * this file (93-C5 / F-03, A4 P3 #37). Only field steps pass it; the
   * informational steps keep the plain span. Bonus: tapping the step
   * label focuses/activates the bound field (bigger hit area).
   */
  htmlFor?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-bold">
      <div className="w-6 h-6 rounded-full flex items-center justify-center text-2xs font-bold shrink-0 shadow-sm bg-primary text-white shadow-primary/30">
        {n}
      </div>
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-xs font-bold cursor-pointer">
          {label}
        </Label>
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs text-muted-foreground mb-0.5 font-semibold">{label}</div>
      <div className="font-bold text-sm">{value}</div>
    </div>
  );
}

/** One wallet_ledger row as served by GET /api/wallet/ledger (R115). */
type LedgerEntry = GetWalletLedger200Item;

/**
 * R115 (A8 P2): signed, directional display amount for a ledger row.
 *
 * The wallet_ledger writers store the ABSOLUTE amount for the fixed
 * types (topup / purchase / refund / referral_credit — the direction IS
 * the type; checkout writes String(finalPrice), refunds and topups their
 * positive values), while `adjustment` rows carry their own sign
 * (balanceAfter − balanceBefore, see AdjustmentService). This helper
 * derives the display sign from the type so the statement reads as a
 * movement list: credits with a leading «+», debits with a leading «-».
 * The amount span renders dir="ltr" so the sign always leads the number
 * inside the RTL layout.
 */
function ledgerAmountDisplay(entry: LedgerEntry): { text: string; credit: boolean } {
  const amount = entry.amount ?? 0;
  const abs = Math.abs(amount);
  if (entry.type === "adjustment") {
    return {
      text: `${amount < 0 ? "-" : "+"}${formatCurrency(abs)}`,
      credit: amount >= 0,
    };
  }
  // Purchases are the only fixed-type debit; everything else credits
  // the wallet (topups, refunds, referral/welcome credits).
  const debit = entry.type === "purchase";
  return { text: `${debit ? "-" : "+"}${formatCurrency(abs)}`, credit: !debit };
}

/**
 * R116-S2 (P3): attribution label for a statement row.
 *
 * `adjustment` rows are the generic bucket — a loyalty conversion
 * lands there with reference_type "loyalty_conversion" and an Arabic
 * description («تحويل N نقطة ولاء إلى رصيد»). Without this mapping the
 * credit rendered as the generic «تسوية رصيد», unattributable to the
 * loyalty action that produced it. Priority: the writer's own
 * description → the loyalty_conversion mapping → the served
 * type_label → the raw type.
 */
function ledgerEntryLabel(entry: LedgerEntry): string {
  const description = entry.description?.trim();
  if (description) return description;
  if (entry.reference_type === "loyalty_conversion") return "تحويل نقاط";
  return entry.type_label ?? entry.type ?? "حركة";
}

/* R118-B2 (A6 F-8): memoized ledger row. The wallet page re-renders on
 * every keystroke of the topup amount input — the statement card's up
 * to 100 rows were re-rendered inline each time for nothing. The row is
 * pure display (entry + index drive everything; no callbacks), so a
 * shallow-compare memo bails every row on unrelated parent state.
 * Same pattern as the admin orders rows extracted this round. */
const LedgerEntryRow = memo(function LedgerEntryRow({
  entry,
  index,
}: {
  entry: LedgerEntry;
  index: number;
}) {
  const { text, credit } = ledgerAmountDisplay(entry);
  return (
    <div
      className={`float-in stagger-${Math.min(index, 8)} flex items-center gap-3 p-3 bg-muted/18 border border-border/30 rounded-xl hover:bg-muted/30 transition-colors`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold mb-0.5">{ledgerEntryLabel(entry)}</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {typeof entry.balance_after === "number" && (
            <span className="text-3xs text-muted-foreground tabular-nums">
              الرصيد بعدها: {formatCurrency(entry.balance_after)}
            </span>
          )}
          {entry.created_at && (
            <span className="text-3xs text-muted-foreground">· {formatDate(entry.created_at)}</span>
          )}
        </div>
      </div>
      {/* dir="ltr": the sign must lead the number inside the RTL
          layout; tabular-nums aligns the column of amounts. */}
      <span
        dir="ltr"
        className={`text-xs font-bold tabular-nums shrink-0 ${
          credit ? "text-status-success" : "text-foreground/85"
        }`}
      >
        {text}
      </span>
    </div>
  );
});

/**
 * R115 (A8 P2): the user-facing wallet STATEMENT — every LYD movement
 * from wallet_ledger (topups, purchases, refunds, loyalty conversions,
 * referral/welcome credits), newest first.
 *
 * Until R115 the wallet page showed only topup REQUESTS: a refund
 * credit, a welcome bonus or a loyalty conversion was invisible as a
 * transaction — "where did my balance come from?" was unanswerable in
 * the UI. This card is purely additive (the topup requests list above is
 * untouched). Distinct LOADING / ERROR / EMPTY / ROWS branches follow
 * the 93-C5/F-05 idiom: an outage is NEVER the «لا توجد حركات بعد»
 * empty state.
 */
function WalletStatementCard({
  entries,
  loading,
  error,
  onRetry,
}: {
  entries: LedgerEntry[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="wallet-statement-heading"
      className="bg-card border border-border/55 rounded-2xl p-5 mt-5"
    >
      <div className="flex items-center gap-2.5 mb-4">
        <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
        <h2 id="wallet-statement-heading" className="font-bold text-sm">
          سجل الحركات
        </h2>
        {entries.length > 0 && (
          <span className="mr-auto text-xs text-muted-foreground font-semibold">
            {/* R116-S2 (P3): the backend caps the ledger at 100 rows —
                a full page is a TRUNCATED window, not the user's total
                history. Saying «100 حركة» implied "exactly 100 ever";
                the caption states what's actually shown. */}
            {entries.length >= 100
              ? "عرض آخر 100 حركة"
              : formatCount(entries.length, {
                  one: "حركة",
                  two: "حركتان",
                  few: "حركات",
                  many: "حركة",
                  other: "حركة",
                })}
          </span>
        )}
      </div>

      {loading ? (
        /* Statement skeleton — same shape as the topup list's, so the
           two right-column lists feel like one family. */
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              /* R125-I7 (A7 B-12 / R124-A3 #12): 2px border-l accent
                 stripe → the plain 1px border (craft-floor cap). */
              className="bg-card border border-border rounded-xl p-4 flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-xl bg-muted skeleton-shimmer shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted skeleton-shimmer rounded-lg w-2/5" />
                <div className="h-3 bg-muted skeleton-shimmer rounded w-1/3" />
              </div>
              <div className="h-5 bg-muted skeleton-shimmer rounded-full w-16 shrink-0" />
            </div>
          ))}
        </div>
      ) : error ? (
        /* 93-C5 / F-05: outage ≠ "no movements yet" — a failed ledger
           fetch must not read as an empty wallet history. */
        <FetchErrorCard
          size="compact"
          title="تعذّر تحميل سجل الحركات"
          description="حدث خطأ في الاتصال — أعد المحاولة لعرض حركات محفظتك"
          onRetry={onRetry}
        />
      ) : entries.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <div className="w-16 h-16 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mx-auto mb-4">
            <ArrowLeftRight className="w-7 h-7 opacity-25" />
          </div>
          <p className="font-bold text-base mb-1.5 text-foreground/80">لا توجد حركات بعد</p>
          <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
            ستظهر هنا عمليات الشحن والشراء والاسترداد في محفظتك
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 lg:max-h-[480px] overflow-y-auto scrollbar-none">
          {entries.map((e, i: number) => (
            <LedgerEntryRow key={e.id ?? i} entry={e} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Step-by-step explanation of the mobile transfer flow. Concise on
 * purpose — three lines that match the actions the user actually takes.
 */
function InstructionsPanel() {
  const steps = [
    "قم بتحويل الرصيد باستخدام الزر.",
    "بعد نجاح التحويل قم بإرسال الطلب.",
    "سيتم مراجعته من الإدارة.",
  ];
  return (
    <ol className="mt-3 mb-4 bg-muted/25 border border-border/45 rounded-xl p-3.5 space-y-2 text-xs leading-relaxed">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 border border-primary/30 text-primary text-3xs font-bold flex items-center justify-center">
            {i + 1}
          </span>
          <span className="text-foreground/85 pt-0.5">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Live, dynamically-generated USSD transfer code + one-tap action.
 *
 * The code recomputes on every amount/network change — no debounce,
 * no submit needed. The "تحويل الرصيد" button uses a `tel:` URL with
 * the code embedded; mobile dialers honour this for both Libyana and
 * Madar. On non-mobile environments the link still navigates to the
 * tel: URL — most desktops fall back gracefully (system handler or
 * "no app available"), and we additionally expose a copy button so
 * the user can never get stuck.
 */
function TransferCodePanel({
  network,
  amount,
  receiver,
}: {
  network: TransferNetwork;
  amount: string;
  receiver: string;
}) {
  const code = transferCode(network, amount, receiver);
  const href = code ? transferCodeTelHref(code) : null;
  const buttonClasses =
    "flex items-center justify-center gap-2 w-full h-11 rounded-xl font-bold text-sm transition-all press-spring";

  return (
    <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-primary-text">
          <PhoneCall className="w-3.5 h-3.5" />
          {/* R111-F2 N3: «رمز» family (رمز الكوبون، رمز التحقق) — was
              «كود التحويل». */}
          رمز التحويل
        </div>
        {/* R116-S2 (P2, money path): the shared 44px CopyButton replaces
            the local pill — the transfer CODE is what the user must dial,
            so the copy affordance is the money-critical control here. */}
        {code && <CopyButton text={code} />}
      </div>

      {/* 96-F6 (R96 A6 #19): the empty-state hint is Arabic — it used to
          sit INSIDE the dir="ltr" text-left font-mono box (left-aligned
          Arabic in an LTR-declared element, announced to screen readers
          with LTR context). The hint now renders as its own RTL element
          outside the LTR box; one persistent aria-live wrapper keeps the
          live region mounted across the swap so the generated code is
          still announced. */}
      <div aria-live="polite" className="mb-3">
        {code ? (
          <div
            dir="ltr"
            /* R122 (A1 P2-4): tracking-wide was a silent no-op — the global
               Arabic letter-spacing guard (index.css:917) zeroes the five
               tracking utilities app-wide, so this LTR mono code rendered
               with 0 spacing while the same class of datum on /referrals
               had 0.2em. The arbitrary tracking-[0.2em] form carries the
               intended spacing for Latin-only runs; the guard's
               letter-join protection stays intact for Arabic. */
            className="font-mono font-bold text-base sm:text-lg tracking-[0.2em] rounded-lg bg-background/60 border border-border/40 px-3 py-2.5 break-all min-h-[44px] flex items-center text-foreground"
          >
            {code}
          </div>
        ) : (
          <div className="rounded-lg bg-background/60 border border-border/40 px-3 py-2.5 min-h-[44px] flex items-center text-muted-foreground/80 text-sm">
            أدخل المبلغ لإنشاء الرمز تلقائياً
          </div>
        )}
      </div>

      {/* Disclaimer ABOVE the button — desktop users who tap the
          tel: link and don't get a dialer were hitting a dead state
          before noticing the "copy and dial manually" hint underneath.
          Surfacing it above the action sets the right expectation up
          front: tap is the fast path, copy is the universal fallback. */}
      <p className="text-2xs text-muted-foreground mb-2 leading-relaxed">
        على الجوال: اضغط الزر لفتح لوحة الاتصال. على الحاسوب: انسخ الرمز وأدخله يدوياً.
      </p>

      {href ? (
        <a
          href={href}
          className={`${buttonClasses} bg-primary text-white hover:bg-primary/90 shadow-md shadow-primary/25`}
        >
          <PhoneCall className="w-4 h-4" />
          تحويل الرصيد
        </a>
      ) : (
        <button
          type="button"
          disabled
          className={`${buttonClasses} bg-muted/40 text-muted-foreground/60 cursor-not-allowed`}
        >
          <PhoneCall className="w-4 h-4" />
          تحويل الرصيد
        </button>
      )}
    </div>
  );
}

/**
 * 93-C5 / F-03 (A2 P1 #2): transfer-receipt reference field, rendered
 * under the amount in BOTH topup flows. Programmatic label + htmlFor
 * (A4 P3 #37 — placeholder-only names), dir="ltr" + font-mono for the
 * receipt/reference runs (typically Latin digits), maxLength 100
 * matching the backend's boundary.
 *
 * R123-E4a (P1): the mobile_transfer flow passes required — the backend
 * has hard-required the reference there since B4-R1 (backend
 * wallet.ts:380-392, 400 «رمز التحويل (رقم العملية من إيصال التحويل)
 * مطلوب…» — R126-L2/A8 F4 aligned the message to the «رمز التحويل»
 * canon) while this field said «اختياري», so users on the
 * Libyana/Madar flow who skipped the receipt hit a post-submit 400.
 * lypay keeps it genuinely optional (gateway receipts are not
 * consistently exposed to users).
 */
function PaymentReferenceField({
  value,
  onChange,
  id,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  required: boolean;
}) {
  return (
    <div className="mt-3">
      <Label htmlFor={id} className="text-xs font-bold text-muted-foreground mb-2 block">
        {/* R116-S2: unified «رمز» family (رمز التحويل above, رمز الكوبون)
            — was «رقم مرجع التحويل», the only «رقم مرجع» outlier on the
            topup money flow. R123-E4a: (مطلوب) on the mobile flow — the
            backend rejects a blank reference there (B4-R1). */}
        رمز التحويل <span className="font-semibold">{required ? "(مطلوب)" : "(اختياري)"}</span>
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="text"
        maxLength={100}
        placeholder="رقم إيصال التحويل كما ورد في رسالة التحويل"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        dir="ltr"
        autoComplete="off"
        className="text-left font-mono h-11 rounded-xl border-border/50 focus:border-primary/45 bg-card"
      />
      <p className="text-2xs text-muted-foreground mt-1.5 leading-relaxed">
        {required
          ? "مطلوب للتحقق من تحويلك ومنع احتسابه مرتين."
          : "يساعد هذا المرجع فريق المراجعة في التحقق من تحويلك ومنع احتسابه مرتين."}
      </p>
    </div>
  );
}

// R123-E4a (P3-d): the balance card's tier accents. The TEXT tone is the
// shared tierColor() (lib/utils) — these two maps only carry the
// bg/border variants tierColor doesn't express, keyed ONCE so the two
// inline conditional ladders below (dot + badge) can't drift apart
// again (they had already drifted from tierColor's palette).
const TIER_DOT_BG: Record<string, string> = {
  bronze: "bg-amber-500",
  silver: "bg-slate-500",
  gold: "bg-status-warning",
  platinum: "bg-cyan-600",
};
const TIER_BADGE_BORDER: Record<string, string> = {
  bronze: "border-amber-500/25",
  silver: "border-slate-500/25",
  gold: "border-status-warning/25",
  platinum: "border-cyan-600/25",
};

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

  const [method, setMethod] = useState<Method>("mobile_transfer");
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
  // fingerprint, see the helpers' docblock above) so a refresh after a
  // network-level failure re-submits with the SAME header (replay)
  // instead of a freshly minted one. Every rotation re-persists under
  // the intent's NEW fingerprint (rotations are always captured AFTER
  // the field change they correspond to — see the explicit arguments
  // at each call site; the closure state at rotation time is stale by
  // one setState).
  const topupKeyRef = useRef<string | null>(null);
  // Lazy init — idempotent null-guard (StrictMode double-render safe).
  // In-memory only: the mount restore below decides what the DURABLE
  // key for this visit is.
  if (topupKeyRef.current === null) {
    topupKeyRef.current = generateIdempotencyKey();
  }
  const resetTopupKey = (nextFingerprint: string) => {
    topupKeyRef.current = generateIdempotencyKey();
    persistTopupIntentKey(nextFingerprint, topupKeyRef.current);
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

  // Load saved preferences on mount
  useEffect(() => {
    const prefs = getTopupPreferences();
    setNetwork(prefs.network);
    setAmount(prefs.amount);
    if (prefs.method === "mobile_transfer" || prefs.method === "lypay") {
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
    } else if (topupKeyRef.current) {
      // Non-null by the lazy init above (render ran before this effect).
      persistTopupIntentKey(fingerprint, topupKeyRef.current);
    }
  }, []);

  // Save preferences when they change
  useEffect(() => {
    saveTopupPreferences(network, amount, method);
  }, [network, amount, method]);

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
    request: {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        // 96-F6 (R96 §5.1): per-intent idempotency key — see topupKeyRef
        // above for the rotation contract. Read at render time; a retry
        // of an unchanged intent replays the SAME key.
        "Idempotency-Key": topupKeyRef.current,
      },
    },
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

  const tier = wallet?.loyalty_tier ?? "bronze";

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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── LEFT: Balance + Form ────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Balance card */}
          {isLoading ? (
            <div className="rounded-2xl h-36 skeleton-shimmer border border-border/45" />
          ) : walletError ? (
            /* 93-C5 / F-05 (A4 #7): the card used to silently vanish on a
               failed /api/wallet probe — the money page's primary datum
               cannot just disappear. Honest error card + retry (same
               idiom as orders/loyalty error states). */
            <FetchErrorCard
              size="section"
              title="تعذّر تحميل رصيد المحفظة"
              description="حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"
              onRetry={() => void refetchWallet()}
            />
          ) : wallet ? (
            <div
              ref={balanceGlow.ref}
              className="relative overflow-hidden rounded-2xl border border-primary/22 bg-gradient-to-br from-primary/14 via-primary/5 to-card p-4 sm:p-5 shadow-xl shadow-primary/8"
            >
              <div className="absolute inset-0 dot-grid opacity-35 pointer-events-none" />
              <div
                className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-primary/10 blur-3xl pointer-events-none blob-drift"
                style={balanceGlow.style}
              />
              <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full bg-primary/5 blur-2xl pointer-events-none" />

              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5 text-primary/65 text-xs font-bold mb-2">
                    <Wallet className="w-3.5 h-3.5" />
                    الرصيد المتاح
                  </div>
                  <div className="text-3xl sm:text-4xl font-bold tabular-nums mb-3 leading-none text-foreground num-pop break-words">
                    {formatCurrency(wallet.balance ?? 0)}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${TIER_DOT_BG[tier] ?? "bg-muted-foreground"}`}
                      />
                      <span className="text-muted-foreground text-xs">المستوى:</span>
                      <span className={`font-bold text-xs ${tierColor(tier)}`}>
                        {tierLabel(tier)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <Star className="w-3 h-3 text-status-warning" />
                      <span className="font-bold tabular-nums text-status-warning">
                        {wallet.loyalty_points ?? 0}
                      </span>
                      <span className="text-muted-foreground">نقطة</span>
                    </div>
                  </div>
                </div>
                <div
                  /* R123-E4a (P3-d): border from the shared tier map, text
                      tone from tierColor() — was a second inline ladder
                      duplicating the helper's palette. */
                  className={`shrink-0 px-3 py-2 rounded-xl border text-2xs font-bold bg-background/30 ${TIER_BADGE_BORDER[tier] ?? "border-border/40"} ${tierColor(tier)}`}
                >
                  {tierLabel(tier)}
                </div>
              </div>
            </div>
          ) : null}

          {/* Pending limit warning */}
          {pendingBlocked && (
            <div className="flex items-start gap-3 p-4 bg-status-warning/8 border border-status-warning/22 rounded-2xl float-in">
              <Lock className="w-4.5 h-4.5 text-status-warning shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-status-warning">
                  {/* R123-E4a (P3-a): «طلبات الشحن موقوفة مؤقتاً» read as a
                      platform outage — the user is only queued behind their
                      own earlier review requests. */}
                  وصلت للحد الأقصى من طلبات المراجعة
                </p>
                {/* 96-F6 (R96 A6 #4 P1): /75 → full token — the translucent
                    warning text measured ≈2.07:1 on white in light mode
                    (AA fail). Background tints stay as-is. */}
                <p className="text-xs text-status-warning mt-0.5">
                  لديك{" "}
                  {formatCount(pendingCount, {
                    one: "طلب",
                    two: "طلبان",
                    few: "طلبات",
                    many: "طلباً",
                    other: "طلب",
                  })}{" "}
                  قيد المراجعة (الحد الأقصى {MAX_PENDING})
                </p>
                {oldestPending && (
                  <p className="text-2xs text-status-warning mt-1">
                    {/* R115 (A8 #5): ONE approval SLA across every surface
                        (this line, TopupWaitingModal, support FAQ) — the
                        old «30 دقيقة» here vs «ثوانٍ» in the waiting modal
                        contradicted each other on the same money flow. */}
                    أقدم طلب: {formatRelativeTime(oldestPending)} — عادةً خلال دقائق، وبحد أقصى 30
                    دقيقة خلال ساعات العمل.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Mobile-only latest-topup pin. Wallet history lives in the
              right-hand column on desktop (sticky), but on mobile it
              stacks below the form — this small banner gives a quick
              "last submission" signal at the top of the page so a
              user who just submitted doesn't have to scroll to know
              their request is queued. */}
          {!isLoading && latestTopup && (
            <div className="lg:hidden flex items-center gap-3 p-3 bg-card border border-border/55 rounded-xl">
              {topupStatusIcon(latestTopup.status)}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold tabular-nums">
                  آخر طلب: {formatCurrency(latestTopup.amount)}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {/* R116: shared StatusBadge (STATUS_TONE) replaces the
                      deprecated statusColor() string-concat — 93-C7
                      follow-up, same tokens/pill shape as the rest. */}
                  <StatusBadge
                    variant={
                      STATUS_TONE[latestTopup.status as keyof typeof STATUS_TONE] ??
                      UNKNOWN_STATUS_TONE
                    }
                    size="xs"
                  >
                    {topupStatusLabel(latestTopup.status)}
                  </StatusBadge>
                  <span className="text-3xs text-muted-foreground">
                    {formatRelativeTime(latestTopup.created_at)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Form card */}
          <div
            className={`bg-card border border-border/55 rounded-2xl p-5 transition-all duration-300 ${pendingBlocked ? "opacity-50 pointer-events-none select-none" : ""}`}
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

            {/* Method tabs */}
            <div className="mb-5">
              <p className="text-xs text-muted-foreground mb-2.5 font-bold">طريقة الدفع</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    id: "mobile_transfer" as Method,
                    icon: Smartphone,
                    title: "تحويل رصيد",
                    sub: "ليبيانا / مدار",
                  },
                  { id: "lypay" as Method, icon: Building2, title: "تحويل مصرفي", sub: "LyPay" },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      // 96-F6 (R96 §5.1): switching method = new intent →
                      // rotate the key (the payload carries
                      // payment_method / payment_network).
                      // 98-F2: persist under the post-switch fingerprint.
                      if (m.id !== method) {
                        resetTopupKey(topupIntentFingerprint(amount, m.id, senderPhone));
                      }
                      setMethod(m.id);
                      setError("");
                    }}
                    /* R124-I1 (A5 P2, WCAG 4.1.2): the selected method is
                        exposed to assistive tech — same tested
                        aria-pressed toggle-button idiom as the catalog/
                        variant pills (home.tsx / product.tsx), not
                        class-only state. */
                    aria-pressed={method === m.id}
                    className={`flex flex-col sm:flex-row items-center gap-2 p-3 rounded-xl border-2 transition-all duration-180 text-center sm:text-right press-spring min-w-0 ${
                      method === m.id
                        ? "border-primary/50 bg-primary/7 shadow-sm"
                        : "border-border/50 hover:border-border/80 bg-card"
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${method === m.id ? "bg-primary shadow-sm shadow-primary/30" : "bg-muted/60"}`}
                    >
                      <m.icon
                        className={`w-4 h-4 ${method === m.id ? "text-white" : "text-muted-foreground"}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`font-bold text-sm ${method === m.id ? "text-foreground" : "text-foreground/80"}`}
                      >
                        <span className="block leading-snug">{m.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground leading-snug">{m.sub}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Transfer Flow */}
            {method === "mobile_transfer" && (
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Step 1: Network */}
                <div>
                  <StepDot n={1} label="اختر شبكتك" />
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {NETWORKS.map((n) => (
                      <button
                        key={n.value}
                        type="button"
                        onClick={() => {
                          // 96-F6 (R96 §5.1): network is part of the payload.
                          // 98-F2: network is not part of the fingerprint
                          // contract (amount|method|phone) — the rotation
                          // itself still fires (new body → new key).
                          if (n.value !== network) {
                            resetTopupKey(topupIntentFingerprint(amount, method, senderPhone));
                          }
                          setNetwork(n.value);
                        }}
                        /* R124-I1 (A5 P2, WCAG 4.1.2): aria-pressed exposes
                            which network is selected — the money path's
                            selector groups follow the tested home.tsx /
                            product.tsx toggle-button idiom. */
                        aria-pressed={network === n.value}
                        className={`py-3 rounded-xl border-2 font-bold text-sm transition-all press-spring ${
                          network === n.value
                            ? `${n.border} ${n.bg} ${n.color} shadow-sm`
                            : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border/80"
                        }`}
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/20" />

                {/* Step 2: Amount */}
                <div>
                  {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
                  <StepDot n={2} label="المبلغ بالدينار الليبي" htmlFor="topup-amount-mobile" />
                  {/* 96-F6 (R96 A2 P2-7): preset chips raised to the 44px
                      touch floor (wrap already flex-wrap). */}
                  <div className="flex gap-2 mt-3 mb-2.5 flex-wrap">
                    {presets.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => applyAmountPreset(p)}
                        /* R124-I1 (A5 P2, WCAG 4.1.2): aria-pressed names
                            the active preset (toggle-button idiom — see
                            the method tabs above). */
                        aria-pressed={amount === String(p)}
                        className={`flex-1 min-w-[52px] min-h-11 py-2 rounded-xl text-sm font-bold transition-all border press-spring ${
                          amount === String(p)
                            ? "border-primary bg-primary text-white shadow-md shadow-primary/25"
                            : "border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <Input
                    id="topup-amount-mobile"
                    /* 96-F6 (R96 A2 P1-6): type="text" + inputMode="decimal"
                       — type="number" on the Arabic-locale iOS keypad has
                       NO decimal separator, so fractional amounts (the
                       0.5-step domain) were literally untypable. The
                       sanitizer in handleAmountChange keeps digits + ONE
                       decimal point alive; min/step semantics stay enforced
                       by the onBlur rounding + handleSubmit's own bounds.
                       R116-S2 (P2): the domain is now WHOLE dinars (USSD
                       codes cannot carry fractions) — step=1 + the
                       Math.round blur/submit snaps keep the amount
                       integer; inputMode stays decimal so a stray
                       separator is still typable (and then rounded). */
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    enterKeyHint="done"
                    min="1"
                    max="10000"
                    step={1}
                    placeholder="أو أدخل مبلغاً آخر…"
                    value={amount}
                    onChange={handleAmountChange}
                    onBlur={(e) => {
                      // R116-S2 (P2): native step=1 only enforces on the
                      // spinner — a typed "24.9" would otherwise reach
                      // the backend AND disagree with the USSD code the
                      // panel above told the user to dial. Round to the
                      // nearest whole dinar + clamp [1, 10000] when the
                      // user finishes editing.
                      const v = parseFloat(e.target.value);
                      if (!Number.isFinite(v)) return;
                      const rounded = Math.min(10000, Math.max(1, Math.round(v)));
                      if (rounded !== v) setAmount(String(rounded));
                    }}
                    required
                    dir="ltr"
                    className="text-left h-11 rounded-xl border-border/50 focus:border-primary/45 bg-card"
                  />
                </div>

                <div className="border-t border-border/20" />

                {/* Step 3: One-tap transfer + the receipt it produces */}
                <div>
                  <StepDot n={3} label="نفّذ التحويل" />
                  <TransferCodePanel
                    network={network as TransferNetwork}
                    amount={amount}
                    receiver={RECEIVER_PHONE}
                  />
                  {/* 93-C5 / F-03: the transfer receipt — REQUIRED on this
                      flow since R123-E4a (see PaymentReferenceField).
                      R124-I1 (A1 P2): rendered AFTER the transfer panel —
                      the receipt number only exists once the user has
                      run the USSD transfer above, so the field used to
                      sit ~1,000px above the button that generates its
                      value (a required field the user cannot fill yet,
                      then a scroll-back hunt after step 3). The flow now
                      reads top-to-bottom: transfer → receipt from the
                      transfer SMS → sender phone → submit. Validation,
                      state and the idempotency-key rotation contract are
                      unchanged. */}
                  <PaymentReferenceField
                    id="topup-payment-reference-mobile"
                    value={paymentReference}
                    onChange={handlePaymentReferenceChange}
                    required
                  />
                </div>

                <div className="border-t border-border/20" />

                {/* Step 4: Phone */}
                <div>
                  {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
                  <StepDot n={4} label="رقم هاتف المُرسل" htmlFor="topup-sender-phone" />
                  <p className="text-xs text-muted-foreground mt-2 mb-3">
                    أدخل رقمك الذي حوّلت منه الرصيد لتأكيد العملية.
                  </p>

                  {/* Saved phones dropdown */}
                  {savedPhones.length > 0 && (
                    /* 96-F6 (R96 A2 P2-7): saved-phone chips raised to the
                       44px touch floor — a money-verification field. */
                    <div className="flex gap-1.5 mb-3 flex-wrap">
                      {savedPhones.map((phone) => (
                        <button
                          key={phone}
                          type="button"
                          onClick={() => {
                            // 96-F6 (R96 §5.1): picking a different saved
                            // phone changes the intent → rotate the key.
                            // 98-F2: the picked phone IS part of the
                            // fingerprint — persist under it.
                            if (phone !== senderPhone) {
                              resetTopupKey(topupIntentFingerprint(amount, method, phone));
                            }
                            setSenderPhone(phone);
                          }}
                          /* R124-I1 (A5 P2, WCAG 4.1.2): aria-pressed on
                              the saved-phone chips — same toggle-button
                              idiom as the selector groups above. */
                          aria-pressed={senderPhone === phone}
                          className={`min-h-11 px-2.5 py-1 rounded-lg text-xs font-mono border transition-all flex items-center justify-center ${
                            senderPhone === phone
                              ? "bg-primary/15 border-primary/50 text-primary-text"
                              : "bg-secondary/30 border-border/50 hover:bg-secondary/50 text-muted-foreground"
                          }`}
                        >
                          {phone}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="relative">
                    <Input
                      id="topup-sender-phone"
                      type="tel"
                      /* 96-F6 (R96 A6 #2 P1): autoComplete=tel lets the OS
                         offer the user's phone numbers for this field. */
                      autoComplete="tel"
                      placeholder="091XXXXXXX"
                      value={senderPhone}
                      onChange={(e) => {
                        const d = e.target.value.replace(/\D/g, "").slice(0, 10);
                        // 96-F6 (R96 §5.1): a different (sanitized) phone
                        // is a different intent → rotate the key.
                        // 98-F2: the new phone is part of the fingerprint —
                        // persist under the post-edit value.
                        if (d !== senderPhone) {
                          resetTopupKey(topupIntentFingerprint(amount, method, d));
                        }
                        setSenderPhone(d);
                        // Surface validation as the user types once they
                        // start entering digits — used to wait for blur,
                        // which meant users tapping submit before the
                        // input lost focus only saw the "غير صالح" error
                        // after a failed submit. Live mode is gated on
                        // having typed at least 4 digits to avoid a
                        // green check on a 1-digit "0" or red error
                        // immediately on focus.
                        if (d.length >= 4) setSenderPhoneTouched(true);
                      }}
                      onBlur={() => setSenderPhoneTouched(true)}
                      required
                      dir="ltr"
                      /* 96-F6 (R96 A6 #13): the live validation error is
                         announced + bound via aria-describedby/aria-invalid
                         on the field itself. */
                      aria-invalid={senderPhoneTouched && !!senderPhoneErr}
                      aria-describedby={
                        senderPhoneTouched && senderPhoneErr
                          ? "topup-sender-phone-error"
                          : undefined
                      }
                      className={`text-left pl-10 h-11 rounded-xl bg-card transition-all ${
                        senderPhoneTouched && senderPhoneErr
                          ? "border-destructive/60"
                          : senderPhoneTouched && senderPhone.length === 10 && !senderPhoneErr
                            ? "border-status-success/55"
                            : "border-border/50 focus:border-primary/45"
                      }`}
                      maxLength={10}
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2">
                      {senderPhoneTouched && !senderPhoneErr && senderPhone.length === 10 && (
                        <CheckCircle className="w-4 h-4 text-status-success" />
                      )}
                      {senderPhoneTouched && senderPhoneErr && (
                        <AlertCircle className="w-4 h-4 text-destructive" />
                      )}
                    </div>
                  </div>
                  {senderPhoneTouched && senderPhoneErr && (
                    /* 96-F6 (R96 A6 #13): id the input points at via
                       aria-describedby above. */
                    <p id="topup-sender-phone-error" className="text-xs text-destructive mt-1.5">
                      {senderPhoneErr}
                    </p>
                  )}

                  {/* Remember phone checkbox */}
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberPhone}
                      onChange={(e) => setRememberPhone(e.target.checked)}
                      className="w-4 h-4 rounded border-border/60 bg-card text-primary"
                    />
                    <span className="text-xs text-muted-foreground">
                      تذكر رقم الهاتف للمرات القادمة
                    </span>
                  </label>
                </div>

                <div className="border-t border-border/20" />

                {/* Step 5: Submit */}
                <div>
                  <StepDot n={5} label="أرسل الطلب" />
                  <InstructionsPanel />
                  {error && (
                    <div
                      id="wallet-error"
                      role="alert"
                      aria-live="polite"
                      className="flex items-center gap-2.5 text-destructive text-sm bg-destructive/8 border border-destructive/18 px-4 py-3 rounded-xl mb-3 shake"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                  <Button
                    type="submit"
                    /* R116-S2 CTA recipe: size=lg (h-12-class primary)
                      + w-full form layout — the drifted h-11/bg-primary/
                      shadow overrides are gone (button.tsx's lg + default
                      variant own them now). R124-I1 (A3 P6): cta-glow
                      removed — the zero-offset pulsing halo is retired;
                      the gradient + press-spring carry the affordance. */
                    size="lg"
                    className="w-full rounded-xl"
                    disabled={submitting || topupMutation.isPending}
                  >
                    {submitting || topupMutation.isPending ? "جارٍ الإرسال…" : "إرسال طلب الشحن"}
                  </Button>
                </div>
              </form>
            )}

            {/* LyPay Flow */}
            {method === "lypay" && (
              <div className="space-y-5">
                {/* Step 1: Bank info */}
                <div>
                  <StepDot n={1} label="معلومات الحساب المصرفي" />
                  <div className="mt-3 bg-muted/25 border border-border/45 rounded-xl p-4 space-y-3.5 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <InfoRow label="اسم الحساب" value={LYPAY_INFO.account_name} />
                      <InfoRow label="البنك" value={LYPAY_INFO.bank} />
                    </div>
                    <InfoRow label="الفرع" value={LYPAY_INFO.branch} />
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border/30">
                      <InfoRow label="رقم الحساب" value={LYPAY_INFO.account_number} />
                      <CopyButton text={LYPAY_INFO.account_number} label="نسخ" size="md" />
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border/30">
                      <div className="min-w-0">
                        <div className="text-2xs text-muted-foreground mb-0.5 font-semibold">
                          IBAN
                        </div>
                        <div dir="ltr" className="font-mono font-bold text-sm break-all text-left">
                          {LYPAY_INFO.iban}
                        </div>
                      </div>
                      <CopyButton text={LYPAY_INFO.iban.replace(/\s/g, "")} label="نسخ" size="md" />
                    </div>
                  </div>
                </div>

                <div className="border-t border-border/20" />

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
                    <StepDot
                      n={2}
                      /* R123-E4a (P3-b): unified with the mobile flow's
                          «المبلغ بالدينار الليبي» — was «المبلغ المحوّل
                          (د.ل)», a second phrasing for the same money
                          datum one tab away (the input's own placeholder
                          already said this). */
                      label="المبلغ بالدينار الليبي"
                      htmlFor="topup-amount-lypay"
                    />
                    {/* 96-F6 (R96 A2 P2-7): preset chips raised to the 44px
                        touch floor (wrap already flex-wrap). */}
                    <div className="flex flex-wrap gap-2 mt-3 mb-2.5">
                      {presets.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => applyAmountPreset(p)}
                          /* R124-I1 (A5 P2, WCAG 4.1.2): aria-pressed names
                              the active preset — the lypay twin of the
                              mobile-flow chips above. */
                          aria-pressed={amount === String(p)}
                          className={`flex-1 min-w-[64px] min-h-11 py-2 rounded-xl text-sm font-bold transition-all border press-spring ${
                            amount === String(p)
                              ? "border-primary bg-primary text-white shadow-md shadow-primary/22"
                              : "border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted/70"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <Input
                      id="topup-amount-lypay"
                      /* 96-F6 (R96 A2 P1-6): decimal keyboard — twin of the
                         mobile-transfer amount field (type="number" had no
                         decimal separator on Arabic-locale iOS keypads).
                         R116-S2 (P2): whole-dinar domain (step=1 + the
                         Math.round blur snap), matching the mobile flow. */
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      enterKeyHint="done"
                      min="1"
                      max="10000"
                      step={1}
                      placeholder="المبلغ بالدينار الليبي"
                      value={amount}
                      onChange={handleAmountChange}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v)) return;
                        const rounded = Math.min(10000, Math.max(1, Math.round(v)));
                        if (rounded !== v) setAmount(String(rounded));
                      }}
                      required
                      dir="ltr"
                      className="text-left h-11 rounded-xl bg-card"
                    />
                    {/* 93-C5 / F-03: optional receipt reference (bank-transfer
                        flow) — lypay keeps it optional (B4-R1 backend note). */}
                    <PaymentReferenceField
                      id="topup-payment-reference-lypay"
                      value={paymentReference}
                      onChange={handlePaymentReferenceChange}
                      required={false}
                    />
                  </div>

                  <div className="border-t border-border/20" />

                  <div>
                    {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
                    <StepDot n={3} label="رقم حسابك (المُرسل)" htmlFor="topup-sender-account" />
                    <Input
                      id="topup-sender-account"
                      type="text"
                      placeholder="أدخل رقم حساب المُرسل"
                      value={senderAccount}
                      onChange={(e) => {
                        // 96-F6 (R96 §5.1): account edits change the intent.
                        // 98-F2: the account is not part of the fingerprint
                        // contract — the rotation itself still fires.
                        if (e.target.value !== senderAccount) {
                          resetTopupKey(topupIntentFingerprint(amount, method, senderPhone));
                        }
                        setSenderAccount(e.target.value);
                      }}
                      required
                      dir="ltr"
                      className="text-left font-mono mt-3 h-11 rounded-xl bg-card"
                    />
                  </div>

                  <div className="border-t border-border/20" />

                  <div>
                    {/* R125-I7 (A7 B-9): the lypay tab's step-4 label joins
                        the mobile flow's «أرسل الطلب» — one verb pair for
                        the same submit action (was «تأكيد الإرسال»). */}
                    <StepDot n={4} label="أرسل الطلب" />
                    <div className="mt-3 mb-3 p-3.5 bg-status-warning/8 border border-status-warning/22 rounded-xl text-xs text-status-warning flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      تأكد من إتمام التحويل المصرفي أولاً قبل إرسال الطلب
                    </div>
                    {error && (
                      <div
                        id="wallet-error-2"
                        role="alert"
                        aria-live="polite"
                        className="flex items-center gap-2.5 text-destructive text-sm bg-destructive/8 border border-destructive/18 px-4 py-3 rounded-xl mb-3 shake"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {error}
                      </div>
                    )}
                    <Button
                      type="submit"
                      /* R116-S2 CTA recipe (lypay twin of the mobile CTA).
                          R124-I1 (A3 P6): cta-glow removed with the
                          mobile CTA above (the pulsing halo is retired). */
                      size="lg"
                      className="w-full rounded-xl"
                      disabled={submitting || topupMutation.isPending}
                    >
                      {/* R125-I7 (A7 B-9): unified submit verb — the lypay
                          CTA joins the mobile flow's «إرسال طلب الشحن»
                          (was «تأكيد طلب الشحن»); same action, one verb
                          pair — the R111-F2 N1 drift class. */}
                      {submitting || topupMutation.isPending ? "جارٍ الإرسال…" : "إرسال طلب الشحن"}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Topup History ──────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="bg-card border border-border/55 rounded-2xl p-5 lg:sticky lg:top-20">
            <div className="flex items-center gap-2.5 mb-4">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-bold text-sm">سجل الشحن</h2>
              {topups.length > 0 && (
                <span className="mr-auto text-xs text-muted-foreground font-semibold">
                  {/* R94-A1 #11 (P3): Arabic pluralization via formatCount
                      (line 680 in this file already uses it for the pending
                      counter). */}
                  {formatCount(topups.length, {
                    one: "طلب",
                    two: "طلبان",
                    few: "طلبات",
                    many: "طلباً",
                    other: "طلب",
                  })}
                </span>
              )}
            </div>

            {topupsLoading ? (
              /* Ledger skeleton — prevents the "no topups yet" empty state
                 from flashing during the initial fetch. */
              <div className="space-y-2.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    /* R125-I7 (A7 B-12 / R124-A3 #12): 2px border-l accent
                 stripe → the plain 1px border (craft-floor cap). */
                    className="bg-card border border-border rounded-xl p-4 flex items-center gap-4"
                  >
                    <div className="w-10 h-10 rounded-xl bg-muted skeleton-shimmer shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted skeleton-shimmer rounded-lg w-2/5" />
                      <div className="h-3 bg-muted skeleton-shimmer rounded w-1/3" />
                    </div>
                    <div className="h-5 bg-muted skeleton-shimmer rounded-full w-16 shrink-0" />
                  </div>
                ))}
              </div>
            ) : topupsError ? (
              /* 93-C5 / F-05 (A4 #7): a failed ledger fetch used to render
                 the "لا توجد طلبات شحن بعد" empty state — an outage read as
                 "you never topped up" on the money page. Distinct error
                 branch with retry. */
              <FetchErrorCard
                size="compact"
                descriptionClassName="max-w-[220px]"
                title="تعذّر تحميل سجل الشحن"
                description="حدث خطأ في الاتصال — أعد المحاولة لعرض طلبات الشحن السابقة"
                onRetry={() => void refetchTopups()}
              />
            ) : topups.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <div className="w-16 h-16 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-7 h-7 opacity-25" />
                </div>
                <p className="font-bold text-base mb-1.5 text-foreground/80">
                  لا توجد طلبات شحن بعد
                </p>
                <p className="text-xs text-muted-foreground max-w-[200px] mx-auto leading-relaxed">
                  ابدأ بشحن محفظتك لشراء اشتراكاتك المفضلة
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 lg:max-h-[480px] overflow-y-auto scrollbar-none">
                {(
                  topups as Array<{
                    id: number;
                    status: string;
                    amount: number;
                    payment_network: string;
                    created_at: string;
                  }>
                ).map((t, i: number) => (
                  <div
                    key={t.id}
                    className={`float-in stagger-${Math.min(i, 8)} flex items-center gap-3 p-3 bg-muted/18 border border-border/30 rounded-xl hover:bg-muted/30 transition-colors group`}
                  >
                    <div className="shrink-0">{topupStatusIcon(t.status)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-bold tabular-nums">
                          {formatCurrency(t.amount)}
                        </span>
                        {t.payment_network && (
                          <span className="text-3xs text-muted-foreground font-semibold">
                            · {networkLabel(t.payment_network)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {/* R116: shared StatusBadge (STATUS_TONE) replaces
                            the deprecated statusColor() — 93-C7 follow-up. */}
                        <StatusBadge
                          variant={
                            STATUS_TONE[t.status as keyof typeof STATUS_TONE] ?? UNKNOWN_STATUS_TONE
                          }
                          size="xs"
                        >
                          {topupStatusLabel(t.status)}
                        </StatusBadge>
                        <span className="text-3xs text-muted-foreground">
                          {formatDate(t.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* R115 (A8 P2): the wallet STATEMENT — additive, below the topup
          requests list. Full-width under the grid so the sticky topup
          card keeps its behavior (a sticky card + tall sibling in one
          column would overlap while scrolling). */}
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
        onClose={() => setWaitingTopupId(null)}
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
