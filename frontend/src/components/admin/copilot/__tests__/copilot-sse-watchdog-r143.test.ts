/**
 * R143 (L13-3) — the Copilot SSE read-idle watchdog, pinned.
 *
 * D-3 (R142) exempted the ask stream from the 20 s adminFetch budget
 * (timeoutMs: 0) but left stream-STALL unguarded: a wedged proxy or a
 * server hang between rounds kept the turn's spinner alive forever with
 * no cancel affordance — the exact class the L13 lane filed. The
 * watchdog races every read() against SSE_READ_IDLE_MS; these tests pin
 * the race's three contracts:
 *
 *   1. A stalled reader (read never settles) rejects with the honest
 *      Arabic retry message after the idle budget.
 *   2. A healthy read resolves as data — the timer is cleared, no
 *      delayed reject can fire on an already-settled race.
 *   3. The message stays Arabic retryable copy (the R123 E3 P3e
 *      stream-end idiom), never an English internals leak.
 */

import { describe, expect, it, vi } from "vitest";
import { SSE_READ_IDLE_MS, SSE_STALL_MESSAGE, readWithIdleWatchdog } from "../CopilotPanel";

function neverResolvingReader(): ReadableStreamDefaultReader<Uint8Array> {
  return {
    read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
    cancel: () => Promise.resolve(),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

function chunkReader(chunk = new Uint8Array([123])): ReadableStreamDefaultReader<Uint8Array> {
  return {
    read: vi.fn(
      async () => ({ value: chunk, done: false }) as ReadableStreamReadResult<Uint8Array>,
    ),
    cancel: () => Promise.resolve(),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

describe("R143 (L13-3) — readWithIdleWatchdog", () => {
  it("a stalled read rejects with the honest Arabic stall message after the idle budget", async () => {
    vi.useFakeTimers();
    try {
      const pending = readWithIdleWatchdog(neverResolvingReader());
      // Pre-budget: still pending (the stall has NOT yet been declared).
      const early = await Promise.race([
        pending.then(() => "settled"),
        vi.advanceTimersByTimeAsync(SSE_READ_IDLE_MS - 1000).then(() => "pending"),
      ]);
      expect(early).toBe("pending");
      // At the budget: the watchdog fires.
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).rejects.toThrow(SSE_STALL_MESSAGE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a healthy read resolves as data and clears its timer (no delayed reject)", async () => {
    vi.useFakeTimers();
    try {
      const reader = chunkReader();
      const result = await readWithIdleWatchdog(reader);
      expect(result.done).toBe(false);
      expect(result.value).toBeInstanceOf(Uint8Array);
      // advance well past the budget — nothing fires on the settled race.
      await vi.advanceTimersByTimeAsync(SSE_READ_IDLE_MS * 2);
      expect(reader.read).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the stall message is retryable Arabic copy, not an English internals leak", () => {
    expect(SSE_STALL_MESSAGE).toContain("حاول مجدداً");
    // The R123 stream-end twin is a DIFFERENT sentence — both honest,
    // but a copy-paste between the two classes would blur telemetry.
    expect(SSE_STALL_MESSAGE).toContain("توقف بث المساعد");
    expect(SSE_STALL_MESSAGE).not.toMatch(/[a-z]{4,}/);
  });

  it("the budget is the generous 120 s (progress frames keep healthy streams far below it)", () => {
    // Pinned exactly: a silent halving (60 s) would false-positive on
    // slow tool rounds; a doubling would re-open the stall window.
    expect(SSE_READ_IDLE_MS).toBe(120_000);
  });
});
