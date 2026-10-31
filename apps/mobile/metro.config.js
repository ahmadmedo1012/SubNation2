const { getSentryExpoConfig } = require("@sentry/react-native/metro");

/**
 * R192: Sentry returns — through @sentry/react-native@8.28's official Expo
 * Metro integration (NOT the deprecated sentry-expo whose 2023-era pod
 * source carried the std::allocator<const T> bug that killed R191's three
 * iOS builds; 8.28 consumes sentry-cocoa 9.29 as a PREBUILT xcframework).
 *
 * getSentryExpoConfig = Expo's own default config + the Sentry serializer
 * (Debug IDs in bundles/source maps — the symbolication contract) + the
 * LogBox frame collapsing. autoWrapExpoRouterErrorBoundary wraps every
 * route's ErrorBoundary at build time so render-phase crashes reach the
 * dashboard without touching a single route file.
 */
module.exports = getSentryExpoConfig(__dirname, {
  autoWrapExpoRouterErrorBoundary: true,
});
