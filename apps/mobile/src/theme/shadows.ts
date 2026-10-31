/**
 * Elevation ladder — CSS `boxShadow` strings (the ONLY sanctioned shadow
 * syntax on RN 0.76+; the legacy shadow and elevation props are banned by
 * the expo-native-ui skill). Neutral shadows like the web's calm ladder.
 */
export const shadows = {
  card: "0 1px 2px rgba(0, 0, 0, 0.05)",
  raised: "0 4px 12px rgba(0, 0, 0, 0.10)",
  overlay: "0 8px 24px rgba(0, 0, 0, 0.18)",
} as const;

export type Shadow = keyof typeof shadows;
