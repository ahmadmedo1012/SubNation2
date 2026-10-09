/**
 * A2 F1 (R124) — lazy Session Replay attach.
 *
 * THIS MODULE IS THE ONLY IMPORTER of the replay integration in the entire
 * app, and it is reached exclusively via the dynamic import in
 * src/instrument.ts (`attachReplay`). That is the whole trick: because no
 * statically-reachable module references the `replayIntegration` binding,
 * Rollup tree-shakes the rrweb recorder/canvas-snapshot code (~⅔ of the
 * old 469 KB vendor-sentry chunk — it was 47% of all JS a visitor
 * downloaded) out of the SDK chunk every visitor idle-loads, and emits it
 * as this module's own async chunk. The bytes are only fetched when a
 * session will actually record:
 *
 *   - "session"  → the sticky 10% session winners (full-session replay,
 *                  delayed start on idle — instrument.ts is itself the
 *                  idle-deferred SDK boot);
 *   - "error"    → everyone else, on the first error-level event
 *                  (buffer mode: records from that point, uploads the
 *                  error replay on the next error).
 *
 * Both `replays*SampleRate` client options are 0 (see instrument.ts), so
 * the integration starts in manual mode and the explicit
 * `start()`/`startBuffering()` calls below decide recording — Sentry's
 * documented pattern for custom sampling.
 *
 * PII masking is byte-identical to the previous static config:
 * `maskAllText: true` + `blockAllMedia: true`.
 *
 * BUILD NOTE (vite.config.ts, sentryDsnGuardPlugin): in DSN-set builds the
 * `replayIntegration` import below is SWAPPED at build time to the internal
 * package entry (@sentry-internal/replay). Importing it through the public
 * @sentry/react barrel — even from this lazy module — would make the whole
 * rrweb recorder a chunk-level dependency of vendor-sentry (the barrel is
 * pinned there by manualChunks) and re-ship it to every visitor. The
 * on-disk import stays on the public API for TypeScript + vitest; it is the
 * identical binding either way. The swap is pinned by
 * src/lib/__tests__/instrument-replay-lazy.test.ts.
 */

import { addIntegration, replayIntegration } from "@sentry/react";

export type SentryReplayAttachMode = "session" | "error";

export function attachSentryReplay(mode: SentryReplayAttachMode): void {
  const replay = replayIntegration({
    maskAllText: true,
    blockAllMedia: true,
  });
  addIntegration(replay);
  if (mode === "session") {
    // Force a session-based recording (the sticky-roll winner).
    replay.start();
  } else {
    // Buffer without uploading; the next error flips it into an error
    // replay and uploads it.
    replay.startBuffering();
  }
}
