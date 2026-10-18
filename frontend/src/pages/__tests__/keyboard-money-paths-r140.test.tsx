/**
 * R140-j — KEYBOARD / FOCUS on the money paths (checkout + wallet).
 *
 * The money paths' VISUAL chrome is pinned by money-path-chrome-r139 /
 * account-surfaces-visual-r139; their money MATH by the wallet-* and
 * checkout-* suites. This suite pins the KEYBOARD layer — the contract
 * this round shipped:
 *
 *   1. FOCUS RETENTION across the submit flights. Both money CTAs ride
 *      the native `disabled` during their POST windows (the honest
 *      PENDING register + aria-busy — pinned by wallet-submit /
 *      checkout-idempotency-keys). Native disabled drops focus to
 *      <body> the moment the flight starts, so every FAILURE landing
 *      used to leave a keyboard user stranded at the page top:
 *        • wallet: MobileTransferForm's submitRef effect re-lands focus
 *          on the re-enabled trigger when the flight clears with the
 *          persistent #wallet-error banner mounted (an immediate Enter
 *          retries — the 96-F6 idempotency key makes that safe);
 *        • checkout: the page's moneyOutcomeRef effect re-lands focus
 *          on the confirm CTA after a failed per-unit loop.
 *   2. FOCUS RETURN for the waiting modal. Radix's FocusScope restores
 *      to the element focused at OPEN time — the trigger had already
 *      lost focus to <body> (disabled-in-flight), so the wallet page's
 *      restoreTopupTriggerFocus re-lands it on the submit CTA after
 *      Radix's own restore pass (behavioral: open → focus INSIDE the
 *      dialog; close → focus back on the trigger).
 *   3. DECISION-FLIP retention inside the waiting modal: the waiting
 *      body's only focusable unmounts on approved/rejected — if the
 *      flip killed focus, it lands on the new state's primary action.
 *   4. The MAX_PENDING freeze is REAL for keyboard users: the visually
 *      frozen form card (opacity-50 + pointer-events-none) now carries
 *      the inert attribute (pointer-events never blocked keyboard
 *      focus), and the banner that explains it is role=status.
 *   5. Source-scan pins: label bindings per input, aria-describedby
 *      error wiring, inputMode="decimal" on both amount fields, ZERO
 *      tabIndex>0 in the lane, the Radix dialog shell intact (focus
 *      trap + restore stay library-owned), the method selector's
 *      selection semantics (the R124-I1 aria-pressed toggle pair),
 *      and the submit CTAs stay MOUNTED while disabled (never
 *      unmounted at the wrong moment).
 *
 * Mocks follow the vitest config's documented pattern: page-level
 * component tests mock `@workspace/api-client-react` + `@/lib/auth` at
 * the module boundary (the wallet-submit / checkout-idempotency-keys
 * harnesses); the mutation callbacks are driven by hand via the LATEST
 * useCreateTopup hook config (the static mock never runs them itself).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WalletPage from "@/pages/wallet";
import CheckoutPage from "@/pages/checkout";
import { CartProvider } from "@/lib/cart";
import { TopupWaitingModal } from "@/components/wallet/TopupWaitingModal";
import { useCreateTopup, useListTopups } from "@workspace/api-client-react";
// ─────────────────────────────────────────────────────────────────────
// Source-scan helpers (the account-surfaces-visual-r139 idiom —
// LINE-COMMENTS-FIRST: rationale comments NAME the retired strings, so
// raw absence checks would false-fail on the documentation itself).
// ─────────────────────────────────────────────────────────────────────

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "");
}

const s = (rel: string): string => stripComments(read(rel));

/** The r140-j lane (owned files). */
const LANE = [
  "src/pages/checkout.tsx",
  "src/pages/wallet.tsx",
  "src/components/wallet/MobileTransferForm.tsx",
  "src/components/wallet/TopupWaitingModal.tsx",
  "src/components/wallet/PendingLimitBanner.tsx",
  "src/components/wallet/topup-meta.tsx",
];

/** Verify-only neighbors that render the money-path DOM (read pins,
 * no edits — their owning lanes stay untouched by this suite's fixes). */
const MONEY_DOM = [
  "src/components/wallet/MethodTabs.tsx",
  "src/components/wallet/LyPayFlow.tsx",
  "src/components/wallet/PaymentReferenceField.tsx",
  "src/components/wallet/TransferCodePanel.tsx",
  "src/components/checkout/PaymentMethodCard.tsx",
  "src/components/checkout/CouponCard.tsx",
  "src/components/checkout/CheckoutCta.tsx",
  "src/components/checkout/OrderErrorBanner.tsx",
  "src/components/checkout/CartSummaryAside.tsx",
];

// ─────────────────────────────────────────────────────────────────────
// The shared page harness — ONE module factory covering BOTH money
// pages (the wallet-submit + checkout-idempotency-keys mock surfaces
// merged: the wallet's hooks + the checkout's create-order loop).
// ─────────────────────────────────────────────────────────────────────

const mutateMock = vi.fn();
const createOrderMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListTopupsQueryKey: () => ["/api/wallet/topups"],
  getGetWalletLedgerQueryKey: () => ["/api/wallet/ledger"],
  getGetMeQueryKey: () => ["/api/auth/me"],
  getListOrdersQueryKey: () => ["/api/orders"],
  useGetMe: vi.fn(() => ({
    data: { id: 7, wallet_balance: 150 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useGetWallet: vi.fn(() => ({
    data: { balance: 150, loyalty_points: 0, loyalty_tier: "bronze" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useListTopups: vi.fn(() => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useGetWalletLedger: vi.fn(() => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useCreateTopup: vi.fn(() => ({
    mutate: mutateMock,
    isPending: false,
    reset: vi.fn(),
  })),
  createOrder: (...args: unknown[]) => createOrderMock(...(args as [])),
  getMe: vi.fn(async () => ({ wallet_balance: 1_000_000 })),
  // getProduct intentionally absent (the checkout-idempotency-keys
  // harness idiom): the mount re-quote fails OPEN through the page's
  // own .catch — the confirm CTA gate still unlocks.
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

type TopupsResult = ReturnType<typeof useListTopups>;

function mockTopups(rows: Array<Record<string, unknown>>) {
  vi.mocked(useListTopups).mockReturnValue({
    data: rows as never,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as TopupsResult);
}

function renderWallet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <WalletPage />
      </Router>
    </QueryClientProvider>,
  );
}

/** The LATEST useCreateTopup hook config — the static mock never runs
 * the callbacks itself; tests drive onSuccess/onError/onSettled by hand
 * (the 96-F6 idempotency suite's idiom). */
function latestMutationConfig():
  | {
      mutation?: {
        onSuccess?: (d: unknown) => void;
        onError?: (e: unknown) => void;
        onSettled?: () => void;
      };
    }
  | undefined {
  const calls = vi.mocked(useCreateTopup).mock.calls as unknown as Array<
    [{ mutation?: Record<string, unknown> }?] | []
  >;
  return calls[calls.length - 1]?.[0] as never;
}

function fillValidTopupForm() {
  fireEvent.change(screen.getByLabelText("المبلغ بالدينار الليبي"), {
    target: { value: "50" },
  });
  fireEvent.change(screen.getByLabelText("رقم هاتف المُرسل"), {
    target: { value: "0912345678" },
  });
  // R154 (P1-A): the receipt field is retired from the mobile flow —
  // amount + phone are the whole payload now.
}

function walletSubmitCta(): HTMLButtonElement {
  return screen.getByRole("button", { name: "إرسال طلب الشحن" }) as HTMLButtonElement;
}

beforeEach(() => {
  mutateMock.mockReset();
  vi.mocked(useListTopups).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as TopupsResult);
  localStorage.clear();
  sessionStorage.clear();
  window.history.pushState(null, "", "/wallet");
});

afterEach(() => {
  window.history.pushState(null, "", "/wallet");
});

// ─────────────────────────────────────────────────────────────────────
// 1 — BEHAVIORAL: focus retention across the money flights (wallet).
// ─────────────────────────────────────────────────────────────────────

describe("R140-j — wallet submit flight: focus retention on the failure landing", () => {
  it("a failed POST /wallet/topups re-lands focus on the (re-enabled) submit trigger", async () => {
    renderWallet();
    fillValidTopupForm();

    const cta = walletSubmitCta();
    fireEvent.click(cta);
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
    // In flight: the honest PENDING register (aria-busy + disabled) —
    // native disabled has dropped focus to <body> by now in a browser.
    expect(cta).toHaveAttribute("aria-busy", "true");
    expect(cta).toBeDisabled();

    // The flight FAILS — onError mounts the persistent banner, onSettled
    // clears the flight flag (batched → one commit → one effect run).
    act(() => {
      latestMutationConfig()?.mutation?.onError?.(new Error("network down"));
      latestMutationConfig()?.mutation?.onSettled?.();
    });

    // The banner is announced (role=alert) AND focus is back on the
    // trigger — an immediate Enter retries (idempotency-safe).
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(cta).toBeEnabled());
    await waitFor(() => expect(cta).toHaveFocus());
  });

  it("a validation error alone never moves focus (the CTA never disabled — focus never left)", async () => {
    renderWallet();

    fireEvent.change(screen.getByLabelText("المبلغ بالدينار الليبي"), {
      target: { value: "0.009" },
    });
    fireEvent.submit(document.querySelector("form")!);

    expect(await screen.findByText("أقل مبلغ شحن هو 1 د.ل")).toBeInTheDocument();
    // The flight flag was never armed → the effect must stay dormant
    // (jsdom keeps focus on <body> after fireEvent.submit — assert the
    // effect did NOT grab focus).
    expect(document.activeElement).toBe(document.body);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2 — BEHAVIORAL: the waiting modal's focus lifecycle (Radix + return).
// ─────────────────────────────────────────────────────────────────────

describe("R140-j — TopupWaitingModal: focus moves IN on open, back to the trigger on close", () => {
  it("approved topup → dialog takes focus; «تم» close → focus returns to the submit CTA", async () => {
    renderWallet();
    fillValidTopupForm();

    fireEvent.click(walletSubmitCta());
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));

    // The topup list now holds the APPROVED decision the modal polls.
    mockTopups([{ id: 7, status: "approved", amount: 50, created_at: new Date().toISOString() }]);
    act(() => {
      latestMutationConfig()?.mutation?.onSuccess?.({ id: 7 });
      latestMutationConfig()?.mutation?.onSettled?.();
    });

    // Radix owns the OPEN side: the dialog mounts, focus moves INSIDE
    // (the header close button is the first focusable in the content).
    const dialog = await screen.findByRole("dialog", { name: "تمت إضافة الرصيد" });
    await waitFor(() => {
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
    });

    // Close via the approved state's explicit action («تم»).
    fireEvent.click(screen.getByRole("button", { name: "تم" }));

    // Radix restores to the element focused at OPEN time (body here —
    // the trigger was disabled-in-flight), then the page's
    // restoreTopupTriggerFocus re-lands focus on the re-enabled CTA.
    const cta = walletSubmitCta();
    await waitFor(() => expect(cta).toBeEnabled());
    await waitFor(() => expect(cta).toHaveFocus());
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3 — BEHAVIORAL: the decision-flip focus retention inside the modal.
// ─────────────────────────────────────────────────────────────────────

describe("R140-j — TopupWaitingModal: the waiting→approved flip never strands focus", () => {
  const BASE = {
    id: 1,
    status: "pending",
    amount: 50,
    admin_note: null,
    created_at: new Date().toISOString(),
  };

  function renderModal() {
    mockTopups([{ ...BASE }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mount = () => (
      <QueryClientProvider client={client}>
        <TopupWaitingModal topupId={BASE.id} token="test-token" onClose={vi.fn()} />
      </QueryClientProvider>
    );
    // rerender needs a FRESH element each call — a referentially-equal
    // element is a React bail-out (the flip would never re-render).
    const utils = render(mount());
    return { ...utils, rerenderFresh: () => utils.rerender(mount()) };
  }

  it("focus resting on the unmounting «إغلاق والمتابعة» lands on the new primary action", async () => {
    vi.useFakeTimers();
    try {
      const { rerenderFresh } = renderModal();

      // ~11 s in: the dismiss affordance exists — the keyboard user's
      // focus rests on it when the admin decision lands.
      act(() => {
        vi.advanceTimersByTime(11_000);
      });
      const dismiss = screen.getByRole("button", { name: "إغلاق والمتابعة" });
      act(() => {
        dismiss.focus();
      });
      expect(dismiss).toHaveFocus();

      // The decision flips the polled list → approved.
      vi.mocked(useListTopups).mockReturnValue({
        data: [{ ...BASE, status: "approved" }],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as TopupsResult);
      rerenderFresh();

      // The waiting body (dismiss button included) unmounted — focus
      // died with it inside the still-open modal. The R-140-j effect
      // re-lands it on the approved state's primary action «تم».
      expect(screen.getByRole("button", { name: "تم" })).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4 — BEHAVIORAL: the MAX_PENDING freeze is real for keyboard users.
// ─────────────────────────────────────────────────────────────────────

describe("R140-j — MAX_PENDING: the frozen form card is inert (not just visually)", () => {
  it("three pending topups → #wallet-topup-card carries the inert attribute + a role=status banner", async () => {
    const pending = (id: number) => ({
      id,
      status: "pending",
      amount: 25,
      created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    mockTopups([pending(11), pending(12), pending(13)]);
    const { container } = renderWallet();

    expect(await screen.findByText("وصلت للحد الأقصى من طلبات المراجعة")).toBeInTheDocument();
    // The banner that explains the freeze is a polite live region (the
    // states contract: PENDING shows WHAT is happening).
    expect(
      screen.getByText("وصلت للحد الأقصى من طلبات المراجعة").closest('[role="status"]'),
    ).not.toBeNull();
    // …and the form card is out of the tab order + a11y tree for real
    // (pointer-events-none never blocked keyboard focus — R-140-j).
    const card = container.querySelector("#wallet-topup-card");
    expect(card).not.toBeNull();
    expect(card!.hasAttribute("inert")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5 — BEHAVIORAL: checkout's failed confirm re-lands focus on the CTA.
// ─────────────────────────────────────────────────────────────────────

const toastSpy = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

function seedCart() {
  localStorage.setItem(
    "subnation_cart_v2",
    JSON.stringify([
      {
        productId: 5,
        variantId: 101,
        variantLabel: "شهر واحد",
        slug: "netflix-1m",
        name: "Netflix شهر",
        imageUrl: null,
        priceLYD: 75,
        salePriceLYD: 49,
        discountPercent: 35,
        quantity: 1,
      },
    ]),
  );
}

function renderCheckout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <CartProvider>
          <CheckoutPage />
        </CartProvider>
      </Router>
    </QueryClientProvider>,
  );
}

describe("R140-j — checkout confirm flight: focus retention on the failure landing", () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    toastSpy.mockReset();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ wallet_balance: 1_000_000 }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a network-failed unit loop re-lands focus on the re-enabled confirm CTA", async () => {
    seedCart();
    renderCheckout();

    const cta = await screen.findByRole("button", { name: /إتمام الطلب/ });
    await waitFor(() => expect(cta).toBeEnabled());

    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    fireEvent.click(cta);
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    // Complete failure → the persistent role=alert banner mounts…
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // …and focus is back on the (re-enabled) CTA — the keyboard buyer
    // can Enter again instead of tabbing the whole page.
    await waitFor(() => expect(cta).toBeEnabled());
    await waitFor(() => expect(cta).toHaveFocus());
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6 — SOURCE-SCAN pins: the money paths' keyboard contracts.
// ─────────────────────────────────────────────────────────────────────

describe("R140-j — source pins: label bindings per input (both topup flows + the coupon)", () => {
  it("every text input on the money paths is programmatically named (htmlFor/id or aria-label)", () => {
    const mobile = s("src/components/wallet/MobileTransferForm.tsx");
    // StepDot labels bind to their fields (96-F6 A6 #2).
    expect(mobile).toContain('htmlFor="topup-amount-mobile"');
    expect(mobile).toContain('id="topup-amount-mobile"');
    expect(mobile).toContain('htmlFor="topup-sender-phone"');
    expect(mobile).toContain('id="topup-sender-phone"');
    // R154 (P1-A): the mobile flow's receipt field is retired — the
    // reference field renders ONLY on the lypay flow now (its distinct id
    // pinned below).
    expect(mobile).not.toContain("topup-payment-reference");

    const lypay = s("src/components/wallet/LyPayFlow.tsx");
    expect(lypay).toContain('htmlFor="topup-amount-lypay"');
    expect(lypay).toContain('id="topup-amount-lypay"');
    expect(lypay).toContain('htmlFor="topup-sender-account"');
    expect(lypay).toContain('id="topup-sender-account"');
    expect(lypay).toContain('id="topup-payment-reference-lypay"');

    const referenceField = s("src/components/wallet/PaymentReferenceField.tsx");
    expect(referenceField).toContain("<Label htmlFor={id}");
    expect(referenceField).toContain("<Input");
    expect(referenceField).toContain("id={id}");

    // The coupon field has no <label> element — the aria-label IS the
    // binding (the name contract pinned by wallet-family suites).
    const coupon = s("src/components/checkout/CouponCard.tsx");
    expect(coupon).toContain('aria-label="رمز الكوبون"');

    // The remember-phone checkbox rides an implicit wrapping <label>.
    expect(mobile).toContain('<label className="flex items-center gap-2 mt-3 cursor-pointer">');
    expect(mobile).toContain("type=");
    expect(mobile).toContain("تذكر رقم الهاتف للمرات القادمة");
  });
});

describe("R140-j — source pins: error wiring (aria-describedby → id'd error nodes)", () => {
  it("the sender-phone live validation binds aria-invalid + aria-describedby to its error node", () => {
    const mobile = s("src/components/wallet/MobileTransferForm.tsx");
    expect(mobile).toContain("aria-invalid={senderPhoneTouched && !!senderPhoneErr}");
    expect(mobile).toContain(
      'senderPhoneTouched && senderPhoneErr ? "topup-sender-phone-error" : undefined',
    );
    expect(mobile).toContain('id="topup-sender-phone-error"');
  });

  it("the coupon error binds aria-invalid + aria-describedby to its role=alert node", () => {
    const coupon = s("src/components/checkout/CouponCard.tsx");
    expect(coupon).toContain("aria-invalid={!!couponNotice && !appliedCoupon}");
    expect(coupon).toContain(
      'aria-describedby={couponNotice && !appliedCoupon ? "checkout-coupon-error" : undefined}',
    );
    expect(coupon).toContain('id="checkout-coupon-error"');
  });

  it("both topup flows' persistent submit errors ride role=alert live banners", () => {
    const mobile = s("src/components/wallet/MobileTransferForm.tsx");
    expect(mobile).toContain('id="wallet-error"');
    expect(mobile).toContain('role="alert"');
    expect(mobile).toContain('aria-live="polite"');
    const lypay = s("src/components/wallet/LyPayFlow.tsx");
    expect(lypay).toContain('id="wallet-error-2"');
    expect(lypay).toContain('role="alert"');
  });
});

describe("R140-j — source pins: inputMode on the amount fields (numeric money input)", () => {
  it("both amount fields are type=text + inputMode=decimal + dir=ltr (the 96-F6 Arabic-keyboard contract)", () => {
    for (const file of [
      "src/components/wallet/MobileTransferForm.tsx",
      "src/components/wallet/LyPayFlow.tsx",
    ]) {
      const src = s(file);
      expect(src, file).toContain('inputMode="decimal"');
      expect(src, file).toContain('type="text"');
      expect(src, file).toContain('dir="ltr"');
    }
  });
});

describe("R140-j — source pins: ZERO tabIndex>0 in the money-path lane", () => {
  it("no file in the lane (or its money-DOM neighbors) lifts anything above natural tab order", () => {
    for (const file of [...LANE, ...MONEY_DOM]) {
      expect(s(file), file).not.toMatch(/tab[iI]ndex\s*=\s*[{"]\s*[1-9]/);
    }
  });
});

describe("R140-j — source pins: the Radix dialog shell owns focus (trap + restore stay library-owned)", () => {
  it("TopupWaitingModal rides the shared AppDialog (never a hand-rolled overlay) with deliberate ESC gating", () => {
    const waiting = s("src/components/wallet/TopupWaitingModal.tsx");
    expect(waiting).toContain("<AppDialog");
    // ESC / backdrop / header close are all gated on the ~10 s agency
    // window (R116-S2) — Escape behavior is DELIBERATE, not accidental.
    expect(waiting).toContain("dismissable={canDismiss}");
    expect(waiting).not.toMatch(/onKeyDown=\{[^}]*["']Escape["']/);
  });

  it("AppDialog stays Radix DialogPrimitive all the way down (focus trap + mount focus + restore)", () => {
    const shell = s("src/components/ui/app-dialog.tsx");
    expect(shell).toContain("DialogPrimitive.Root");
    expect(shell).toContain("DialogPrimitive.Portal");
    expect(shell).toContain("DialogPrimitive.Content");
    expect(shell).toContain('aria-modal="true"');
  });

  it("the wallet page re-lands modal-close focus on the submit trigger (the R-140-j return contract)", () => {
    const page = s("src/pages/wallet.tsx");
    expect(page).toContain(
      "querySelector<HTMLButtonElement>(\"#wallet-topup-card button[type='submit']\")",
    );
    expect(page).toContain("restoreTopupTriggerFocus();");
    expect(page).toContain('id="wallet-topup-card"');
  });
});

describe("R140-j — source pins: the method selector exposes its selection (the R124-I1 toggle idiom)", () => {
  it("both method options are real buttons whose aria-pressed follows the selection — keyboard-operable as-is", () => {
    const tabs = s("src/components/wallet/MethodTabs.tsx");
    // Tab + Enter/Space changes the method: no pointer-only state. The
    // aria-pressed toggle pair is the codebase's TESTED selector idiom
    // (home.tsx / product.tsx — pinned byte-wise by
    // account-surfaces-visual-r139); a role="radiogroup" + roving
    // tabindex upgrade belongs to MethodTabs' owning lane, NOT here.
    expect(tabs).toContain("aria-pressed={method === m.id}");
    expect(tabs).toContain('type="button"');
    expect(tabs).toContain("تحويل رصيد");
    expect(tabs).toContain("تحويل مصرفي");
    // Exactly TWO options, declared once each (the mapped literal is one
    // <button in source — the pair comes from the option array).
    expect(tabs).toContain('id: "mobile_transfer"');
    expect(tabs).toContain('id: "lypay"');
    // The checkout "payment method" step needs NO selector at all:
    // wallet-only by design (the page docblock) — nothing fake to pin.
    expect(s("src/components/checkout/PaymentMethodCard.tsx")).not.toContain("aria-pressed");
  });
});

describe("R140-j — source pins: the money CTAs stay mounted while disabled (PENDING shows WHAT)", () => {
  it("the wallet submit CTA: disabled + aria-busy on the SAME predicate, focus restoration wired", () => {
    const mobile = s("src/components/wallet/MobileTransferForm.tsx");
    expect(mobile).toContain("disabled={submitting || mutationPending}");
    expect(mobile).toContain("aria-busy={submitting || mutationPending}");
    expect(mobile).toContain('type="submit"');
    // The R-140-j focus-retention contract itself:
    expect(mobile).toContain("if (error) submitRef.current?.focus();");
    expect(mobile).toContain("ref={submitRef}");
  });

  it("the checkout page's confirm-flight focus restoration is wired to the money outcome block", () => {
    const page = s("src/pages/checkout.tsx");
    expect(page).toContain("confirmFlightRef");
    expect(page).toContain("moneyOutcomeRef");
    expect(page).toContain("confirmCta?.focus();");
  });

  it("the waiting modal's decision-flip focus retention is wired", () => {
    const waiting = s("src/components/wallet/TopupWaitingModal.tsx");
    expect(waiting).toContain("prevStatusRef");
    expect(waiting).toContain("bodyAnchorRef");
  });

  it("the MAX_PENDING freeze is inert + announced (role=status banner)", () => {
    expect(s("src/pages/wallet.tsx")).toContain("inert={pendingBlocked}");
    expect(s("src/components/wallet/PendingLimitBanner.tsx")).toContain('role="status"');
  });
});
