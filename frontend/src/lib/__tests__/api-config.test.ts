import { afterEach, describe, expect, it, vi } from "vitest";

// E-F4 (R188-7): unstub in afterEach, not at end-of-test-body — a failed
// assertion used to skip the unstub and leak the stubbed VITE_API_*
// into the rest of the worker (same idiom as boot-sentry-dsn-guard).
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("api-config", () => {
  it("normalizes the configured API origin and resolves API URLs", async () => {
    vi.stubEnv("VITE_API_BASE_URL", " https://api.example.com/// ");
    vi.stubEnv("VITE_API_URL", "https://legacy.example.com");

    vi.resetModules();
    const { apiUrl, getApiBaseUrl, getSocketUrl } = await import("../api-config");

    expect(getApiBaseUrl()).toBe("https://api.example.com");
    expect(getSocketUrl()).toBe("https://api.example.com");
    expect(apiUrl("/api/auth/probe")).toBe("https://api.example.com/api/auth/probe");
    expect(apiUrl("/assets/app.js")).toBe("https://api.example.com/assets/app.js");
  });

  it("falls back to the legacy API variable and leaves protocol-relative paths untouched", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.stubEnv("VITE_API_URL", "https://legacy.example.com/");

    vi.resetModules();
    const { apiUrl, getApiBaseUrl } = await import("../api-config");

    expect(getApiBaseUrl()).toBe("https://legacy.example.com");
    expect(apiUrl("//cdn.example.com/file.js")).toBe("//cdn.example.com/file.js");
    expect(apiUrl("relative/path")).toBe("relative/path");
  });
});
