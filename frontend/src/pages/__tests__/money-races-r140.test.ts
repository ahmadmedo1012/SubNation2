/**
 * R-140-o — the money-path race/retry final audit pin suite.
 *
 * Lane files audited this round: lib/idempotency.ts, lib/api-config.ts,
 * lib/errors.ts, hooks/useSocket.ts + lib/socket-resync.ts (the four
 * storefront money mutations live in the PAGES — audited verify-only,
 * their gate chains pinned here as SOURCE-scan contracts per the
 * admin-products-decomposition-r137 idiom).
 *
 * What this suite freezes (one block per audit question):
 *
 *   A. THE IDEMPOTENCY KEY LIFECYCLE (task e — retry semantics):
 *      mint-replay-clear for all four money flows. A NETWORK-level
 *      failure mid-POST keeps the stored key → the user's retry sends
 *      the SAME key → the backend middleware replays the cached
 *      response instead of charging again. The key rotates only on a
 *      NEW intent (fingerprint drift: payload edit / price change /
 *      variant switch) or a DEFINITIVE resolution (2xx accounted /
 *      HTTP rejection — 409 IDEMPOTENCY_IN_FLIGHT keeps it). TTL 10 min
 *      bounds a stale intent so it can never swallow a genuinely new
 *      purchase through the server's 24 h replay window.
 *   B. THE GATE CHAIN per money mutation (task a — double submit):
 *      disabled CTA + synchronous in-handler re-entry guard + the
 *      idempotency header wiring. A double-click / double-Enter meets
 *      the re-rendered disabled predicate (React flushes discrete
 *      events synchronously), and even a same-frame double entry sends
 *      the SAME key + SAME body → the backend's in-flight 409 branch,
 *      never a second charge.
 *   C. ABORT WIRING on the quote/charge fetches (task c): customFetch's
 *      20 s timeout maps onto the canonical network-error TypeError
 *      (Arabic generic via lib/errors.ts), a CALLER abort (React Query
 *      unmount) propagates unchanged, and the transparent boot-gate
 *      retry re-sends the SAME Idempotency-Key + body (retry-safe).
 *   D. SOCKET RESYNC KEY ALIGNMENT (task d): use-socket's topup-updated
 *      handler invalidates the exact generated keys the consumers use
 *      (wallet / topups / ledger / me — R-140-o added the latter two),
 *      and an invalidation racing a concurrently refetching query
 *      CANCEL-AND-SUPERSEDES it (TanStack v5 refetchQueries defaults
 *      cancelRefetch:true) — exactly one fresh request, the pre-event
 *      response can never land — and lib/socket-resync.ts keeps ONE
 *      storefront money set covering the same families.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── module mocks (the use-socket-topup-dedupe idiom) ───────────────────────
// The socket transport and the toaster are mocked at the module boundary so
// the hook's QUERY wiring runs against a REAL QueryClient — that is the
// surface the key-alignment pins need.
const { connectSocketMock } = vi.hoisted(() => ({ connectSocketMock: vi.fn() }));
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/lib/socket", () => ({
  connectSocket: connectSocketMock,
}));

vi.mock("@/hooks/useToast", () => ({
  toast: toastMock,
}));

// The REAL generated client: the key functions under test are exactly the
// ones the production consumers import — no hand-rolled key copies.
import {
  customFetch,
  DEFAULT_REQUEST_TIMEOUT_MS,
  getGetMeQueryKey,
  getGetWalletLedgerQueryKey,
  getGetWalletQueryKey,
  getListTopupsQueryKey,
} from "@workspace/api-client-react";
import { useSocket } from "@/hooks/useSocket";
import { invalidateStorefrontTransactionalFamilies } from "@/lib/socket-resync";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import { getErrorMessage } from "@/lib/errors";
import {
  buyIntentFingerprint,
  clearBuyIntentKey,
  loadBuyIntentKey,
  persistBuyIntentKey,
} from "@/components/product/buy-intent-key";
import {
  checkoutUnitFingerprint,
  clearCheckoutUnitKey,
  loadCheckoutUnitKey,
  persistCheckoutUnitKey,
  purgeLegacyCheckoutUnitKeys,
} from "@/components/checkout/checkout-unit-key";
import {
  clearStoredConvertKey,
  loadStoredConvertKey,
  persistStoredConvertKey,
} from "@/components/loyalty/loyalty-convert-key";
import {
  loadTopupIntentKey,
  persistTopupIntentKey,
  topupIntentFingerprint,
} from "@/components/wallet/topup-intent-key";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.spyOn(Date, "now").mockRestore();
  localStorage.clear();
  sessionStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// A. The idempotency key lifecycle (task e) — the exact contract, one block
//    per money flow, behavioral against the REAL helper modules.
// ─────────────────────────────────────────────────────────────────────────────

describe("R-140-o A — idempotency key lifecycle: mint-replay-clear (task e)", () => {
  it("generateIdempotencyKey mints RFC-4122 v4 UUIDs (header-shaped, collision-free)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1_000; i++) {
      const key = generateIdempotencyKey();
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      seen.add(key);
    }
    expect(seen.size).toBe(1_000);
  });

  it("withIdempotencyKey appends the header WITHOUT mutating the caller's map", () => {
    const base = { Authorization: "Bearer t" };
    const out = withIdempotencyKey(base, "k-1");
    expect(out).toEqual({ Authorization: "Bearer t", "Idempotency-Key": "k-1" });
    expect(base).not.toHaveProperty("Idempotency-Key");
  });

  it("PDP buy-intent key: network-failure retry REPLAYS the stored key; TTL / fingerprint / terminal clear all mint fresh", () => {
    const fp = buyIntentFingerprint(7, 50, "save10", 3);
    // mint-before-request (the page persists BEFORE createOrder fires)
    persistBuyIntentKey(7, fp, "buy-key-1");
    expect(loadBuyIntentKey(7, fp)).toBe("buy-key-1"); // the retry's replay
    // a price / coupon / variant change is a NEW intent — never replay
    expect(loadBuyIntentKey(7, buyIntentFingerprint(7, 60, "save10", 3))).toBeNull();
    expect(loadBuyIntentKey(7, buyIntentFingerprint(7, 50, "other", 3))).toBeNull();
    expect(loadBuyIntentKey(7, buyIntentFingerprint(7, 50, "save10", 4))).toBeNull();
    // coupon codes are normalized — case drift must NOT mint fresh
    expect(loadBuyIntentKey(7, buyIntentFingerprint(7, 50, "SAVE10", 3))).toBe("buy-key-1");
    // TTL: a key older than 10 minutes is a stale intent, not this retry
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 11 * 60 * 1000);
    expect(loadBuyIntentKey(7, fp)).toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(realNow);
    // terminal resolution (2xx / definitive HTTP rejection) clears the slot
    clearBuyIntentKey(7);
    expect(loadBuyIntentKey(7, fp)).toBeNull();
  });

  it("checkout per-UNIT keys: line-scoped slots (variant collision-proof), unit-price fingerprint, legacy purge", () => {
    const line = { productId: 9, variantId: 2, priceLYD: 80, salePriceLYD: 60 };
    const fp = checkoutUnitFingerprint(line, "SAVE");
    persistCheckoutUnitKey(9, 2, 0, fp, "unit-key-a");
    // retry of the SAME unit replays
    expect(loadCheckoutUnitKey(9, 2, 0, fp)).toBe("unit-key-a");
    // AUD103-2-F1: a sibling line (same product, DIFFERENT variant) owns a
    // DISTINCT slot — the sibling's persist must not clobber this unit's key
    persistCheckoutUnitKey(
      9,
      5,
      0,
      checkoutUnitFingerprint(
        { productId: 9, variantId: 5, priceLYD: 80, salePriceLYD: 60 },
        "SAVE",
      ),
      "unit-key-b",
    );
    expect(loadCheckoutUnitKey(9, 2, 0, fp)).toBe("unit-key-a");
    expect(
      loadCheckoutUnitKey(
        9,
        5,
        0,
        checkoutUnitFingerprint(
          { productId: 9, variantId: 5, priceLYD: 80, salePriceLYD: 60 },
          "SAVE",
        ),
      ),
    ).toBe("unit-key-b");
    // the unit price rides the fingerprint (a post-reconcile price change
    // is a NEW intent — never a replay of the old charge)
    expect(
      loadCheckoutUnitKey(
        9,
        2,
        0,
        checkoutUnitFingerprint(
          { productId: 9, variantId: 2, priceLYD: 80, salePriceLYD: 70 },
          "SAVE",
        ),
      ),
    ).toBeNull();
    // terminal clear per unit
    clearCheckoutUnitKey(9, 2, 0);
    expect(loadCheckoutUnitKey(9, 2, 0, fp)).toBeNull();
    // pre-r103 legacy slots (2 segments) are swept, new-shape keys survive
    localStorage.setItem("subnation_checkout_key:9:0", '"legacy-raw-uuid"');
    purgeLegacyCheckoutUnitKeys();
    expect(localStorage.getItem("subnation_checkout_key:9:0")).toBeNull();
    expect(localStorage.getItem("subnation_checkout_key:9:5:0")).not.toBeNull();
  });

  it("wallet topup intent key: sessionStorage envelope + amount|method|phone fingerprint + TTL", () => {
    const fp = topupIntentFingerprint("25", "mobile_transfer", "0912345678");
    persistTopupIntentKey(fp, "topup-key-1");
    expect(loadTopupIntentKey(fp)).toBe("topup-key-1");
    // any payload-defining edit is a new intent (rotation point in the page)
    expect(
      loadTopupIntentKey(topupIntentFingerprint("30", "mobile_transfer", "0912345678")),
    ).toBeNull();
    expect(loadTopupIntentKey(topupIntentFingerprint("25", "lypay", "0912345678"))).toBeNull();
    expect(
      loadTopupIntentKey(topupIntentFingerprint("25", "mobile_transfer", "0910000000")),
    ).toBeNull();
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 601_000);
    expect(loadTopupIntentKey(fp)).toBeNull();
  });

  it("loyalty convert intent key: localStorage envelope + convert|<points> fingerprint + TTL", () => {
    persistStoredConvertKey("convert|200", "convert-key-1");
    expect(loadStoredConvertKey("convert|200")).toBe("convert-key-1");
    // a different points amount is a NEW intent
    expect(loadStoredConvertKey("convert|300")).toBeNull();
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 601_000);
    expect(loadStoredConvertKey("convert|200")).toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(realNow);
    clearStoredConvertKey();
    expect(loadStoredConvertKey("convert|200")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. The gate chain per money mutation (task a) — source-scan pins.
// ─────────────────────────────────────────────────────────────────────────────

const checkoutPage = read("src/pages/checkout.tsx");
const walletPage = read("src/pages/wallet.tsx");
const productPage = read("src/pages/product.tsx");
const loyaltyPage = read("src/pages/loyalty.tsx");

describe("R-140-o B — the gate chain per money mutation (task a)", () => {
  it("checkout confirm: synchronous re-entry guard + CTA gate includes the flight flag AND the re-quote flag", () => {
    // AUD103-2-F8: two clicks in one frame both entered before the disabled
    // re-render — the guard is synchronous, the idempotency layer stays
    // defense-in-depth, not the gate itself.
    expect(checkoutPage).toMatch(/if \(!token \|\| items\.length === 0 \|\| submitting\) return;/);
    // canSubmit owns BOTH gates: the submitting flight flag…
    expect(checkoutPage).toMatch(/if \(!token \|\| isEmpty \|\| submitting\) return false;/);
    // …and the 98-F2 re-quote-in-flight gate (stale totals never sell).
    expect(checkoutPage).toMatch(/if \(pricingRecheckInFlight\) return false;/);
    // the CTA consumes the same predicate (disabled while in flight).
    expect(read("src/components/checkout/CheckoutCta.tsx")).toMatch(/disabled=\{!canSubmit\}/);
  });

  it("checkout confirm: per-unit key is mint-or-REUSE, persisted BEFORE the POST, sent as the header", () => {
    expect(checkoutPage).toMatch(
      /loadCheckoutUnitKey\(it\.productId, it\.variantId \?\? null, unit, lineFingerprint\) \?\?\s*generateIdempotencyKey\(\)/,
    );
    expect(checkoutPage).toMatch(/persistCheckoutUnitKey\(/);
    expect(checkoutPage).toMatch(/headers: \{ "Idempotency-Key": unitKey \},/);
  });

  it("checkout confirm: IDEMPOTENCY_IN_FLIGHT keeps the unit key; definitive HTTP rejections clear it", () => {
    expect(checkoutPage).toMatch(
      /if \(apiErrorData\(e\)\?\.code !== ErrorCode\.IDEMPOTENCY_IN_FLIGHT\) \{/,
    );
    expect(checkoutPage).toMatch(
      /clearCheckoutUnitKey\(it\.productId, it\.variantId \?\? null, unit\)/,
    );
  });

  it("wallet topup submit: in-handler guard mirrors the disabled predicate (Enter can't double-fire)", () => {
    // 97-F5: Enter must not submit while the button is disabled — the SAME
    // predicate as the CTA, so a stray Enter over the waiting modal can't
    // fire a 409 over the open window.
    expect(walletPage).toMatch(/if \(submitting \|\| topupMutation\.isPending\) return;/);
    expect(read("src/components/wallet/MobileTransferForm.tsx")).toMatch(
      /disabled=\{submitting \|\| mutationPending\}/,
    );
    expect(read("src/components/wallet/LyPayFlow.tsx")).toMatch(
      /disabled=\{submitting \|\| mutationPending\}/,
    );
  });

  it("wallet topup submit: the key is FETCH-TIME read (stable request object) + rotates at every payload-defining reset point", () => {
    // 96-F6: ONE key per submission intent — rotated ONLY at explicit
    // reset points. G-2 (R142) closed the ORVAL HEADER-TIMING residual
    // (lib/idempotency.ts documents the class): the render-time header
    // capture shipped the PRE-rotation key with the submit-time
    // POST-normalization body. The pin is now the stable-request-object
    // contract — synced at EVERY rotation point (resetTopupKey), the
    // mount restore, and belt-and-suspenders immediately before mutate.
    expect(walletPage).toMatch(/request: topupRequestRef\.current,/);
    expect(walletPage).toMatch(
      /const syncTopupRequestKey = \(\) => \{\s*topupRequestRef\.current\.headers\["Idempotency-Key"\] = topupKeyRef\.current \?\? "";\s*\};/,
    );
    // every rotation point funnels through resetTopupKey → the sync.
    expect(walletPage).toMatch(/resetTopupKey\(topupIntentFingerprint\(/);
    expect(walletPage).toMatch(
      /persistTopupIntentKey\(nextFingerprint, topupKeyRef\.current\);\s*syncTopupRequestKey\(\);/,
    );
    // the intent key is durable (sessionStorage) for the refresh retry —
    // and the restored key reaches the stable request object too.
    expect(walletPage).toMatch(/loadTopupIntentKey\(fingerprint\)/);
    expect(walletPage).toMatch(/topupKeyRef\.current = restored;\s*syncTopupRequestKey\(\);/);
    // belt-and-suspenders: the wire key is re-synced in the submit
    // handler itself, AFTER the normalization rotation, BEFORE mutate.
    const submitSync = walletPage.indexOf("syncTopupRequestKey();");
    const mutateCall = walletPage.indexOf("topupMutation.mutate({");
    expect(submitSync).toBeGreaterThan(-1);
    expect(mutateCall).toBeGreaterThan(submitSync);
  });

  it("PDP single-buy: buyPending guard + mint-or-reuse BEFORE createOrder + in-flight-409 key retention", () => {
    expect(productPage).toMatch(/if \(!product \|\| buyPending\) return;/);
    expect(productPage).toMatch(
      /const intentKey = loadBuyIntentKey\(product\.id, fingerprint\) \?\? generateIdempotencyKey\(\);/,
    );
    expect(productPage).toMatch(/persistBuyIntentKey\(product\.id, fingerprint, intentKey\);/);
    expect(productPage).toMatch(/headers: \{ "Idempotency-Key": intentKey \},/);
    // 99-M2: a 409 IDEMPOTENCY_IN_FLIGHT is NOT definitive — the retry must
    // replay, never re-execute.
    expect(productPage).toMatch(/httpCode !== "IDEMPOTENCY_IN_FLIGHT"/);
    // the pre-buy re-quote runs BEFORE any key is minted (drift = new intent).
    expect(productPage.indexOf("const live = await getProduct(product.id);")).toBeGreaterThan(-1);
    expect(productPage.indexOf("const live = await getProduct(product.id);")).toBeLessThan(
      productPage.indexOf("loadBuyIntentKey(product.id, fingerprint)"),
    );
    expect(read("src/components/product/CtaBlock.tsx")).toMatch(/disabled=\{isPending\}/);
  });

  it("points convert: durable mint-once-per-intent key + in-flight-409 retention + disabled CTA while converting", () => {
    expect(loyaltyPage).toMatch(
      /const intentKey = loadStoredConvertKey\(fingerprint\) \?\? generateIdempotencyKey\(\);/,
    );
    expect(loyaltyPage).toMatch(/persistStoredConvertKey\(fingerprint, intentKey\);/);
    expect(loyaltyPage).toMatch(/"Idempotency-Key": intentKey,/);
    // G-1 (R142): the convert POST rides the generated client — non-2xx
    // arrives as ApiError, so the envelope lives on .data (checkout's
    // apiErrorData reader) instead of a hand-parsed body.
    expect(loyaltyPage).toMatch(
      /if \(envelope && envelope\.code !== ErrorCode\.IDEMPOTENCY_IN_FLIGHT\) clearStoredConvertKey\(\);/,
    );
    expect(read("src/components/loyalty/ConvertPointsCard.tsx")).toMatch(
      /disabled=\{converting \|\| !convertPoints\}/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Abort wiring on the quote / charge fetches (task c) — customFetch
//    behavioral pins (the 20 s bound the checkout CTA gate relies on).
// ─────────────────────────────────────────────────────────────────────────────

/** Response stand-in covering the customFetch surface (the resLike idiom,
 *  fuller: text() + Headers are what the client actually touches). */
function resLike(over: {
  status?: number;
  statusText?: string;
  json?: unknown;
  contentType?: string;
}): Response {
  const status = over.status ?? 200;
  const bodyText = JSON.stringify(over.json ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: over.statusText ?? "",
    headers: new Headers({ "content-type": over.contentType ?? "application/json" }),
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve(over.json ?? {}),
  } as unknown as Response;
}

/** A fetch stub that mirrors the browser's abort semantics: rejects with the
 *  signal's reason the moment the (effective) signal aborts. */
function neverResolvingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("test stub expects a signal");
        signal.addEventListener("abort", () => {
          const reason = (signal as AbortSignal & { reason?: unknown }).reason;
          reject(
            reason instanceof Error
              ? reason
              : new DOMException("This operation was aborted", "AbortError"),
          );
        });
      }),
  );
}

describe("R-140-o C — abort wiring on the money fetches (task c)", () => {
  it("the default request budget is the documented 20 s (the bound the checkout re-quote CTA gate cites)", () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(20_000);
  });

  it("a timed-out fetch rejects as the canonical network-error TypeError (cause preserved) and lib/errors maps it to the Arabic generic", async () => {
    vi.stubGlobal("fetch", neverResolvingFetch());
    const error = await customFetch("/api/products/1", { timeoutMs: 25 }).then(
      () => null,
      (e: unknown) => e,
    );
    // toNetworkErrorShape: the exact browser network-failure shape every
    // existing caller mapping keys off — never a raw DOMException leak.
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe("Failed to fetch");
    expect((error as { cause?: { name?: string } }).cause?.name).toBe("TimeoutError");
    // lib/errors.ts: the money path speaks Arabic on a dead request.
    expect(getErrorMessage(error)).toBe("تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.");
  });

  it("a CALLER abort (React Query unmount cancellation) propagates UNCHANGED — never remapped to the network shape", async () => {
    vi.stubGlobal("fetch", neverResolvingFetch());
    const controller = new AbortController();
    const pending = customFetch("/api/products/1", {
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    controller.abort();
    const error = await pending.then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as DOMException)?.name).toBe("AbortError");
    expect(error).not.toBeInstanceOf(TypeError);
    expect(getErrorMessage(error)).toBe("تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.");
  });

  it("the transparent boot-gate retry re-sends the SAME Idempotency-Key + method + body (retry-safe by construction)", async () => {
    vi.useFakeTimers();
    try {
      const script: Response[] = [
        resLike({ status: 503, statusText: "Service Unavailable", json: { status: "starting" } }),
        resLike({ status: 200, json: { id: 11, status: "pending" } }),
      ];
      const calls: Array<{ headers: Headers; body?: string }> = [];
      const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
        calls.push({
          headers: new Headers(init?.headers),
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        const next = script.shift();
        if (!next) throw new Error("unexpected third fetch");
        return Promise.resolve(next);
      });
      vi.stubGlobal("fetch", fetchMock);

      // timeoutMs 0: the money POST owns no timeout here — the gate budget
      // is the only deadline (mirrors a cold-start submit).
      const pending = customFetch<{ id: number }>("/api/wallet/topups", {
        method: "POST",
        headers: { "Idempotency-Key": "intent-key-1", Authorization: "Bearer t" },
        body: JSON.stringify({ amount: 25 }),
        timeoutMs: 0,
      });
      await vi.advanceTimersByTimeAsync(1_500); // the first boot-gate backoff
      await expect(pending).resolves.toEqual({ id: 11, status: "pending" });

      // The retry is TRANSPARENT and byte-identical: same key, same body —
      // the backend idempotency layer sees one logical attempt.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(calls[0]?.headers.get("idempotency-key")).toBe("intent-key-1");
      expect(calls[1]?.headers.get("idempotency-key")).toBe("intent-key-1");
      expect(calls[0]?.body).toBe(JSON.stringify({ amount: 25 }));
      expect(calls[1]?.body).toBe(JSON.stringify({ amount: 25 }));
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Socket resync key alignment (task d) — real QueryClient, real generated
//    keys, fake socket (the use-socket-topup-dedupe harness idiom).
// ─────────────────────────────────────────────────────────────────────────────

interface FakeSocket {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  fire: (event: string, arg?: unknown) => void;
}

function fakeSocket(): FakeSocket {
  const handlers = new Map<string, (arg?: unknown) => void>();
  return {
    on: vi.fn((event: string, fn: (arg?: unknown) => void) => {
      handlers.set(event, fn);
    }),
    off: vi.fn(),
    fire: (event: string, arg?: unknown) => {
      handlers.get(event)?.(arg);
    },
  };
}

interface ProbeSpec {
  queryKey: readonly unknown[];
  fn: () => Promise<unknown>;
}

function MoneyProbe(props: ProbeSpec) {
  useQuery({ queryKey: props.queryKey, queryFn: props.fn });
  return null;
}

function SocketHarness() {
  useSocket(42);
  return null;
}

function renderProbes(probes: ProbeSpec[], withSocket: boolean): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const children: ReactNode[] = probes.map((p) =>
    createElement(MoneyProbe, {
      key: JSON.stringify(p.queryKey),
      queryKey: p.queryKey,
      fn: p.fn,
    }),
  );
  if (withSocket) {
    children.push(createElement(SocketHarness, { key: "socket" }));
  }
  render(createElement(QueryClientProvider, { client }, children));
  return client;
}

describe("R-140-o D — topup-updated → wallet query invalidation: keys align + dedup (task d)", () => {
  let socket: FakeSocket;

  beforeEach(() => {
    connectSocketMock.mockReset();
    toastMock.mockClear();
    socket = fakeSocket();
    connectSocketMock.mockResolvedValue(socket);
  });

  it("a topup decision refetches the wallet, topups, STATEMENT and me families — under the exact generated keys (R-140-o: me + ledger joined)", async () => {
    const counts = new Map<string, number>();
    const bump = (id: string) => () => {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      return Promise.resolve({ id });
    };
    renderProbes(
      [
        { queryKey: getGetWalletQueryKey(), fn: bump("wallet") },
        { queryKey: getListTopupsQueryKey(), fn: bump("topups") },
        { queryKey: getGetWalletLedgerQueryKey(), fn: bump("ledger") },
        { queryKey: getGetMeQueryKey(), fn: bump("me") },
        // controls: the catalog + order-detail families are NOT part of the
        // topup event's set (anti-refetch-storm policy; orders ride their
        // own order-updated handler).
        { queryKey: ["/api/products"], fn: bump("catalog") },
        { queryKey: ["/api/orders/SNDB-TEST"], fn: bump("orders") },
      ],
      true,
    );
    await waitFor(() => expect(counts.get("wallet")).toBe(1));

    act(() => {
      socket.fire("topup-updated", { id: 501, amount: 50, status: "approved" });
    });

    await waitFor(() => {
      expect(counts.get("wallet")).toBe(2);
      expect(counts.get("topups")).toBe(2);
      expect(counts.get("ledger")).toBe(2);
      expect(counts.get("me")).toBe(2);
    });
    expect(counts.get("catalog")).toBe(1);
    expect(counts.get("orders")).toBe(1);
  });

  it("TanStack supersede semantics: an invalidation racing a concurrently refetching query CANCELS the in-flight fetch and issues ONE fresh request — the stale response can never land", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let calls = 0;
    const fn = () => {
      calls += 1;
      // call 1 = the mount fetch; every later call waits on the shared gate
      // so the "3 s poll" response stays in flight when the event lands.
      return calls === 1 ? Promise.resolve({ v: 1 }) : gate.then(() => ({ v: calls }));
    };
    const client = renderProbes([{ queryKey: getListTopupsQueryKey(), fn }], true);
    await waitFor(() => expect(calls).toBe(1));

    // A manual refetch starts and is HELD in flight (the 3 s poll's twin).
    await act(async () => {
      void client.refetchQueries({ queryKey: getListTopupsQueryKey() });
      await Promise.resolve();
    });
    expect(calls).toBe(2); // in flight now

    // The socket event lands WHILE that fetch is running. TanStack v5's
    // refetchQueries defaults cancelRefetch:true → Query.fetch CANCELS the
    // in-flight request (silent revert) and starts a fresh one: exactly ONE
    // new queryFn call (never a duplicate concurrent request, never an
    // observer-driven second fan-out), and the pre-event response is
    // discarded before it can land.
    await act(async () => {
      socket.fire("topup-updated", { id: 502, amount: 75, status: "approved" });
      await Promise.resolve();
    });
    expect(calls).toBe(3); // superseded, not duplicated

    release();
    await act(async () => {
      await Promise.resolve();
    });
    // The data that lands is the POST-event fetch's — the held (stale)
    // in-flight response never reaches the cache.
    await waitFor(() => expect(client.getQueryData(getListTopupsQueryKey())).toEqual({ v: 3 }));
  });

  it("invalidateStorefrontTransactionalFamilies covers the ONE storefront money set (orders sweep + wallet/topups/ledger/me + notifications)", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateStorefrontTransactionalFamilies(client);
    // R153: 5 → 6 — the paged notifications-history family joined the
    // reconnect-resync set (the /notifications page holds no socket of
    // its own; without this entry a reconnect left its rows stale).
    // R187 (B-F3): 6 → 7 — the loyalty family joined (the /loyalty and
    // /referrals pages hold no socket of their own either; the R153
    // rationale finally covers them).
    expect(spy).toHaveBeenCalledTimes(7);
    const keys = spy.mock.calls
      .map((call) => call[0])
      .filter((arg): arg is { queryKey: unknown[] } => Boolean(arg?.queryKey))
      .map((arg) => JSON.stringify(arg.queryKey));
    expect(keys).toContain(JSON.stringify(["/api/wallet"]));
    expect(keys).toContain(JSON.stringify(["/api/wallet/topups"]));
    expect(keys).toContain(JSON.stringify(["/api/wallet/ledger"]));
    expect(keys).toContain(JSON.stringify(["/api/auth/me"]));
    expect(keys).toContain(JSON.stringify(["/api/notifications"]));
    // R187 (B-F3): the loyalty family (the shared ["loyalty", …] prefix
    // key the loyalty/referrals pages ride).
    expect(keys).toContain(JSON.stringify(["loyalty"]));
    // The orders leg is the PREDICATE sweep (list variants + every open
    // detail page) — and it never touches the catalog family.
    const predicateCall = spy.mock.calls
      .map((call) => call[0])
      .find((arg) => typeof arg?.predicate === "function");
    expect(predicateCall).toBeTruthy();
    const predicate = predicateCall?.predicate as unknown as (q: {
      queryKey: unknown[];
    }) => boolean;
    expect(predicate({ queryKey: ["/api/orders"] })).toBe(true);
    expect(predicate({ queryKey: ["/api/orders/SNDB-1234"] })).toBe(true);
    expect(predicate({ queryKey: ["/api/products", {}] })).toBe(false);
  });

  it("source parity: use-socket and socket-resync import the SAME generated key functions (one definition per family)", () => {
    const hook = read("src/hooks/useSocket.ts");
    const resync = read("src/lib/socket-resync.ts");
    for (const keyFn of [
      "getGetWalletQueryKey",
      "getListTopupsQueryKey",
      "getGetWalletLedgerQueryKey",
      "getGetMeQueryKey",
    ]) {
      expect(hook, `use-socket.ts must import ${keyFn}`).toContain(keyFn);
      expect(resync, `socket-resync.ts must import ${keyFn}`).toContain(keyFn);
    }
  });
});
