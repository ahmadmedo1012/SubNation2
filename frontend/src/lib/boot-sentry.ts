/**
 * Sentry boot deferrer.
 *
 * Background: importing `./instrument` at the top of main.tsx pulls
 * @sentry/react (Replay + BrowserTracing integrations) into the
 * initial chunk graph. Vite emits a `<link rel="modulepreload">` for
 * the resulting `vendor-sentry` chunk, which on the production build
 * is ~155 KB gzip — bigger than React itself. That payload contends
 * with the LCP image bytes and adds ~250 ms of TBT on mid-tier mobile.
 *
 * This module restructures Sentry to be entirely off the critical path:
 *
 *   1. window error/rejection handlers are installed SYNCHRONOUSLY.
 *      They buffer events into an in-memory queue so any error that
 *      fires before Sentry loads is preserved.
 *   2. React's createRoot error handlers (onUncaughtError /
 *      onCaughtError / onRecoverableError) get a wrapper that ALSO
 *      buffers, then delegates once Sentry is loaded.
 *   3. The actual @sentry/react chunk loads on requestIdleCallback
 *      (or setTimeout 0 fallback). Once it's loaded:
 *        - instrument.ts runs (Sentry.init + integrations)
 *        - the buffered events are flushed
 *        - the wrapped React handlers start delegating in real time
 *
 * Tradeoff: errors during the ~50–200 ms window between page-load
 * and Sentry boot are captured and replayed, NOT lost. Source-map
 * fidelity is preserved (Sentry resolves stack frames at ingest time
 * using the bundle hash, not at capture time).
 */

type ReactErrorInfo = unknown;
type ReactErrorHandler = (error: unknown, errorInfo: ReactErrorInfo) => void;

interface BufferedEvent {
  kind: "error" | "rejection" | "react";
  payload: unknown;
  errorInfo?: ReactErrorInfo;
  timestamp: number;
}

const buffer: BufferedEvent[] = [];
const MAX_BUFFER = 32; // hard cap so a runaway error loop can't bloat memory

let sentryReady: typeof import("@sentry/react") | null = null;

function push(event: BufferedEvent): void {
  if (sentryReady) {
    flushOne(sentryReady, event);
    return;
  }
  if (buffer.length < MAX_BUFFER) {
    buffer.push(event);
  }
}

function flushOne(Sentry: typeof import("@sentry/react"), event: BufferedEvent): void {
  try {
    if (event.kind === "react") {
      Sentry.withScope((scope) => {
        if (event.errorInfo && typeof event.errorInfo === "object") {
          const ei = event.errorInfo as { componentStack?: unknown };
          if (typeof ei.componentStack === "string") {
            scope.setContext("react", { componentStack: ei.componentStack });
          }
        }
        scope.setTag("kind", "react-error-handler");
        Sentry.captureException(event.payload);
      });
    } else if (event.kind === "rejection") {
      Sentry.captureException(event.payload);
    } else {
      Sentry.captureException(event.payload);
    }
  } catch {
    // Never let Sentry replay throw and break the app.
  }
}

/** Install window error listeners. Call EARLY in main.tsx. */
export function installBootErrorBuffer(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e) => {
    push({
      kind: "error",
      payload: e.error ?? new Error(e.message || "unknown window error"),
      timestamp: Date.now(),
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    push({
      kind: "rejection",
      payload: e.reason ?? new Error("unhandledrejection (no reason)"),
      timestamp: Date.now(),
    });
  });
}

/**
 * React-error-handler wrapper. Pass the result to createRoot's
 * onUncaughtError / onCaughtError / onRecoverableError options. Each
 * call buffers until Sentry loads, then delegates immediately on every
 * subsequent call.
 */
export function bufferedReactErrorHandler(): ReactErrorHandler {
  return (error: unknown, errorInfo: ReactErrorInfo) => {
    push({ kind: "react", payload: error, errorInfo, timestamp: Date.now() });
  };
}

/**
 * Schedule the Sentry chunk to load on idle. Once loaded, the
 * buffered queue is flushed and subsequent push() calls go directly
 * to Sentry.
 */
export function scheduleSentryBoot(): void {
  if (typeof window === "undefined") return;

  type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  };
  const w = window as IdleWindow;

  const start = (): void => {
    void import("../instrument").then(async () => {
      // instrument.ts sets window.Sentry as part of its boot. We re-import
      // @sentry/react here to get a typed handle without a cyclic dep.
      const SentryModule = await import("@sentry/react");
      sentryReady = SentryModule;
      // Drain the buffer in arrival order.
      while (buffer.length) {
        const event = buffer.shift();
        if (event) flushOne(SentryModule, event);
      }
    });
  };

  if (typeof w.requestIdleCallback === "function") {
    // 2s timeout so a busy main thread can't indefinitely block boot.
    w.requestIdleCallback(start, { timeout: 2000 });
  } else {
    setTimeout(start, 0);
  }
}
