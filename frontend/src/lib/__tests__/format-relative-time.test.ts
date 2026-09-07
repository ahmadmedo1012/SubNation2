/**
 * 93-C6 / F-06 (round-93 — A5 PR-1 + A11 §4) — formatRelativeTime tests.
 *
 * The old implementation had three documented defects, each locked
 * here as a regression pin:
 *
 *   1. FUTURE dates returned "الآن" (negative diff fell into the
 *      `mins < 1` branch) — every flash sale on admin/promotions
 *      rendered «ينتهي الآن» for its entire runtime (A5 PR-1 / A10-f).
 *   2. Arabic plurals collapsed to a single form: «منذ 2 د» and
 *      «منذ 5 د» instead of دقيقتين / 5 دقائق (A11 §4-1).
 *   3. Single-letter truncated units «د/س» inside prose (A11).
 *
 * The new implementation delegates to Intl.RelativeTimeFormat with
 * `ar-LY-u-nu-latn` (Latin digits per the site-wide numeral
 * convention) and `numeric: "auto"` (CLDR past wording «قبل …» /
 * future wording «خلال …» / special forms أمس، أول أمس، غدًا).
 *
 * Time is frozen at a fixed instant so bucket edges (59s, 60s, 1h,
 * 24h, 7d) are deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, formatDateShort, localDateTimeToUtcIso } from "../utils";

const FROZEN_ISO = "2026-09-07T12:00:00.000Z";

describe("formatRelativeTime — past (Arabic plural forms via Intl)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns الآن for timestamps under a minute ago (old behavior kept)", () => {
    expect(formatRelativeTime("2026-09-07T11:59:45.000Z")).toBe("الآن");
    expect(formatRelativeTime("2026-09-07T12:00:00.000Z")).toBe("الآن");
  });

  it("minute bucket: واحدة / مثنى / جمع (was «منذ N د»)", () => {
    expect(formatRelativeTime("2026-09-07T11:59:00.000Z")).toBe("قبل دقيقة واحدة");
    expect(formatRelativeTime("2026-09-07T11:58:00.000Z")).toBe("قبل دقيقتين");
    expect(formatRelativeTime("2026-09-07T11:55:00.000Z")).toBe("قبل 5 دقائق");
    // 11+ takes the singular تمييز form (CLDR many/other).
    expect(formatRelativeTime("2026-09-07T11:49:00.000Z")).toBe("قبل 11 دقيقة");
  });

  it("hour bucket: ساعة واحدة / ساعتين / 5 ساعات", () => {
    expect(formatRelativeTime("2026-09-07T11:00:00.000Z")).toBe("قبل ساعة واحدة");
    expect(formatRelativeTime("2026-09-07T10:00:00.000Z")).toBe("قبل ساعتين");
    expect(formatRelativeTime("2026-09-07T07:00:00.000Z")).toBe("قبل 5 ساعات");
    expect(formatRelativeTime("2026-09-06T13:00:00.000Z")).toBe("قبل 23 ساعة");
  });

  it("day bucket: أمس / أول أمس / قبل 5 أيام (only up to a week, then the date)", () => {
    // 24h–48h → أمس (the special CLDR form, previously hand-rolled).
    expect(formatRelativeTime("2026-09-06T12:00:00.000Z")).toBe("أمس");
    expect(formatRelativeTime("2026-09-05T12:00:00.000Z")).toBe("أول أمس");
    expect(formatRelativeTime("2026-09-02T12:00:00.000Z")).toBe("قبل 5 أيام");
    expect(formatRelativeTime("2026-09-01T12:00:00.000Z")).toBe("قبل 6 أيام");
  });

  it("falls back to the short calendar date past 7 days", () => {
    const out = formatRelativeTime("2026-08-20T12:00:00.000Z");
    // 18 days old — a calendar date (e.g. "20 أغسطس"), not a relative
    // unit phrase.
    expect(out).not.toContain("قبل");
    expect(out).not.toContain("منذ");
    expect(out).toMatch(/\d/u);
    expect(out).toContain("أغس");
  });

  it("returns الآن for unparseable dates instead of throwing", () => {
    expect(formatRelativeTime("not-a-date")).toBe("الآن");
  });
});

describe("formatRelativeTime — future (the flash-sale end-time fix)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a live sale's remaining time as «خلال …» — never «الآن» (PR-1)", () => {
    // A sale ending in 2 hours: the OLD code returned "الآن" (negative
    // diff), so promotions.tsx rendered «ينتهي الآن» for hours.
    expect(formatRelativeTime("2026-09-07T14:00:00.000Z")).toBe("خلال ساعتين");
    expect(formatRelativeTime("2026-09-07T17:00:00.000Z")).toBe("خلال 5 ساعات");
    expect(formatRelativeTime("2026-09-07T12:05:00.000Z")).toBe("خلال 5 دقائق");
    expect(formatRelativeTime("2026-09-07T12:01:00.000Z")).toBe("خلال دقيقة واحدة");
  });

  it("a target 59 seconds away still reads as a future minute, not الآن", () => {
    expect(formatRelativeTime("2026-09-07T12:00:59.000Z")).toBe("خلال دقيقة واحدة");
  });

  it("day-scale future wording (غدًا / خلال أيام)", () => {
    expect(formatRelativeTime("2026-09-08T12:00:00.000Z")).toBe("غدًا");
    expect(formatRelativeTime("2026-09-09T12:00:00.000Z")).toBe("بعد الغد");
    expect(formatRelativeTime("2026-09-12T12:00:00.000Z")).toBe("خلال 5 أيام");
  });

  it("uses LATIN digits (site numeral convention — not ٥ دقائق)", () => {
    const out = formatRelativeTime("2026-09-07T11:55:00.000Z"); // قبل 5 دقائق
    expect(out).toContain("5");
    expect(out).not.toMatch(/[٠-٩]/u);
  });
});

describe("formatDateShort — inherits the future-aware behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("inside 48h delegates to formatRelativeTime (both directions)", () => {
    expect(formatDateShort("2026-09-07T14:00:00.000Z")).toBe("خلال ساعتين");
    expect(formatDateShort("2026-09-07T10:00:00.000Z")).toBe("قبل ساعتين");
  });
});

describe("localDateTimeToUtcIso — shared TZ helper (A5 C-2, for 93-C7 coupons)", () => {
  it("converts a naive datetime-local value to a real UTC instant", () => {
    const naive = "2026-09-07T23:59";
    const iso = localDateTimeToUtcIso(naive);
    expect(iso).not.toBeNull();
    expect(iso).toMatch(/Z$/);
    // Both parse in the SAME (browser) zone → identical instant: the
    // helper must not shift the operator's intended wall-clock.
    expect(new Date(iso!).getTime()).toBe(new Date(naive).getTime());
  });

  it("returns null for empty / unparseable input (caller validates)", () => {
    expect(localDateTimeToUtcIso("")).toBeNull();
    expect(localDateTimeToUtcIso("   ")).toBeNull();
    expect(localDateTimeToUtcIso("not-a-date")).toBeNull();
  });
});
