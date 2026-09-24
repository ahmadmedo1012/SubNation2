/**
 * 96-F2 (R96-A4 §4.1 + §1.3E + §3.2, A6 #16/#17, A2 P2-9, A1 P1-4) +
 * 97-F5 (R97-A4 §8 / F-05 + J-1) — WhatsApp OTP sign-in hardening tests.
 *
 * Pins:
 *   1. Phone normalization (+218 / 00218 / +2180…) — mirrors the
 *      backend normalizeLibyanPhone contract (96-F2 §3.2).
 *   1b. 97-F5 (F-05): Arabic-Indic (٠-٩) and Persian (۰-۹) digits are
 *      CONVERTED to Latin — in the phone field AND the OTP extractor —
 *      instead of being deleted (the old `\D` strip emptied the field
 *      and locked the primary sign-in path for Arabic-locale users).
 *   2. Resend affordance on the code step: visible immediately,
 *      cooldown-aware «(N ث)» label with Latin digits, reuses the
 *      STORED phone, never resets the flow (96-F2 §4.1).
 *   3. Settling state (503 details.reason="whatsapp_settling" +
 *      retry_after_sec): informational banner (role=status, never
 *      role=alert), auto-retry after retry_after_sec, max 2
 *      auto-retries then a manual button (96-F2 §1.3E).
 *   3b. 97-F5 (J-1): channelStatus "failed" renders the HONEST dead-
 *      channel copy (muted info style) — NOT the misleading «قيد الربط
 *      مؤقتاً» generic hint; qr_ready/settling/ready keep their own
 *      existing hints.
 *   4. Terminology/format: «رمز التحقق» unified, Latin digits in the
 *      aria-label and countdowns («(60 ث)», M:SS), lang="en" on the
 *      WhatsApp brand badge, 16px inputs (iOS zoom), 44px micro-links,
 *      enterKeyHint="done" (A6 #16/#17, A1 P1-4, A2 P2-9, P3-1).
 *   5. Error funnel: every failure routes through getErrorMessage —
 *      the route's precise Arabic `error` beats its generic `code`.
 *   6. OTP expiry countdown from expires_at («ينتهي خلال M:SS»).
 *
 * Fake-timer notes: the cooldown effect chains 1 s timeouts (a new
 * timeout is armed only when React re-runs the effect after each
 * decrement), so multi-second advances go ONE SECOND AT A TIME. The
 * settling timer is a single timeout whose callback starts an async
 * fetch chain — drained with microtask flushes, never waitFor (which
 * polls on faked timers).
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizePhoneInput,
  toLatinDigits,
  WhatsAppPhoneSignIn,
} from "@/components/WhatsAppPhoneSignIn";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ setToken: vi.fn() }),
}));

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** 503 shape the backend (F1) emits right after a fresh pairing. */
function settlingResponse(retryAfterSec: number) {
  return jsonResponse(503, {
    error: "قناة WhatsApp غير مربوطة مؤقتاً، جاري استعادة الخدمة",
    code: "SERVICE_UNAVAILABLE",
    details: { reason: "whatsapp_settling", retry_after_sec: retryAfterSec },
  });
}

const PHONE = "0913456789";
const isoIn = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();

function renderSignIn(props: Partial<Parameters<typeof WhatsAppPhoneSignIn>[0]> = {}) {
  return render(
    <Router>
      <WhatsAppPhoneSignIn {...props} />
    </Router>,
  );
}

function openPhoneStep(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "المتابعة عبر WhatsApp" }));
  return screen.getByLabelText("رقم الهاتف");
}

function typePhone(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

/** Drains the promise continuations behind the mocked fetch (fake timers freeze macrotasks). */
async function flushAsync() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/** Advances fake time, then drains whatever the fired timers started. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flushAsync();
}

/** One second at a time so the chained cooldown effect re-arms between ticks. */
function advanceSeconds(totalSec: number) {
  for (let i = 0; i < totalSec; i++) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

/** Phone step → code step under fake timers (no waitFor — see file header). */
async function reachCodeStepFake(expiresInSec = 300) {
  fetchMock.mockResolvedValueOnce(
    jsonResponse(200, { success: true, expires_at: isoIn(expiresInSec) }),
  );
  renderSignIn();
  typePhone(openPhoneStep(), PHONE);
  fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
  await flushAsync();
  return screen.getByPlaceholderText("رمز التحقق");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Phone normalization (96-F2 §3.2)
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizePhoneInput — international prefixes mirror the backend (96-F2 §3.2)", () => {
  it.each([
    ["+218 91 345 6789", "913456789"],
    ["+218913456789", "913456789"],
    ["00218913456789", "913456789"],
    ["00218 91 345 6789", "913456789"],
    ["218913456789", "913456789"],
    ["+2180913456789", "0913456789"],
    ["0913456789", "0913456789"],
    ["913456789", "913456789"],
    ["0913456789012", "0913456789"],
    ["abc0913456789def", "0913456789"],
    ["+218", ""],
    // 97-F5 (F-05): Arabic-Indic / Persian digits CONVERT (the old
    // behavior — pinned by the previous revision of this very table —
    // deleted every digit and returned "").
    ["٩١٣٤٥٦٧٨٩", "913456789"],
    ["+٢١٨٩١٠٠٨٩٩٧٥", "910089975"],
    ["+٢١٨ ٩١ ٣٤٥ ٦٧٨٩", "913456789"],
    ["٠٩١٣٤٥٦٧٨٩", "0913456789"],
    ["۰۹۱۳۴۵۶۷۸۹", "0913456789"],
    ["+۲۱۸۹۱۰۰۸۹۹۷۵", "910089975"],
    // Mixed scripts survive the conversion too.
    ["+218٩١٣٤٥٦٧٨٩", "913456789"],
  ])("%j → %j", (raw, expected) => {
    expect(normalizePhoneInput(raw)).toBe(expected);
  });

  it("97-F5 (F-05): toLatinDigits converts both Arabic-Indic and Persian glyphs", () => {
    expect(toLatinDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toLatinDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
    expect(toLatinDigits("abc123")).toBe("abc123"); // Latin passes through
    expect(toLatinDigits("")).toBe("");
  });

  it("normalizes on change: pasting the international form lands as the local form", () => {
    renderSignIn();
    const input = openPhoneStep();
    fireEvent.change(input, { target: { value: "+218 91 345 6789" } });
    expect(input).toHaveValue("913456789");
  });

  it("97-F5 (F-05): pasting an Arabic-Indic number into the phone field normalizes correctly", () => {
    renderSignIn();
    const input = openPhoneStep();
    fireEvent.change(input, { target: { value: "+٢١٨٩١٠٠٨٩٩٧٥" } });
    expect(input).toHaveValue("910089975");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Copy / format / a11y contract (A6 #16/#17 + 96-F2 tasks 4/8/9)
// ─────────────────────────────────────────────────────────────────────────────

describe("copy & a11y contract (A6 #16/#17, A1 P1-4, A2 P2-9)", () => {
  it('wraps the Latin brand name in lang="en" on the pristine button (A6 #16)', () => {
    renderSignIn();
    const badge = screen.getByText("WhatsApp");
    expect(badge.getAttribute("lang")).toBe("en");
  });

  it("phone input: 16px (text-base) + enterKeyHint=done — no iOS focus zoom (A1 P1-4)", () => {
    renderSignIn();
    const phone = openPhoneStep();
    expect(phone.className).toContain("text-base");
    expect(phone.getAttribute("enterkeyhint")).toBe("done");
  });

  it("OTP input: 16px + enterKeyHint=done + unified «رمز التحقق» + Latin-digit aria-label (A6 #17)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, expires_at: isoIn(300) }));
    renderSignIn();
    typePhone(openPhoneStep(), PHONE);
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    const otp = await screen.findByPlaceholderText("رمز التحقق");
    expect(otp.className).toContain("text-base");
    expect(otp.getAttribute("enterkeyhint")).toBe("done");
    expect(otp).toHaveAttribute("aria-label", "رمز التحقق المكوّن من 6 أرقام");
    // Terminology is unified — the old «كود التحقق» must not resurface.
    expect(otp.getAttribute("placeholder")).not.toContain("كود");
  });

  it("micro-links «تراجع» / «تغيير الرقم» are 44px touch targets (A2 P2-9)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, expires_at: isoIn(300) }));
    renderSignIn();
    const back = screen.getByRole("button", { name: "المتابعة عبر WhatsApp" });
    expect(back.className).toContain("h-11");
    typePhone(openPhoneStep(), PHONE);
    const retreat = screen.getByRole("button", { name: "تراجع" });
    expect(retreat.className).toContain("min-h-11");
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    await screen.findByPlaceholderText("رمز التحقق");
    const change = screen.getByRole("button", { name: "تغيير الرقم" });
    expect(change.className).toContain("min-h-11");
  });

  it("cooldown label uses Arabic ث with Latin digits — «إعادة الإرسال (30 ث)» (A6 #17)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, {
        error: "يرجى الانتظار قبل طلب رمز جديد",
        code: "INVALID_DATA",
        details: { reason: "cooldown", retry_after_sec: 30 },
      }),
    );
    renderSignIn();
    typePhone(openPhoneStep(), PHONE);
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    await screen.findByRole("button", { name: "إعادة الإرسال (30 ث)" });
    // No Latin "s" unit may resurface (the old «(60s)» copy).
    expect(screen.queryByRole("button", { name: /\(\d+s\)/ })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Honest provider hints (r95 pattern + 96-F2 settling)
// ─────────────────────────────────────────────────────────────────────────────

describe("honest provider hints under the pristine button (96-F2 §1.3E + 97-F5 J-1)", () => {
  it('shows the settling hint when whatsapp_status === "settling"', () => {
    renderSignIn({ channelStatus: "settling" });
    expect(screen.getByText(/تُهيَّأ الآن وتصبح جاهزة خلال أقل من دقيقة/)).toBeInTheDocument();
  });

  it("keeps the r95 not-paired hint for other non-ready statuses (settling/failed excluded)", () => {
    renderSignIn({ channelStatus: "qr_ready" });
    expect(screen.getByText(/قيد الربط مؤقتاً/)).toBeInTheDocument();
    expect(screen.queryByText(/تُهيَّأ الآن/)).not.toBeInTheDocument();
  });

  it('97-F5 (J-1): "failed" renders the honest dead-channel copy — muted info, NOT «قيد الربط»', () => {
    renderSignIn({ channelStatus: "failed" });

    const hint = screen.getByText(/غير مرتبطة حاليًا/);
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toContain("جارٍ إصلاحها من فريق التشغيل");
    expect(hint.textContent).toContain("استخدم Google أو Telegram");
    // R111-F2 N4: the Latin provider names are wrapped in lang="en"
    // exactly like WhatsApp two words earlier in the same sentence
    // (screen readers stop spelling them with Arabic phonemes).
    expect([...hint.querySelectorAll('span[lang="en"]')].map((s) => s.textContent)).toEqual(
      expect.arrayContaining(["Google", "Telegram"]),
    );
    // Muted info styling (NOT the destructive error style) + never an alert.
    expect(hint.className).toContain("text-muted-foreground");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The misleading «قيد الربط مؤقتاً» copy must NOT co-render for failed.
    expect(screen.queryByText(/قيد الربط مؤقتاً/)).not.toBeInTheDocument();
  });

  it("shows no hint when the channel is ready", () => {
    renderSignIn({ channelStatus: "ready" });
    expect(screen.queryByText(/قيد الربط|تُهيَّأ|غير مرتبطة/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Resend affordance on the code step (96-F2 §4.1)
// ─────────────────────────────────────────────────────────────────────────────

describe("resend affordance on the code step (96-F2 §4.1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("appears with the countdown, frees up after 60 s, resends the STORED phone, re-arms the cooldown", async () => {
    await reachCodeStepFake();

    const cooling = screen.getByRole("button", {
      name: "لم يصلك الرمز؟ إعادة الإرسال (60 ث)",
    });
    expect(cooling).toBeDisabled();

    advanceSeconds(60);

    const free = screen.getByRole("button", { name: "لم يصلك الرمز؟ إعادة الإرسال" });
    expect(free).toBeEnabled();

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, expires_at: isoIn(300) }));
    fireEvent.click(free);
    await flushAsync();

    // Reused the stored phone — never reset the flow.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as unknown[])[1]).toMatchObject({
      body: JSON.stringify({ phone: PHONE }),
    });
    expect(screen.getByPlaceholderText("رمز التحقق")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تغيير الرقم" })).toBeInTheDocument();
    // Cooldown re-armed for the fresh code.
    expect(
      screen.getByRole("button", { name: "لم يصلك الرمز؟ إعادة الإرسال (60 ث)" }),
    ).toBeDisabled();
  });

  it("clears a stale typed code when the fresh code is sent", async () => {
    await reachCodeStepFake();
    const otp = screen.getByPlaceholderText("رمز التحقق");
    fireEvent.change(otp, { target: { value: "111111" } });
    // Auto-submit fired the verify request — fulfil it with a mismatch
    // so the code stays on screen (stale, wrong).
    await flushAsync();

    advanceSeconds(60);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, expires_at: isoIn(300) }));
    fireEvent.click(screen.getByRole("button", { name: "لم يصلك الرمز؟ إعادة الإرسال" }));
    await flushAsync();

    expect(otp).toHaveValue("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Settling state — 503 whatsapp_settling (96-F2 §1.3E)
// ─────────────────────────────────────────────────────────────────────────────

describe("settling state — 503 whatsapp_settling (96-F2 §1.3E)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("is informational (role=status, never alert), burns no cooldown, auto-retries and proceeds", async () => {
    fetchMock
      .mockResolvedValueOnce(settlingResponse(5))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, expires_at: isoIn(300) }));
    renderSignIn();
    typePhone(openPhoneStep(), PHONE);
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    await flushAsync();

    // Honest banner — NOT the destructive error style.
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("ربطت للتو");
    expect(banner.textContent).toContain("تُهيَّأ الآن");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // A settling 503 is not a rate limit — no cooldown label burned.
    expect(screen.queryByRole("button", { name: /إعادة الإرسال \(/ })).not.toBeInTheDocument();
    // Still on the phone step (no code was sent yet) + button locked
    // with the honest wait label while the auto-retry is scheduled.
    expect(screen.getByLabelText("رقم الهاتف")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "جارٍ التهيئة…" })).toBeDisabled();

    await advance(5000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByPlaceholderText("رمز التحقق")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stops after 2 auto-retries and hands control back (manual button)", async () => {
    fetchMock.mockResolvedValue(settlingResponse(3));
    renderSignIn();
    typePhone(openPhoneStep(), PHONE);
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    await flushAsync(); // call 1 → schedules auto-retry #1
    await advance(3000); // call 2 → schedules auto-retry #2
    await advance(3000); // call 3 → budget spent → manual mode
    await advance(3000); // nothing fires automatically anymore

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("أعد المحاولة");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Manual: the send button is usable again and still works.
    const send = screen.getByRole("button", { name: "إرسال" });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await flushAsync();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("never fires a ghost auto-retry after the user escapes the flow", async () => {
    fetchMock.mockResolvedValue(settlingResponse(3));
    renderSignIn();
    typePhone(openPhoneStep(), PHONE);
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    await flushAsync();

    fireEvent.click(screen.getByRole("button", { name: "تراجع" }));

    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Back to the pristine single button — flow fully reset.
    expect(screen.getByRole("button", { name: "المتابعة عبر WhatsApp" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. OTP expiry countdown (96-F2 §4.1 — expires_at)
// ─────────────────────────────────────────────────────────────────────────────

describe("OTP expiry countdown (96-F2 §4.1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("shows «ينتهي خلال M:SS» with Latin digits, then the expired note", async () => {
    await reachCodeStepFake(300);

    expect(screen.getByText("ينتهي خلال").textContent).toContain("5:00");

    await advance(61_000);
    expect(screen.getByText("ينتهي خلال").textContent).toContain("3:59");

    await advance(300_000);
    expect(screen.getByText(/انتهت صلاحية الرمز/)).toBeInTheDocument();
  });

  it("hides the countdown when the flow is reset", async () => {
    await reachCodeStepFake(300);
    fireEvent.click(screen.getByRole("button", { name: "تغيير الرقم" }));
    expect(screen.queryByText(/ينتهي خلال/)).not.toBeInTheDocument();
    expect(screen.queryByText(/انتهت صلاحية/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Error funnel — getErrorMessage everywhere (96-F2 §4.1)
// ─────────────────────────────────────────────────────────────────────────────

describe("error funnel — getErrorMessage everywhere (96-F2 §4.1)", () => {
  it("keeps the route's precise Arabic copy over its generic code (502 delivery_failed)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(502, {
        error: "تعذّر إرسال الرمز عبر WhatsApp، حاول مجدداً",
        code: "SERVICE_UNAVAILABLE",
        details: { reason: "delivery_failed" },
      }),
    );
    renderSignIn();
    typePhone(openPhoneStep(), PHONE);
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تعذّر إرسال الرمز عبر WhatsApp");
    // The generic SERVICE_UNAVAILABLE table entry must NOT win.
    expect(alert.textContent).not.toContain("الخدمة غير متاحة");
  });

  it("maps network failures to the shared Arabic network copy", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderSignIn();
    typePhone(openPhoneStep(), PHONE);
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تعذّر الاتصال بالخدمة");
  });

  it("verify errors keep the precise OTP copy over the UNAUTHORIZED code map", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, expires_at: isoIn(300) }));
    renderSignIn();
    typePhone(openPhoneStep(), PHONE);
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    const otp = await screen.findByPlaceholderText("رمز التحقق");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: "الرمز غير صحيح",
        code: "UNAUTHORIZED",
        details: { reason: "mismatch" },
      }),
    );
    fireEvent.change(otp, { target: { value: "111111" } }); // auto-submit path

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("الرمز غير صحيح");
    expect(alert.textContent).not.toContain("غير مصرح");
  });

  it("97-F5 (F-05): typing an Arabic-Indic OTP CONVERTS to Latin digits and verifies the converted code", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, expires_at: isoIn(300) }));
    renderSignIn();
    typePhone(openPhoneStep(), PHONE);
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    const otp = await screen.findByPlaceholderText("رمز التحقق");

    // The user's keyboard delivered ١٢٣٤٥٦ — the old extractor deleted
    // every glyph (empty code, «الرمز يجب أن يكون 6 أرقام").
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: "الرمز غير صحيح", code: "UNAUTHORIZED" }),
    );
    fireEvent.change(otp, { target: { value: "١٢٣٤٥٦" } });

    // The input itself holds the CONVERTED Latin digits…
    expect(otp).toHaveValue("123456");
    // …and the auto-submit fired the verify request WITH them (not with
    // an empty string, not with the Arabic glyphs).
    const verifyCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/auth/whatsapp/verify",
    );
    expect(verifyCall).toBeTruthy();
    expect(JSON.parse((verifyCall![1] as RequestInit).body as string)).toMatchObject({
      phone: PHONE,
      code: "123456",
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("الرمز غير صحيح");
  });
});
