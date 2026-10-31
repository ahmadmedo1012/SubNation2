import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import * as Linking from "expo-linking";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetWalletLedgerQueryKey,
  getGetWalletQueryKey,
  getListTopupsQueryKey,
  useCreateTopup,
  useGetWallet,
  useGetWalletLedger,
  useListTopups,
  type GetWalletLedger200Item,
  type Topup,
  type WalletInfo,
} from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { Card, Divider } from "@/components/card";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/states";
import { StatusBadge, topupStatusBadge } from "@/components/status-badge";
import { ThemedText } from "@/components/themed-text";
import {
  LYPAY_INFO,
  MAX_PENDING,
  NETWORKS,
  isValidLibyanPhone,
  libyanPhoneError,
  methodPresets,
  sanitizeAmountInput,
  topupChannelLabel,
  type TopupMethod,
} from "@/components/topup-meta";
import { useSocket } from "@/hooks/use-socket";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import {
  INTENT_SLOTS,
  INTENT_TTL_MS,
  generateIdempotencyKey,
  loadIntentKey,
  persistIntentKey,
} from "@/lib/idempotency";
import { arabicCount, formatCurrency, formatNumber } from "@/lib/money";
import {
  formatFullDate,
  formatRelativeTime,
  tierColorKey,
  tierLabel,
} from "@/screens/account/dates";
import { SignInPrompt } from "@/screens/account/sign-in-prompt";
import { useColors, radius, spacing, type } from "@/theme";

import { transferCodeTelHref, transferPlan, type TransferNetwork } from "./transfer-code";

/**
 * Wallet — the native port of the web's pages/wallet.tsx: the balance
 * hero, the two-channel top-up flow (mobile_transfer: network → amount →
 * USSD transfer plan → sender phone; lypay: bank coordinates → amount +
 * optional receipt → sender account), the topups review queue and the
 * LYD ledger.
 *
 * THE TOPUP IDEMPOTENCY CONTRACT (96-F6 / 98-F2 — LAW): ONE
 * Idempotency-Key per submission INTENT rides every POST
 * /api/wallet/topups via useCreateTopup's stable `request` ref (the
 * orval mutationFn closes over the request object at render time, so
 * the headers are READ AT FETCH TIME and synced at every rotation
 * point). The key is minted BEFORE the call, persisted under the
 * {k, t, f} envelope (INTENT_SLOTS.topup + INTENT_TTL_MS, fingerprint
 * amount|method|phone), rotated at every payload-defining edit and at
 * successful submission — and NEVER cleared (rotation-only, the web's
 * contract: a stored key inside its TTL makes a retry-after-refresh
 * REPLAY instead of creating a second pending topup).
 *
 * Real-time: use-socket connects while authenticated and invalidates
 * the topups list / wallet / ledger on "topup-updated" / "wallet" — a
 * pending→approved flip lands on screen the moment the admin decides.
 */

/** Arabic plural forms — order-noun SUBJECT registry (the web's maps). */
const ORDER_COUNT_FORMS_SUBJECT = {
  zero: "طلب",
  one: "طلب",
  two: "طلبان",
  few: "طلبات",
  many: "طلباً",
  other: "طلب",
};

const PENDING_REVIEW_FORMS = {
  zero: "طلب قيد المراجعة",
  one: "طلب قيد المراجعة",
  two: "طلبان قيد المراجعة",
  few: "طلبات قيد المراجعة",
  many: "طلباً قيد المراجعة",
  other: "طلب قيد المراجعة",
};

const LEDGER_COUNT_FORMS = {
  zero: "حركة",
  one: "حركة",
  two: "حركتان",
  few: "حركات",
  many: "حركة",
  other: "حركة",
};

const POINTS_COUNT_FORMS = {
  zero: "نقطة",
  one: "نقطة",
  two: "نقطتان",
  few: "نقاط",
  many: "نقطة",
  other: "نقطة",
};

const TRANSFER_COUNT_FORMS = {
  zero: "تحويل منفصل",
  one: "تحويل واحد",
  two: "تحويلان منفصلان",
  few: "تحويلات منفصلة",
  many: "تحويلاً منفصلاً",
  other: "تحويل منفصل",
};

/** Topup intent fingerprint (the web's topupIntentFingerprint). */
function topupIntentFingerprint(amount: string, method: string, phone: string): string {
  return `${amount}|${method}|${phone.trim()}`;
}

// ── Small presentational atoms ───────────────────────────────────────────────

/** A numbered step marker (the web's StepDot — a flat legend). */
function StepDot({ n, label }: { n: number; label: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.full,
          backgroundColor: colors.primary,
          alignItems: "center",
          justifyContent: "center",
        }}
        accessibilityLabel={`الخطوة ${n}`}
      >
        <ThemedText variant="micro" style={{ color: colors.onTint, fontFamily: "ReadexPro-Bold" }}>
          {n}
        </ThemedText>
      </View>
      <ThemedText variant="footnote" style={{ fontFamily: "ReadexPro-SemiBold" }}>
        {label}
      </ThemedText>
    </View>
  );
}

/** Label + value row (the web's InfoRow — the LyPay coordinates). */
function InfoRow({ label, value, latin }: { label: string; value: string; latin?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ gap: 2 }}>
      <ThemedText variant="micro" style={{ color: colors.onSurface }}>
        {label}
      </ThemedText>
      <ThemedText
        variant="subhead"
        selectable
        style={{
          color: colors.foreground,
          fontFamily: "ReadexPro-SemiBold",
          ...(latin ? { direction: "ltr" as const, textAlign: "left" as const } : null),
        }}
      >
        {value}
      </ThemedText>
    </View>
  );
}

/** Preset amount chips («1 د.ل» …) — the active chip carries the state. */
function PresetChips({
  presets,
  amount,
  onPreset,
}: {
  presets: number[];
  amount: string;
  onPreset: (preset: number) => void;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: spacing.sm,
        marginTop: spacing.md,
        marginBottom: spacing.sm,
      }}
    >
      {presets.map((p) => {
        const active = amount === String(p);
        return (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityLabel={`مبلغ ${p} دينار`}
            accessibilityState={{ selected: active }}
            onPress={() => onPreset(p)}
            style={({ pressed }) => ({
              minHeight: spacing.touch,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.sm,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: active ? `${colors.primary}4D` : colors.border,
              backgroundColor: active
                ? `${colors.primary}26`
                : pressed
                  ? colors.secondary
                  : colors.surfaceOverlay,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <ThemedText
              variant="footnote"
              style={{
                color: active ? colors.primaryText : colors.onSurface,
                fontFamily: active ? "ReadexPro-SemiBold" : "ReadexPro-Regular",
                fontVariant: ["tabular-nums"],
              }}
            >
              {`${p} د.ل`}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The live USSD transfer plan (the web's TransferCodePanel): one
 * installment fits → one code + one dial CTA; above the network's
 * single-transfer limit → one row PER required transfer (each with its
 * own dial action — never one generic button that dials only the
 * first). Codes are selectable Latin runs; `tel:` opens the dialer.
 */
function TransferCodePanel({ network, amount }: { network: TransferNetwork; amount: string }) {
  const colors = useColors();
  const plan = transferPlan(network, amount);
  const count = plan ? plan.installments.length : 0;
  const multi = count > 1;

  const dial = (code: string) => {
    void Linking.openURL(transferCodeTelHref(code)).catch(() => {
      // No dialer available — the selectable code covers manual dialing.
    });
  };

  return (
    <View
      style={{
        marginTop: spacing.md,
        padding: spacing.md,
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceOverlay,
        gap: spacing.sm,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.sm,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Icon sf="phone.fill" md="phone" size={14} color={colors.primaryText} />
          <ThemedText
            variant="footnote"
            style={{ color: colors.primaryText, fontFamily: "ReadexPro-SemiBold" }}
          >
            رمز التحويل
          </ThemedText>
        </View>
        {plan ? (
          <ThemedText
            variant="micro"
            style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
          >
            {`الإجمالي: ${formatCurrency(plan.total)}`}
          </ThemedText>
        ) : null}
      </View>

      {plan ? (
        <View style={{ gap: spacing.sm }}>
          {multi ? (
            <View
              accessibilityRole="alert"
              style={{
                padding: spacing.sm,
                borderRadius: radius.sm,
                borderCurve: "continuous",
                backgroundColor: `${colors.warning}1A`,
                borderWidth: 1,
                borderColor: `${colors.warning}38`,
              }}
            >
              <ThemedText variant="micro" style={{ color: colors.warning, lineHeight: 18 }}>
                {`يلزم ${arabicCount(count, TRANSFER_COUNT_FORMS)} — كل رمز أدناه يمثل تحويلاً مستقلاً. أكمل جميع التحويلات ثم أرسل طلباً واحداً بالمبلغ الإجمالي.`}
              </ThemedText>
            </View>
          ) : null}

          {plan.installments.map((installment, i) =>
            multi ? (
              <View
                key={i}
                style={{
                  padding: spacing.sm,
                  borderRadius: radius.sm,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: colors.border,
                  gap: spacing.sm,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: spacing.sm,
                  }}
                >
                  <ThemedText variant="footnote" style={{ fontFamily: "ReadexPro-SemiBold" }}>
                    {`التحويل ${i + 1} من ${count}`}
                  </ThemedText>
                  <ThemedText
                    variant="micro"
                    style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
                  >
                    {formatCurrency(installment.amount)}
                  </ThemedText>
                </View>
                <ThemedText
                  variant="footnote"
                  selectable
                  style={{
                    direction: "ltr",
                    textAlign: "left",
                    fontVariant: ["tabular-nums"],
                    fontFamily: "ReadexPro-SemiBold",
                  }}
                >
                  {installment.code}
                </ThemedText>
                <Button
                  title={`اتصال بالتحويل ${i + 1}`}
                  onPress={() => dial(installment.code)}
                  accessibilityHint="فتح لوحة الاتصال بهذا الرمز"
                />
              </View>
            ) : (
              <View key={i} style={{ gap: spacing.sm }}>
                <ThemedText
                  variant="headline"
                  selectable
                  style={{
                    direction: "ltr",
                    textAlign: "left",
                    fontVariant: ["tabular-nums"],
                    fontFamily: "ReadexPro-Bold",
                  }}
                >
                  {installment.code}
                </ThemedText>
                <Button
                  title="تحويل الرصيد"
                  onPress={() => dial(installment.code)}
                  accessibilityHint="فتح لوحة الاتصال برمز التحويل"
                />
              </View>
            ),
          )}
        </View>
      ) : (
        <View
          style={{
            minHeight: spacing.touch,
            justifyContent: "center",
            borderRadius: radius.sm,
            borderCurve: "continuous",
            backgroundColor: colors.secondary,
            paddingHorizontal: spacing.md,
          }}
        >
          <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
            أدخل المبلغ لإنشاء الرمز تلقائياً
          </ThemedText>
        </View>
      )}

      <ThemedText variant="micro" style={{ color: colors.onSurface }}>
        اضغط زر الاتصال لفتح لوحة الاتصال — أو انسخ الرمز وأدخله يدوياً.
      </ThemedText>
    </View>
  );
}

/** The mobile-transfer flow's instruction legend (the web's panel). */
function InstructionsPanel() {
  const colors = useColors();
  const steps = [
    "اتصل بكل رمز تحويل أعلاه لإتمام جميع التحويلات.",
    "بعد نجاح التحويل قم بإرسال الطلب.",
    "سيتم مراجعته من الإدارة.",
  ];
  return (
    <View
      style={{
        marginTop: spacing.md,
        marginBottom: spacing.md,
        padding: spacing.md,
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceOverlay,
        gap: spacing.sm,
      }}
    >
      {steps.map((s, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: radius.full,
              backgroundColor: `${colors.primary}26`,
              borderWidth: 1,
              borderColor: `${colors.primary}4D`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ThemedText variant="micro" style={{ color: colors.primaryText }}>
              {i + 1}
            </ThemedText>
          </View>
          <ThemedText variant="footnote" style={{ color: colors.onSurface, flex: 1 }}>
            {s}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

// ── Ledger display helpers (the web's LedgerEntryRow logic) ─────────────────

/** Signed, directional display amount for a ledger row. */
function ledgerAmountDisplay(entry: GetWalletLedger200Item): { text: string; credit: boolean } {
  const amount = entry.amount ?? 0;
  const abs = Math.abs(amount);
  if (entry.type === "adjustment") {
    // adjustment rows carry their own sign (balanceAfter − balanceBefore).
    return { text: `${amount < 0 ? "-" : "+"}${formatCurrency(abs)}`, credit: amount >= 0 };
  }
  // Purchases are the only fixed-type debit; everything else credits.
  const debit = entry.type === "purchase";
  return { text: `${debit ? "-" : "+"}${formatCurrency(abs)}`, credit: !debit };
}

/** Attribution label: description → loyalty_conversion → type_label → type. */
function ledgerEntryLabel(entry: GetWalletLedger200Item): string {
  const description = entry.description?.trim();
  if (description) return description;
  if (entry.reference_type === "loyalty_conversion") return "تحويل نقاط";
  return entry.type_label ?? entry.type ?? "حركة";
}

/** One ledger row: label + balance_after/date + the signed LTR amount. */
function LedgerRow({ entry }: { entry: GetWalletLedger200Item }) {
  const colors = useColors();
  const { text, credit } = ledgerAmountDisplay(entry);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.sm,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <ThemedText
          variant="footnote"
          numberOfLines={1}
          style={{ fontFamily: "ReadexPro-SemiBold" }}
        >
          {ledgerEntryLabel(entry)}
        </ThemedText>
        <View
          style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs }}
        >
          {typeof entry.balance_after === "number" ? (
            <ThemedText
              variant="micro"
              style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
            >
              {`الرصيد بعدها: ${formatCurrency(entry.balance_after)}`}
            </ThemedText>
          ) : null}
          {entry.created_at ? (
            <ThemedText variant="micro" style={{ color: colors.onSurface }}>
              {`· ${formatFullDate(entry.created_at)}`}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <ThemedText
        variant="subhead"
        selectable
        style={{
          direction: "ltr",
          textAlign: "left",
          fontVariant: ["tabular-nums"],
          fontFamily: "ReadexPro-SemiBold",
          color: credit ? colors.success : colors.error,
        }}
      >
        {text}
      </ThemedText>
    </View>
  );
}

/** One topup review-queue row (the web's TopupHistoryCard row). */
function TopupRow({ topup }: { topup: Topup }) {
  const colors = useColors();
  const badge = topupStatusBadge(topup.status);
  const channel = topupChannelLabel(topup.payment_method, topup.payment_network);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceOverlay,
      }}
    >
      <Icon
        sf={
          topup.status === "approved"
            ? "checkmark.circle.fill"
            : topup.status === "rejected"
              ? "xmark.circle.fill"
              : "clock.fill"
        }
        md={
          topup.status === "approved"
            ? "check_circle"
            : topup.status === "rejected"
              ? "cancel"
              : "schedule"
        }
        size={18}
        color={
          topup.status === "approved"
            ? colors.success
            : topup.status === "rejected"
              ? colors.error
              : colors.warning
        }
      />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}
        >
          <ThemedText
            variant="footnote"
            selectable
            style={{ fontVariant: ["tabular-nums"], fontFamily: "ReadexPro-SemiBold" }}
          >
            {formatCurrency(topup.amount)}
          </ThemedText>
          {channel ? (
            <ThemedText variant="micro" style={{ color: colors.onSurface }}>
              {`· ${channel}`}
            </ThemedText>
          ) : null}
        </View>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}
        >
          <StatusBadge label={badge.label} tone={badge.tone} />
          <ThemedText variant="micro" style={{ color: colors.onSurface }}>
            {formatFullDate(topup.created_at)}
          </ThemedText>
        </View>
        {topup.status === "rejected" && topup.admin_note ? (
          <ThemedText variant="micro" numberOfLines={2} style={{ color: colors.onSurface }}>
            {topup.admin_note}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

// ── The screen ───────────────────────────────────────────────────────────────

export function WalletScreen() {
  const { status } = useAuth();

  if (status === "guest") {
    return <SignInPrompt message="سجّل دخولك لشحن محفظتك ومتابعة رصيدك وسجل عملياتك الشرائية." />;
  }
  return <WalletContent />;
}

function WalletContent() {
  const colors = useColors();
  const queryClient = useQueryClient();

  // Page-scoped realtime (auth-gated inside the hook): topup-updated /
  // wallet events invalidate the three money queries below.
  useSocket();

  // ── Queries (the money trio) ────────────────────────────────────────────
  const walletQuery = useGetWallet();
  const topupsQuery = useListTopups(undefined);
  const ledgerQuery = useGetWalletLedger(undefined);

  const topups = topupsQuery.data ?? [];
  const ledger = ledgerQuery.data ?? [];
  const pendingCount = topups.filter((t) => t.status === "pending").length;
  const pendingBlocked = pendingCount >= MAX_PENDING;
  const oldestPending = useMemo(() => {
    const dates = (topupsQuery.data ?? [])
      .filter((t) => t.status === "pending")
      .map((t) => t.created_at);
    dates.sort();
    return dates[0];
  }, [topupsQuery.data]);

  // ── Topup form state (the web's page atoms, prefs omitted) ──────────────
  const [method, setMethod] = useState<TopupMethod>("mobile_transfer");
  const [network, setNetwork] = useState<TransferNetwork>("libyana");
  const [amount, setAmount] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [senderAccount, setSenderAccount] = useState("");
  // R154: mobile_transfer retired its receipt field; this atom is the
  // LYPAY flow's OPTIONAL bank-receipt reference only.
  const [paymentReference, setPaymentReference] = useState("");
  const [senderPhoneTouched, setSenderPhoneTouched] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // The just-submitted topup (the native arm of TopupWaitingModal — an
  // inline status panel, no web modal): the response row first, then the
  // live list row as the socket invalidations land.
  const [waitingTopup, setWaitingTopup] = useState<Topup | null>(null);

  // ── 96-F6 / 98-F2: the topup intent key (rotation-only) ─────────────────
  // The stable request object: orval's mutationFn closes over `request`
  // at RENDER time, so its headers are READ AT FETCH TIME (G-2, the web
  // wallet's discipline) — the per-intent key rides
  // headers["Idempotency-Key"], synced at every rotation point and
  // belt-and-suspenders right before mutate().
  const topupRequestRef = useRef<{ headers: Record<string, string> }>({ headers: {} });
  const topupKeyRef = useRef<string | null>(null);
  const keyRotatedRef = useRef(false);
  const syncTopupRequestKey = () => {
    topupRequestRef.current.headers["Idempotency-Key"] = topupKeyRef.current ?? "";
  };
  // Lazy init — idempotent null-guard (double-render safe).
  if (topupKeyRef.current === null) {
    topupKeyRef.current = generateIdempotencyKey();
    syncTopupRequestKey();
  }
  const resetTopupKey = (nextFingerprint: string) => {
    topupKeyRef.current = generateIdempotencyKey();
    // Rotation-only contract: PERSIST the new intent's key; never clear
    // (a stored key inside its TTL makes a retry-after-restart REPLAY
    // instead of a second pending topup).
    void persistIntentKey(INTENT_SLOTS.topup, nextFingerprint, topupKeyRef.current);
    keyRotatedRef.current = true;
    syncTopupRequestKey();
  };

  // 98-F2 (R98-09): restore the durable topup intent key across
  // remounts — a stored entry still inside its TTL whose fingerprint
  // matches the restored (blank) form is reused verbatim; otherwise the
  // lazy-init key above becomes the durable one. Guarded against a
  // rotation that already happened while the async restore was in flight.
  useEffect(() => {
    void (async () => {
      const fingerprint = topupIntentFingerprint("", "mobile_transfer", "");
      const restored = await loadIntentKey(INTENT_SLOTS.topup, INTENT_TTL_MS, fingerprint);
      if (keyRotatedRef.current) return;
      if (restored) {
        topupKeyRef.current = restored;
        syncTopupRequestKey();
      } else if (topupKeyRef.current) {
        void persistIntentKey(INTENT_SLOTS.topup, fingerprint, topupKeyRef.current);
      }
    })();
    // Once-only mount restore.
  }, []);

  // ── Input handlers (every payload-defining edit hits its rotation) ──────
  const handleAmountChange = (raw: string) => {
    const next = sanitizeAmountInput(raw);
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
  const handleAmountBlur = () => {
    // R116-S2: whole-dinar snap at blur (USSD codes carry integers) —
    // the submit-time normalization owns the rotation.
    const v = parseFloat(amount);
    if (!Number.isFinite(v)) return;
    const rounded = Math.min(10000, Math.max(1, Math.round(v)));
    if (rounded !== v) setAmount(String(rounded));
  };
  const handleMethodChange = (m: TopupMethod) => {
    if (m !== method) {
      resetTopupKey(topupIntentFingerprint(amount, m, senderPhone));
    }
    setMethod(m);
    setError("");
  };
  const handleNetworkChange = (value: TransferNetwork) => {
    // network is part of the payload (rotation fires) but not the
    // fingerprint contract (amount|method|phone).
    if (value !== network) {
      resetTopupKey(topupIntentFingerprint(amount, method, senderPhone));
    }
    setNetwork(value);
  };
  const handleSenderPhoneChange = (raw: string) => {
    const d = raw.replace(/\D/g, "").slice(0, 10);
    if (d !== senderPhone) {
      resetTopupKey(topupIntentFingerprint(amount, method, d));
    }
    setSenderPhone(d);
    // Live validation once at least 4 digits are typed.
    if (d.length >= 4) setSenderPhoneTouched(true);
  };
  const handleSenderAccountChange = (v: string) => {
    if (v !== senderAccount) {
      resetTopupKey(topupIntentFingerprint(amount, method, senderPhone));
    }
    setSenderAccount(v);
  };
  const handlePaymentReferenceChange = (v: string) => {
    // Payload-relevant (rotation) but not part of the fingerprint.
    if (v !== paymentReference) {
      resetTopupKey(topupIntentFingerprint(amount, method, senderPhone));
    }
    setPaymentReference(v);
  };

  // ── The mutation (Idempotency-Key via the stable request ref) ───────────
  const topupMutation = useCreateTopup({
    request: topupRequestRef.current,
    mutation: {
      onSuccess: (created: Topup) => {
        // 96-F6: the intent was successfully submitted — ROTATE the key
        // (never clear) so the next topup (fresh form) gets a new one,
        // persisted under the POST-RESET fingerprint (amount/phone
        // cleared by this handler; method untouched).
        resetTopupKey(topupIntentFingerprint("", method, ""));

        setAmount("");
        setSenderPhone("");
        setSenderAccount("");
        setPaymentReference("");
        setSenderPhoneTouched(false);
        void queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        // The statement may already reflect this submit (an approval that
        // landed between submit and response) — refresh it too.
        void queryClient.invalidateQueries({ queryKey: getGetWalletLedgerQueryKey() });

        // The waiting panel (the native TopupWaitingModal): the response
        // row renders immediately; the socket's invalidations keep its
        // status live.
        setWaitingTopup(created);
      },
      onError: (err: unknown) => {
        setError(getErrorMessage(err));
      },
      onSettled: () => {
        setSubmitting(false);
      },
    },
  });

  const handleSubmit = useCallback(() => {
    setError("");
    // Duplicate-submit prevention: the disabled predicate, mirrored here
    // (a stray submit during the in-flight POST must not fire a 409 over
    // the open window).
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
    // R116-S2: whole-dinar floor — USSD codes can only carry integers;
    // the client floor is 1 LYD.
    if (parsedAmount < 1) {
      setError("أقل مبلغ شحن هو 1 د.ل");
      return;
    }
    if (parsedAmount > 10000) {
      setError("الحد الأقصى للشحن هو 10,000 د.ل");
      return;
    }
    const normalizedAmount = Math.min(10000, Math.max(1, Math.round(parsedAmount)));
    if (normalizedAmount !== parsedAmount) {
      setAmount(String(normalizedAmount));
      // The submit-time normalization changed the payload → a DIFFERENT
      // intent. Rotate the key under the POST-normalization fingerprint
      // so this submission can never replay onto the fractional intent a
      // previous key was minted for.
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
    }

    if (method === "lypay" && !senderAccount.trim()) {
      setError("يرجى إدخال رقم حساب المُرسل");
      return;
    }

    setSubmitting(true);
    // Trim once at the boundary (the backend trims again + rejects >100).
    // R154: ONLY the lypay flow submits a reference.
    const trimmedReference = method === "lypay" ? paymentReference.trim().slice(0, 100) : "";
    // G-2 belt-and-suspenders: guarantee the wire key matches
    // topupKeyRef.current even if a future rotation path forgets to sync.
    if (topupKeyRef.current === null) {
      topupKeyRef.current = generateIdempotencyKey();
    }
    syncTopupRequestKey();
    topupMutation.mutate({
      data: {
        amount: normalizedAmount,
        payment_method: method,
        payment_network: method === "mobile_transfer" ? network : undefined,
        sender_phone: method === "mobile_transfer" ? senderPhone || undefined : undefined,
        sender_account: method === "lypay" ? senderAccount || undefined : undefined,
        // The dedup machinery is only armed when this field is non-empty.
        payment_reference: trimmedReference || undefined,
      },
    });
    // NOT awaited: onSuccess/onError/onSettled own the outcome state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    submitting,
    topupMutation,
    pendingBlocked,
    amount,
    method,
    network,
    senderPhone,
    senderAccount,
    paymentReference,
  ]);

  // The live row for the waiting panel (status flips arrive via the
  // socket's query invalidations).
  const waitingRow = waitingTopup
    ? (topups.find((t) => t.id === waitingTopup.id) ?? waitingTopup)
    : null;
  const senderPhoneErr = senderPhoneTouched ? libyanPhoneError(senderPhone) : null;
  const presets = methodPresets(method, network);

  const inputStyle = {
    backgroundColor: colors.surfaceOverlay,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderCurve: "continuous" as const,
    color: colors.foreground,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    minHeight: spacing.touch,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  };
  const latinInputStyle = { ...inputStyle, direction: "ltr" as const, textAlign: "left" as const };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      {/* ── Balance card ── */}
      {walletQuery.isLoading ? (
        <Skeleton style={{ height: 128, borderRadius: radius.md }} />
      ) : walletQuery.isError ? (
        <Card>
          <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm }}>
            <ThemedText variant="headline" style={{ color: colors.error }}>
              تعذّر تحميل رصيد المحفظة
            </ThemedText>
            <ThemedText variant="footnote" style={{ textAlign: "center", color: colors.onSurface }}>
              حدث خطأ في الاتصال — تحقّق من شبكتك ثم حاول مجدداً
            </ThemedText>
            <Button
              variant="secondary"
              title="إعادة المحاولة"
              onPress={() => void walletQuery.refetch()}
            />
          </View>
        </Card>
      ) : walletQuery.data ? (
        <BalanceCardSection wallet={walletQuery.data} />
      ) : null}

      {/* ── MAX_PENDING review-queue warning ── */}
      {pendingBlocked ? (
        <View
          accessibilityRole="alert"
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: radius.md,
            borderCurve: "continuous",
            backgroundColor: `${colors.warning}1A`,
            borderWidth: 1,
            borderColor: `${colors.warning}38`,
          }}
        >
          <Icon sf="lock.fill" md="lock" size={18} color={colors.warning} />
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText
              variant="subhead"
              style={{ color: colors.warning, fontFamily: "ReadexPro-SemiBold" }}
            >
              وصلت للحد الأقصى من طلبات المراجعة
            </ThemedText>
            <ThemedText variant="footnote" style={{ color: colors.warning }}>
              {`لديك ${arabicCount(pendingCount, ORDER_COUNT_FORMS_SUBJECT)} قيد المراجعة (الحد الأقصى ${MAX_PENDING})`}
            </ThemedText>
            {oldestPending ? (
              <ThemedText variant="micro" style={{ color: colors.warning }}>
                {`أقدم طلب: ${formatRelativeTime(oldestPending)} — عادةً خلال دقائق، وبحد أقصى 30 دقيقة خلال ساعات العمل.`}
              </ThemedText>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* ── The just-submitted topup's live status (no web modal) ── */}
      {waitingRow ? (
        <WaitingPanel
          topup={waitingRow}
          balance={walletQuery.data?.balance ?? null}
          onDismiss={() => setWaitingTopup(null)}
        />
      ) : null}

      {/* ── Topup form ── */}
      <Card>
        <View
          pointerEvents={pendingBlocked ? "none" : "auto"}
          style={{ opacity: pendingBlocked ? 0.5 : 1 }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              marginBottom: spacing.lg,
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: radius.sm,
                borderCurve: "continuous",
                backgroundColor: `${colors.primary}1A`,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon sf="plus" md="add" size={16} color={colors.primary} />
            </View>
            <ThemedText variant="headline">شحن المحفظة</ThemedText>
            {pendingCount > 0 && !pendingBlocked ? (
              <View
                style={{
                  marginStart: "auto",
                  backgroundColor: `${colors.warning}1A`,
                  borderWidth: 1,
                  borderColor: `${colors.warning}38`,
                  borderRadius: radius.full,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 2,
                }}
              >
                <ThemedText variant="micro" style={{ color: colors.warning }}>
                  {`${arabicCount(pendingCount, PENDING_REVIEW_FORMS)} من ${MAX_PENDING}`}
                </ThemedText>
              </View>
            ) : null}
          </View>

          {/* Method tabs */}
          <View style={{ marginBottom: spacing.lg, gap: spacing.xs }}>
            <ThemedText
              variant="footnote"
              style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
            >
              طريقة الدفع
            </ThemedText>
            <View
              style={{ flexDirection: "row", gap: spacing.sm }}
              accessibilityLabel="طريقة الدفع"
            >
              {(
                [
                  {
                    id: "mobile_transfer" as TopupMethod,
                    title: "تحويل رصيد",
                    sub: "ليبيانا / مدار",
                    iconSf: "iphone",
                    iconMd: "smartphone",
                  },
                  {
                    id: "lypay" as TopupMethod,
                    title: "تحويل مصرفي",
                    sub: "LyPay",
                    iconSf: "building.2.fill",
                    iconMd: "account-balance",
                  },
                ] as const
              ).map((m) => {
                const active = method === m.id;
                return (
                  <Pressable
                    key={m.id}
                    accessibilityRole="button"
                    accessibilityLabel={m.title}
                    accessibilityState={{ selected: active }}
                    onPress={() => handleMethodChange(m.id)}
                    style={({ pressed }) => ({
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                      padding: spacing.md,
                      borderRadius: radius.md,
                      borderCurve: "continuous",
                      borderWidth: 1,
                      borderColor: active ? `${colors.primary}4D` : colors.border,
                      backgroundColor: active
                        ? `${colors.primary}26`
                        : pressed
                          ? colors.secondary
                          : colors.surfaceOverlay,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: radius.sm,
                        borderCurve: "continuous",
                        backgroundColor: active ? `${colors.primary}26` : colors.secondary,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon
                        sf={m.iconSf}
                        md={m.iconMd}
                        size={18}
                        color={active ? colors.primaryText : colors.onSurface}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <ThemedText
                        variant="footnote"
                        numberOfLines={1}
                        style={{ fontFamily: "ReadexPro-SemiBold" }}
                      >
                        {m.title}
                      </ThemedText>
                      <ThemedText
                        variant="micro"
                        numberOfLines={1}
                        style={{ color: colors.onSurface }}
                      >
                        {m.sub}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {method === "mobile_transfer" ? (
            <View style={{ gap: spacing.lg }}>
              {/* Step 1: Network */}
              <View>
                <StepDot n={1} label="اختر شبكتك" />
                <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                  {NETWORKS.map((n) => {
                    const active = network === n.value;
                    return (
                      <Pressable
                        key={n.value}
                        accessibilityRole="button"
                        accessibilityLabel={n.label}
                        accessibilityState={{ selected: active }}
                        onPress={() => handleNetworkChange(n.value)}
                        style={({ pressed }) => ({
                          flex: 1,
                          minHeight: spacing.touch,
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: radius.md,
                          borderCurve: "continuous",
                          borderWidth: 1,
                          borderColor: active
                            ? n.value === "libyana"
                              ? `${colors.success}99`
                              : `${colors.info}99`
                            : colors.border,
                          backgroundColor: active
                            ? n.value === "libyana"
                              ? `${colors.success}1A`
                              : `${colors.info}1A`
                            : pressed
                              ? colors.secondary
                              : colors.surfaceOverlay,
                          opacity: pressed ? 0.8 : 1,
                        })}
                      >
                        <ThemedText
                          variant="subhead"
                          style={{
                            color: active
                              ? n.value === "libyana"
                                ? colors.success
                                : colors.info
                              : colors.onSurface,
                            fontFamily: "ReadexPro-SemiBold",
                          }}
                        >
                          {n.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Divider />

              {/* Step 2: Amount */}
              <View>
                <StepDot n={2} label="المبلغ بالدينار الليبي" />
                <PresetChips presets={presets} amount={amount} onPreset={applyAmountPreset} />
                <TextInput
                  value={amount}
                  onChangeText={handleAmountChange}
                  onBlur={handleAmountBlur}
                  placeholder="أو أدخل مبلغاً آخر…"
                  placeholderTextColor={colors.onSurface}
                  accessibilityLabel="المبلغ بالدينار الليبي"
                  inputMode="decimal"
                  autoCorrect={false}
                  textAlign="left"
                  style={latinInputStyle}
                />
                <ThemedText
                  variant="micro"
                  style={{ color: colors.onSurface, marginTop: spacing.xs }}
                >
                  بين 1 و 10,000 د.ل — مبالغ صحيحة فقط
                </ThemedText>
              </View>

              <Divider />

              {/* Step 3: The transfer plan */}
              <View>
                <StepDot n={3} label="نفّذ التحويل" />
                <TransferCodePanel network={network} amount={amount} />
              </View>

              <Divider />

              {/* Step 4: Sender phone */}
              <View>
                <StepDot n={4} label="رقم هاتف المُرسل" />
                <ThemedText
                  variant="footnote"
                  style={{
                    color: colors.onSurface,
                    marginTop: spacing.sm,
                    marginBottom: spacing.sm,
                  }}
                >
                  أدخل رقمك الذي حوّلت منه الرصيد لتأكيد العملية.
                </ThemedText>
                <TextInput
                  value={senderPhone}
                  onChangeText={handleSenderPhoneChange}
                  onBlur={() => setSenderPhoneTouched(true)}
                  placeholder="091XXXXXXX"
                  placeholderTextColor={colors.onSurface}
                  accessibilityLabel="رقم هاتف المُرسل"
                  textContentType="telephoneNumber"
                  inputMode="tel"
                  autoCorrect={false}
                  maxLength={10}
                  textAlign="left"
                  style={[
                    latinInputStyle,
                    senderPhoneTouched && senderPhoneErr
                      ? { borderColor: `${colors.error}99` }
                      : null,
                  ]}
                />
                {senderPhoneTouched && senderPhoneErr ? (
                  <ThemedText
                    variant="micro"
                    accessibilityRole="alert"
                    style={{ color: colors.error, marginTop: spacing.xs }}
                  >
                    {senderPhoneErr}
                  </ThemedText>
                ) : null}
              </View>

              <Divider />

              {/* Step 5: Submit */}
              <View>
                <StepDot n={5} label="أرسل الطلب" />
                <InstructionsPanel />
                {error ? (
                  <View
                    accessibilityRole="alert"
                    style={{
                      marginBottom: spacing.md,
                      padding: spacing.md,
                      borderRadius: radius.md,
                      borderCurve: "continuous",
                      backgroundColor: `${colors.error}1A`,
                      borderWidth: 1,
                      borderColor: `${colors.error}38`,
                    }}
                  >
                    <ThemedText variant="footnote" selectable style={{ color: colors.error }}>
                      {error}
                    </ThemedText>
                  </View>
                ) : null}
                <Button
                  title={
                    submitting || topupMutation.isPending ? "جارٍ الإرسال…" : "إرسال طلب الشحن"
                  }
                  size="lg"
                  disabled={submitting || topupMutation.isPending || pendingBlocked}
                  loading={submitting || topupMutation.isPending}
                  accessibilityHint="إرسال طلب الشحن لمراجعة الإدارة"
                  onPress={handleSubmit}
                />
              </View>
            </View>
          ) : (
            <View style={{ gap: spacing.lg }}>
              {/* Step 1: Bank info */}
              <View>
                <StepDot n={1} label="معلومات الحساب المصرفي" />
                <View
                  style={{
                    marginTop: spacing.md,
                    padding: spacing.lg,
                    borderRadius: radius.md,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceOverlay,
                    gap: spacing.md,
                  }}
                >
                  <View style={{ flexDirection: "row", gap: spacing.lg }}>
                    <View style={{ flex: 1 }}>
                      <InfoRow label="اسم الحساب" value={LYPAY_INFO.account_name} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <InfoRow label="البنك" value={LYPAY_INFO.bank} />
                    </View>
                  </View>
                  <InfoRow label="الفرع" value={LYPAY_INFO.branch} />
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                      paddingTop: spacing.md,
                    }}
                  >
                    <InfoRow label="رقم الحساب" value={LYPAY_INFO.account_number} latin />
                  </View>
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                      paddingTop: spacing.md,
                    }}
                  >
                    <InfoRow label="IBAN" value={LYPAY_INFO.iban} latin />
                  </View>
                </View>
              </View>

              <Divider />

              {/* Step 2: Amount + optional receipt reference */}
              <View>
                <StepDot n={2} label="المبلغ بالدينار الليبي" />
                <PresetChips presets={presets} amount={amount} onPreset={applyAmountPreset} />
                <TextInput
                  value={amount}
                  onChangeText={handleAmountChange}
                  onBlur={handleAmountBlur}
                  placeholder="المبلغ بالدينار الليبي"
                  placeholderTextColor={colors.onSurface}
                  accessibilityLabel="المبلغ بالدينار الليبي"
                  inputMode="decimal"
                  autoCorrect={false}
                  textAlign="left"
                  style={latinInputStyle}
                />
                <ThemedText
                  variant="micro"
                  style={{ color: colors.onSurface, marginTop: spacing.xs }}
                >
                  بين 1 و 10,000 د.ل — مبالغ صحيحة فقط
                </ThemedText>

                <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
                  <ThemedText
                    variant="footnote"
                    style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
                  >
                    رمز التحويل (اختياري)
                  </ThemedText>
                  <TextInput
                    value={paymentReference}
                    onChangeText={handlePaymentReferenceChange}
                    placeholder="رقم إيصال التحويل كما ورد في رسالة التحويل"
                    placeholderTextColor={colors.onSurface}
                    accessibilityLabel="رمز التحويل، اختياري"
                    maxLength={100}
                    autoCorrect={false}
                    textAlign="left"
                    style={latinInputStyle}
                  />
                  <ThemedText variant="micro" style={{ color: colors.onSurface }}>
                    يساعد رمز التحويل فريق المراجعة في التحقق من تحويلك ومنع احتسابه مرتين.
                  </ThemedText>
                </View>
              </View>

              <Divider />

              {/* Step 3: Sender account */}
              <View>
                <StepDot n={3} label="رقم حسابك (المُرسل)" />
                <TextInput
                  value={senderAccount}
                  onChangeText={handleSenderAccountChange}
                  placeholder="أدخل رقم حساب المُرسل"
                  placeholderTextColor={colors.onSurface}
                  accessibilityLabel="رقم حساب المُرسل"
                  autoCorrect={false}
                  textAlign="left"
                  style={[latinInputStyle, { marginTop: spacing.md }]}
                />
              </View>

              <Divider />

              {/* Step 4: Submit */}
              <View>
                <StepDot n={4} label="أرسل الطلب" />
                <View
                  accessibilityRole="alert"
                  style={{
                    marginTop: spacing.md,
                    marginBottom: spacing.md,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderCurve: "continuous",
                    backgroundColor: `${colors.warning}1A`,
                    borderWidth: 1,
                    borderColor: `${colors.warning}38`,
                  }}
                >
                  <Icon
                    sf="exclamationmark.triangle.fill"
                    md="warning"
                    size={14}
                    color={colors.warning}
                  />
                  <ThemedText variant="footnote" style={{ color: colors.warning, flex: 1 }}>
                    تأكد من إتمام التحويل المصرفي أولاً قبل إرسال الطلب
                  </ThemedText>
                </View>
                {error ? (
                  <View
                    accessibilityRole="alert"
                    style={{
                      marginBottom: spacing.md,
                      padding: spacing.md,
                      borderRadius: radius.md,
                      borderCurve: "continuous",
                      backgroundColor: `${colors.error}1A`,
                      borderWidth: 1,
                      borderColor: `${colors.error}38`,
                    }}
                  >
                    <ThemedText variant="footnote" selectable style={{ color: colors.error }}>
                      {error}
                    </ThemedText>
                  </View>
                ) : null}
                <Button
                  title={
                    submitting || topupMutation.isPending ? "جارٍ الإرسال…" : "إرسال طلب الشحن"
                  }
                  size="lg"
                  disabled={submitting || topupMutation.isPending || pendingBlocked}
                  loading={submitting || topupMutation.isPending}
                  accessibilityHint="إرسال طلب الشحن لمراجعة الإدارة"
                  onPress={handleSubmit}
                />
              </View>
            </View>
          )}
        </View>
      </Card>

      {/* ── Topups review queue ── */}
      <Card>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            marginBottom: spacing.md,
          }}
        >
          <Icon
            sf="chart.line.uptrend.xyaxis"
            md="trending-up"
            size={16}
            color={colors.onSurface}
          />
          <ThemedText variant="headline">سجل الشحن</ThemedText>
          {topups.length > 0 ? (
            <ThemedText variant="micro" style={{ marginStart: "auto", color: colors.onSurface }}>
              {topups.length >= 200
                ? "عرض آخر 200 طلب شحن"
                : arabicCount(topups.length, ORDER_COUNT_FORMS_SUBJECT)}
            </ThemedText>
          ) : null}
        </View>

        {topupsQuery.isLoading ? (
          <View style={{ gap: spacing.sm }}>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} style={{ height: 72, borderRadius: radius.md }} />
            ))}
          </View>
        ) : topupsQuery.isError ? (
          <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md }}>
            <ThemedText
              variant="subhead"
              style={{ color: colors.error, fontFamily: "ReadexPro-SemiBold" }}
            >
              تعذّر تحميل سجل الشحن
            </ThemedText>
            <ThemedText variant="footnote" style={{ textAlign: "center", color: colors.onSurface }}>
              حدث خطأ في الاتصال — حاول مجدداً لعرض طلبات الشحن السابقة
            </ThemedText>
            <Button
              variant="secondary"
              title="إعادة المحاولة"
              onPress={() => void topupsQuery.refetch()}
            />
          </View>
        ) : topups.length === 0 ? (
          <View style={{ alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xl }}>
            <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
              لا توجد طلبات شحن بعد
            </ThemedText>
            <ThemedText variant="footnote" style={{ textAlign: "center", color: colors.onSurface }}>
              ابدأ بشحن محفظتك لشراء اشتراكاتك المفضلة
            </ThemedText>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {topups.map((t) => (
              <TopupRow key={t.id} topup={t} />
            ))}
          </View>
        )}
      </Card>

      {/* ── Ledger (the wallet statement) ── */}
      <Card>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            marginBottom: spacing.sm,
          }}
        >
          <Icon sf="arrow.left.arrow.right" md="swap-horiz" size={16} color={colors.onSurface} />
          <ThemedText variant="headline">سجل الحركات</ThemedText>
          {ledger.length > 0 ? (
            <ThemedText variant="micro" style={{ marginStart: "auto", color: colors.onSurface }}>
              {ledger.length >= 100
                ? "عرض آخر 100 حركة"
                : arabicCount(ledger.length, LEDGER_COUNT_FORMS)}
            </ThemedText>
          ) : null}
        </View>

        {ledgerQuery.isLoading ? (
          <View style={{ gap: spacing.sm }}>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} style={{ height: 52, borderRadius: radius.sm }} />
            ))}
          </View>
        ) : ledgerQuery.isError ? (
          <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md }}>
            <ThemedText
              variant="subhead"
              style={{ color: colors.error, fontFamily: "ReadexPro-SemiBold" }}
            >
              تعذّر تحميل سجل الحركات
            </ThemedText>
            <ThemedText variant="footnote" style={{ textAlign: "center", color: colors.onSurface }}>
              حدث خطأ في الاتصال — حاول مجدداً لعرض حركات محفظتك
            </ThemedText>
            <Button
              variant="secondary"
              title="إعادة المحاولة"
              onPress={() => void ledgerQuery.refetch()}
            />
          </View>
        ) : ledger.length === 0 ? (
          <View style={{ alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xl }}>
            <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
              لا توجد حركات بعد
            </ThemedText>
            <ThemedText variant="footnote" style={{ textAlign: "center", color: colors.onSurface }}>
              ستظهر هنا عمليات الشحن والشراء والاسترداد في محفظتك
            </ThemedText>
          </View>
        ) : (
          <View>
            {ledger.map((entry, i) => (
              <View key={entry.id ?? i}>
                {i > 0 ? <Divider /> : null}
                <LedgerRow entry={entry} />
              </View>
            ))}
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

// ── The balance hero ────────────────────────────────────────────────────────

function BalanceCardSection({ wallet }: { wallet: WalletInfo }) {
  const colors = useColors();
  const tier = wallet.loyalty_tier ?? "bronze";
  const tierColor = colors[tierColorKey(tier)];

  return (
    <Card raised>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          marginBottom: spacing.sm,
        }}
      >
        <Icon sf="wallet.fill" md="account-balance-wallet" size={14} color={colors.primaryText} />
        <ThemedText
          variant="footnote"
          style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
        >
          الرصيد المتاح
        </ThemedText>
      </View>

      <ThemedText
        variant="title"
        selectable
        style={{ fontVariant: ["tabular-nums"], marginBottom: spacing.md }}
        accessibilityLabel={`الرصيد المتاح ${formatCurrency(wallet.balance)}`}
      >
        {formatCurrency(wallet.balance)}
      </ThemedText>

      <View
        style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.md }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <View
            style={{ width: 8, height: 8, borderRadius: radius.full, backgroundColor: tierColor }}
          />
          <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
            المستوى:
          </ThemedText>
          <ThemedText
            variant="footnote"
            style={{ color: tierColor, fontFamily: "ReadexPro-SemiBold" }}
          >
            {tierLabel(tier)}
          </ThemedText>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Icon sf="star.fill" md="star" size={12} color={colors.warning} />
          <ThemedText
            variant="footnote"
            selectable
            style={{
              color: colors.warning,
              fontVariant: ["tabular-nums"],
              fontFamily: "ReadexPro-SemiBold",
            }}
          >
            {formatNumber(wallet.loyalty_points ?? 0)}
          </ThemedText>
          <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
            {arabicCount(wallet.loyalty_points ?? 0, POINTS_COUNT_FORMS)}
          </ThemedText>
        </View>
      </View>
    </Card>
  );
}

// ── The submitted topup's live status panel ─────────────────────────────────

function WaitingPanel({
  topup,
  balance,
  onDismiss,
}: {
  topup: Topup;
  balance: number | null;
  onDismiss: () => void;
}) {
  const colors = useColors();

  if (topup.status === "approved") {
    return (
      <Card
        accessibilityLabel="تم اعتماد طلب الشحن"
        style={{ borderColor: `${colors.success}38`, backgroundColor: `${colors.success}0D` }}
      >
        <View style={{ alignItems: "center", gap: spacing.sm }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.full,
              backgroundColor: `${colors.success}1A`,
              borderWidth: 1,
              borderColor: `${colors.success}38`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon sf="checkmark.circle.fill" md="check_circle" size={28} color={colors.success} />
          </View>
          <ThemedText variant="headline">تم اعتماد طلب الشحن</ThemedText>
          <ThemedText variant="footnote" style={{ textAlign: "center", color: colors.onSurface }}>
            تم اعتماد طلب الشحن وإضافته إلى محفظتك.
          </ThemedText>
          <View
            style={{
              alignSelf: "stretch",
              alignItems: "center",
              padding: spacing.md,
              borderRadius: radius.md,
              borderCurve: "continuous",
              backgroundColor: `${colors.success}1A`,
              borderWidth: 1,
              borderColor: `${colors.success}38`,
              gap: 2,
            }}
          >
            <ThemedText
              variant="micro"
              style={{ color: colors.success, fontFamily: "ReadexPro-SemiBold" }}
            >
              المبلغ المُضاف
            </ThemedText>
            <ThemedText
              variant="title"
              selectable
              style={{ color: colors.success, fontVariant: ["tabular-nums"] }}
            >
              {`+ ${formatCurrency(topup.amount)}`}
            </ThemedText>
          </View>
          {balance !== null ? (
            <View
              style={{
                alignSelf: "stretch",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                padding: spacing.md,
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: colors.secondary,
              }}
            >
              <ThemedText
                variant="footnote"
                style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
              >
                الرصيد الحالي
              </ThemedText>
              <ThemedText
                variant="subhead"
                selectable
                style={{ fontVariant: ["tabular-nums"], fontFamily: "ReadexPro-SemiBold" }}
              >
                {formatCurrency(balance)}
              </ThemedText>
            </View>
          ) : null}
          <Button title="تم" size="lg" onPress={onDismiss} />
        </View>
      </Card>
    );
  }

  if (topup.status === "rejected") {
    return (
      <Card accessibilityLabel="تم رفض طلب الشحن" style={{ borderColor: `${colors.error}38` }}>
        <View style={{ alignItems: "center", gap: spacing.sm }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.full,
              backgroundColor: `${colors.error}1A`,
              borderWidth: 1,
              borderColor: `${colors.error}38`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon sf="xmark.circle.fill" md="cancel" size={28} color={colors.error} />
          </View>
          <ThemedText variant="headline">تم رفض طلب الشحن</ThemedText>
          <ThemedText variant="footnote" style={{ textAlign: "center", color: colors.onSurface }}>
            {topup.admin_note
              ? "السبب الموضّح من الإدارة:"
              : "رُفض طلب الشحن ولم يُضاف المبلغ إلى محفظتك."}
          </ThemedText>
          {topup.admin_note ? (
            <View
              accessibilityRole="alert"
              style={{
                alignSelf: "stretch",
                padding: spacing.md,
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: `${colors.error}1A`,
                borderWidth: 1,
                borderColor: `${colors.error}38`,
              }}
            >
              <ThemedText variant="footnote" selectable style={{ color: colors.error }}>
                {topup.admin_note}
              </ThemedText>
            </View>
          ) : null}
          <Button title="البقاء في المحفظة" variant="secondary" onPress={onDismiss} />
        </View>
      </Card>
    );
  }

  // Pending — the live review queue state (socket-driven).
  return (
    <Card accessibilityLabel="طلب الشحن قيد المراجعة">
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.full,
            borderWidth: 2,
            borderColor: colors.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color={colors.primary} />
        </View>
        <ThemedText variant="headline">طلبك قيد المراجعة</ThemedText>
        <ThemedText variant="footnote" style={{ textAlign: "center", color: colors.onSurface }}>
          نتحقق الآن من إتمام التحويل. عادةً خلال دقائق، وبحد أقصى 30 دقيقة خلال ساعات العمل.
        </ThemedText>
        <View
          style={{
            alignSelf: "stretch",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: spacing.md,
            borderRadius: radius.md,
            borderCurve: "continuous",
            backgroundColor: colors.secondary,
          }}
        >
          <ThemedText
            variant="footnote"
            style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
          >
            المبلغ
          </ThemedText>
          <ThemedText
            variant="subhead"
            selectable
            style={{ fontVariant: ["tabular-nums"], fontFamily: "ReadexPro-SemiBold" }}
          >
            {formatCurrency(topup.amount)}
          </ThemedText>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Icon sf="clock.fill" md="schedule" size={12} color={colors.onSurface} />
          <ThemedText variant="micro" style={{ color: colors.onSurface }}>
            قيد المراجعة من الإدارة
          </ThemedText>
        </View>
        <Button title="إغلاق والمتابعة" variant="secondary" onPress={onDismiss} />
      </View>
    </Card>
  );
}
