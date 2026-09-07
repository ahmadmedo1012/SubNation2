import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { REDACT_CENSOR, REDACT_PATHS } from "../logger";

/**
 * 93-A1 S7 (round-93) — nested-path redaction, built from the REAL
 * production config.
 *
 * The audit proved the old "custom" pino serializer was dead code (pino
 * applies serializers per-key; nothing logged a field named `custom`)
 * while redact.paths covered ONLY top-level names — so
 * `logger.info({ body: req.body })` leaked `id_token`, `temp_token`,
 * `link_consent_token`, `initData` and fetch-error Authorization
 * headers. That serializer is deleted; the paths below are the real
 * control.
 *
 * Unlike redaction.test.ts (which hand-mirrors the path list and can
 * drift), this file imports REDACT_PATHS from lib/logger.ts — the
 * production logger and this test share ONE source of truth. A path
 * added to logger.ts without coverage here is still exercised
 * implicitly (same array); a path REMOVED from logger.ts fails the
 * "documented nested shapes" cases below if it mattered.
 *
 * None of these values are real secrets — recognisable shape-correct
 * decoys only (FR-042 / SC-008 discipline).
 */

const FAKE_JWT_SHAPED =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiJ0ZXN0LXVzZXIifQ" +
  ".fake-signature-segment-not-a-real-token";

function capturedLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = pino(
    {
      level: "info",
      redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
    },
    stream,
  );
  return { logger, lines };
}

function lastLine(lines: string[]): string {
  expect(lines.length).toBeGreaterThan(0);
  return lines[lines.length - 1];
}

describe("config export (93-A1 S7)", () => {
  it("REDACT_PATHS is non-empty and includes the nested families", () => {
    expect(REDACT_PATHS.length).toBeGreaterThan(40);
    // The three families this fix added — presence pinned so an
    // accidental trim of the nested block fails loudly.
    for (const required of [
      "body.id_token",
      "body.temp_token",
      "body.link_consent_token",
      "body.initData",
      "req.body.password",
      "err.config.headers.authorization",
      "err.cause.config.headers.authorization",
      "initData",
      "temp_token",
      "*.id_token",
    ]) {
      expect(REDACT_PATHS, `missing redact path: ${required}`).toContain(required);
    }
  });

  it("the production censor token is [REDACTED]", () => {
    expect(REDACT_CENSOR).toBe("[REDACTED]");
  });
});

describe("nested request bodies (the S7 leak vectors)", () => {
  it("redacts auth credentials nested under body.* while non-sensitive siblings survive", () => {
    const { logger, lines } = capturedLogger();
    logger.info(
      {
        msg: "login attempt",
        body: {
          id_token: FAKE_JWT_SHAPED,
          temp_token: "temp-2fa-token-fake-1234567890",
          link_consent_token: "consent-token-fake-1234567890",
          initData: "user=%7B%22id%22%3A42%7D&hash=fake",
          password: "P@ssw0rd-not-real",
          current_password: "CurrentP@ss-fake",
          // These must SURVIVE — the redactor must not nuke whole objects.
          username: "admin",
          remember: true,
        },
      },
      "auth route",
    );
    const line = lastLine(lines);
    expect(line).not.toContain(FAKE_JWT_SHAPED);
    expect(line).not.toContain("temp-2fa-token-fake-1234567890");
    expect(line).not.toContain("consent-token-fake-1234567890");
    expect(line).not.toContain("user=%7B%22id%22%3A42%7D");
    expect(line).not.toContain("P@ssw0rd-not-real");
    expect(line).not.toContain("CurrentP@ss-fake");
    expect(line).toContain("admin");
    expect(line).toContain("true");
    // Censor marker proves redaction ran (fields not dropped).
    expect(line.match(/\[REDACTED\]/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("redacts credentials under pino-http's req.body shape", () => {
    const { logger, lines } = capturedLogger();
    logger.info({
      req: {
        method: "POST",
        url: "/api/auth/telegram/webapp",
        body: {
          initData: "auth_date=1&hash=fake",
          id_token: FAKE_JWT_SHAPED,
          password: "not-real",
        },
      },
    });
    const line = lastLine(lines);
    expect(line).not.toContain(FAKE_JWT_SHAPED);
    expect(line).not.toContain("auth_date=1&hash=fake");
    expect(line).not.toContain("not-real");
    expect(line).toContain("/api/auth/telegram/webapp");
  });
});

describe("fetch/axios error chains (93-A1 S7 residual exposure)", () => {
  it("redacts err.config.headers.authorization (axios request config)", () => {
    const { logger, lines } = capturedLogger();
    logger.info({
      err: {
        message: "Request failed with status 401",
        config: { headers: { authorization: `Bearer ${FAKE_JWT_SHAPED}`, accept: "json" } },
      },
    });
    const line = lastLine(lines);
    expect(line).not.toContain(FAKE_JWT_SHAPED);
    expect(line).toContain("Request failed with status 401");
  });

  it("redacts err.cause.config.headers.Authorization (wrapped error, capital-A spelling)", () => {
    const { logger, lines } = capturedLogger();
    logger.info({
      err: {
        message: "socket hang up",
        cause: { config: { headers: { Authorization: `Bearer ${FAKE_JWT_SHAPED}` } } },
      },
    });
    const line = lastLine(lines);
    expect(line).not.toContain(FAKE_JWT_SHAPED);
  });

  it("redacts set-cookie from an err.response.headers chain", () => {
    const { logger, lines } = capturedLogger();
    logger.info({
      err: {
        response: {
          status: 409,
          headers: { "set-cookie": `auth_token=${FAKE_JWT_SHAPED}; HttpOnly` },
        },
      },
    });
    const line = lastLine(lines);
    expect(line).not.toContain(FAKE_JWT_SHAPED);
    expect(line).toContain("409");
  });
});

describe("top-level flow credentials", () => {
  it("redacts initData / temp_token / link_consent_token at the top level", () => {
    const { logger, lines } = capturedLogger();
    logger.info({
      initData: "user=%7B%22id%22%3A42%7D&hash=fake",
      temp_token: "temp-2fa-token-fake-1234567890",
      link_consent_token: "consent-token-fake-1234567890",
      flow: "telegram-webapp",
    });
    const line = lastLine(lines);
    expect(line).not.toContain("user=%7B%22id%22%3A42%7D");
    expect(line).not.toContain("temp-2fa-token-fake-1234567890");
    expect(line).not.toContain("consent-token-fake-1234567890");
    expect(line).toContain("telegram-webapp");
  });
});

describe("one-deep leading wildcards (*.id_token family)", () => {
  it("redacts credentials nested one level deeper under ANY top-level key", () => {
    const { logger, lines } = capturedLogger();
    logger.info({
      payload: { id_token: FAKE_JWT_SHAPED },
      request: { temp_token: "temp-2fa-token-fake-1234567890" },
      auth: { initData: "auth_date=1&hash=fake" },
    });
    const line = lastLine(lines);
    expect(line).not.toContain(FAKE_JWT_SHAPED);
    expect(line).not.toContain("temp-2fa-token-fake-1234567890");
    expect(line).not.toContain("auth_date=1&hash=fake");
  });
});

describe("non-regression: the fixed top-level allowlist still works", () => {
  it("redacts the classic top-level names", () => {
    const { logger, lines } = capturedLogger();
    logger.info({
      password: "P@ssw0rd-not-real",
      token: FAKE_JWT_SHAPED,
      totp_secret: "JBSWY3DPEHPK3PXP-fake",
      api_key: "sk_fake_test_apikey_1234567890",
    });
    const line = lastLine(lines);
    expect(line).not.toContain("P@ssw0rd-not-real");
    expect(line).not.toContain(FAKE_JWT_SHAPED);
    expect(line).not.toContain("JBSWY3DPEHPK3PXP-fake");
    expect(line).not.toContain("sk_fake_test_apikey_1234567890");
  });
});
