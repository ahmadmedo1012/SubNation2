/**
 * R177 — the guest-surface loyalty policy constants.
 *
 * The loyalty PAGE reads this same policy from the /loyalty payload
 * (R115 A8 de-hardcode: points_rate.points_per_referral /
 * tier_thresholds). But three surfaces render the policy to GUESTS, before
 * any auth: register's welcome card, login's value chips, and the support
 * FAQ — no payload exists there, so the values live in ONE frontend
 * address (the loyalty-tiers.ts fallback precedent).
 *
 * Mirrors backend/src/lib/loyalty-policy.ts (WELCOME_BONUS_LYD /
 * POINTS_PER_REFERRAL) — change BOTH sides together; the current pair is
 * pinned at the rendered level by register-welcome-copy.test.tsx.
 */

export const WELCOME_BONUS_LYD = 5.0;
export const POINTS_PER_REFERRAL = 50;
