import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R143 (L14-2) — the TOTP advisory's internal catch must CAPTURE, not
 * just warn.
 *
 * `checkAdminTotpAdvisory` deliberately never throws (advisory-only — a
 * failure must never affect boot), but that contract made BOTH of its
 * outer Sentry captures dead code: cron.ts's `captureSchedulerFailure(
 * "totp_advisory", …)` and the boot one-shot chain's equivalent can only
 * fire on a throw this function never produces. A slow-growing DB failure
 * (permissions on the advisory SELECT/insert) left the weekly TOTP nudge
 * silently dead for weeks on a no-deploy instance — pino warn only, zero
 * Sentry signal — the exact observability asymmetry the R142 L-3 fix
 * closed for whatsapp-otp-prune.
 *
 * The fix under test: `captureSchedulerFailure("totp_advisory", err,
 * { trigger: "advisory" })` inside the internal catch, keeping the
 * non-throwing contract.
 *
 * Module graph fully mocked (the boot-one-shot-failure-capture shape):
 * the db select chain and both alertLogger helpers are stubs, so the
 * suite exercises ONLY the catch's capture behavior.
 */

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
  },
  adminUsersTable: {},
}));

vi.mock("../alertLogger", () => ({
  logAdminAlert: vi.fn(),
  resolveAlertsByDedupeKey: vi.fn(async () => 0),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../lib/sentry", () => ({
  captureSchedulerFailure: vi.fn(),
}));

import { checkAdminTotpAdvisory } from "../security-advisories";
import { db } from "@workspace/db";
import { captureSchedulerFailure } from "../../lib/sentry";
import { logAdminAlert } from "../alertLogger";
import { logger } from "../../lib/logger";

const selectMock = vi.mocked(db.select);
const captureSpy = vi.mocked(captureSchedulerFailure);
const warnSpy = vi.mocked(logger.warn);

/** A drizzle-shaped thenable builder that REJECTS when awaited. */
function failingSelect(err: Error): never {
  return {
    from: () => ({
      where: () => ({
        then: (_resolve: unknown, reject: (e: Error) => void) => {
          reject(err);
        },
      }),
    }),
  } as never;
}

/** A drizzle-shaped thenable builder that RESOLVES with `rows`. */
function resolvingSelect(rows: unknown[]): never {
  return {
    from: () => ({
      where: () => ({
        then: (resolve: (v: unknown) => void) => {
          resolve(rows);
        },
      }),
    }),
  } as never;
}

beforeEach(() => {
  selectMock.mockReset();
  captureSpy.mockReset();
  warnSpy.mockReset();
  vi.mocked(logAdminAlert).mockReset();
});

describe("R143 (L14-2): checkAdminTotpAdvisory captures internal failures to Sentry", () => {
  it("an advisory SELECT failure → captureSchedulerFailure('totp_advisory') fires AND the call resolves (boot unaffected)", async () => {
    const boom = new Error("permission denied for table admin_users (test)");
    selectMock.mockImplementation((() => failingSelect(boom)) as unknown as typeof selectMock);

    // The non-throwing contract must HOLD — a rejection here would take
    // down the boot one-shot chain's promise (and previously would have
    // been the only way the outer captures could ever fire).
    await expect(checkAdminTotpAdvisory()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledTimes(1);
    const [name, err, extras] = captureSpy.mock.calls[0]!;
    expect(name).toBe("totp_advisory");
    expect(err).toBe(boom);
    expect(extras).toEqual({ trigger: "advisory" });
  });

  it("control leg — a healthy pass dispatches the advisory and captures NOTHING", async () => {
    selectMock.mockImplementation((() =>
      resolvingSelect([{ id: 1, username: "root-admin" }])) as unknown as typeof selectMock);

    await expect(checkAdminTotpAdvisory()).resolves.toBeUndefined();

    expect(logAdminAlert).toHaveBeenCalledTimes(1);
    expect(captureSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
