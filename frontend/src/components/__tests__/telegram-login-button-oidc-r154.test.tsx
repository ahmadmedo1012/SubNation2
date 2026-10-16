import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";

/**
 * R154 (P2) — the Telegram button's OIDC transport switch.
 *
 * When /api/auth/providers reports `oidc_enabled`, the button navigates to
 * the backend-started Authorization Code + PKCE flow
 * (GET /api/auth/telegram/oidc/login) instead of hand-building the legacy
 * oauth.telegram.org widget URL — the state/nonce/verifier live
 * server-side, and registration never asks for a phone number. The
 * referral + guarded buy-intent redirect survive the round-trip.
 */

type MockLocation = { href: string; origin: string; search: string };
const ORIGINAL_LOCATION = window.location;

function mockLocation(search = ""): MockLocation {
  const loc: MockLocation = {
    href: "https://subnation.ly/login",
    origin: "https://subnation.ly",
    search,
  };
  // jsdom's window.location is read-only — replace the whole property
  // for the duration of the suite.
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: loc,
  });
  return loc;
}

const onError = vi.fn();

beforeAll(() => {
  mockLocation();
});

beforeEach(() => {
  onError.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("R154 — TelegramLoginButton transport switch", () => {
  it("oidc mode navigates to the backend-started OIDC flow (no client-built Telegram URL)", () => {
    const loc = mockLocation();
    render(<TelegramLoginButton botId="1234567890" oidc onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "المتابعة عبر Telegram" }));

    expect(loc.href).toBe("https://subnation.ly/api/auth/telegram/oidc/login");
    // The legacy hand-built widget URL is NOT used in OIDC mode.
    expect(loc.href).not.toContain("https://oauth.telegram.org/auth");
  });

  it("oidc mode carries ?ref= and the guarded ?redirect= through to the login endpoint", () => {
    const loc = mockLocation("?ref=subref&redirect=%2Fcheckout");
    render(<TelegramLoginButton botId="1234567890" oidc onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "المتابعة عبر Telegram" }));

    const url = new URL(loc.href);
    expect(url.pathname).toBe("/api/auth/telegram/oidc/login");
    expect(url.searchParams.get("ref")).toBe("SUBREF");
    expect(url.searchParams.get("redirect")).toBe("/checkout");
  });

  it("an external ?redirect= target is dropped (open-redirect guard)", () => {
    const loc = mockLocation("?redirect=https%3A%2F%2Fevil.example.com%2Fx");
    render(<TelegramLoginButton botId="1234567890" oidc onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "المتابعة عبر Telegram" }));

    const url = new URL(loc.href);
    expect(url.searchParams.get("redirect")).toBeNull();
  });

  it("legacy mode (oidc unset) keeps the widget redirect URL (compatibility path)", () => {
    const loc = mockLocation();
    render(<TelegramLoginButton botId="1234567890" onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "المتابعة عبر Telegram" }));

    const url = new URL(loc.href);
    expect(url.origin + url.pathname).toBe("https://oauth.telegram.org/auth");
    expect(url.searchParams.get("bot_id")).toBe("1234567890");
    expect(url.searchParams.get("return_to")).toContain("/auth/telegram-callback");
  });
});

// Restore the real jsdom location for the rest of the file's lifecycle.
afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  });
});
