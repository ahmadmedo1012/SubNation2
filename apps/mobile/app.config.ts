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
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "subnation.ly", pathPrefix: "/" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "www.subnation.ly", pathPrefix: "/" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
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
