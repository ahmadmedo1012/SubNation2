/**
 * Sentry boot deferrer.
 *
 * Background: importing `./instrument` at the top of main.tsx pulls
 * @sentry/react (core + BrowserTracing — the rrweb Replay bytes are a
 * separate lazy chunk since A2 F1, see src/lib/sentry-replay.ts) into the
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
 *
 * 97-F6 (R97 J-3) — DSN dead-weight guard: R97-A1 observed the live
 * production site fetching the vendor-sentry chunk (~151 KB brotli) at
 * boot even though VITE_SENTRY_DSN is unset — an SDK initialized with
 * no DSN reports nothing, so the bytes were pure cost. The dynamic
 * import of ../instrument below now lives INSIDE the DSN-present
 * branch only: Vite statically replaces import.meta.env.VITE_SENTRY_DSN
 * at build time (with `void 0` when unset), so on a DSN-less build the
 * branch never executes. Companion guard in vite.config.ts
 * (sentryDsnGuardPlugin) additionally stubs @sentry/react for such
 * builds so the vendor-sentry chunk is not emitted at all. When the
 * DSN IS set, behavior is identical to before.
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

/**
 * The only @sentry/react API the flush path needs. Kept as an explicit
 * minimal type (not the module namespace) — A2 F1 (R124): a namespace
 * handle stored at module scope defeats tree-shaking and would pin every
 * export, including the lazy Session Replay integration, back into the
 * every-visitor vendor-sentry chunk.
 */
type SentryFlushApi = {
  captureException: (typeof import("@sentry/react"))["captureException"];
  withScope: (typeof import("@sentry/react"))["withScope"];
};

let sentryReady: SentryFlushApi | null = null;

/**
 * 97-F6 (R97 J-3): build-time DSN presence. Vite statically replaces
 * import.meta.env.VITE_SENTRY_DSN during `vite build` (`void 0` when
 * unset — verified against the emitted instrument chunk), so this is a
 * compile-time constant in production bundles. Reading it ONCE at module
 * evaluation keeps boot-sentry, vite.config.ts's sentryDsnGuardPlugin and
 * instrument.ts's own check all agreeing on whether this build ships the
 * SDK. Exported for tests and for any future call site that needs to know
 * without re-deriving the env read.
 */
const SENTRY_DSN: string | undefined =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim() || undefined;

export const SENTRY_DSN_SET: boolean = !!SENTRY_DSN;

function push(event: BufferedEvent): void {
  if (sentryReady) {
    flushOne(sentryReady, event);
    return;
  }
  if (buffer.length < MAX_BUFFER) {
    buffer.push(event);
  }
}

function flushOne(Sentry: SentryFlushApi, event: BufferedEvent): void {
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
 *
 * 97-F6 (R97 J-3): when the build carries no VITE_SENTRY_DSN this is a
 * no-op — the dynamic import below is only reachable from the
 * DSN-present path, so a DSN-less build never requests the Sentry
 * chunk(s). The operator-facing console messages (and the
 * window.__sentryStatus debug handle, normally installed by
 * instrument.ts) are preserved here so a misconfigured deployment is
 * still loudly visible and debuggable.
 */
export function scheduleSentryBoot(): void {
  if (typeof window === "undefined") return;

  if (!SENTRY_DSN_SET) {
    if (import.meta.env.MODE === "production") {
      // Production builds without the env are misconfigured — log loudly
      // so it's caught before traffic exposes the gap (same contract
      // instrument.ts used to provide, now emitted without loading the
      // dead-weight SDK chunk).
      console.error(
        "[sentry] VITE_SENTRY_DSN is not set in production. Frontend errors will not be reported. Sentry SDK chunk skipped (97-F6).",
      );
    } else {
      console.info("[sentry] VITE_SENTRY_DSN not set — Sentry disabled in dev.");
    }
    // instrument.ts never loads in this build, so it can't install its
    // debug surface. Provide the __sentryStatus contract here instead so
    // operators probing a live tab get a truthful answer rather than a
    // TypeError from `window.__sentryStatus()` being undefined.
    if (typeof window.__sentryStatus !== "function") {
      window.__sentryStatus = () => ({
        initialized: false,
        environment: import.meta.env.MODE,
        release: "sentry-not-shipped",
        dsn: null,
      });
    }
    return;
  }

  type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  };
  const w = window as IdleWindow;

  const start = (): void => {
    void import("../instrument").then(async () => {
      // instrument.ts runs Sentry.init as part of its boot. We re-import
      // @sentry/react here for a typed handle without a cyclic dep —
      // NAMED imports only (see the SentryFlushApi note above): a
      // namespace handle would re-pin every export, replay included,
      // into the every-visitor chunk (A2 F1).
      const { captureException, withScope } = await import("@sentry/react");
      sentryReady = { captureException, withScope };
      // Drain the event buffer in arrival order.
      while (buffer.length) {
        const event = buffer.shift();
        if (event) flushOne(sentryReady, event);
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
