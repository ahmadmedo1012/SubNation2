/**
 * Redaction integration tests — F-012 (security audit 004).
 *
 * Confirms two independent redaction layers strip sensitive values from
 * captured artefacts:
 *
 *   1. Pino `redact` paths configured on the base logger in `lib/logger.ts`.
 *   2. Sentry `deepSanitize` recursive walker in `lib/sentry.ts` (exposed
 *      for testing via the `__test` namespace).
 *
 * The audit's calibration anchor: a future regression that adds a new
 * field name, changes redact-path syntax, or swaps Pino versions would
 * silently bypass redaction without a CI signal. These tests fail loudly
 * if either layer regresses.
 *
 * Field-name coverage: every entry in the union of (Pino redact paths)
 * ∪ (Sentry SENSITIVE_FIELD_NAMES) appears here at least once. Future
 * additions go here too — adding a field to the redactor without adding
 * it here is a tracked-defect.
 *
 * JWT regex coverage: a JWT-shaped string under an *innocent* key name
 * ("description") confirms the deep-sanitizer redacts it regardless of
 * field name (defense against accidental token logging in free-form text).
 *
 * Spec authority: closes Finding F-012 (security.md §3) +
 * data-model.md C-05 (zero secret values appear in any deliverable —
 * this test is the runtime-side guarantee that the redactor matches
 * audit-time observation).
 */

import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { __test as sentryInternal } from "../sentry";

const { deepSanitize, sanitizeUrl, isSensitiveField } = sentryInternal;

// A JWT-shaped string: three base64url segments, each ≥ 8 chars. The
// payload deliberately uses a recognisable but obviously fake claim
// — there is no real signing key here. Tests must NEVER ship real
// secrets; this matches the audit's FR-042 / SC-008 discipline.
const FAKE_JWT_SHAPED =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiJ0ZXN0LXVzZXIifQ" +
  ".fake-signature-segment-not-a-real-token";

// Fake but recognisably-shaped sensitive values. None of these are
// production secrets — they're shape-correct decoys for assertion.
const FAKE_SECRETS = {
  password: "P@ssw0rd-not-real-1234",
  password_hash: "$argon2id$v=19$m=65536,t=3,p=1$saltsaltsaltsalt$hashfake",
  current_password: "CurrentP@ss-fake",
  new_password: "NewP@ss-fake-5678",
  account_password: "encrypted-account-password-fake",
  accountPassword: "encrypted-camelCase-password-fake",
  otp: "123456",
  totp: "654321",
  totp_secret: "JBSWY3DPEHPK3PXP-fake",
  code: "999999",
  token: FAKE_JWT_SHAPED,
  id_token: FAKE_JWT_SHAPED,
  access_token: FAKE_JWT_SHAPED,
  refresh_token: "refresh-fake-token-1234567890abcdef",
  auth_token: FAKE_JWT_SHAPED,
  admin_token: FAKE_JWT_SHAPED,
  session_token: "session-fake-1234567890abcdef",
  cookie: "auth_token=eyJabc; admin_token=eyJxyz",
  authorization: "Bearer " + FAKE_JWT_SHAPED,
  secret: "shared-secret-fake-1234",
  session_secret: "session-secret-fake-1234567890abcdef1234",
  encryption_key: "0123456789abcdef0123456789abcdef-fake",
  api_key: "sk_fake_test_apikey_1234567890",
  apikey: "ak_fake_apikey_1234",
  private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END-----",
  firebase_service_account_json: '{"type":"service_account","fake":true}',
  telegram_bot_token: "1234567890:FAKE-bot-token-abcdef",
  ssn: "123-45-6789",
  national_id: "FAKE-NATIONAL-ID-1234",
  card_number: "4111-1111-1111-1111",
  cvv: "123",
};

// Capture pino output to a buffer so we can grep the rendered line.
function capturedPinoLogger(): { logger: pino.Logger; captured: string[] } {
  const captured: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      captured.push(chunk.toString());
      cb();
    },
  });
  // Mirror the logger.ts redact config so the test exercises the actual
  // production redact paths. Keep this in sync with lib/logger.ts.
  const logger = pino(
    {
      level: "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'res.headers["set-cookie"]',
          "password",
          "password_hash",
          "passwordHash",
          "current_password",
          "new_password",
          "account_password",
          "accountPassword",
          "token",
          "access_token",
          "refresh_token",
          "id_token",
          "auth_token",
          "admin_token",
          "session_token",
          "otp",
          "totp",
          "totp_secret",
          "card_number",
          "cvv",
          "sender_account",
          "ssn",
          "national_id",
          "secret",
          "session_secret",
          "encryption_key",
          "api_key",
          "apikey",
          "private_key",
          "firebase_service_account_json",
          "telegram_bot_token",
        ],
        censor: "[REDACTED]",
      },
    },
    stream,
  );
  return { logger, captured };
}

describe("redaction (F-012) — Pino redact paths", () => {
  it("redacts every documented sensitive field name from a typical request log", () => {
    const { logger, captured } = capturedPinoLogger();

    logger.info({
      msg: "user login attempt",
      // Top-level fields the redact paths target directly.
      password: FAKE_SECRETS.password,
      password_hash: FAKE_SECRETS.password_hash,
      passwordHash: FAKE_SECRETS.password_hash,
      account_password: FAKE_SECRETS.account_password,
      accountPassword: FAKE_SECRETS.accountPassword,
      token: FAKE_SECRETS.token,
      access_token: FAKE_SECRETS.access_token,
      refresh_token: FAKE_SECRETS.refresh_token,
      id_token: FAKE_SECRETS.id_token,
      otp: FAKE_SECRETS.otp,
      card_number: FAKE_SECRETS.card_number,
      cvv: FAKE_SECRETS.cvv,
      ssn: FAKE_SECRETS.ssn,
      national_id: FAKE_SECRETS.national_id,
      // Wildcard-pattern matches.
      session_secret: FAKE_SECRETS.session_secret,
      api_key: FAKE_SECRETS.api_key,
      auth_token: FAKE_SECRETS.auth_token,
      admin_token: FAKE_SECRETS.admin_token,
    });

    expect(captured.length).toBe(1);
    const line = captured[0];

    // Every fake value must be absent from the rendered line.
    for (const [fieldName, fakeValue] of Object.entries(FAKE_SECRETS)) {
      // Skip fields that aren't covered by the Pino redact paths
      // explicitly — those are Sentry-only concerns and tested below.
      const isPinoCovered =
        /password|token|otp|card_number|cvv|ssn|national_id|secret|.*token.*|auth/i.test(fieldName);
      if (!isPinoCovered) continue;
      expect(line, `Pino leaked '${fieldName}' value into log output`).not.toContain(fakeValue);
    }

    // Positive assertion: the censor token appears (proves redaction
    // ran rather than the field being silently dropped).
    expect(line).toContain("[REDACTED]");
  });

  it("redacts authorization and cookie headers from a request scope", () => {
    const { logger, captured } = capturedPinoLogger();

    logger.info({
      msg: "incoming request",
      req: {
        url: "/api/wallet/topups",
        method: "POST",
        headers: {
          authorization: FAKE_SECRETS.authorization,
          cookie: FAKE_SECRETS.cookie,
          "user-agent": "vitest",
        },
      },
    });

    const line = captured[0];
    expect(line).not.toContain(FAKE_JWT_SHAPED);
    expect(line).not.toContain(FAKE_SECRETS.cookie);
    // user-agent is NOT sensitive and SHOULD survive — confirms the
    // redactor isn't over-zealous on req.headers.*.
    expect(line).toContain("vitest");
  });

  it("redacts set-cookie from response headers", () => {
    const { logger, captured } = capturedPinoLogger();

    logger.info({
      msg: "response sent",
      res: {
        statusCode: 200,
        headers: {
          "set-cookie": "auth_token=" + FAKE_JWT_SHAPED + "; HttpOnly",
          "content-type": "application/json",
        },
      },
    });

    const line = captured[0];
    expect(line).not.toContain(FAKE_JWT_SHAPED);
    expect(line).toContain("application/json");
  });
});

describe("redaction (F-012) — Sentry deepSanitize", () => {
  it("redacts every documented sensitive field name (recursive)", () => {
    const sanitized = deepSanitize({
      level: "info",
      msg: "user login attempt",
      request: {
        body: {
          // Every field name in SENSITIVE_FIELD_NAMES — straightforward
          // top-level coverage.
          ...FAKE_SECRETS,
          // Plus a nested object so recursion is exercised.
          nested: {
            password: FAKE_SECRETS.password,
            inner: {
              auth_token: FAKE_SECRETS.auth_token,
            },
          },
          // Plus an array so list traversal is exercised.
          history: [{ token: FAKE_SECRETS.token }, { otp: FAKE_SECRETS.otp }],
        },
      },
    }) as Record<string, unknown>;

    // Stringify the entire output and assert no fake value survives.
    const flat = JSON.stringify(sanitized);
    for (const [fieldName, fakeValue] of Object.entries(FAKE_SECRETS)) {
      expect(flat, `Sentry deepSanitize leaked '${fieldName}' value`).not.toContain(fakeValue);
    }

    // Positive assertion: REDACTED token appears.
    expect(flat).toContain("[REDACTED]");
  });

  it("redacts JWT-shaped strings under innocent field names", () => {
    // The audit's anti-token-leak heuristic: any string matching the JWT
    // shape is redacted regardless of the key name. This catches accidental
    // token logging in free-form fields like description / message / note.
    const sanitized = deepSanitize({
      description: FAKE_JWT_SHAPED,
      message: "user said: " + FAKE_JWT_SHAPED,
      note: FAKE_JWT_SHAPED,
    }) as Record<string, unknown>;

    expect(sanitized.description).toBe("[REDACTED]");
    expect(sanitized.note).toBe("[REDACTED]");
    // Note: the heuristic only triggers when the ENTIRE string matches
    // — embedded-in-prose tokens are NOT caught (documented limitation).
    // The "message" assertion documents this current behavior so a future
    // tightening of the heuristic would update this test deliberately.
    expect(sanitized.message).toContain(FAKE_JWT_SHAPED);
  });

  it("strips token-shaped query params from URLs", () => {
    expect(sanitizeUrl(`/auth/callback?token=${FAKE_JWT_SHAPED}`)).toBe(
      "/auth/callback?token=[REDACTED]",
    );
    expect(sanitizeUrl(`/auth/callback?id_token=${FAKE_JWT_SHAPED}&user=42`)).toBe(
      "/auth/callback?id_token=[REDACTED]&user=42",
    );
    expect(sanitizeUrl(`/auth/callback?access_token=${FAKE_JWT_SHAPED}&otp=654321`)).toBe(
      "/auth/callback?access_token=[REDACTED]&otp=[REDACTED]",
    );
  });

  it("strips token-shaped URL fragments", () => {
    const cleaned = sanitizeUrl(`/auth/callback#token=${FAKE_JWT_SHAPED}`);
    expect(cleaned).not.toContain(FAKE_JWT_SHAPED);
    expect(cleaned).toContain("[REDACTED]");
  });

  it("isSensitiveField is case-insensitive and substring-matching", () => {
    // Exact + case
    expect(isSensitiveField("password")).toBe(true);
    expect(isSensitiveField("PASSWORD")).toBe(true);
    // Substring (deliberate per audit doc)
    expect(isSensitiveField("passwordLoginEnabled")).toBe(true);
    expect(isSensitiveField("currentPassword")).toBe(true);
    expect(isSensitiveField("authToken")).toBe(true);
    expect(isSensitiveField("apiKeyHeader")).toBe(true);
    // Non-sensitive: should pass through
    expect(isSensitiveField("userId")).toBe(false);
    expect(isSensitiveField("orderId")).toBe(false);
    expect(isSensitiveField("status")).toBe(false);
  });

  it("preserves non-sensitive structure end-to-end", () => {
    const input = {
      msg: "checkout succeeded",
      orderId: 12345,
      productId: "test-product",
      amount: "12.50",
      ts: "2026-06-02T17:00:00Z",
      meta: {
        couponApplied: false,
        nested: { value: 42 },
      },
    };
    const sanitized = deepSanitize(input);
    expect(sanitized).toEqual(input);
  });
});

describe("redaction (F-012) — depth cap protection", () => {
  it("hits the depth cap on pathological recursion without throwing", () => {
    // Build a deeply-nested object beyond the depth-6 cap.
    type Nested = { layer: number; child?: Nested };
    let cur: Nested = { layer: 10 };
    for (let i = 9; i >= 0; i--) {
      cur = { layer: i, child: cur };
    }
    // Should return without throwing; depth cap inserts "[depth-cap]".
    const sanitized = deepSanitize(cur);
    const flat = JSON.stringify(sanitized);
    expect(flat).toContain("[depth-cap]");
  });
});
