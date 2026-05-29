/**
 * Admin user-identity display helpers.
 *
 * Single source of truth for rendering a user across every admin
 * table + detail modal. Replaces ad-hoc `user.phone` reads scattered
 * across admin/users, admin/orders, admin/topups, admin/tickets,
 * admin/dashboard.
 *
 * Pure module — no fetches, no React, no Tailwind tokens. The badge
 * helpers return semantic colour names; the page's JSX maps each name
 * to the project's existing colour utility set.
 *
 * The accepted shape is relaxed (`Record<string, unknown>` underneath)
 * because the four admin endpoints surface slightly different subsets
 * of the user record — orders gives `user_phone` + `user_display_name`,
 * users gives the full row, etc. Each helper picks the best available
 * value and gracefully degrades when a field is missing.
 */

export interface AdminUserShape {
  /** Internal numeric id. Used as last-resort label "#42". */
  id?: number;
  /** Stored phone — may be a 9-digit Libyan local form OR a placeholder
   *  (`tg_<id>` for Telegram-first, `fb_<uid>` for Firebase-Google-only,
   *  legacy `gh_<id>`). Helpers detect placeholders and avoid showing them. */
  phone?: string | null;
  /** Best human-readable name from any provider (Firebase displayName,
   *  Telegram first_name + last_name, Google name claim). */
  display_name?: string | null;
  /** Lower-cased email when known. */
  email?: string | null;
  /** Backend's stored authProvider tag — values:
   *    "firebase_google" | "firebase_phone" (legacy) |
   *    "telegram" | "whatsapp_phone" | "firebase" | "legacy_password" */
  auth_provider?: string | null;
  /** Boolean fan-out from the admin/users endpoint. */
  has_google?: boolean;
  has_telegram?: boolean;
  has_firebase?: boolean;
  has_whatsapp?: boolean;
}

/** Stored phone is a placeholder if it starts with one of these prefixes. */
const PLACEHOLDER_PREFIXES = ["tg_", "fb_", "gh_"];

function isPlaceholderPhone(phone: string): boolean {
  return PLACEHOLDER_PREFIXES.some((p) => phone.startsWith(p));
}

/**
 * Derive a human-readable name for the user. Priority:
 *
 *   1. `display_name` (Firebase / Telegram / Google name claim)
 *   2. real `phone` (skipped when it's a placeholder like "tg_…")
 *   3. local-part of `email` (e.g. "alice@example.com" → "alice")
 *   4. provider-specific generic ("حساب Telegram", "حساب Google", …)
 *   5. `#<id>` last resort
 *
 * Never shows raw placeholder phones (`tg_…`, `fb_…`, `gh_…`).
 */
export function displayUserName(user: AdminUserShape): string {
  const dn = typeof user.display_name === "string" ? user.display_name.trim() : "";
  if (dn) return dn;

  const phone = typeof user.phone === "string" ? user.phone : "";
  if (phone && !isPlaceholderPhone(phone)) return phone;

  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (email) {
    const local = email.split("@")[0];
    if (local) return local;
  }

  // Generic provider-derived label when nothing better exists.
  if (user.has_telegram || user.auth_provider === "telegram") return "حساب Telegram";
  if (user.has_google || user.auth_provider === "firebase_google") return "حساب Google";
  if (user.has_whatsapp || user.auth_provider === "whatsapp_phone") return "حساب WhatsApp";
  if (user.has_firebase || user.auth_provider === "firebase_phone") {
    // Legacy Firebase Phone OTP user — flagged so admins know it's
    // historical (the flow was retired; no new users land here).
    return "حساب هاتف (قديم)";
  }

  if (typeof user.id === "number") return `#${user.id}`;
  return "—";
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider badges
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderBadgeTone =
  | "google" // Google sign-in
  | "telegram" // Telegram login (redirect or Mini App)
  | "whatsapp" // WhatsApp OTP
  | "legacy_phone" // Retired Firebase Phone OTP — historical accounts only
  | "none"; // No linked identity

export interface ProviderBadge {
  tone: ProviderBadgeTone;
  label: string;
}

/**
 * Compute the badges to render for a user.
 *
 * Returns badges in priority order: active providers (Google, Telegram,
 * WhatsApp) first, then the legacy-phone marker only when the user has
 * a Firebase identity AND no other modern provider linked.
 *
 * Returns a single `none` badge when no provider is detectable.
 */
export function userProviderBadges(user: AdminUserShape): ProviderBadge[] {
  const out: ProviderBadge[] = [];
  const hasGoogle = !!user.has_google || user.auth_provider === "firebase_google";
  const hasTelegram = !!user.has_telegram || user.auth_provider === "telegram";
  const hasWhatsApp = !!user.has_whatsapp || user.auth_provider === "whatsapp_phone";
  if (hasGoogle) out.push({ tone: "google", label: "Google" });
  if (hasTelegram) out.push({ tone: "telegram", label: "Telegram" });
  if (hasWhatsApp) out.push({ tone: "whatsapp", label: "WhatsApp" });

  // Legacy Firebase Phone OTP — only show when the user has NO modern
  // provider linked, so the admin sees "هاتف (قديم)" only on truly
  // historical accounts and not as visual clutter on Google-linked users
  // who happen to have a phone field too.
  const onlyLegacyPhone =
    !!user.has_firebase &&
    !hasGoogle &&
    !hasTelegram &&
    !hasWhatsApp;
  if (onlyLegacyPhone || user.auth_provider === "firebase_phone") {
    out.push({ tone: "legacy_phone", label: "هاتف (قديم)" });
  }

  if (out.length === 0) out.push({ tone: "none", label: "—" });
  return out;
}

/**
 * Tailwind class set for each ProviderBadgeTone. Centralised so a future
 * theme change updates every admin badge in lockstep.
 */
export const PROVIDER_TONE_CLASS: Record<ProviderBadgeTone, string> = {
  google: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  telegram: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  whatsapp: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  legacy_phone: "text-muted-foreground bg-muted/30 border-border/40",
  none: "text-muted-foreground bg-muted/30 border-border/40",
};

// ─────────────────────────────────────────────────────────────────────────────
// Adapter — read a `user_*`-prefixed row (orders, topups, tickets)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape produced by /api/admin/orders, /api/admin/topups, and
 * /api/admin/tickets — each row carries the joined user's identity
 * fields under a `user_…` prefix (since the row is primarily about
 * the order/topup/ticket itself, not the user).
 */
export interface AdminUserScopedRow {
  user_phone?: string | null;
  user_display_name?: string | null;
  user_email?: string | null;
  user_auth_provider?: string | null;
  user_has_google?: boolean;
  user_has_telegram?: boolean;
  user_has_firebase?: boolean;
  user_has_whatsapp?: boolean;
}

/**
 * Map a `user_*`-prefixed row into the AdminUserShape the display
 * helpers expect. Keeps callsites short:
 *
 *   {displayUserName(userFromRow(order))}
 *   {userProviderBadges(userFromRow(topup))}
 */
export function userFromRow(row: AdminUserScopedRow): AdminUserShape {
  return {
    phone: row.user_phone ?? null,
    display_name: row.user_display_name ?? null,
    email: row.user_email ?? null,
    auth_provider: row.user_auth_provider ?? null,
    has_google: !!row.user_has_google,
    has_telegram: !!row.user_has_telegram,
    has_firebase: !!row.user_has_firebase,
    has_whatsapp: !!row.user_has_whatsapp,
  };
}
