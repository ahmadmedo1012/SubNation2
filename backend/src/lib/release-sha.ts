/**
 * R107 (migration, hosting-agnostic release identity): single source for
 * the 7-char release SHA used in logs, health payloads, Sentry tags and
 * the heartbeat.
 *
 * Priority: GIT_SHA (neutral — Coolify/CI/Docker builds) →
 * RENDER_GIT_COMMIT (Render injects it automatically) → "unknown".
 *
 * The Dockerfile accepts BOTH as build args and exports GIT_SHA into the
 * runtime container, so every deployment platform reaches the same
 * telemetry without platform-specific code. Empty/whitespace values fall
 * through exactly like missing ones.
 */
export function getReleaseSha(): string {
  const neutral = (process.env.GIT_SHA ?? "").trim();
  if (neutral) return neutral.slice(0, 7);
  const render = (process.env.RENDER_GIT_COMMIT ?? "").trim();
  if (render) return render.slice(0, 7);
  return "unknown";
}
