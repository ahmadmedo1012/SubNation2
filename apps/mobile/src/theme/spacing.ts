/**
 * 4-point spacing grid — mirrors the web conventions (12px breathing unit,
 * 16px card padding, 24px section gap, 44px touch targets).
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  /** Minimum touch target (web contract: 44px). */
  touch: 44,
} as const;

export type Spacing = keyof typeof spacing;
