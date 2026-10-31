/**
 * Motion timing — related durations across the app (state feedback fast,
 * element transitions base, large surfaces slow).
 */
export const motion = {
  fast: 150,
  base: 250,
  slow: 400,
} as const;

export type Motion = keyof typeof motion;
