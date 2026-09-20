import { afterEach, describe, it, expect, vi } from "vitest";
import { parseTopupCallback, replyWithStartIds } from "../../routes/telegram-webhook";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("parseTopupCallback", () => {
  it("parses approve actions", () => {
    expect(parseTopupCallback("topup_app:3")).toEqual({ action: "approve", topupId: 3 });
  });

  it("parses reject actions", () => {
    expect(parseTopupCallback("topup_rej:12345")).toEqual({ action: "reject", topupId: 12345 });
  });

  it("rejects unknown actions", () => {
    expect(parseTopupCallback("sub_app:3")).toBeNull();
    expect(parseTopupCallback("topup_del:3")).toBeNull();
  });

  it("rejects non-numeric / non-positive ids", () => {
    expect(parseTopupCallback("topup_app:abc")).toBeNull();
    expect(parseTopupCallback("topup_app:0")).toBeNull();
    expect(parseTopupCallback("topup_app:-5")).toBeNull();
  });

  it("rejects missing/malformed data", () => {
    expect(parseTopupCallback(undefined)).toBeNull();
    expect(parseTopupCallback("")).toBeNull();
    expect(parseTopupCallback("topup_app:")).toBeNull();
    expect(parseTopupCallback("just-text")).toBeNull();
  });
});

/**
 * F2 (R98-A6, 98-F5): the /start bootstrap reply used to be a raw awaited
 * fetch with NO timeout — the one Telegram call in this route outside the
 * gateway's 10 s AbortController. A slow Telegram pinned the webhook handler
 * until the server's 60 s requestTimeout destroyed the socket, and Telegram
 * re-delivered the update (their retry policy) onto the endpoint that must
 * stay cheap. The reply is now bounded by the same 10 s AbortController +
 * clearTimeout idiom as lib/telegram-gateway.ts apiCall.
 */
describe("replyWithStartIds — F2 timeout guard", () => {
  it("a hanging Telegram fetch is aborted at the 10 s timeout — the reply never blocks beyond it", async () => {
    vi.useFakeTimers();
    // Hangs forever UNLESS the request carries an abort signal that fires —
    // exactly the black-holed-socket shape the timeout must convert.
    const fetchMock = vi.fn(
      (_input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const reply = replyWithStartIds("123456:TEST-TOKEN", 111, 222);

    // Before the timeout the promise is still pending (fetch is hanging).
    let settled = false;
    void reply.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(settled).toBe(false);

    // 10 s — the AbortController fires, the hanging fetch rejects, the
    // .catch swallows it, and the helper resolves.
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(reply).resolves.toBeUndefined();

    // The request actually carried the signal (the guard, not luck).
    const signal = fetchMock.mock.calls[0]![1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  });

  it("still sends the bootstrap IDs (chat + personal) to the bot's sendMessage endpoint", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(replyWithStartIds("123456:TEST-TOKEN", 111, 222)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.telegram.org/bot123456:TEST-TOKEN/sendMessage");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.chat_id).toBe(111);
    expect(String(body.text)).toContain("111");
    expect(String(body.text)).toContain("222"); // the personal id for TELEGRAM_ADMIN_IDS
    expect(body.parse_mode).toBe("Markdown");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
