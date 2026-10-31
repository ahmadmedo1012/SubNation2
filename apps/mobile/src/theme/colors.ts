import { useColorScheme } from "react-native";

/**
 * SubNation brand palette — the exact token table from the web app
 * (frontend/src/index.css + DESIGN.md), ported 1:1 so the native app is
 * visually the same product. Dark is the brand default (the web ships
 * dark-first); light is the full secondary set.
 *
 * Hook-only by design (expo-design-system skill): reads the color scheme at
 * render time, so colors can only be applied inside components.
 */
const dark = {
  /** The single brand accent — crimson. */
  primary: "#dc1840",
  /** Text-safe twin of primary (readable on dark backgrounds). */
  primaryText: "#ed5e7b",
  background: "#0a0c10",
  surfaceCard: "#101318",
  surfaceOverlay: "#181d25",
  foreground: "#f8fafc",
  onSurface: "#a0abba",
  border: "#232a34",
  secondary: "#1f252e",
  destructive: "#ea3e3e",
  success: "#2dd285",
  warning: "#f6aa28",
  error: "#ed5a5a",
  info: "#3491f4",
  lowStock: "#f67a31",
  onTint: "#ffffff",
  /** Tier accents (loyalty). */
  tierBronze: "#f7b83b",
  tierSilver: "#acb6c3",
  tierGold: "#f6aa28",
  tierPlatinum: "#75b0f0",
  /** Category accents (7 live categories). */
  catStreaming: "#ad70eb",
  catMusic: "#42d791",
  catSoftware: "#6c9ae5",
  catVpn: "#4cbcf0",
  catAiTools: "#d87de8",
  catSeoTools: "#f0784c",
  catEducation: "#f5c147",
  /** Provider brand marks (theme-independent). */
  whatsapp: "#25d366",
  telegram: "#2aabee",
  google: "#4285F4",
} as const;

const light = {
  primary: "#d3173d",
  primaryText: "#c51639",
  background: "#f3f4f7",
  surfaceCard: "#ffffff",
  surfaceOverlay: "#ffffff",
  foreground: "#14181f",
  onSurface: "#535c6e",
  border: "#dadce2",
  secondary: "#ebecf0",
  destructive: "#dc1818",
  success: "#1d724a",
  warning: "#885907",
  error: "#bb1b1b",
  info: "#135eae",
  lowStock: "#ad460b",
  onTint: "#ffffff",
  tierBronze: "#916308",
  tierSilver: "#586174",
  tierGold: "#885907",
  tierPlatinum: "#135eae",
  catStreaming: "#802dd2",
  catMusic: "#1e764d",
  catSoftware: "#2362c7",
  catVpn: "#116d97",
  catAiTools: "#a32eb8",
  catSeoTools: "#b83c0f",
  catEducation: "#886107",
  whatsapp: "#25d366",
  telegram: "#2aabee",
  google: "#4285F4",
} as const;

/** Key set derived from the dark table (the canonical token list). */
export type Colors = { [K in keyof typeof dark]: string };

const palette: { dark: Colors; light: Colors } = { dark, light };

/**
 * Brand colors. Dark is the default (brand truth — matches the web app's
 * dark-first default); light is used only when the system scheme is light.
 */
export function useColors(): Colors {
  const scheme = useColorScheme();
  return scheme === "light" ? palette.light : palette.dark;
}

/** Static lookup for non-React contexts (notifications, deep-link tints). */
export const darkColors: Colors = palette.dark;
