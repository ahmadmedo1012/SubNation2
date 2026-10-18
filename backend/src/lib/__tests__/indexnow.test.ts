import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R163 — the IndexNow notification lib.
 *
 * Pins:
 *   - the key gate: unset/malformed INDEXNOW_KEY → fully inert (null key,
 *     no fetch, no route mount — indexNowConfigured false);
 *   - the submission shape: GET
 *     https://api.indexnow.org/indexnow?url=<origin-encoded>&key=<key>,
 *     fire-and-forget (never throws to the caller);
 *   - the ≥5-minute per-URL debounce (repeat pings inside the window
 *     never leave the process; a different URL pings independently);
 *   - notifyProductChanged fans out to the PDP + its category landing.
 *
 * Module-state note: the debounce map is module-level, so every test
 * takes a FRESH module via vi.resetModules + dynamic import — the
 * repeat-ping tests must not inherit a URL another test just sent.
 * APP_URL is pinned per-test (the origin the absolute URL is built from)
 * and restored after — the repo's env-hygiene convention.
 */

// Synthetic fixture — dash-separated low-entropy on purpose: a 32-char
// hex-shaped constant trips gitleaks' generic-api-key entropy rule (the
// R163 CI lesson). Still matches the documented [A-Za-z0-9-] charset.
const GOOD_KEY = "subnation-indexnow-test-key-0001";

type IndexNowModule = typeof import("../indexnow");
let indexnow: IndexNowModule;

async function freshModule(env: Record<string, string | undefined>): Promise<void> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  indexnow = (await import("../indexnow")) as IndexNowModule;
}

describe("indexNowKey / indexNowConfigured (the env gate)", () => {
  afterEach(() => {
    delete process.env.INDEXNOW_KEY;
  });

  it("null for unset, empty, and whitespace-only values", async () => {
    await freshModule({ INDEXNOW_KEY: undefined });
    expect(indexnow.indexNowKey()).toBeNull();
    expect(indexnow.indexNowConfigured()).toBe(false);
    await freshModule({ INDEXNOW_KEY: "" });
    expect(indexnow.indexNowKey()).toBeNull();
    await freshModule({ INDEXNOW_KEY: "   " });
    expect(indexnow.indexNowKey()).toBeNull();
  });

  it("null for malformed keys (length + charset per the live API's 422 contract)", async () => {
    // 7 chars — under the 8-char minimum.
    await freshModule({ INDEXNOW_KEY: "abc1234" });
    expect(indexnow.indexNowKey()).toBeNull();
    // 129 chars — over the maximum.
    await freshModule({ INDEXNOW_KEY: "a".repeat(129) });
    expect(indexnow.indexNowKey()).toBeNull();
    // Illegal character (underscore).
    await freshModule({ INDEXNOW_KEY: "bad_key_value_here" });
    expect(indexnow.indexNowKey()).toBeNull();
  });

  it("accepts a 32-char lowercase-hex key (the openssl rand -hex form)", async () => {
    await freshModule({ INDEXNOW_KEY: GOOD_KEY });
    expect(indexnow.indexNowKey()).toBe(GOOD_KEY);
    expect(indexnow.indexNowConfigured()).toBe(true);
  });

  it("accepts the full documented charset (upper, digits, dashes) at both bounds", async () => {
    await freshModule({ INDEXNOW_KEY: "ABCDEFGH" });
    expect(indexnow.indexNowKey()).toBe("ABCDEFGH");
    await freshModule({ INDEXNOW_KEY: "a".repeat(128) });
    expect(indexnow.indexNowKey()).toBe("a".repeat(128));
  });
});

describe("notifyIndexNow (submission + debounce)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await freshModule({
      INDEXNOW_KEY: GOOD_KEY,
      APP_URL: "https://indexnow-test.example",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INDEXNOW_KEY;
    delete process.env.APP_URL;
  });

  it("sends the documented single-URL GET to the shared endpoint", async () => {
    indexnow.notifyIndexNow("/product/netflix-premium");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.indexnow.org/indexnow?url=" +
        encodeURIComponent("https://indexnow-test.example/product/netflix-premium") +
        "&key=" +
        encodeURIComponent(GOOD_KEY),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("is fully inert without the key (no fetch at all)", async () => {
    await freshModule({ INDEXNOW_KEY: undefined, APP_URL: "https://indexnow-test.example" });
    indexnow.notifyIndexNow("/product/netflix-premium");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("debounces repeat pings of the SAME url inside the 5-minute window", async () => {
    indexnow.notifyIndexNow("/product/netflix-premium");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    indexnow.notifyIndexNow("/product/netflix-premium");
    indexnow.notifyIndexNow("/product/netflix-premium");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pings DIFFERENT urls independently (no cross-url debounce)", async () => {
    indexnow.notifyIndexNow("/product/netflix-premium");
    indexnow.notifyIndexNow("/category/streaming");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    const urls = calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes(encodeURIComponent("/product/netflix-premium")))).toBe(true);
    expect(urls.some((u) => u.includes(encodeURIComponent("/category/streaming")))).toBe(true);
  });

  it("never throws to the caller on a rejected fetch (fire-and-forget)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(() => indexnow.notifyIndexNow("/product/hulu")).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("treats a 202 (key validation pending) as success-class — no warn, no retry storm", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 202 });
    expect(() => indexnow.notifyIndexNow("/product/hulu")).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    indexnow.notifyIndexNow("/product/hulu");
    expect(fetchMock).toHaveBeenCalledTimes(1); // debounced, not retried
  });

  it("strips a trailing slash from APP_URL (no //product/ URLs)", async () => {
    await freshModule({ INDEXNOW_KEY: GOOD_KEY, APP_URL: "https://indexnow-test.example/" });
    indexnow.notifyIndexNow("/product/netflix-premium");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [calledUrl] = (fetchMock.mock.calls as unknown as Array<[string]>)[0] as [string];
    expect(calledUrl).not.toContain("//product/");
  });
});

describe("notifyProductChanged (the catalog-change fan-out)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await freshModule({
      INDEXNOW_KEY: GOOD_KEY,
      APP_URL: "https://indexnow-test.example",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INDEXNOW_KEY;
    delete process.env.APP_URL;
  });

  it("pings the PDP + the category landing", async () => {
    indexnow.notifyProductChanged("sling-tv", "streaming");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const urls = (fetchMock.mock.calls as unknown as Array<[string]>).map((c) => c[0]);
    expect(urls.some((u) => u.includes(encodeURIComponent("/product/sling-tv")))).toBe(true);
    expect(urls.some((u) => u.includes(encodeURIComponent("/category/streaming")))).toBe(true);
  });

  it("pings only the PDP when the category is unknown", async () => {
    indexnow.notifyProductChanged("sling-tv", null);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [calledUrl] = (fetchMock.mock.calls as unknown as Array<[string]>)[0] as [string];
    expect(calledUrl).toContain(encodeURIComponent("/product/sling-tv"));
  });
});
