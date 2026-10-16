import { beforeEach, describe, expect, it } from "vitest";
import {
  __test,
  consumeTelegramOidcState,
  storeTelegramOidcState,
  type TelegramOidcStateValue,
} from "../telegram-oidc-states";

/**
 * R154 (P2) — the OIDC state store's single-use contract. The whole CSRF
 * + PKCE + replay defense of the modern Telegram Login flow rides on it:
 * a state that can be consumed twice (or lives past its TTL) reopens the
 * login-CSRF window the B1-1 banner documented for the legacy flow.
 */

function sampleValue(over: Partial<TelegramOidcStateValue> = {}): TelegramOidcStateValue {
  return {
    verifier: "a".repeat(64),
    nonce: "b".repeat(32),
    redirect: "/checkout",
    referralCode: "SUBNATION",
    createdAt: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  __test.resetMemoryStore();
});

describe("R154 — Telegram OIDC state store (no-Redis in-memory shape)", () => {
  it("stores then consumes a state exactly once", async () => {
    await storeTelegramOidcState("state-1", sampleValue());
    const first = await consumeTelegramOidcState("state-1");
    expect(first).not.toBeNull();
    expect(first?.verifier).toBe("a".repeat(64));
    expect(first?.nonce).toBe("b".repeat(32));
    expect(first?.redirect).toBe("/checkout");
    expect(first?.referralCode).toBe("SUBNATION");

    // Single-use: the second consumption (double callback delivery /
    // replayed redirect) finds NOTHING — the login fails closed.
    const second = await consumeTelegramOidcState("state-1");
    expect(second).toBeNull();
  });

  it("an unknown state consumes to null", async () => {
    expect(await consumeTelegramOidcState("never-issued")).toBeNull();
  });

  it("an expired state consumes to null (TTL is the hard stop)", async () => {
    // ttlSec 0 → expiry is "now" — the very next consume is expired.
    await storeTelegramOidcState("state-exp", sampleValue(), 0);
    // Ensure the expiry timestamp is strictly in the past.
    await new Promise((r) => setTimeout(r, 5));
    expect(await consumeTelegramOidcState("state-exp")).toBeNull();
  });

  it("distinct states coexist (concurrent in-flight flows)", async () => {
    await storeTelegramOidcState("state-a", sampleValue({ nonce: "nonce-a" }));
    await storeTelegramOidcState("state-b", sampleValue({ nonce: "nonce-b" }));
    const a = await consumeTelegramOidcState("state-a");
    expect(a?.nonce).toBe("nonce-a");
    const b = await consumeTelegramOidcState("state-b");
    expect(b?.nonce).toBe("nonce-b");
  });
});
