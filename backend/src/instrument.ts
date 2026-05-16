/**
 * Backend Sentry sidecar — MUST be the very first import in every entrypoint
 * (index.ts, worker.ts, build.mjs runtime).
 *
 * Sentry's Node SDK auto-instruments Express, HTTP, fs, child_process, and
 * the OpenTelemetry-based pipeline by patching modules at require time. If
 * Sentry.init runs AFTER `app.ts` is imported, any handler registered in
 * `app.ts` will not have its spans captured. Loading this module first
 * fixes that ordering hazard.
 *
 * Also installs a defensive uncaughtException + unhandledRejection handler
 * that captures + flushes before exit, on top of Sentry's default
 * `onUncaughtExceptionIntegration` and `onUnhandledRejectionIntegration`
 * (both enabled by default in v8+).
 */

import * as Sentry from "@sentry/node";
import { initSentry } from "./lib/sentry";

// 1. Init Sentry as the very first runtime side effect.
initSentry();

// 2. Belt-and-suspenders: flush Sentry on the way out so error events are
//    not lost when the process is killed by an uncaught exception. Sentry's
//    built-in onUncaughtExceptionIntegration captures the error itself, but
//    the process can still exit before the network event finishes —
//    flushing here closes that gap.
const FLUSH_TIMEOUT_MS = 2000;

process.on("uncaughtException", async (err: Error) => {
  // Sentry's default integration has already captured this error. We just
  // ensure the queue is drained before the process dies.
  try {
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  } catch {
    // ignore — at this point we're exiting anyway.
  }
  // Re-raise to preserve Node's default exit behaviour. Sentry's integration
  // exits with code 1 by default; if a userland handler has overridden it
  // we keep the original semantics.
  // eslint-disable-next-line no-console
  console.error("uncaughtException:", err);
  process.exit(1);
});

process.on("unhandledRejection", async (reason: unknown) => {
  try {
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  } catch {
    // ignore
  }
  // eslint-disable-next-line no-console
  console.error("unhandledRejection:", reason);
  // Don't exit — unhandledRejection is typically a logical bug, not a
  // process-fatal condition. The default Sentry behaviour matches this.
});
