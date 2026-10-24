/**
 * R136 (FE-1) — the wallet.tsx decomposition contract.
 *
 * The money page was a 2,096-line single component (14 useState atoms,
 * the whole 96-F6/98-F2 idempotency-key machinery, two topup flows and
 * three data lists in one function) — the R135 product.tsx
 * decomposition's twin target. R136 split it into orchestration
 * (pages/wallet.tsx) + fourteen verbatim extracts under
 * components/wallet/ (the R135 FE-3 contract, applied verbatim).
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the
 * idempotency-key rotation lifecycle) is already pinned by the four
 * wallet-* suites (wallet-money-gates / wallet-submit /
 * wallet-statement / wallet-method-url); this file guards the
 * STRUCTURE so the decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      2,096 lines at decomposition; the ceiling leaves room to grow
 *      without re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (directly, or by its consumer extract for the nested atoms —
 *      a dropped import = the section silently vanished);
 *   3. money-path ownership — handleSubmit, the topupMutation, and the
 *      96-F6/98-F2 key machinery (topupKeyRef + resetTopupKey + the
 *      intent-key helpers) stay IN the page: the orval mutation closes
 *      over the Idempotency-Key header at render time, so the rotation
 *      must live beside the state it supersedes — an extract that took
 *      a raw setter would desync the key from the captured headers and
 *      reopen the 409 same-key-different-body hole;
 *   4. state ownership — all 14 cross-section atoms stay CENTRALIZED
 *      in the page; the extracts take values + callbacks only;
 *   5. purity — the money helpers modules are React-free.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/wallet.tsx");

/** The extracts the page imports directly. */
const DIRECT_EXTRACTS = [
  "@/components/wallet/topup-intent-key",
  "@/components/wallet/topup-preferences",
  "@/components/wallet/topup-meta",
  "@/components/wallet/BalanceCard",
  "@/components/wallet/LatestTopupPin",
  "@/components/wallet/LyPayFlow",
  "@/components/wallet/MethodTabs",
  "@/components/wallet/MobileTransferForm",
  "@/components/wallet/PendingLimitBanner",
  "@/components/wallet/TopupHistoryCard",
  "@/components/wallet/WalletStatementCard",
];

/** Every .tsx extract (the presentational units the state pin sweeps). */
const TSX_EXTRACTS = [
  "BalanceCard",
  "LatestTopupPin",
  "LedgerEntryRow",
  "LyPayFlow",
  "MethodTabs",
  "MobileTransferForm",
  "PaymentReferenceField",
  "PendingLimitBanner",
  "TopupHistoryCard",
  "TransferCodePanel",
  "WalletStatementCard",
  "topup-meta",
];

describe("R136 (FE-1) — wallet.tsx decomposition: page stays an orchestration core", () => {
  it("pages/wallet.tsx stays under the 1,000-line ceiling (was 2,096 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    for (const specifier of DIRECT_EXTRACTS) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the nested atoms are still imported by their consumers (LedgerEntryRow / TransferCodePanel / PaymentReferenceField)", () => {
    // These render inside their consumer extracts, not the page —
    // the deletion guard for them lives at the CONSUMER's import.
    // R154 (P1-A): PaymentReferenceField is consumed by the LYPAY flow
    // only — the mobile flow retired the receipt field.
    const statement = read("src/components/wallet/WalletStatementCard.tsx");
    expect(statement).toContain('from "@/components/wallet/LedgerEntryRow"');
    const mobileForm = read("src/components/wallet/MobileTransferForm.tsx");
    expect(mobileForm).toContain('from "@/components/wallet/TransferCodePanel"');
    expect(mobileForm).not.toContain('from "@/components/wallet/PaymentReferenceField"');
    const lypay = read("src/components/wallet/LyPayFlow.tsx");
    expect(lypay).toContain('from "@/components/wallet/PaymentReferenceField"');
  });

  it("the money-path handlers stay IN the page (the extracts render; the page owns the charge)", () => {
    // handleSubmit carries the amount gates + the submit-time
    // normalization rotation; topupMutation closes over the
    // Idempotency-Key header at render time — neither may drift into a
    // presentational extract where a stale closure could charge the
    // wrong intent.
    expect(page).toContain("const handleSubmit = (e: React.FormEvent) => {");
    expect(page).toContain("const topupMutation = useCreateTopup({");
    // The 96-F6/98-F2 rotation machinery — one owner, beside the state
    // it supersedes (the docblock's "never mid-render" contract).
    expect(page).toContain("const topupKeyRef = useRef<string | null>(null);");
    expect(page).toContain("const resetTopupKey = (nextFingerprint: string) => {");
    // The idempotency-contract input handlers the extracts call —
    // an extract-local setter would silently stop the rotations.
    expect(page).toContain(
      "const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {",
    );
    expect(page).toContain("const applyAmountPreset = (p: number) => {");
    expect(page).toContain("const handlePaymentReferenceChange = (v: string) => {");
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the pending gate, both topup flows, the method mirror
    // and the mutation payload all key off the same atoms.
    for (const atom of [
      "const [method, setMethod]",
      "const [network, setNetwork]",
      "const [amount, setAmount]",
      "const [senderPhone, setSenderPhone]",
      "const [senderAccount, setSenderAccount]",
      "const [paymentReference, setPaymentReference]",
      "const [error, setError]",
      "const [submitting, setSubmitting]",
      "const [rememberPhone, setRememberPhone]",
      "const [waitingTopupId, setWaitingTopupId]",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });
});

describe("R186-6 (A-F4) — PaymentReferenceField's retired required prop stays dead", () => {
  it("the component declares no required prop and its sole consumer passes none (R154 truth: the lypay-only optional field)", () => {
    // R154 (P1-A) retired the field from the mobile_transfer flow;
    // since then the prop's true branch was verified-dead (LyPayFlow
    // passed required={false}, the mobile form stopped importing it).
    // R186-6 deleted the prop + its three true-branch renders and
    // rewrote the docblock to the R154 truth — this pin keeps the dead
    // branch from quietly growing back.
    const reference = read("src/components/wallet/PaymentReferenceField.tsx");
    // The word itself must not resurface anywhere in the file — not as
    // a prop, not as an HTML attribute, not as the stale R123-E4a
    // docblock claim that asserted the opposite of the live wiring.
    expect(reference).not.toContain("required");
    // The optional copy is unconditional now.
    expect(reference).toContain("(اختياري)");
    expect(reference).toContain(
      "يساعد رمز التحويل فريق المراجعة في التحقق من تحويلك ومنع احتسابه مرتين.",
    );

    // The sole consumer passes value/onChange/id only.
    const lypay = read("src/components/wallet/LyPayFlow.tsx");
    const usage = lypay.match(/<PaymentReferenceField[\s\S]*?\/>/)?.[0] ?? "";
    expect(usage).toContain('id="topup-payment-reference-lypay"');
    expect(usage).toContain("value={paymentReference}");
    expect(usage).toContain("onChange={onReferenceChange}");
    expect(usage).not.toContain("required");
  });
});

describe("R136 (FE-1) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Unlike product.tsx's extracts, NONE of the wallet extracts even
    // carries a fold-toggle — every atom (down to rememberPhone) lives
    // in the page, so the bar here is a flat ZERO useState.
    for (const name of TSX_EXTRACTS) {
      const src = read(`src/components/wallet/${name}.tsx`);
      expect(src.match(/useState\(/g) ?? [], name).toHaveLength(0);
    }
  });

  it("the extracts never touch a raw setter — the idempotency-contract handlers are page-owned", () => {
    // The 409 hole: an extract calling setAmount directly would skip
    // resetTopupKey, desyncing the Idempotency-Key from the mutation's
    // captured headers (96-F6/98-F2). The extracts receive the
    // page-owned handlers as props and nothing else.
    for (const name of TSX_EXTRACTS) {
      const src = read(`src/components/wallet/${name}.tsx`);
      expect(src, name).not.toMatch(/\bset[A-Z]\w*\(/);
    }
  });

  it("the money helpers modules are React-free (pure storage lifecycle — importable by any lane)", () => {
    const intentKey = read("src/components/wallet/topup-intent-key.ts");
    expect(intentKey).not.toMatch(/from "react"|from "lucide-react"/);
    expect(intentKey).toContain("const TOPUP_KEY_TTL_MS = 10 * 60 * 1000;");
    expect(intentKey).toContain('const TOPUP_KEY_SLOT = "subnation_topupkey";');

    const prefs = read("src/components/wallet/topup-preferences.ts");
    expect(prefs).not.toMatch(/from "react"|from "lucide-react"/);
    expect(prefs).toContain("export const MAX_PENDING = 3;");
    expect(prefs).toContain('"subnation_topup_preferences"');
  });
});
