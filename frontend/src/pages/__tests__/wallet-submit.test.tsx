/**
 * Wallet topup form tests — 93-C5 / F-03 (A10 spec (b)).
 *
 * The topup form never sent `payment_reference`, which left the backend's
 * entire duplicate-transfer dedup machinery (advisory lock + in-tx
 * reference check + partial unique index, V1-M9/B2-02) conditional on a
 * field that was always empty — a user could submit the same real
 * transfer 3× (MAX_PENDING) and be credited 3×. These tests pin:
 *
 *   1. A reference the user typed is TRIMMED and sent in the POST body
 *      (asserted on the orval mutation's `mutate({ data })` payload —
 *      A10's spec phrases it as the fetch body; the implementation goes
 *      through useCreateTopup, so the payload is the outgoing contract).
 *   2. Client-side rejection of an invalid amount performs no request.
 *   3. A failed /api/wallet probe renders an error state, NOT a
 *      fabricated 0.00-balance card (A10 spec (e), A4 P2 #7).
 *
 * `@workspace/api-client-react` and `@/lib/auth` are mocked at the
 * module boundary (the vitest config's documented pattern for
 * page-level component tests).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WalletPage from "@/pages/wallet";
import { useCreateTopup, useGetWallet } from "@workspace/api-client-react";

const mutateMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListTopupsQueryKey: () => ["/api/wallet/topups"],
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
  useCreateTopup: vi.fn(() => ({
    mutate: mutateMock,
    isPending: false,
    reset: vi.fn(),
  })),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

type WalletResult = ReturnType<typeof useGetWallet>;

function mockWalletResult(over: Partial<WalletResult>) {
  vi.mocked(useGetWallet).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  } as unknown as WalletResult);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <WalletPage />
      </Router>
    </QueryClientProvider>,
  );
}

// 96-F6: file-level hygiene. The original beforeEach lives INSIDE the
// first describe, so tests in the round-96 describes below inherited
// leaked state: the LyPay method-switch test persists
// `subnation_topup_preferences` (the next mount restores method=lypay →
// the mobile-transfer form and its labels never render), the wallet
// error-state test leaves useGetWallet mocked with isError:true, and
// mutateMock call counts leak between the idempotency tests. Reset all
// three for EVERY test in this file (the first describe's own
// beforeEach repeats the same resets — harmless).
beforeEach(() => {
  mutateMock.mockReset();
  vi.mocked(useGetWallet).mockReturnValue({
    data: { balance: 150, loyalty_points: 0, loyalty_tier: "bronze" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as WalletResult);
  localStorage.clear();
  sessionStorage.clear();
});

describe("WalletPage topup form — payment_reference reaches the server (93-C5 F-03)", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    // Deterministic default for the balance query (tests that need the
    // error branch override it explicitly below).
    vi.mocked(useGetWallet).mockReturnValue({
      data: { balance: 150, loyalty_points: 0, loyalty_tier: "bronze" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as WalletResult);
    localStorage.clear();
    sessionStorage.clear();
  });

  it("sends the trimmed payment_reference in the topup POST body", async () => {
    renderPage();

    // Amount (step 2 of the mobile-transfer flow).
    fireEvent.change(screen.getByPlaceholderText("أو أدخل مبلغاً آخر..."), {
      target: { value: "50" },
    });
    // Sender phone (step 4) — 10-digit Libyan format.
    fireEvent.change(screen.getByPlaceholderText("091XXXXXXX"), {
      target: { value: "0912345678" },
    });
    // The receipt reference field (93-C5 / F-03) — typed with padding to
    // prove the trim-at-submit boundary.
    fireEvent.change(screen.getByLabelText("رقم مرجع التحويل (اختياري)"), {
      target: { value: "  TRX-9  " },
    });

    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الشحن" }));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    expect(mutateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 50,
        payment_method: "mobile_transfer",
        payment_reference: "TRX-9",
        sender_phone: "0912345678",
      }),
    });
  });

  it("omits payment_reference when the user left it blank (optional field)", async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("أو أدخل مبلغاً آخر..."), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByPlaceholderText("091XXXXXXX"), {
      target: { value: "0912345678" },
    });

    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الشحن" }));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    const body = mutateMock.mock.calls[0][0].data as Record<string, unknown>;
    expect(body.payment_reference).toBeUndefined();
  });

  it("rejects an invalid amount client-side without any request", async () => {
    const { container } = renderPage();

    // fireEvent.submit bypasses jsdom's constraint validation (the empty
    // amount input is `required`) AND the input's onBlur re-rounding
    // (which would coerce a typed 0 to 1) — this exercises handleSubmit's
    // OWN guard: a non-positive amount never reaches the network.
    fireEvent.change(screen.getByPlaceholderText("أو أدخل مبلغاً آخر..."), {
      target: { value: "0" },
    });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(screen.getByText("يرجى إدخال مبلغ صالح")).toBeInTheDocument();
    });
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("renders an error state (not a fabricated balance) when /api/wallet fails", async () => {
    mockWalletResult({ isError: true });

    renderPage();

    // 93-C5 / F-05 (A4 #7): the balance card used to silently vanish on a
    // failed probe; now it's an explicit, retryable error card.
    expect(await screen.findByText("تعذّر تحميل رصيد المحفظة")).toBeInTheDocument();
    expect(screen.queryByText("الرصيد المتاح")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 96-F6 (R96) — the round-96 wallet form upgrades: decimal amount
// keyboard + sanitizer (A2 P1-6), programmatic labels (A6 #2), live
// validation aria binding (A6 #13), and the topup Idempotency-Key
// (§5.1 frontend half).
// ─────────────────────────────────────────────────────────────────────

describe("WalletPage — amount keyboard + sanitizer (96-F6 / R96 A2 P1-6)", () => {
  it("amount field is a text input with a decimal keyboard profile", () => {
    renderPage();
    const amount = screen.getByLabelText("المبلغ بالدينار الليبي");
    expect(amount).toHaveAttribute("type", "text");
    expect(amount).toHaveAttribute("inputmode", "decimal");
    expect(amount).toHaveAttribute("autocomplete", "off");
    expect(amount).toHaveAttribute("enterkeyhint", "done");
  });

  it("sanitizer keeps digits + a single decimal point (incl. Arabic-Indic digits)", () => {
    renderPage();
    const amount = screen.getByLabelText("المبلغ بالدينار الليبي") as HTMLInputElement;

    // Arabic-Indic digits + the Arabic decimal separator (٫).
    fireEvent.change(amount, { target: { value: "١٢٫٥" } });
    expect(amount.value).toBe("12.5");

    // Letters stripped; multiple dots collapse into the first one.
    fireEvent.change(amount, { target: { value: "abc12.5.5" } });
    expect(amount.value).toBe("12.55");

    // Plain digits pass through untouched.
    fireEvent.change(amount, { target: { value: "50" } });
    expect(amount.value).toBe("50");
  });
});

describe("WalletPage — form labels + live validation a11y (96-F6 / R96 A6 #2 + #13)", () => {
  it("amount / sender-phone fields are programmatically labelled (autoComplete=tel on the phone)", () => {
    renderPage();
    const amount = screen.getByLabelText("المبلغ بالدينار الليبي");
    expect(amount).toHaveAttribute("id", "topup-amount-mobile");

    const phone = screen.getByLabelText("رقم هاتف المُرسل");
    expect(phone).toHaveAttribute("id", "topup-sender-phone");
    expect(phone).toHaveAttribute("autocomplete", "tel");
  });

  it("LyPay flow labels its amount + sender account the same way", () => {
    renderPage();
    fireEvent.click(screen.getByText("تحويل مصرفي"));

    expect(screen.getByLabelText("المبلغ المحوّل (د.ل)")).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByLabelText("رقم حسابك (المُرسل)")).toHaveAttribute(
      "id",
      "topup-sender-account",
    );
  });

  it("sender-phone error is bound via aria-describedby + aria-invalid once visible", async () => {
    renderPage();
    const phone = screen.getByLabelText("رقم هاتف المُرسل") as HTMLInputElement;

    // Untouched: no describedby target, not marked invalid.
    expect(phone).not.toHaveAttribute("aria-describedby");
    expect(phone).toHaveAttribute("aria-invalid", "false");

    // Type a too-short phone and blur → the live error appears + binds.
    fireEvent.change(phone, { target: { value: "091" } });
    fireEvent.blur(phone);

    expect(await screen.findByText("رقم الهاتف يجب أن يتكون من 10 أرقام")).toHaveAttribute(
      "id",
      "topup-sender-phone-error",
    );
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAttribute("aria-describedby", "topup-sender-phone-error");
  });
});

describe("WalletPage — topup Idempotency-Key reset semantics (96-F6 / R96 §5.1)", () => {
  /**
   * The orval mutation closes over the hook's `request` headers at RENDER
   * time — so the headers of the LATEST useCreateTopup() call are exactly
   * what the next mutate() sends. (The mutation itself is mocked, so the
   * hook CONFIG is the observable surface for the key.)
   */
  const lastHookConfig = ():
    | {
        request?: { headers?: Record<string, string> };
        mutation?: {
          onSuccess?: (data: unknown) => void;
          onSettled?: () => void;
        };
      }
    | undefined => {
    const calls = vi.mocked(useCreateTopup).mock.calls as unknown as Array<
      [{ request?: { headers?: Record<string, string> }; mutation?: Record<string, unknown> }?] | []
    >;
    return calls[calls.length - 1]?.[0] as
      | {
          request?: { headers?: Record<string, string> };
          mutation?: { onSuccess?: (data: unknown) => void; onSettled?: () => void };
        }
      | undefined;
  };
  const lastKey = () => lastHookConfig()?.request?.headers?.["Idempotency-Key"];

  it("configures the mutation with a UUID Idempotency-Key + the auth header", () => {
    renderPage();

    expect(lastKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(lastHookConfig()?.request?.headers?.["Authorization"]).toBe("Bearer test-token");
  });

  it("reuses the same key across retries of one intent, rotates on amount edits", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("المبلغ بالدينار الليبي"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByLabelText("رقم هاتف المُرسل"), {
      target: { value: "0912345678" },
    });

    const intentKey = lastKey();
    expect(intentKey).toBeTruthy();

    // Submit #1 — say the response gets lost on a flaky mobile network.
    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الشحن" }));
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));

    // The mutation settles without a result (network-level failure) —
    // `submitting` flips back, nothing rotated the key.
    act(() => {
      lastHookConfig()?.mutation?.onSettled?.();
    });
    expect(lastKey()).toBe(intentKey);

    // Retry of the SAME intent → SAME key: the backend's idempotency
    // middleware replays the first response instead of creating a
    // second identical pending topup.
    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الشحن" }));
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(2));
    expect(lastKey()).toBe(intentKey);

    // The user edits the amount after the failure → new intent → new key
    // (also protects the backend's 409 same-key-different-body branch).
    fireEvent.change(screen.getByLabelText("المبلغ بالدينار الليبي"), {
      target: { value: "60" },
    });
    expect(lastKey()).not.toBe(intentKey);
  });

  it("rotates the key after a SUCCESSFUL submit (form reset ⇒ new intent)", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("المبلغ بالدينار الليبي"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByLabelText("رقم هاتف المُرسل"), {
      target: { value: "0912345678" },
    });
    const intentKey = lastKey();

    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الشحن" }));
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));

    // Simulate the mutation's success path (the static mock doesn't run
    // the real callbacks) — onSuccess resets the form AND rotates the key.
    act(() => {
      lastHookConfig()?.mutation?.onSuccess?.({ id: 7 });
    });

    const nextKey = lastKey();
    expect(nextKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(nextKey).not.toBe(intentKey);
    // The form reset alongside the rotation.
    expect((screen.getByLabelText("المبلغ بالدينار الليبي") as HTMLInputElement).value).toBe("");
  });
});
