import * as Sentry from "@sentry/react-native";

/**
 * R192: native crash reporting — the DSN-gated init.
 *
 * History (docs/mobile/EAS-BUILDS.md): R191 shipped v1 WITHOUT crash
 * reporting after sentry-expo (deprecated 2024; pins
 * @sentry/react-native 5.x → the sentry-cocoa 8.7 SOURCE pod) failed
 * EAS's Xcode clang on the std::allocator<const T> profiling bug — 3
 * errored iOS builds. R192 returns via @sentry/react-native@~8.28.0
 * (Expo SDK 58's bundled pin): sentry-cocoa 9.29 ships PREBUILT, so the
 * broken C++ is never compiled.
 *
 * Gating: with no EXPO_PUBLIC_SENTRY_DSN the SDK never initializes —
 * zero telemetry, identical app behavior (the R191 v1 posture). The
 * owner sets the DSN (+ SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN as
 * EAS build secrets for source maps — see app.config.ts) and the next
 * build carries live crash reporting.
 *
 * Privacy posture: sendDefaultPii stays false (no user identifiers,
 * no credentials — the delivered-credential payloads never pass through
 * here), no screenshots, no tracing; this is crash-and-exception
 * reporting only.
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initSentry(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    // One environment per install variant — matches the EAS profiles.
    environment:
      process.env.APP_VARIANT === "development"
        ? "development"
        : process.env.APP_VARIANT === "preview"
          ? "preview"
          : "production",
    // Crash reporting only — no traces, no profiles, no replay.
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    // Default PII suppression stays on: no user ids/emails/IPs attached.
    sendDefaultPii: false,
  });
}
