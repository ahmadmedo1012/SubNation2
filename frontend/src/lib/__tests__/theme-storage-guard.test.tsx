/**
 * R186-6 (H-F5) — ThemeProvider's storage-blocked boot guard.
 *
 * ThemeProvider is one of the outermost boot-critical providers
 * (main.tsx mounts it above every error boundary; public/init.js guards
 * the same `sn_theme` key's read, but the React tree did not — theme.tsx
 * was the lone unguarded localStorage consumer among the boot
 * providers). A storage that THROWS on access (SecurityError in
 * storage-blocked embed contexts, legacy private-mode setItem) used to
 * escape the useState initializer in render: React 19 unmounts the
 * whole tree into a permanent blank page. The initializer now degrades
 * to the "dark" default and the effect's setItem is a silent no-op —
 * the auth/cart storage guards' sibling (audit H-F5).
 *
 * Harness: the lib/cart.test.tsx Object.defineProperty(window,
 * "localStorage", …) idiom, faked per-test.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
// JSX in this file compiles with the classic runtime (React.createElement)
// in the vitest transform, so the React default import is load-bearing
// (the cart.test.tsx note).
import React from "react";
import { ThemeProvider, useTheme } from "@/lib/theme";

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button data-testid="toggle" onClick={toggleTheme} />
    </div>
  );
}

/** Restore a plain fake storage for any test that follows (the
 *  cart.test.tsx reset idiom). */
function restoreFakeStorage() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
  });
}

describe("ThemeProvider — storage-blocked boot (R186-6 / H-F5)", () => {
  afterEach(() => {
    restoreFakeStorage();
  });

  it("a throwing READ degrades to dark and renders children (never a blank page)", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    // Children render through the initializer's dark fallback…
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    // …and the dark theme is APPLIED to the document root — the effect
    // ran past its guarded setItem; no throw escaped the render.
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("a throwing WRITE (quota/private-mode) is a silent no-op — the session still toggles", async () => {
    // Read works, write throws: the private-mode setItem profile.
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        return {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: () => {
            throw new DOMException("quota", "QuotaExceededError");
          },
          removeItem: (k: string) => store.delete(k),
          clear: () => store.clear(),
        };
      },
    });

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    // The session still toggles (the effect's setItem no-ops instead of
    // killing the effect loop).
    await act(async () => {
      screen.getByTestId("toggle").click();
    });
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});
