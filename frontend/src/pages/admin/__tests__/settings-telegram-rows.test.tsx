/**
 * N-4/D-1 (R142) — the integrations tab's TELEGRAM status rows against the
 * REAL GET /api/admin/settings contract.
 *
 * The backend emits EXACTLY {telegram_configured, platform_name, currency,
 * maintenance_mode} (backend/src/routes/admin/settings.ts:15-22 — pinned by
 * the backend contract suite). The rows used to read
 * `telegram_bot_set` / `telegram_chat_set` — fields the backend has NEVER
 * emitted — so both key rows permanently rendered the red «غير موجود»
 * even with TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID correctly configured
 * (the live UI bug lanes N and D both confirmed). Nothing pinned this
 * surface — this suite is the missing pin (D's missing-test census #2).
 *
 * The rows now ride the AGGREGATE telegram_configured verdict
 * (isTelegramConfigured() = token ∧ chat id both present). Direct render —
 * the component takes the settings object as a value (R137 decomposition).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TelegramStatusRows } from "@/components/admin/settings-page/TelegramStatusRows";

/** The backend's real 4-field shape. */
const REAL_SETTINGS = {
  telegram_configured: true,
  platform_name: "SubNation",
  currency: "LYD",
  maintenance_mode: false,
};

describe("TelegramStatusRows — real AdminSettings shape (N-4 / R142)", () => {
  it("a CONFIGURED integration renders تم الضبط on both key rows (was permanently «غير موجود»)", () => {
    render(<TelegramStatusRows settings={REAL_SETTINGS} />);

    // The aggregate verdict row…
    expect(screen.getByText("مفعّل ويعمل")).toBeInTheDocument();
    // …and both env-var rows agree — configured means BOTH are set.
    expect(screen.getAllByText("تم الضبط")).toHaveLength(2);
    // The pre-fix live bug: red «غير موجود» on a healthy integration.
    expect(screen.queryByText("غير موجود")).not.toBeInTheDocument();
  });

  it("an UNCONFIGURED integration renders the honest «غير موجود» on the key rows", () => {
    render(<TelegramStatusRows settings={{ ...REAL_SETTINGS, telegram_configured: false }} />);

    expect(screen.getByText("غير مفعّل")).toBeInTheDocument();
    expect(screen.getAllByText("غير موجود")).toHaveLength(2);
  });

  it("null settings (loading / failed load) never fabricates تم الضبط", () => {
    render(<TelegramStatusRows settings={null} />);

    expect(screen.getByText("غير مفعّل")).toBeInTheDocument();
    expect(screen.getAllByText("غير موجود")).toHaveLength(2);
  });
});
