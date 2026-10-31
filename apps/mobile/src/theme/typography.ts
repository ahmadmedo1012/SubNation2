import type { TextStyle } from "react-native";
import { useColors, type Colors } from "./colors";

/**
 * Named type ramp mirroring the web's Readex Pro discipline:
 * weights 400/600/700 ONLY (the bundled static instances — the web bans
 * every other weight, so the app does too), Arabic-safe line heights
 * (1.3 headlines / 1.7 body), letter-spacing always 0.
 *
 * Colors are applied via the `color` pass in `withColors` — this module
 * stays static-safe per the design-system skill (no hooks at module scope).
 */
const ramp = {
  largeTitle: { fontSize: 34, fontFamily: "ReadexPro-Bold", lineHeight: 44 },
  title: { fontSize: 22, fontFamily: "ReadexPro-Bold", lineHeight: 29 },
  headline: { fontSize: 17, fontFamily: "ReadexPro-SemiBold", lineHeight: 22 },
  body: { fontSize: 17, fontFamily: "ReadexPro-Regular", lineHeight: 29 },
  callout: { fontSize: 15, fontFamily: "ReadexPro-Regular", lineHeight: 24 },
  subhead: { fontSize: 15, fontFamily: "ReadexPro-Regular", lineHeight: 22 },
  footnote: { fontSize: 13, fontFamily: "ReadexPro-Regular", lineHeight: 19 },
  caption: { fontSize: 12, fontFamily: "ReadexPro-Regular", lineHeight: 17 },
  /** The Arabic floor on the web is 11px — keep one micro size, never lower. */
  micro: { fontSize: 11, fontFamily: "ReadexPro-Regular", lineHeight: 15 },
} as const satisfies Record<string, Omit<TextStyle, "color">>;

export type TypeVariant = keyof typeof ramp;

export type TypeStyle = TextStyle;

/** Base ramp (no color) — static-safe. */
export const type = ramp;

/** Colorized ramp — call inside components. */
export function useType(): Record<TypeVariant, TypeStyle> {
  const colors = useColors();
  return withColors(colors);
}

export function withColors(colors: Colors): Record<TypeVariant, TypeStyle> {
  const out = {} as Record<TypeVariant, TypeStyle>;
  for (const key of Object.keys(ramp) as TypeVariant[]) {
    out[key] = { ...ramp[key], color: colors.foreground };
  }
  return out;
}
