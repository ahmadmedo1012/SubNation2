/**
 * R111-FIX-T / T2 — the convert-points SUCCESS journey of loyalty.tsx.
 *
 * The money mutation (POST /api/loyalty/convert-points) was tested only for
 * its error banner (loyalty-error-state.test.tsx pins the persistent
 * role=alert on failure). The success path — and the r102-envelope intent
 * key (AUD103-2-F3: durable localStorage {k, t, f} with a 10-min TTL and a
 * `convert|<points>` fingerprint) — was pinned NOWHERE.
 *
 * Modeled on checkout-idempotency-keys.test.tsx (the trio's pattern):
 *
 *   1. SUCCESS: the POST carries the Authorization + a UUID
 *      Idempotency-Key; the success toast fires; the key is CONSUMED
 *      (terminal); the Navbar/wallet caches are invalidated; the points
 *      balance tile refreshes; the form clears.
 *   2. RETRY STABILITY: a network-level failure keeps the key; the retry
 *      of the SAME intent sends the SAME key (the double-convert fix).
 *   3. 409 IDEMPOTENCY_IN_FLIGHT keeps the key (transient — the retry must
 *      replay, never re-execute).
 *   4. A definitive 4xx clears the key so a retry mints a fresh one.
 *   5. A different points amount is a NEW intent (fingerprint binding) —
 *      an unresolved key never replays onto changed data.
 *   6. The 100-point minimum gate (no request below it).
 *
 * `@workspace/api-client-react`, `@/lib/auth` and `@/hooks/use-toast` are
 * mocked at the module boundary; global fetch is stubbed per-test with a
 * router that serves GET /api/loyalty (mutable balance) and the convert
 * POST from a scripted queue.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import LoyaltyPage from "@/pages/loyalty";

vi.mock("@workspace/api-client-react", () => ({
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const CONVERT_URL = "/api/loyalty/convert-points";
const CONVERT_SLOT = "subnation_convert_key";

interface ConvertCall {
  headers: Record<string, string>;
  body: { points: number };
}

const convertCalls: ConvertCall[] = [];
type ConvertResponder = () => Response | Promise<Response>;
const convertQueue: ConvertResponder[] = [];
const loyaltyState = { points: 500 };

/** Minimal Response-like object (the loyalty-error-state harness shape). */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function loyaltyPayload(points: number) {
  return {
    points,
    tier: "silver",
    lifetime_spend: 1200,
    referral_code: "SNABC12",
    referral_link: "",
    referrals_total: 3,
    referrals_credited: 2,
    referrals_pending: 1,
    points_value_lyd: (points / 100).toFixed(2),
    next_tier: { tier: "gold", label: "ذهبي", remaining: 800 },
    points_rate: { points_per_referral: 50, points_per_lyd: 100 },
  };
}

const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url === CONVERT_URL) {
    convertCalls.push({
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")) as { points: number },
    });
    const respond = convertQueue.shift();
    if (!respond) {
      // Default convert verdict: success (the journey under test).
      return resLike({ body: { message: "تم تحويل النقاط بنجاح" } });
    }
    return respond();
  }
  // GET /api/loyalty — reflects the mutable points so the post-convert
  // refetch can render the deducted balance.
  return resLike({ body: loyaltyPayload(loyaltyState.points) });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <Router>
        <LoyaltyPage />
      </Router>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

async function openConvertForm(): Promise<{
  input: HTMLInputElement;
  invalidateSpy: MockInstance;
}> {
  const { invalidateSpy } = renderPage();
  const input = await screen.findByPlaceholderText(/عدد النقاط/);
  return { input, invalidateSpy };
}

function convertKeyOf(callIndex: number): string {
  const key = convertCalls[callIndex]?.headers["Idempotency-Key"];
  if (typeof key !== "string") throw new Error(`no Idempotency-Key on call ${callIndex}`);
  return key;
}

function storedConvertEntry(): { k?: string; t?: number; f?: string } | null {
  const raw = localStorage.getItem(CONVERT_SLOT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { k?: string; t?: number; f?: string };
  } catch {
    return null;
  }
}

function clickConvert() {
  fireEvent.click(screen.getByRole("button", { name: "تحويل" }));
}

beforeEach(() => {
  toastSpy.mockReset();
  fetchMock.mockClear();
  convertCalls.length = 0;
  convertQueue.length = 0;
  loyaltyState.points = 500;
  localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoyaltyPage — convert-points SUCCESS journey (T2: only the error banner was tested)", () => {
  it("a successful convert sends the keyed POST, toasts, consumes the key, refreshes the balance + money caches", async () => {
    const { input } = await openConvertForm();
    fireEvent.change(input, { target: { value: "300" } });
    clickConvert();

    await waitFor(() => expect(convertCalls).toHaveLength(1));
    const call = convertCalls[0];
    expect(call.body).toEqual({ points: 300 });
    expect(call.headers["Authorization"]).toBe("Bearer test token");
    // The intent key is a UUID v4 (generateIdempotencyKey).
    expect(call.headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // Success toast with the server's message.
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "تم التحويل", description: "تم تحويل النقاط بنجاح" }),
      ),
    );

    // 99-M4: success is TERMINAL — the durable intent key is consumed.
    expect(localStorage.getItem(CONVERT_SLOT)).toBeNull();

    // The form cleared for the next intent.
    expect((screen.getByPlaceholderText(/عدد النقاط/) as HTMLInputElement).value).toBe("");
  });

  it("a network-level failure KEEPS the key — the retry of the same intent sends the SAME key", async () => {
    const { input } = await openConvertForm();
    fireEvent.change(input, { target: { value: "300" } });

    // First attempt: the response is lost on a flaky link (the server may
    // have committed — the retry MUST present the same key so the backend
    // replays instead of converting twice).
    convertQueue.push(() => {
      throw new TypeError("failed to fetch");
    });
    clickConvert();
    await waitFor(() => expect(convertCalls).toHaveLength(1));
    const key1 = convertKeyOf(0);

    // The durable envelope holds the key, stamped now, bound to this intent.
    expect(storedConvertEntry()).toMatchObject({
      k: key1,
      f: "convert|300",
    });
    expect(storedConvertEntry()?.t).toBeGreaterThan(Date.now() - 60_000);

    // Persistent failure banner (not just the 4s toast).
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر التحويل");

    // Retry of the SAME intent (the input still holds 300)…
    convertQueue.push(() => {
      throw new TypeError("failed to fetch");
    });
    clickConvert();
    await waitFor(() => expect(convertCalls).toHaveLength(2));
    expect(convertKeyOf(1)).toBe(key1);
    expect(storedConvertEntry()?.k).toBe(key1);
  });

  it("a 409 IDEMPOTENCY_IN_FLIGHT is TRANSIENT — the key survives and the retry reuses it, then succeeds", async () => {
    const { input } = await openConvertForm();
    fireEvent.change(input, { target: { value: "300" } });

    convertQueue.push(() =>
      resLike({
        ok: false,
        status: 409,
        body: {
          error: "طلب سابق بنفس المعرف لا يزال قيد المعالجة. حاول مرة أخرى بعد قليل.",
          code: "IDEMPOTENCY_IN_FLIGHT",
        },
      }),
    );
    clickConvert();
    await waitFor(() => expect(convertCalls).toHaveLength(1));
    const key1 = convertKeyOf(0);

    // Unlike a definitive rejection, the in-flight 409 keeps the key…
    expect(storedConvertEntry()?.k).toBe(key1);
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    // …so the retry lands on the SAME key and this time replays success.
    clickConvert();
    await waitFor(() => expect(convertCalls).toHaveLength(2));
    expect(convertKeyOf(1)).toBe(key1);
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "تم التحويل" })),
    );
    // Terminal success consumes the key.
    expect(localStorage.getItem(CONVERT_SLOT)).toBeNull();
  });

  it("a definitive 4xx clears the key — the retry mints a FRESH one (a cached rejection must not answer forever)", async () => {
    const { input } = await openConvertForm();
    fireEvent.change(input, { target: { value: "300" } });

    convertQueue.push(() =>
      resLike({ ok: false, status: 400, body: { error: "رصيد النقاط غير كافٍ" } }),
    );
    clickConvert();
    await waitFor(() => expect(convertCalls).toHaveLength(1));
    const key1 = convertKeyOf(0);
    expect(await screen.findByRole("alert")).toHaveTextContent("رصيد النقاط غير كافٍ");

    // Definitive failure resolved the intent — the slot is empty…
    expect(localStorage.getItem(CONVERT_SLOT)).toBeNull();

    // …so the retry presents a NEW key to the backend.
    clickConvert();
    await waitFor(() => expect(convertCalls).toHaveLength(2));
    expect(convertKeyOf(1)).not.toBe(key1);
  });

  it("a DIFFERENT points amount is a NEW intent — the fingerprint never replays an old key onto changed data", async () => {
    const { input } = await openConvertForm();
    fireEvent.change(input, { target: { value: "300" } });

    convertQueue.push(() => {
      throw new TypeError("failed to fetch");
    });
    clickConvert();
    await waitFor(() => expect(convertCalls).toHaveLength(1));
    const keyFor300 = convertKeyOf(0);
    expect(storedConvertEntry()?.f).toBe("convert|300");

    // The user edits the amount after the failure → different intent →
    // different key (protects the backend's 409 same-key-different-body).
    // This attempt also drops (network) so the durable entry stays inspectable.
    fireEvent.change(input, { target: { value: "400" } });
    convertQueue.push(() => {
      throw new TypeError("failed to fetch");
    });
    clickConvert();
    await waitFor(() => expect(convertCalls).toHaveLength(2));
    const keyFor400 = convertKeyOf(1);
    expect(keyFor400).not.toBe(keyFor300);
    expect(storedConvertEntry()).toMatchObject({ k: keyFor400, f: "convert|400" });
  });

  it("the 100-point minimum gate rejects below 100 with no request; 100 proceeds", async () => {
    const { input } = await openConvertForm();

    fireEvent.change(input, { target: { value: "50" } });
    // fireEvent.submit deliberately bypasses the input's native min="100"
    // constraint (jsdom — like a browser — blocks the submit event on an
    // underflowing number input, so the click path never reaches the
    // handler). This exercises handleConvert's OWN guard, the belt-and-
    // suspenders behind the attribute.
    fireEvent.submit(input.closest("form")!);

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "الحد الأدنى 100 نقطة", variant: "destructive" }),
      ),
    );
    expect(convertCalls).toHaveLength(0);

    // The boundary itself proceeds to the network.
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(convertCalls).toHaveLength(1));
    expect(convertCalls[0].body).toEqual({ points: 100 });
  });
});

describe("LoyaltyPage — post-success money refresh (balance + cache invalidations)", () => {
  it("after a successful convert the points tile re-renders with the deducted balance and both money caches invalidate", async () => {
    const { input, invalidateSpy } = await openConvertForm();

    // The pre-convert balance is rendered (500 points).
    expect(await screen.findByText("500")).toBeInTheDocument();

    // Converting 300 points will leave 200 on the server.
    loyaltyState.points = 200;
    fireEvent.change(input, { target: { value: "300" } });
    clickConvert();

    await waitFor(() => expect(convertCalls).toHaveLength(1));

    // Money moved: the Navbar balance (useGetMe) and wallet page
    // (useGetWallet) caches are invalidated (B4 P1-7 pair)…
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/auth/me"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/wallet"] });
    });
    // …AND the SHARED loyalty-overview cache identity (R120-B5, A5-F4/F5):
    // pages/referrals.tsx renders from the same ["loyalty","overview"]
    // entry — before R120 the convert only refetched this page's local
    // copy, leaving /referrals on the pre-convert balance for ≤60 s.
    // The ledger twin (the conversion_out row this mutation appended)
    // is invalidated in the same breath.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["loyalty", "overview"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["loyalty", "ledger"] });
    });

    // And the points tile refreshes to the deducted balance.
    expect(await screen.findByText("200")).toBeInTheDocument();
  });
});
