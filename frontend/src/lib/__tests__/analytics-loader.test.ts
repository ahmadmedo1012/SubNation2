/**
 * Regression: the GA4 loader must push the live `arguments` object into
 * dataLayer, not a rest-parameter array.
 *
 * A real Chrome run against the 2026-10-24 production bundle showed the
 * exact failure mode: `gtag/js` loaded and dataLayer held
 * `["config","G-RKRV3ZC3MF",{...}]`, but no `/g/collect` request and no
 * `_ga` cookie appeared. Replacing the loader with the same page using
 * `dataLayer.push(arguments)` produced page_view + scroll collection.
 * gtag.js accepts only the arguments-object shape here; an array is
 * silently ignored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("GA4 loader dataLayer shape", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as { dataLayer?: unknown }).dataLayer;
    delete (window as { gtag?: unknown }).gtag;
    document.head.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as { dataLayer?: unknown }).dataLayer;
    delete (window as { gtag?: unknown }).gtag;
    document.head.innerHTML = "";
  });

  it("pushes an arguments object, not an array", async () => {
    vi.stubEnv("VITE_GA_TRACKING_ID", "G-TEST12345");
    const { initAnalytics } = await import("../analytics");
    initAnalytics();

    const layer = (window as { dataLayer?: unknown[] }).dataLayer ?? [];
    const config = layer.find((entry) => {
      try {
        return (entry as ArrayLike<unknown>)[0] === "config";
      } catch {
        return false;
      }
    });

    expect(config).toBeDefined();
    expect(Array.isArray(config)).toBe(false);
    expect((config as ArrayLike<unknown>)[0]).toBe("config");
    expect((config as ArrayLike<unknown>)[1]).toBe("G-TEST12345");

    const script = document.querySelector(
      'script[src^="https://www.googletagmanager.com/gtag/js"]',
    );
    expect(script).not.toBeNull();
  });
});
