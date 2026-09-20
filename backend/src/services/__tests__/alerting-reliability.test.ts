/**
 * 98-F5 (R98-A6) — alerting reliability fixes, pinned at the service level.
 *
 * F1 — evaluator re-entrancy guard:
 *   A fired rule's channel dispatch can legally take 25 s (10 s timeout × 2
 *   attempts + 5 s retry delay), so 3+ co-firing rules overrun the 60 s
 *   interval. setInterval used to stack concurrent evaluateRules() cycles →
 *   duplicate operator pages for the whole incident. The guard must SKIP an
 *   overlapping tick (not queue it) and resume once the cycle completes.
 *
 * F1 — bounded in-memory dedup fallback (the no-Redis production shape):
 *   getRedisClient() is null today (REDIS_URL unset) — the old isDeduped
 *   returned "not deduped" unconditionally. The fallback must keep the
 *   5-minute dedup contract: same key within TTL → deduped, different key →
 *   not, TTL expiry → re-claimable, and >128 entries evict the OLDEST claim
 *   (FIFO — mirrors telegram-replay's capped-store tests).
 *
 * F5 — Telegram HTTP 200 with body.ok:false is a FAILURE:
 *   Telegram answers 200 + ok:false ("message is too long", blocked bot) —
 *   the old response.ok-only check marked those "delivered". Now the body is
 *   parsed and !body.ok throws so the retry path + failure accounting engage.
 *
 * Fake timers drive the 60 s evaluator interval, the 5 s retry delay, and the
 * 300 s dedup TTL; global fetch is mocked at the transport boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_RULES, type AlertEvent, type AlertRuleSpec } from "../alerting.service";

const ORIGINAL_FETCH = globalThis.fetch;

/** Fresh module graph per case — isolates the module-level dedup store. */
async function importAlerting() {
  return import("../alerting.service");
}

function eventFor(dedupKey: string): AlertEvent {
  const rule = ALERT_RULES[0]!;
  return {
    rule: rule.name,
    severity: rule.severity,
    value: 1,
    threshold: 1,
    firedAt: new Date().toISOString(),
    labels: { rule: rule.name, severity: rule.severity },
    dedupKey,
    summary: "reliability test alert",
    runbookUrl: "https://example.invalid/OPERATIONS_RUNBOOK.md#api-5xx",
  };
}

/** Private-method shim — same `as unknown as` idiom as dispatchTestAlert. */
function isDedupedOf(service: unknown): (key: string) => Promise<boolean> {
  const svc = service as { isDeduped(key: string): Promise<boolean> };
  return (key: string) => svc.isDeduped(key);
}

beforeEach(() => {
  vi.resetModules();
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-TOKEN-NOT-REAL";
  process.env.TELEGRAM_CHAT_ID = "42";
  delete process.env.DISCORD_WEBHOOK_URL;
  delete process.env.GENERIC_ALERT_WEBHOOK_URL;
  delete process.env.ALERTING_ENABLED;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("F1 — evaluator re-entrancy guard", () => {
  it("skips an overlapping 60 s tick while the previous cycle is still in flight, then resumes", async () => {
    const { AlertingService } = await importAlerting();

    let hangRelease!: () => void;
    let firstRuleChecks = 0;

    // checkRuleCondition is `protected` — the subclass IS the test seam
    // (no mocking of the module's internals).
    class HangingEvaluator extends AlertingService {
      protected override async checkRuleCondition(rule: AlertRuleSpec): Promise<boolean> {
        if (rule.name === ALERT_RULES[0]!.name) {
          firstRuleChecks += 1;
          await new Promise<void>((resolve) => {
            hangRelease = resolve;
          });
        }
        return false;
      }
    }

    const svc = new HangingEvaluator();
    vi.useFakeTimers();
    try {
      svc.start();
      await vi.advanceTimersByTimeAsync(60_000); // tick 1 — hangs mid-cycle
      expect(firstRuleChecks).toBe(1);

      // Tick 2 fires at t=120 s while tick 1 is still dispatching → the
      // guard must SKIP it: no second concurrent evaluation cycle.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(firstRuleChecks).toBe(1);

      // Tick 1 completes (remaining rules resolve false immediately).
      hangRelease();
      await vi.advanceTimersByTimeAsync(0);

      // Tick 3 at t=180 s — the guard is released, evaluation resumes.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(firstRuleChecks).toBe(2);
    } finally {
      svc.stop();
    }
  });
});

describe("F1 — bounded in-memory dedup fallback (no Redis)", () => {
  it("same dedupeKey within the 300 s TTL → deduped; a different key is not", async () => {
    const { AlertingService, __test } = await importAlerting();
    __test.resetDedupMemoryStore();
    const isDeduped = isDedupedOf(new AlertingService());

    await expect(isDeduped("ruleA|hash1")).resolves.toBe(false); // first claim
    await expect(isDeduped("ruleA|hash1")).resolves.toBe(true); // replay within TTL
    await expect(isDeduped("ruleB|hash2")).resolves.toBe(false); // different key
    await expect(isDeduped("ruleA|hash1")).resolves.toBe(true); // still live
    expect(__test.dedupMemoryStoreSize()).toBe(2);
  });

  it("entries expire after the 300 s TTL and become re-claimable", async () => {
    vi.useFakeTimers();
    const { AlertingService, __test } = await importAlerting();
    __test.resetDedupMemoryStore();
    const isDeduped = isDedupedOf(new AlertingService());

    await expect(isDeduped("ttl-key")).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(300_000 + 1);
    await expect(isDeduped("ttl-key")).resolves.toBe(false); // expired → re-claim
    await expect(isDeduped("ttl-key")).resolves.toBe(true); // and dedupes again
  });

  it("store is capped at 128 entries — inserting #129 evicts the OLDEST claim (FIFO)", async () => {
    const { AlertingService, __test } = await importAlerting();
    __test.resetDedupMemoryStore();
    const isDeduped = isDedupedOf(new AlertingService());

    for (let i = 0; i < 128; i++) {
      await expect(isDeduped(`key-${i}`)).resolves.toBe(false);
    }
    expect(__test.dedupMemoryStoreSize()).toBe(128);

    // The 129th insert evicts key-0 (the oldest), not a random victim.
    await expect(isDeduped("key-128")).resolves.toBe(false);
    expect(__test.dedupMemoryStoreSize()).toBe(128);
    await expect(isDeduped("key-0")).resolves.toBe(false); // evicted → re-claimable

    // A RECENT claim is untouched by the eviction.
    await expect(isDeduped("key-127")).resolves.toBe(true);
  });

  it("the fallback engages end-to-end: a second dispatch of the same alert is deduped without Redis", async () => {
    const { AlertingService, __test } = await importAlerting();
    __test.resetDedupMemoryStore();

    globalThis.fetch = vi.fn(async () => tgResponse({ ok: true })) as unknown as typeof fetch;
    const svc = new AlertingService();
    const event = eventFor(`e2e-dedup-${Date.now()}`);

    const first = await svc.dispatchAlert(event);
    expect(first.find((r) => r.channel === "telegram")!.outcome).toBe("delivered");

    const second = await svc.dispatchAlert({ ...event });
    expect(second.find((r) => r.channel === "telegram")!.outcome).toBe("deduped");
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });
});

function tgResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("F5 — Telegram 200 ok:false is a failure, not a delivery", () => {
  it("200 with body.ok:false → counted as failed after the retry (2 attempts, ok:false in the error)", async () => {
    const { AlertingService, __test } = await importAlerting();
    __test.resetDedupMemoryStore();

    const fetchMock = vi.fn(async () =>
      tgResponse({
        ok: false,
        error_code: 400,
        description: "Bad Request: message is too long",
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new AlertingService();
    vi.useFakeTimers();
    try {
      const p = svc.dispatchAlert(eventFor(`f5-okfalse-${Date.now()}`));
      await vi.advanceTimersByTimeAsync(5_000); // retry delay
      const results = await p;

      const telegram = results.find((r) => r.channel === "telegram")!;
      expect(telegram.outcome).toBe("failed");
      expect(telegram.attempts).toBe(2);
      expect(telegram.errorMessage).toContain("ok:false");
      expect(telegram.errorMessage).toContain("message is too long");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("200 with body.ok:true → delivered on the first attempt (regression)", async () => {
    const { AlertingService, __test } = await importAlerting();
    __test.resetDedupMemoryStore();

    const fetchMock = vi.fn(async () => tgResponse({ ok: true, result: { message_id: 1 } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new AlertingService();
    const results = await svc.dispatchAlert(eventFor(`f5-oktrue-${Date.now()}`));

    const telegram = results.find((r) => r.channel === "telegram")!;
    expect(telegram.outcome).toBe("delivered");
    expect(telegram.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("200 with an unparseable body → still a failure (never counted as delivered)", async () => {
    const { AlertingService, __test } = await importAlerting();
    __test.resetDedupMemoryStore();

    const fetchMock = vi.fn(async () => new Response("not json", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new AlertingService();
    vi.useFakeTimers();
    try {
      const p = svc.dispatchAlert(eventFor(`f5-badbody-${Date.now()}`));
      await vi.advanceTimersByTimeAsync(5_000);
      const results = await p;
      expect(results.find((r) => r.channel === "telegram")!.outcome).toBe("failed");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
