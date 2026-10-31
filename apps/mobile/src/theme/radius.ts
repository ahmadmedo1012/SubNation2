/**
 * Radius scale — mirrors the web (4/8/10/12-default/16/24/full).
 * Pair every non-capsule radius with `borderCurve: "continuous"`
 * (expo-native-ui rule) — the `radiusStyle` helper applies it.
 */
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export type Radius = keyof typeof radius;

/** Style fragment for a rounded corner with the continuous curve. */
export function rounded(r: Radius): { borderRadius: number; borderCurve: "continuous" } {
  return { borderRadius: radius[r], borderCurve: "continuous" };
}
