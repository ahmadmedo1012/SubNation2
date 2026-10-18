/**
 * R155 — the OIDC reason-code mapping battery for AuthErrorBanner.
 *
 * Production context: the R154 OIDC flow redirects the browser to
 * /login?error=<reason> with one of five flow-specific reasons
 * (oidc_state / oidc_token_exchange / oidc_missing_id_token /
 * oidc_invalid_token / misconfigured_origin) plus the NEW
 * oidc_invalid_client (Telegram rejected the BotFather Client ID/Secret
 * pair — surfaced from the live-verified 200 + {"error":"invalid_client"}
 * body) and Telegram's own forwarded codes (access_denied). NONE of these
 * had a mapping — every OIDC failure rendered the same generic
 * «حدث خطأ غير متوقع. حاول مرة أخرى.» fallback, which made the
 * production failure undiagnosable (the R155 incident: an
 * operator-fixable credential rejection was indistinguishable from any
 * other failure).
 *
 * This battery pins:
 *   • every flow reason renders its OWN distinct Arabic message (not the
 *     generic fallback and not each other's copy);
 *   • the tone ladder (user-fixable → warning/info, hard failures → error);
 *   • Telegram's forwarded access_denied renders the friendly cancel copy
 *     (the standard OAuth denial code), not a red error;
 *   • the generic fallback still owns genuinely unknown codes.
 */

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/login");
});

function renderWithErrorCode(code: string): HTMLElement {
  window.history.pushState({}, "", `/login?error=${encodeURIComponent(code)}`);
  render(<AuthErrorBanner />);
  return screen.getByRole("alert");
}

describe("R155 — AuthErrorBanner maps every Telegram OIDC reason (no more generic wall)", () => {
  it("oidc_state — an expired/consumed flow state is its own warning, not the generic error", () => {
    const banner = renderWithErrorCode("oidc_state");
    expect(banner.textContent).toContain("انتهت صلاحية جلسة تسجيل الدخول");
    expect(banner.className).toContain("text-status-warning");
  });

  it("oidc_token_exchange — a rejected exchange is a distinct retryable error", () => {
    const banner = renderWithErrorCode("oidc_token_exchange");
    expect(banner.textContent).toContain("تعذّر إكمال تسجيل الدخول عبر Telegram");
    expect(banner.className).toContain("text-status-error");
  });

  it("oidc_invalid_client — the operator-actionable credential rejection says so", () => {
    const banner = renderWithErrorCode("oidc_invalid_client");
    expect(banner.textContent).toContain("إعداد تسجيل الدخول عبر Telegram غير صحيح");
    expect(banner.className).toContain("text-status-error");
  });

  it("oidc_missing_id_token and oidc_invalid_token are distinct failures, not each other", () => {
    const missing = renderWithErrorCode("oidc_missing_id_token");
    expect(missing.textContent).toContain("استجابة غير صالحة من Telegram");
    cleanup();
    window.history.replaceState({}, "", "/login");
    const invalid = renderWithErrorCode("oidc_invalid_token");
    expect(invalid.textContent).toContain("تعذّر التحقق من هوية Telegram");
  });

  it("misconfigured_origin — the incomplete-server-setup warning", () => {
    const banner = renderWithErrorCode("misconfigured_origin");
    expect(banner.textContent).toContain("إعداد تسجيل الدخول غير مكتمل على الخادم");
    expect(banner.className).toContain("text-status-warning");
  });

  it("access_denied — Telegram's forwarded denial renders the friendly cancel copy", () => {
    const banner = renderWithErrorCode("access_denied");
    expect(banner.textContent).toContain("تم إلغاء تسجيل الدخول");
    expect(banner.className).toContain("text-status-info");
  });

  it("a genuinely unknown code still falls back to the generic message", () => {
    const banner = renderWithErrorCode("brand_new_future_code");
    expect(banner.textContent).toContain("حدث خطأ غير متوقع. حاول مرة أخرى.");
    expect(banner.className).toContain("text-status-error");
  });

  it("no OIDC reason renders another reason's copy (the collision regression)", () => {
    const codes = [
      "oidc_state",
      "oidc_token_exchange",
      "oidc_invalid_client",
      "oidc_missing_id_token",
      "oidc_invalid_token",
      "misconfigured_origin",
    ];
    const messages: string[] = [];
    for (const code of codes) {
      const banner = renderWithErrorCode(code);
      messages.push(banner.textContent ?? "");
      cleanup();
      window.history.replaceState({}, "", "/login");
    }
    // Every mapped reason renders a DISTINCT message — the generic-wall
    // regression this round fixes is exactly N codes → 1 message.
    expect(new Set(messages).size).toBe(codes.length);
    for (const m of messages) {
      expect(m).not.toContain("حدث خطأ غير متوقع. حاول مرة أخرى.");
    }
  });
});
