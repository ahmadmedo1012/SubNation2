import { describe, expect, it } from "vitest";
import { isPathAllowed } from "../admin-request-tool";

/**
 * Path-validation tests for the universal admin_request copilot tool.
 *
 * Background: the model can ask the copilot to call any /api/admin/*
 * endpoint. The route forwards the admin's bearer token, so the
 * downstream endpoint enforces its own auth — but we still ban two
 * prefixes (auth + copilot) at the tool layer to keep the model from
 * touching identity flows or recursing into itself.
 *
 * The original implementation used `startsWith("/api/admin/")` and a
 * disallow-prefix list. That's vulnerable to path traversal:
 *   - `/api/admin/../auth/login` passes both checks, but `fetch()` later
 *     normalizes the path to `/auth/login`.
 * These tests pin the fixed validator's behavior.
 */

describe("isPathAllowed", () => {
  it("accepts a normal admin path", () => {
    expect(isPathAllowed("/api/admin/products").ok).toBe(true);
    expect(isPathAllowed("/api/admin/orders/123").ok).toBe(true);
  });

  it("rejects paths outside /api/admin/", () => {
    expect(isPathAllowed("/api/products").ok).toBe(false);
    expect(isPathAllowed("/").ok).toBe(false);
    expect(isPathAllowed("").ok).toBe(false);
  });

  it("rejects auth and copilot prefixes", () => {
    expect(isPathAllowed("/api/admin/auth/login").ok).toBe(false);
    expect(isPathAllowed("/api/admin/copilot/draft").ok).toBe(false);
  });

  it("rejects path-traversal attempts", () => {
    expect(isPathAllowed("/api/admin/../auth/login").ok).toBe(false);
    expect(isPathAllowed("/api/admin/products/../auth/login").ok).toBe(false);
    expect(isPathAllowed("/api/admin/..").ok).toBe(false);
  });

  it("rejects empty path components (//)", () => {
    expect(isPathAllowed("/api/admin//orders").ok).toBe(false);
    expect(isPathAllowed("//api/admin/orders").ok).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isPathAllowed(undefined as unknown as string).ok).toBe(false);
    expect(isPathAllowed(null as unknown as string).ok).toBe(false);
    expect(isPathAllowed(42 as unknown as string).ok).toBe(false);
  });
});
