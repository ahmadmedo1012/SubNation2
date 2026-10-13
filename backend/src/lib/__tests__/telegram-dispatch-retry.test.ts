import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R142 (L-1) — the telegram.ts dispatch retry/timeout/body-ok pipeline,
 * pinned at the fetch boundary.
 *
 * Every other test that touches this path (wallet-topups-telegram-card,
 * the telegram-webhook suites) mocks `globalThis.fetch` to return a bare
 * `{ok:true}` 200 — so the module's own documented reliability contract
 * (header lines 9-31 of backend/src/telegram.ts) had ZERO failing tests:
 * dropping the `body?.ok` inspection (the exact live bug R98-A6/F5
 * records in alerting.service.ts), inverting the transient
 * classification, or removing the retry_after clamp all shipped green.
 * The sibling OpenWA retry pipeline is fully tested
 * (openwa.service.test.ts) — this file closes the gap for the Telegram
 * business-notification client the same way: a scriptable fetch
 * responder + fake timers for the backoff.
 *
 * `diagnosticPing()` is the exported awaitable that exercises
 * `dispatchWithDetails` end-to-end and reports attempts/outcome, so it
 * is the observation seam used throughout.
 */

const ORIGINAL_FETCH = globalThis.fetch;
const BOT_TOKEN = "111222333:TEST-token-not-real-do-not-reuse";
const CHAT_ID = "422000001";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function installFetchMock(handler: (call: FetchCall, n: number) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call: FetchCall = { url, init };
    calls.push(call);
    return handler(call, calls.length);
  }) as unknown as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_CHAT_ID = CHAT_ID;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("telegram dispatch — retry/timeout/body-ok pipeline", () => {
  it("env unset → skip: zero fetches, structured not-configured verdict", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const calls = installFetchMock(() => jsonResponse({ ok: true }));

    const mod = await import("../../telegram");
    const result = await mod.diagnosticPing();

    expect(result.configured).toBe(false);
    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(0);
    expect(calls).toHaveLength(0); // self-guarding — no network call when unconfigured
  });

  it("200 with body ok:false → PERMANENT failure, no retry (exactly 1 fetch)", async () => {
    // The Telegram API answers 200 with {ok:false, error_code, description}
    // for class-4xx verdicts (e.g. "message is too long"). The old client
    // missed those entirely (R98-A6/F5) — this pins the body inspection.
    const calls = installFetchMock(() =>
      jsonResponse(
        { ok: false, error_code: 400, description: "Bad Request: message is too long" },
        200,
      ),
    );

    const { logger } = await import("../../lib/logger");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const mod = await import("../../telegram");
    const result = await mod.diagnosticPing();

    expect(result.configured).toBe(true);
    expect(result.delivered).toBe(false); // body-ok gate: 200 is NOT success
    expect(result.attempts).toBe(1); // permanent 4xx-class verdict → zero retries
    expect(result.errorMessage).toContain("400");
    expect(result.errorMessage).toContain("message is too long");
    expect(calls).toHaveLength(1);
    expect(errorSpy.mock.calls.some((c) => c[1] === "telegram dispatch: failure (permanent)")).toBe(
      true,
    );
  });

  it("500 then 200 → ok on attempt 2 (transient HTTP status retried once)", async () => {
    const calls = installFetchMock((_call, n) =>
      n === 1
        ? jsonResponse({ ok: false, error_code: 500, description: "boom" }, 500)
        : jsonResponse({ ok: true }),
    );

    const mod = await import("../../telegram");
    vi.useFakeTimers();
    let result: Awaited<ReturnType<typeof mod.diagnosticPing>>;
    try {
      const ping = mod.diagnosticPing();
      // No retry_after in the 500 body → the documented 1s default backoff.
      await vi.advanceTimersByTimeAsync(1_000);
      result = await ping;
    } finally {
      vi.useRealTimers();
    }

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);

    // Wire shape on the successful attempt: bot-token path + HTML parse mode.
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    const body = JSON.parse(String(calls[1]!.init?.body));
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.parse_mode).toBe("HTML");
  });

  it("429 retry_after:99 → backoff clamped to 5s, then ok on attempt 2", async () => {
    const calls = installFetchMock((_call, n) =>
      n === 1
        ? jsonResponse(
            {
              ok: false,
              error_code: 429,
              description: "Too Many Requests: retry after 99",
              parameters: { retry_after: 99 },
            },
            429,
          )
        : jsonResponse({ ok: true }),
    );

    const mod = await import("../../telegram");
    vi.useFakeTimers();
    let result: Awaited<ReturnType<typeof mod.diagnosticPing>>;
    try {
      const ping = mod.diagnosticPing();
      // 4_999ms: retry_after honoured (NOT the 1s default) and NOT clamped
      // away — a plain 1s backoff would already have fired the 2nd call.
      await vi.advanceTimersByTimeAsync(4_999);
      expect(calls).toHaveLength(1);
      // +1ms → 5_000 total: the clamp boundary (MAX_RETRY_BACKOFF_MS). An
      // UNclamped implementation would still be waiting for 99s here.
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(2);
      result = await ping;
    } finally {
      vi.useRealTimers();
    }

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("network abort then 200 → ok on attempt 2 (fetch rejection retried once)", async () => {
    const calls = installFetchMock((_call, n) => {
      if (n === 1) throw new Error("This operation was aborted");
      return jsonResponse({ ok: true });
    });

    const mod = await import("../../telegram");
    vi.useFakeTimers();
    let result: Awaited<ReturnType<typeof mod.diagnosticPing>>;
    try {
      const ping = mod.diagnosticPing();
      // Network-class failures sleep the fixed 500ms between attempts.
      await vi.advanceTimersByTimeAsync(500);
      result = await ping;
    } finally {
      vi.useRealTimers();
    }

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("500 twice → permanent failure after the single retry (attempts 2, error retained)", async () => {
    const calls = installFetchMock(() =>
      jsonResponse({ ok: false, error_code: 500, description: "gateway down" }, 500),
    );

    const mod = await import("../../telegram");
    vi.useFakeTimers();
    let result: Awaited<ReturnType<typeof mod.diagnosticPing>>;
    try {
      const ping = mod.diagnosticPing();
      await vi.advanceTimersByTimeAsync(1_000);
      result = await ping;
    } finally {
      vi.useRealTimers();
    }

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(2); // one initial + one retry — then honest failure
    expect(result.errorMessage).toContain("500");
    expect(result.errorMessage).toContain("gateway down");
    expect(calls).toHaveLength(2);
  });

  it("network failure twice → failure (attempts 2, message retained)", async () => {
    const calls = installFetchMock(() => {
      throw new Error("socket hangup (simulated)");
    });

    const mod = await import("../../telegram");
    vi.useFakeTimers();
    let result: Awaited<ReturnType<typeof mod.diagnosticPing>>;
    try {
      const ping = mod.diagnosticPing();
      await vi.advanceTimersByTimeAsync(500);
      result = await ping;
    } finally {
      vi.useRealTimers();
    }

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.errorMessage).toContain("socket hangup");
    expect(calls).toHaveLength(2);
  });
});
