import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * SubNation native app configuration (Expo CNG).
 *
 * Identity: one app on both platforms — `ly.subnation.app`.
 * Variants: EAS sets APP_VARIANT=development|preview for side-by-side installs.
 * EAS project id: committed after `eas init` (extra.eas.projectId — see
 * eas-simulator/eas-app-stores skills: linking is required for build/update).
 */
const IS_DEV = process.env.APP_VARIANT === "development";
const IS_PREVIEW = process.env.APP_VARIANT === "preview";

const appName = IS_DEV ? "SubNation Dev" : IS_PREVIEW ? "SubNation Preview" : "SubNation";
const bundleId = "ly.subnation.app";
// Linked EAS project @rh2011/subnation (created via `eas init`, R191).
const EAS_PROJECT_ID = "9ab879a4-561d-46d0-b987-6853c6d8fe33";

const config: ExpoConfig = {
  name: appName,
  slug: "subnation",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "subnation",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: bundleId,
    supportsTablet: true,
    associatedDomains: ["applinks:subnation.ly", "applinks:www.subnation.ly"],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: bundleId,
    adaptiveIcon: {
      backgroundColor: "#dc1840",
      foregroundImage: "./assets/images/adaptive-foreground.png",
      monochromeImage: "./assets/images/adaptive-monochrome.png",
    },
    softwareKeyboardLayoutMode: "resize",
    // Review R7-a (P2-4): the filters claim EXACTLY the web URLs the app
    // can render — the shareable families (/product/*, /category/*,
    // /orders/* — the web's receipt URL, resolvable via the
    // src/app/orders/[orderCode] alias) + the home root. The previous
    // domain-wide pathPrefix "/" claimed every subnation.ly page while
    // single-segment app-unknown paths (/status, /flash-sales, …) fell
    // into the root [orderCode] route and rendered «الطلب غير موجود» —
    // web-only pages now correctly stay in the browser. One filter per
    // (host, path-spec) pair — Android cross-products attributes across
    // data elements inside ONE filter, so separate filters are the
    // unambiguous form. Mirrors the iOS AASA's curated component set.
    intentFilters: (
      [
        { path: "/" },
        { pathPrefix: "/product/" },
        { pathPrefix: "/category/" },
        { pathPrefix: "/orders/" },
      ] as const
    ).flatMap((spec) =>
      ["subnation.ly", "www.subnation.ly"].map((host) => ({
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host, ...spec }],
        category: ["BROWSABLE", "DEFAULT"],
      })),
    ),
  },
  plugins: [
    "expo-router",
    "expo-localization",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#0a0c10",
        image: "./assets/images/splash-icon.png",
        imageWidth: 160,
        dark: { backgroundColor: "#0a0c10" },
      },
    ],
    "expo-secure-store",
    [
      "expo-notifications",
      {
        color: "#dc1840",
      },
    ],
    [
      "@sentry/react-native/expo",
      {
        // R192: crash reporting returns. NOT sentry-expo (deprecated 2024,
        // pins @sentry/react-native 5.x → the sentry-cocoa 8.7 SOURCE pod
        // whose std::allocator<const T> profiling code failed EAS's Xcode
        // clang — the 3 errored R191 builds). 8.28 pulls sentry-cocoa 9.29
        // as a prebuilt xcframework: the broken C++ never compiles.
        // Org/project/token are EAS build-time secrets the owner sets
        // (SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN); with no token
        // present the upload phases are DISABLED — a credentials-less
        // build can never fail on Sentry, and adding the secrets later
        // activates source-map upload on the next build with zero code
        // changes. The runtime init itself is EXPO_PUBLIC_SENTRY_DSN-gated
        // (lib/sentry.ts) — no DSN, no telemetry, identical app behavior.
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        ...(process.env.SENTRY_AUTH_TOKEN ? {} : { disableAutoUpload: true }),
      },
    ],
  ],
  extra: {
    eas: {
      projectId: EAS_PROJECT_ID,
    },
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
