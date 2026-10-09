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
 *   3. The actual @sentry/react chunk loads per the R127-L10 (B4 D2)
 *      replay-roll-aware schedule (see scheduleSentryBoot below):
 *        - sticky session-replay WINNERS (the 10% roll, mirroring
 *          the SDK's own stickySession sampling semantics) boot on
 *          requestIdleCallback exactly as before — their replay
 *          records the whole session, so delaying the SDK would
 *          truncate the recording (A2 F1 semantics preserved);
 *        - everyone else (~90%): the import attaches to the LATER of
 *          the window `load` event / the first `pointerdown` — live
 *          (B4) the vendor-sentry chunk (111,295 B br, 70% unused at
 *          load, a 221 ms long task at ~3.6 s on home) rode INSIDE
 *          the load window on mid-tier mobile because rIC fires
 *          during it, not after it. The first buffered ERROR loads
 *          the SDK immediately (see deferredErrorLoadTrigger).
 *      Once it's loaded:
 *        - instrument.ts runs (Sentry.init + integrations)
 *        - the buffered events are flushed
 *        - the wrapped React handlers start delegating in real time
 *
 * Tradeoff: errors during the deferral window are captured and
 * replayed once the chunk lands, NOT lost — the synchronous buffer
 * (§1–2) is the guarantee, and the first error short-circuits the
 * load/pointerdown gate so an early crash pulls the SDK in at once.
 * The only capture gap vs the old rIC schedule is the (rare) session
 * with errors that unloads before load+pointerdown ever fire; the
 * old schedule had the same property inside its 2 s rIC timeout.
 * Source-map fidelity is preserved (Sentry resolves stack frames at
 * ingest time using the bundle hash, not at capture time).
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
 * R127-L10 (B4 D2): the "load the deferred SDK NOW" handle for the
 * non-sampled path. Armed by armDeferredSentryLoad() while the SDK load
 * is waiting on the later-of(load, first pointerdown) gate; fired (and
 * cleared) by push() on the FIRST buffered event — an early crash must
 * not wait for user engagement to reach Sentry. Null on the winner path
 * (rIC already bounds the window) and once any load path has fired.
 */
let deferredErrorLoadTrigger: (() => void) | null = null;

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
  // R127-L10 (B4 D2): the first buffered error of a DEFERRED
  // (non-sampled) session loads the SDK immediately — the event stays
  // buffered (flushed the moment the chunk lands, the §1–2 guarantee),
  // but it also short-circuits the load/pointerdown gate so the chunk
  // starts landing right away. Self-clearing: no-op for winners (the
  // rIC path arms nothing) and once any load path has fired.
  deferredErrorLoadTrigger?.();
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
 * R127-L10 (B4 D2): MIRROR of instrument.ts's rollReplaySessionWinner —
 * same sessionStorage key ("sn:sentry-replay-roll"), same sticky
 * per-tab-session semantics, same rate (10% in production, 0 in
 * dev/test). boot-sentry needs the verdict BEFORE the SDK chunk exists
 * (it decides WHEN to fetch the 111 KB br chunk), so the roll runs here
 * FIRST; when instrument.ts later evaluates inside the loaded chunk, its
 * own roll reads the same stored verdict and the two always agree.
 * Storage-blocked environments (private mode) fall back to independent
 * per-boot rolls on both sides — they may disagree there, which only
 * means a deferred boot attaches a session replay when the chunk lands
 * (harmless: the SDK loads either way; instrument.ts's roll is the one
 * that decides recording).
 */
const REPLAY_ROLL_STORAGE_KEY = "sn:sentry-replay-roll";

function rollReplaySessionWinnerForBoot(sampleRate: number): boolean {
  if (sampleRate <= 0) return false;
  try {
    const stored = sessionStorage.getItem(REPLAY_ROLL_STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
    const won = Math.random() < sampleRate;
    sessionStorage.setItem(REPLAY_ROLL_STORAGE_KEY, won ? "1" : "0");
    return won;
  } catch {
    // Storage blocked (private mode / quota) — per-boot roll, exactly
    // like instrument.ts's fallback.
    return Math.random() < sampleRate;
  }
}

/**
 * R127-L10 (B4 D2): arm the deferred SDK load for NON-sampled sessions.
 *
 * The window `load` event ends the initial load window — importing the
 * vendor-sentry chunk before it would put 111 KB br + its eval + its
 * long task right back into the LCP phase (B4's measured regression:
 * 174 ms eval + a 221 ms long task at ~3.6 s on home, the #1
 * unused-JS opportunity on every mobile route). The import fires at the
 * LATER of the load event / the first pointerdown: engagement proves
 * the visitor is staying (and moves any eval cost off the critical
 * interaction), while waiting for `load` keeps the bytes from competing
 * with the LCP resources even when the first tap lands early.
 *
 * The FIRST buffered error overrides the gate (deferredErrorLoadTrigger
 * — an early crash must reach Sentry ASAP, and the error also arms the
 * replay beforeSend path the moment the chunk initializes).
 *
 * Listeners are removed on whichever path fires — nothing dangles on
 * window for the page lifetime after the decision.
 */
function armDeferredSentryLoad(startOnce: () => void): void {
  // R127-L10 (B4 D2) belt-and-braces: an error may already be sitting
  // in the buffer when the schedule arms — only possible if the window
  // listeners were installed meaningfully earlier than
  // scheduleSentryBoot() (main.tsx calls them back-to-back, so today
  // this is future-proofing for other entry points). The early-crash
  // guarantee wins over the load-window discipline: load NOW.
  if (buffer.length > 0) {
    deferredErrorLoadTrigger = null;
    startOnce();
    return;
  }

  // The load event may already have fired by the time the entry chunk
  // evaluates (fast cached boots) — readyState is the honest check.
  let loaded = typeof document !== "undefined" && document.readyState === "complete";
  let interacted = false;
  let disarmed = false;

  const onLoad = (): void => {
    loaded = true;
    maybeLoad();
  };
  const onPointerDown = (): void => {
    interacted = true;
    maybeLoad();
  };

  const disarm = (): void => {
    disarmed = true;
    deferredErrorLoadTrigger = null;
    window.removeEventListener("load", onLoad);
    window.removeEventListener("pointerdown", onPointerDown, true);
  };

  const maybeLoad = (): void => {
    if (disarmed || !loaded || !interacted) return;
    disarm();
    startOnce();
  };

  deferredErrorLoadTrigger = (): void => {
    if (disarmed) return;
    disarm();
    startOnce();
  };

  if (!loaded) window.addEventListener("load", onLoad);
  window.addEventListener("pointerdown", onPointerDown, true);
}

/**
 * R127-L10 (B4 D2) TEST-ONLY introspection (same naming convention as
 * use-public-auth-providers' __resetPublicAuthProvidersCacheForTests):
 * the boot schedule's decision state, so the regression suite can pin
 * "the deferred load has NOT fired" WITHOUT pushing a probe error
 * through the buffer — a probe error would itself trip the
 * first-error short-circuit (the very behavior under test), so a
 * captureException-based probe cannot distinguish "already live"
 * from "the probe just triggered the load".
 *
 *   - ready: a load path fired AND the import chain settled (sentryReady
 *     is set — subsequent pushes flush synchronously to Sentry).
 *   - deferredGateArmed: the non-sampled path is waiting on the
 *     later-of(load, first pointerdown) gate right now.
 */
export function __sentryBootStateForTests(): {
  ready: boolean;
  deferredGateArmed: boolean;
} {
  return {
    ready: sentryReady !== null,
    deferredGateArmed: deferredErrorLoadTrigger !== null,
  };
}

/**
 * Schedule the Sentry chunk per the R127-L10 (B4 D2) plan. Once loaded,
 * the buffered queue is flushed and subsequent push() calls go directly
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

  let started = false;
  const startOnce = (): void => {
    if (started) return;
    started = true;
    start();
  };

  // R127-L10 (B4 D2): the sticky replay roll decides the boot schedule
  // (see rollReplaySessionWinnerForBoot above — same key/semantics/rate
  // as instrument.ts, rolled here FIRST so the loaded SDK agrees).
  const replaySessionWinner = rollReplaySessionWinnerForBoot(
    import.meta.env.MODE === "production" ? 0.1 : 0,
  );

  if (replaySessionWinner) {
    // Sticky 10% session winners: unchanged idle boot — their session
    // replay records from SDK boot (this module is itself the deferred
    // SDK boot, so the winner's replay starts delayed-on-idle, exactly
    // the documented A2 F1 lazy-load shape). 2s timeout so a busy main
    // thread can't indefinitely block boot.
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(startOnce, { timeout: 2000 });
    } else {
      setTimeout(startOnce, 0);
    }
    return;
  }

  // Everyone else (~90% of sessions — they only ever need the SDK for
  // an error, which arms error replay at that point): keep the 111 KB
  // br chunk out of the first-visit load window entirely.
  armDeferredSentryLoad(startOnce);
}
