import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * R158 (B#7) — the shared numeric env-tunable reader.
 *
 * Nine call sites used to hand-roll `Number(process.env.X)` + a silent
 * finite/positive guard, so a set-but-malformed value ("25 000", "25s")
 * was indistinguishable from unset. The reader keeps every numeric
 * semantic (each site passes its own predicate) and adds the one
 * missing signal: a warn naming the variable on the set-but-unusable
 * path. These cases pin that contract at the unit boundary.
 */

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));

vi.mock("../logger", () => ({
  logger: { warn: warnSpy },
}));

import { readEnvNumber } from "../env";

const NAME = "READENV_NUMBER_TEST_MS";

afterEach(() => {
  delete process.env[NAME];
  warnSpy.mockClear();
});

describe("R158 (B#7) readEnvNumber — the numeric env-tunable contract", () => {
  it("unset answers the fallback SILENTLY (no warn — unset is not a misconfiguration)", () => {
    delete process.env[NAME];
    expect(readEnvNumber(NAME, 25_000)).toBe(25_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("set-but-blank answers the fallback silently (the comment-out shape)", () => {
    process.env[NAME] = "";
    expect(readEnvNumber(NAME, 25_000)).toBe(25_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("set and parseable answers the parsed value", () => {
    process.env[NAME] = "8000";
    expect(readEnvNumber(NAME, 25_000)).toBe(8_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('set-but-malformed ("25 000") answers the fallback AND warns naming the variable', () => {
    process.env[NAME] = "25 000";
    expect(readEnvNumber(NAME, 25_000)).toBe(25_000);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [payload] = warnSpy.mock.calls[0] as [{ name: string }, string];
    expect(payload.name).toBe(NAME);
    expect(warnSpy.mock.calls[0][1]).toContain(NAME);
  });

  it("a value the caller's predicate rejects (0 against n > 0) warns and falls back", () => {
    process.env[NAME] = "0";
    expect(readEnvNumber(NAME, 5_000, (n) => n > 0)).toBe(5_000);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect((warnSpy.mock.calls[0][0] as { name: string }).name).toBe(NAME);
  });

  it("integer predicate: a fractional value warns and falls back (the strict-Number retirement of parseInt partial-parsing)", () => {
    process.env[NAME] = "7000.5";
    expect(readEnvNumber(NAME, 25_000, Number.isInteger)).toBe(25_000);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("integer predicate: whole values pass untouched", () => {
    process.env[NAME] = "7000";
    expect(readEnvNumber(NAME, 25_000, Number.isInteger)).toBe(7_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
