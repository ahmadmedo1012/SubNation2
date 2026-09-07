/**
 * Status-token adoption — targeted slice of the B6-P1-4 cluster.
 *
 * ~15 sites hardcode status colors (emerald/blue/amber/yellow/purple
 * Tailwind hues) instead of the shared `--status-*` tokens that
 * status-badge/statusColor already establish — raw hues are
 * dark-mode-tuned only and mis-tint in the light theme. This slice
 * covers the two highest-value component sites:
 *
 *   • NotificationBell TYPE_CONFIG (wallet/order/support/loyalty rows)
 *   • AuthErrorBanner (info/warning tones)
 *
 * plus the new `--status-purple` token (support) that the mapping
 * required. The remaining ~13 sites are documented as follow-up.
 */

import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TYPE_CONFIG } from "@/components/layout/NotificationBell";
import { AuthErrorBanner } from "@/components/AuthErrorBanner";

// Vitest's jsdom environment doesn't expose import.meta.url with a
// file: scheme — resolve from the runner cwd (always the frontend/
// package dir, both for `npx vitest run` and `pnpm --filter … test:run`).
const cssText = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

// Raw Tailwind status-ish hues that bypass the token system.
const RAW_HUE = /\b(emerald|blue|purple|yellow|amber|green|red|sky|indigo)-\d{3}\b/;

describe("NotificationBell TYPE_CONFIG — rides the --status-* tokens (B6-P1-4)", () => {
  it("maps every tinted type to a status token tuple", () => {
    expect(TYPE_CONFIG.wallet.color).toBe("text-status-success");
    expect(TYPE_CONFIG.wallet.bg).toBe("bg-status-success/10");
    expect(TYPE_CONFIG.order.color).toBe("text-status-info");
    expect(TYPE_CONFIG.support.color).toBe("text-status-purple");
    expect(TYPE_CONFIG.loyalty.color).toBe("text-status-warning");
  });

  it("contains no raw status hues in any entry", () => {
    for (const [type, cfg] of Object.entries(TYPE_CONFIG)) {
      expect(`${cfg.color} ${cfg.bg} ${cfg.border}`, `type: ${type}`).not.toMatch(RAW_HUE);
    }
  });

  it("the new --status-purple token exists in dark + light themes and @theme", () => {
    // Dark :root …
    expect(cssText).toMatch(/:root\s*\{[^}]*--status-purple:/s);
    // … and the light override …
    expect(cssText).toMatch(/\.light\s*\{[^}]*--status-purple:/s);
    // … and is exposed to Tailwind as a color.
    expect(cssText).toContain("--color-status-purple: hsl(var(--status-purple))");
  });
});

describe("AuthErrorBanner — tone palettes ride the status tokens (B6-P1-4)", () => {
  it("info tone uses --status-info, not raw blue", () => {
    window.history.pushState({}, "", "/login?error=cancelled");
    render(<AuthErrorBanner />);

    const banner = screen.getByRole("alert");
    expect(banner.className).toContain("text-status-info");
    expect(banner.className).not.toMatch(RAW_HUE);
  });

  it("warning tone uses --status-warning, not raw amber", () => {
    window.history.pushState({}, "", "/login?error=stale_auth_date");
    render(<AuthErrorBanner />);

    const banner = screen.getByRole("alert");
    expect(banner.className).toContain("text-status-warning");
    expect(banner.className).not.toMatch(RAW_HUE);
  });

  it("error tone keeps the destructive token", () => {
    window.history.pushState({}, "", "/login?error=server_error");
    render(<AuthErrorBanner />);

    const banner = screen.getByRole("alert");
    expect(banner.className).toContain("text-destructive");
    expect(banner.className).not.toMatch(RAW_HUE);
  });
});
