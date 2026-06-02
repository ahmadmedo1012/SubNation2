/**
 * Firebase auth service — F-002 regression coverage.
 *
 * Asserts that `verifyFirebaseIdToken` forwards the caller's
 * `checkRevoked` argument to the underlying Firebase Admin SDK call.
 *
 * The original defect (security audit 004 / F-002): the function
 * declared `checkRevoked = false` as a parameter, then hardcoded
 * `auth.verifyIdToken(idToken, false)` ignoring the argument. Two
 * callers in `routes/auth.ts:359, :457` passed `true` expecting
 * revocation enforcement; Firebase silently accepted revoked tokens
 * for up to one hour.
 *
 * Spec authority: closes Finding F-002 (security.md §3) +
 * data-model.md C-04 (every Evidence Note's pathRange resolves at the
 * pinned commit — this regression test makes the proven claim
 * mechanically enforceable going forward).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Build a JWT-shaped string ≥ 100 chars so we get past the length
// guard inside verifyFirebaseIdToken without needing real signing.
// jwt.decode tolerates a missing signature, so payload-only is fine.
function makeFakeIdToken(payload: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(
    JSON.stringify({
      iss: "https://securetoken.google.com/test-project",
      aud: "test-project",
      sub: "uid-fake",
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { sign_in_provider: "google.com" },
      ...payload,
    }),
  ).toString("base64url");
  // Pad signature so total length is well over the 100-char guard.
  const sig = "fake-signature-segment-padded-to-be-long-enough-for-the-length-guard";
  return `${header}.${body}.${sig}`;
}

// Capture invocations of the Firebase Admin SDK's verifyIdToken so we
// can assert the second argument (checkRevoked) is forwarded.
type VerifyCall = { token: string; checkRevoked: boolean };
const verifyCalls: VerifyCall[] = [];

// Mock the firebase-admin module BEFORE importing the service under
// test so the SUT's `getFirebaseAdminAuth` resolves to our stub. This
// also avoids needing real Firebase credentials in CI.
vi.mock("../../lib/firebase-admin", () => {
  return {
    getFirebaseAdminAuth: () => ({
      verifyIdToken: vi.fn(async (token: string, checkRevoked?: boolean) => {
        verifyCalls.push({ token, checkRevoked: !!checkRevoked });
        return {
          uid: "uid-fake",
          aud: "test-project",
          sub: "uid-fake",
          firebase: { sign_in_provider: "google.com" },
        };
      }),
    }),
    getFirebaseAdminApp: () => ({}),
  };
});

const PREV_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

describe("verifyFirebaseIdToken — F-002 (forwards checkRevoked)", () => {
  beforeEach(() => {
    verifyCalls.length = 0;
    // Make the token's `aud` match expected project so the project-mismatch
    // guard in the SUT doesn't trip before reaching the SDK call.
    process.env.FIREBASE_PROJECT_ID = "test-project";
  });

  afterEach(() => {
    process.env.FIREBASE_PROJECT_ID = PREV_PROJECT_ID;
  });

  it("forwards checkRevoked=true to auth.verifyIdToken", async () => {
    const { verifyFirebaseIdToken } = await import("../firebase-auth.service");
    const token = makeFakeIdToken();

    await verifyFirebaseIdToken(token, true);

    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0].checkRevoked).toBe(true);
  });

  it("forwards checkRevoked=false (explicit) to auth.verifyIdToken", async () => {
    const { verifyFirebaseIdToken } = await import("../firebase-auth.service");
    const token = makeFakeIdToken();

    await verifyFirebaseIdToken(token, false);

    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0].checkRevoked).toBe(false);
  });

  it("defaults to checkRevoked=false when omitted", async () => {
    const { verifyFirebaseIdToken } = await import("../firebase-auth.service");
    const token = makeFakeIdToken();

    // Default-arg path — caller does not pass the second argument.
    await verifyFirebaseIdToken(token);

    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0].checkRevoked).toBe(false);
  });

  it("preserves caller intent across two adjacent calls with different values", async () => {
    const { verifyFirebaseIdToken } = await import("../firebase-auth.service");
    const token1 = makeFakeIdToken();
    const token2 = makeFakeIdToken();

    await verifyFirebaseIdToken(token1, true);
    await verifyFirebaseIdToken(token2, false);

    expect(verifyCalls).toHaveLength(2);
    expect(verifyCalls[0].checkRevoked).toBe(true);
    expect(verifyCalls[1].checkRevoked).toBe(false);
    // Tokens themselves forwarded verbatim — defense against accidental
    // arg-shuffling regressions.
    expect(verifyCalls[0].token).toBe(token1);
    expect(verifyCalls[1].token).toBe(token2);
  });
});
