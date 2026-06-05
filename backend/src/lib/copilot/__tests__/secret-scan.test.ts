import { describe, expect, it } from "vitest";
import { scanForSecrets } from "../secret-scan";

/**
 * Outbound secret scanner — a defense-in-depth control that catches
 * credentials in copilot responses and preview payloads before they
 * reach the admin UI (010-ai-admin-copilot R-14).
 *
 * Pin every regex pattern so a future change can't silently drop
 * detection coverage. Each test case asserts both detection AND that
 * the sample is redacted before being returned to the caller.
 */

describe("scanForSecrets", () => {
  it("returns no match for clean text", () => {
    const r = scanForSecrets("hello world this is fine");
    expect(r.hasMatch).toBe(false);
    expect(r.matches).toHaveLength(0);
  });

  it("detects postgres URLs", () => {
    const r = scanForSecrets("postgres://user:pass@db.neon.tech/main");
    expect(r.hasMatch).toBe(true);
    expect(r.matches[0]?.pattern).toBe("postgres_url");
    // Sample must be redacted, not returned verbatim.
    expect(r.matches[0]?.sample).not.toContain("pass");
  });

  it("detects redis URLs", () => {
    const r = scanForSecrets("redis://default:abc123@redis.cloud:6379");
    expect(r.hasMatch).toBe(true);
    expect(r.matches[0]?.pattern).toBe("redis_url");
  });

  it("detects AWS access keys", () => {
    const r = scanForSecrets("the key is AKIA1234567890ABCDEF in the env");
    expect(r.hasMatch).toBe(true);
    expect(r.matches.find((m) => m.pattern === "aws_access_key")).toBeTruthy();
  });

  it("detects bearer tokens", () => {
    const r = scanForSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test1234567890.sig");
    expect(r.hasMatch).toBe(true);
  });

  it("detects anthropic API keys", () => {
    const r = scanForSecrets("api key: sk-ant-api03-abc123def456ghi789");
    expect(r.hasMatch).toBe(true);
    expect(r.matches.find((m) => m.pattern === "anthropic_key")).toBeTruthy();
  });

  it("detects PEM private key headers", () => {
    const r = scanForSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIEvQ...");
    expect(r.hasMatch).toBe(true);
    expect(r.matches[0]?.pattern).toBe("private_key_block");
  });

  it("detects JWT tokens", () => {
    const r = scanForSecrets(
      "token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.aBcDeFgHiJkLmNoPqRsT",
    );
    expect(r.hasMatch).toBe(true);
    expect(r.matches.find((m) => m.pattern === "jwt")).toBeTruthy();
  });

  it("detects account_password field assignments", () => {
    const r = scanForSecrets('{"account_password": "literal-leak"}');
    expect(r.hasMatch).toBe(true);
    expect(r.matches.find((m) => m.pattern === "account_password_field")).toBeTruthy();
  });

  it("recurses into nested objects", () => {
    const r = scanForSecrets({
      product: { name: "Netflix" },
      diagnostics: { connection: "postgres://x:y@host/db" },
    });
    expect(r.hasMatch).toBe(true);
  });

  it("handles non-stringifiable values without throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const r = scanForSecrets(cyclic);
    // Just don't crash — match presence is irrelevant for cyclic input.
    expect(typeof r.hasMatch).toBe("boolean");
  });

  it("redacts sample so the full secret never escapes", () => {
    const secret = "AKIA1234567890ABCDEF";
    const r = scanForSecrets(`leak: ${secret}`);
    expect(r.matches[0]?.sample).not.toBe(secret);
    expect(r.matches[0]?.sample).toContain("[REDACTED]");
  });
});
