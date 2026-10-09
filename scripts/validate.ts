#!/usr/bin/env -S npx tsx
/**
 * Phase 7 Validation Suite Runner — continuous validation checks.
 *
 * Spec: .kiro/specs/observability-seo-cwv-maturity
 *   - Requirements: R7.1–R7.7
 *   - Design:       §7 Phase 7 continuous validation
 *   - Tasks:        43.1–43.6 (this file: 43.1, 43.2, 43.3, 43.4, 43.5)
 *
 * Responsibilities:
 *   1. Run Firebase Google Sign-In E2E (Playwright)
 *   2. Run OTP login validation
 *   4. Run Redis ping + rate-limit round-trip
 *   5. Run Socket.IO connect → emit → receive on `user:{userId}`
 *   6. Run worker heartbeat freshness check
 *   7. Run admin dashboard load smoke test
 *   8. Run mobile rendering smoke test
 *   9. Run Lighthouse mobile ≥90 + desktop ≥98 on home
 *   10. Run sitemap.xml reachability over HTTPS
 *   11. Run robots.txt reachability over HTTPS
 *   12. Run Sentry synthetic 500 receipt with source-mapped frame
 *   13. Enforce 15 min total budget + per-journey timeouts
 *   14. Persist JSON report at `.kiro/specs/observability-seo-cwv-maturity/validation-runs/<ISO timestamp>.json`
 *   15. On success: append to Memory_MCP `observability-seo-cwv-maturity:validation-runs`
 *   16. On failure: append to Memory_MCP `observability-seo-cwv-maturity:validation-failures`
 *
 * Usage:
 *     pnpm tsx scripts/validate.ts             # full validation run
 *     pnpm tsx scripts/validate.ts --help      # show all options
 */

import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// ── Types ────────────────────────────────────────────────────────────────────

interface ValidationResult {
  name: string;
  status: "pass" | "fail" | "timeout";
  observed?: number | string;
  expected?: number | string;
  durationMs: number;
  error?: string;
}

interface ValidationReport {
  timestamp: string;
  commitSha: string;
  totalDurationMs: number;
  results: ValidationResult[];
  passed: boolean;
}

interface JourneyTimeouts {
  firebase: number;
  otp: number;
  redis: number;
  socket: number;
  admin: number;
  mobile: number;
  lighthouse: number;
  sitemapRobots: number;
  sentry: number;
}

// ── Configuration ────────────────────────────────────────────────────────────

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validationRunsDir = path.join(
  repoRoot,
  ".kiro",
  "specs",
  "observability-seo-cwv-maturity",
  "validation-runs",
);

const JOURNEY_TIMEOUTS: JourneyTimeouts = Object.freeze({
  firebase: 60_000,
  otp: 60_000,
  redis: 10_000,
  socket: 30_000,
  admin: 10_000,
  mobile: 10_000,
  lighthouse: 5 * 60_000,
  sitemapRobots: 10_000,
  sentry: 60_000,
});

const TOTAL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// ── Utility Functions ──────────────────────────────────────────────────────

function getCommitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim().slice(0, 7);
  } catch {
    return "unknown";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function measure<T>(
  fn: () => Promise<T> | T,
  timeoutMs: number,
): Promise<{ result: T; durationMs: number }> {
  return Promise.race([
    (async () => {
      const start = performance.now();
      const result = await fn();
      const durationMs = Math.round(performance.now() - start);
      return { result, durationMs };
    })(),
    (async () => {
      await sleep(timeoutMs);
      throw new Error(`Timeout after ${timeoutMs} ms`);
    })(),
  ]);
}

async function appendMemoryObservation(
  key: string,
  observation: Record<string, unknown>,
): Promise<void> {
  // Placeholder for Memory_MCP integration
  // In production, this would call Memory_MCP memory_add_observations
  console.log(`[memory] Would append to ${key}:`, JSON.stringify(observation, null, 2));
}

/**
 * Dispatch validation_suite_failure alert via the alerting service.
 * This is called when a validation check times out or fails.
 */
async function dispatchValidationFailureAlert(
  checkName: string,
  error: string,
  durationMs: number,
): Promise<void> {
  try {
    // Import alerting service dynamically to avoid circular dependencies
    const { alertingService } = await import("../backend/src/services/alerting.service.js");

    // Build a validation failure alert event
    const alertEvent = {
      rule: "validation_suite_failure",
      severity: "critical" as const,
      value: durationMs,
      threshold: 0,
      firedAt: new Date().toISOString(),
      labels: {
        check: checkName,
        error,
      },
      dedupKey: `validation_suite_failure|${checkName}`,
      summary: `Validation check "${checkName}" failed or timed out`,
      runbookUrl:
        "https://github.com/subnation/subnation2/blob/main/MONITORING_RUNBOOK.md#validation-suite-failure",
    };

    // Dispatch to all channels
    await alertingService["dispatchToChannel"](alertEvent, "telegram");
    await alertingService["dispatchToChannel"](alertEvent, "discord");
    await alertingService["dispatchToChannel"](alertEvent, "webhook");

    console.log(`[alerting] Dispatched validation_suite_failure for ${checkName}`);
  } catch (err) {
    console.error(
      `[alerting] Failed to dispatch validation_suite_failure for ${checkName}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ── Validation Checks ──────────────────────────────────────────────────────

/**
 * 43.2: Lighthouse mobile ≥90 + desktop ≥98 on home
 */
async function checkLighthouse(): Promise<ValidationResult> {
  const start = performance.now();

  try {
    const appOrigin = process.env.APP_ORIGIN || "https://subnation.ly";

    // Resolve the workspace-local binary. Never use bare `npx lhci`: if the
    // binary is absent, npx may download a different package named `lhci`.
    try {
      execSync("pnpm exec lhci --version", { stdio: "ignore" });
    } catch {
      return {
        name: "lighthouse",
        status: "fail",
        durationMs: Math.round(performance.now() - start),
        error: "Lighthouse CI is not available from the workspace dependency graph",
      };
    }

    const collectScores = (preset: "mobile" | "desktop"): number[] => {
      const outputDir = mkdtempSync(path.join(tmpdir(), "subnation-lhci-"));
      try {
        try {
          execFileSync(
            "pnpm",
            [
              "exec",
              "lhci",
              "collect",
              `--url=${appOrigin}`,
              "--numberOfRuns=3",
              "--settings.onlyCategories=performance",
              ...(preset === "desktop" ? ["--settings.preset=desktop"] : []),
              "--settings.chromeFlags=--no-sandbox --disable-gpu",
              `--outputDir=${outputDir}`,
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
          );
        } catch (err: unknown) {
          // LHCI writes a useful runtimeError report even when collection
          // exits non-zero. Prefer that concise, actionable reason over the
          // CLI's enormous JSON/stderr dump (especially on a suspended host).
          const report = readdirSync(outputDir).find((file) => /^lhr-.*\.json$/.test(file));
          let runtimeErrorMessage: string | undefined;
          if (report) {
            try {
              const lhr = JSON.parse(readFileSync(path.join(outputDir, report), "utf8")) as {
                runtimeError?: { code?: string; message?: string };
              };
              if (lhr.runtimeError) {
                runtimeErrorMessage = `${preset} Lighthouse runtime error: ${lhr.runtimeError.code ?? "unknown"}: ${lhr.runtimeError.message ?? "unknown"}`;
              }
            } catch {
              // Fall through to the concise process-level failure below.
            }
          }
          if (runtimeErrorMessage) throw new Error(runtimeErrorMessage, { cause: err });
          const exitCode =
            err && typeof err === "object" && "status" in err && typeof err.status === "number"
              ? ` (exit code ${err.status})`
              : "";
          throw new Error(`${preset} Lighthouse collection failed${exitCode}`, { cause: err });
        }

        const scores = readdirSync(outputDir)
          .filter((file) => /^lhr-.*\.json$/.test(file))
          .map(
            (file) =>
              JSON.parse(readFileSync(path.join(outputDir, file), "utf8")) as {
                categories?: { performance?: { score?: unknown } };
                runtimeError?: { code?: string; message?: string };
              },
          )
          .map((lhr) => {
            if (lhr.runtimeError) {
              throw new Error(
                `${lhr.runtimeError.code ?? "lighthouse_runtime_error"}: ${lhr.runtimeError.message ?? "unknown error"}`,
              );
            }
            const score = lhr.categories?.performance?.score;
            if (typeof score !== "number" || !Number.isFinite(score)) {
              throw new Error("Lighthouse output did not contain a performance score");
            }
            return Math.round(score * 100);
          });

        if (scores.length !== 3) {
          throw new Error(`Expected 3 Lighthouse reports, found ${scores.length}`);
        }
        return scores;
      } finally {
        rmSync(outputDir, { recursive: true, force: true });
      }
    };

    const mobileScores = collectScores("mobile");
    const desktopScores = collectScores("desktop");
    const median = (scores: number[]) => scores.slice().sort((a, b) => a - b)[1];
    const mobileScore = median(mobileScores);
    const desktopScore = median(desktopScores);

    const passed = mobileScore >= 90 && desktopScore >= 98;

    return {
      name: "lighthouse",
      status: passed ? "pass" : "fail",
      observed: `mobile=${mobileScore} (${mobileScores.join(",")}), desktop=${desktopScore} (${desktopScores.join(",")})`,
      expected: "mobile≥90, desktop≥98",
      durationMs: Math.round(performance.now() - start),
      error: passed
        ? undefined
        : `Lighthouse scores below thresholds: mobile=${mobileScore} (<90), desktop=${desktopScore} (<98)`,
    };
  } catch (err: unknown) {
    return {
      name: "lighthouse",
      status: "fail",
      durationMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 43.2: Sitemap reachability over HTTPS
 */
async function checkSitemap(): Promise<ValidationResult> {
  const start = performance.now();

  try {
    const appOrigin = process.env.APP_ORIGIN || "https://subnation.ly";
    const sitemapUrl = `${appOrigin}/sitemap.xml`;

    // Ensure HTTPS
    if (!sitemapUrl.startsWith("https://")) {
      throw new Error("Sitemap URL must use HTTPS");
    }

    const response = await fetch(sitemapUrl, {
      // R126-L7 (T3): `timeout` is NOT an undici RequestInit property — it
      // was silently ignored, leaving the socket unbounded past the 10 s
      // measure() race (A10 §1.5). A real abort signal kills the socket.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const body = await response.text();

    // Basic XML validation
    if (!body.includes("<?xml") && !body.includes("<urlset")) {
      throw new Error("Response is not valid XML sitemap format");
    }

    return {
      name: "sitemap",
      status: "pass",
      observed: `HTTP ${response.status}`,
      expected: "HTTP 200",
      durationMs: Math.round(performance.now() - start),
    };
  } catch (err: unknown) {
    return {
      name: "sitemap",
      status: "fail",
      durationMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 43.2: Robots.txt reachability over HTTPS
 */
async function checkRobots(): Promise<ValidationResult> {
  const start = performance.now();

  try {
    const appOrigin = process.env.APP_ORIGIN || "https://subnation.ly";
    const robotsUrl = `${appOrigin}/robots.txt`;

    // Ensure HTTPS
    if (!robotsUrl.startsWith("https://")) {
      throw new Error("Robots.txt URL must use HTTPS");
    }

    const response = await fetch(robotsUrl, {
      // R126-L7 (T3): same as the sitemap fetch — real abort signal, not
      // the dead `timeout` property undici never read.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const body = await response.text();

    // Basic validation
    if (!body.includes("User-agent") && !body.includes("Allow") && !body.includes("Disallow")) {
      throw new Error("Response is not valid robots.txt format");
    }

    return {
      name: "robots",
      status: "pass",
      observed: `HTTP ${response.status}`,
      expected: "HTTP 200",
      durationMs: Math.round(performance.now() - start),
    };
  } catch (err: unknown) {
    return {
      name: "robots",
      status: "fail",
      durationMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 43.2: Sentry synthetic 500 receipt with source-mapped frame
 */
async function checkSentry(): Promise<ValidationResult> {
  const start = performance.now();

  try {
    const sentryDsn =
      process.env.SENTRY_DSN_BACKEND ||
      process.env.SENTRY_DSN ||
      process.env.SENTRY_DSN_FRONTEND ||
      process.env.VITE_SENTRY_DSN;

    if (!sentryDsn) {
      return {
        name: "sentry",
        status: "fail",
        durationMs: Math.round(performance.now() - start),
        error: "A Sentry DSN is not configured",
      };
    }

    // Extract Sentry project ID from DSN
    const dsnMatch = sentryDsn.match(/\/([^/]+)\/?$/);
    const projectId = dsnMatch ? dsnMatch[1] : "unknown";

    // Generate a unique correlation ID for tracking
    const correlationId = crypto.randomUUID();
    const testTimestamp = new Date().toISOString();

    // In production, this would:
    // 1. Create a test error with a known correlation ID
    // 2. Wait for Sentry to receive and process it
    // 3. Query Sentry API to verify the error was received with source-mapped frames
    // 4. Verify the stack frame references the original .ts source line

    // For now, we'll use the Sentry HTTP API to send a test error
    // The actual implementation would require Sentry auth token
    const sentryAuth = process.env.SENTRY_AUTH_TOKEN;

    if (!sentryAuth) {
      console.log("[sentry] SENTRY_AUTH_TOKEN not configured, skipping synthetic error send");
      return {
        name: "sentry",
        status: "fail",
        observed: "DSN configured, synthetic event not sent",
        expected: "Error received with source-mapped frame",
        durationMs: Math.round(performance.now() - start),
        error:
          "SENTRY_AUTH_TOKEN is not configured; use the authenticated /api/admin/diagnostics/sentry-debug?mode=throw check",
      };
    }

    // Send synthetic error via Sentry HTTP API.
    // Variables are underscore-prefixed (lint convention for intentionally-
    // unused) because the actual fetch below is commented out — they're
    // scaffolding for when someone enables the live HTTP test.
    const _sentryUrl = `https://sentry.io/api/${projectId}/store/`;
    const _errorEvent = {
      event_id: crypto.randomUUID(),
      message: `Validation suite synthetic 500 - ${correlationId}`,
      timestamp: testTimestamp,
      level: "error",
      exception: {
        values: [
          {
            type: "ValidationError",
            value: `Synthetic 500 error for validation suite. Correlation ID: ${correlationId}`,
            stacktrace: {
              frames: [
                {
                  filename: "scripts/validate.ts",
                  lineno: 280, // Line number where this check is defined
                  function: "checkSentry",
                  in_app: true,
                },
                {
                  filename: "scripts/validate.ts",
                  lineno: 450, // Line number of main validation runner
                  function: "runValidation",
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
      tags: {
        validation_suite: "true",
        correlation_id: correlationId,
        check: "sentry-synthetic-500",
      },
    };

    // In production, this would actually send the request
    // const response = await fetch(_sentryUrl, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "X-Sentry-Auth": `sentry_version=7, sentry_client=lhci/0.11.0, sentry_key=${projectId}`,
    //   },
    //   body: JSON.stringify(_errorEvent),
    // });

    console.log(`[sentry] Would send synthetic error with correlation_id=${correlationId}`);

    // Preparing an event is not a receipt test. Do not report success until
    // a real event is sent and queried back with its source-mapped frame.
    return {
      name: "sentry",
      status: "fail",
      observed: `DSN configured, synthetic error prepared (correlation_id=${correlationId})`,
      expected: "Error received with source-mapped frame",
      durationMs: Math.round(performance.now() - start),
      error:
        "Synthetic event transport/receipt verification is not implemented; use the authenticated diagnostics endpoint",
    };
  } catch (err: unknown) {
    return {
      name: "sentry",
      status: "fail",
      durationMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Existing Validation Checks (from task 43.1) ─────────────────────────────

async function checkFirebase(): Promise<ValidationResult> {
  return {
    name: "firebase",
    status: "fail",
    observed: "not executed",
    expected: "Google Sign-In E2E completes",
    durationMs: 0,
    error: "Firebase E2E requires a configured Playwright test account",
  };
}

async function checkOtp(): Promise<ValidationResult> {
  return {
    name: "otp",
    status: "fail",
    observed: "not executed",
    expected: "WhatsApp OTP issue + verify completes",
    durationMs: 0,
    error: "OTP E2E requires a disposable test phone and a ready OpenWA session",
  };
}

async function checkRedis(): Promise<ValidationResult> {
  return {
    name: "redis",
    status: "fail",
    observed: "not executed",
    expected: "Redis ping and rate-limit round-trip succeed",
    durationMs: 0,
    error: "Redis journey is not wired to a live test target",
  };
}

async function checkSocket(): Promise<ValidationResult> {
  return {
    name: "socket",
    status: "fail",
    observed: "not executed",
    expected: "Socket.IO connect, emit, and receive succeed",
    durationMs: 0,
    error: "Socket.IO E2E is not wired to a live authenticated test target",
  };
}

async function checkAdmin(): Promise<ValidationResult> {
  return {
    name: "admin",
    status: "fail",
    observed: "not executed",
    expected: "Admin dashboard loads with a test admin account",
    durationMs: 0,
    error: "Admin E2E requires a disposable admin account",
  };
}

async function checkMobile(): Promise<ValidationResult> {
  return {
    name: "mobile",
    status: "fail",
    observed: "not executed",
    expected: "Home page renders at mobile viewport",
    durationMs: 0,
    error: "Mobile rendering E2E requires a configured browser runner",
  };
}

// ── Main Validation Runner ───────────────────────────────────────────────────

async function runValidation(): Promise<ValidationReport> {
  const startTime = performance.now();
  const commitSha = getCommitSha();
  const results: ValidationResult[] = [];

  const checks = [
    { name: "firebase", fn: checkFirebase, timeout: JOURNEY_TIMEOUTS.firebase },
    { name: "otp", fn: checkOtp, timeout: JOURNEY_TIMEOUTS.otp },
    { name: "redis", fn: checkRedis, timeout: JOURNEY_TIMEOUTS.redis },
    { name: "socket", fn: checkSocket, timeout: JOURNEY_TIMEOUTS.socket },
    { name: "admin", fn: checkAdmin, timeout: JOURNEY_TIMEOUTS.admin },
    { name: "mobile", fn: checkMobile, timeout: JOURNEY_TIMEOUTS.mobile },
    // 43.2 additions
    { name: "lighthouse", fn: checkLighthouse, timeout: JOURNEY_TIMEOUTS.lighthouse },
    { name: "sitemap", fn: checkSitemap, timeout: JOURNEY_TIMEOUTS.sitemapRobots },
    { name: "robots", fn: checkRobots, timeout: JOURNEY_TIMEOUTS.sitemapRobots },
    { name: "sentry", fn: checkSentry, timeout: JOURNEY_TIMEOUTS.sentry },
  ];

  for (const check of checks) {
    try {
      const { result, durationMs } = await measure(check.fn, check.timeout);
      results.push({
        ...result,
        // The runner owns the measured duration. A check must not be able to
        // report a stale or fabricated duration in the persisted report.
        name: check.name,
        durationMs,
      });
    } catch (err: unknown) {
      const durationMs = Math.round(performance.now() - startTime);
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Determine if this is a timeout or a regular failure
      const isTimeout = errorMessage.includes("Timeout");

      results.push({
        name: check.name,
        status: isTimeout ? "timeout" : "fail",
        durationMs,
        error: errorMessage,
      });

      // On timeout or failure, record :validation-failures and dispatch validation_suite_failure alert
      if (isTimeout) {
        console.log(`[validate] Check "${check.name}" timed out after ${check.timeout}ms`);

        // Record to Memory_MCP :validation-failures
        await appendMemoryObservation("observability-seo-cwv-maturity:validation-failures", {
          timestamp: new Date().toISOString(),
          check: check.name,
          observed: `timeout after ${check.timeout}ms`,
          expected: `< ${check.timeout}ms`,
          summary: `Validation check "${check.name}" timed out`,
        });

        // Dispatch validation_suite_failure alert via alerting service within 60s
        await dispatchValidationFailureAlert(check.name, errorMessage, durationMs);
      }
    }
  }

  const totalDurationMs = Math.round(performance.now() - startTime);
  const passed = results.every((r) => r.status === "pass");

  // Persist JSON report
  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    commitSha,
    totalDurationMs,
    results,
    passed,
  };

  if (!existsSync(validationRunsDir)) {
    mkdirSync(validationRunsDir, { recursive: true });
  }

  const reportPath = path.join(validationRunsDir, `${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[validate] Report saved to ${reportPath}`);

  // Persist to Memory_MCP
  if (passed) {
    await appendMemoryObservation("observability-seo-cwv-maturity:validation-runs", {
      phase: 7,
      commitSha,
      lighthouse: results.find((r) => r.name === "lighthouse")?.observed,
      p95Latency: results.reduce((acc, r) => acc + r.durationMs, 0) / results.length,
      errorRate: results.filter((r) => r.status === "fail").length / results.length,
    });
  } else {
    const failures = results.filter((r) => r.status !== "pass");
    await appendMemoryObservation("observability-seo-cwv-maturity:validation-failures", {
      phase: 7,
      commitSha,
      failures: failures.map((f) => ({ name: f.name, error: f.error })),
    });
  }

  return report;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
  const lines = [
    "Usage: pnpm tsx scripts/validate.ts [options]",
    "",
    "Phase 7 validation suite runner for the observability-seo-cwv-maturity spec.",
    "Runs continuous validation checks for observability, SEO, and CWV.",
    "",
    "Checks:",
    "  - Firebase Google Sign-In E2E (Playwright)",
    "  - OTP login validation",
    "  - Redis ping + rate-limit round-trip",
    "  - Socket.IO connect → emit → receive",
    "  - Worker heartbeat freshness",
    "  - Admin dashboard load smoke test",
    "  - Mobile rendering smoke test",
    "  - Lighthouse mobile ≥90 + desktop ≥98 on home (43.2)",
    "  - Sitemap reachability over HTTPS (43.2)",
    "  - Robots.txt reachability over HTTPS (43.2)",
    "  - Sentry synthetic 500 receipt with source-mapped frame (43.2)",
    "",
    "Options:",
    "  -h, --help            Show this help and exit.",
    "      --json            Output report as JSON only.",
    "",
    "Timeouts (per journey):",
    `  Firebase:     ${JOURNEY_TIMEOUTS.firebase / 1000}s`,
    `  OTP:          ${JOURNEY_TIMEOUTS.otp / 1000}s`,
    `  Redis:        ${JOURNEY_TIMEOUTS.redis / 1000}s`,
    `  Socket.IO:    ${JOURNEY_TIMEOUTS.socket / 1000}s`,
    `  Admin:        ${JOURNEY_TIMEOUTS.admin / 1000}s`,
    `  Lighthouse:   ${JOURNEY_TIMEOUTS.lighthouse / 1000}s`,
    `  Sitemap/Robots: ${JOURNEY_TIMEOUTS.sitemapRobots / 1000}s`,
    `  Sentry:       ${JOURNEY_TIMEOUTS.sentry / 1000}s`,
    `  Total:        ${TOTAL_TIMEOUT_MS / 1000}s`,
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  process.stdout.write("[validate] Phase 7 validation suite starting\n");

  let report: ValidationReport;
  try {
    report = (await measure(runValidation, TOTAL_TIMEOUT_MS)).result;
  } catch (err: unknown) {
    process.stderr.write(
      `[validate] total timeout: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  const { passed, totalDurationMs, results } = report;

  process.stdout.write(
    `[validate] Phase 7 complete in ${totalDurationMs} ms. ` +
      `Passed: ${passed} (${results.filter((r) => r.status === "pass").length}/${results.length} checks)\n`,
  );

  if (!passed) {
    const failures = results.filter((r) => r.status !== "pass");
    process.stderr.write("Failed checks:\n");
    for (const f of failures) {
      process.stderr.write(`  - ${f.name}: ${f.error}\n`);
    }
    return 1;
  }

  return 0;
}

// Only auto-run when executed as a script
const invokedAsScript = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(
        `[validate] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    },
  );
}
