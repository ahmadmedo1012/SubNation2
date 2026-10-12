import {
  PROVIDER_TONE_CLASS,
  userProviderBadges,
  type AdminUserShape,
} from "@/lib/admin/user-display";

// R137 (FE) decomposition: extracted verbatim from pages/admin/users.tsx —
// the compact auth-provider pill row (Google/Telegram/Firebase merge
// visibility) that rides the desktop row and the mobile card. Pure
// function of the row's provider flags — the user flows down as a prop.
// The move only changes its address; DOM, classes and aria are
// byte-identical.

/**
 * Compact pill row showing which auth providers are linked to a given
 * user. Backed by the boolean flags surfaced in /api/admin/users
 * (has_google / has_telegram / has_firebase).
 *
 * If multiple are linked, all show — admins can quickly see merged
 * accounts.
 *
 * Uses the relaxed `Record<string, unknown>` pattern because the
 * generated AdminUser type doesn't yet include the new fields. We
 * read them via bracket access + `Boolean(…)` so a missing field is
 * silently treated as absent rather than throwing a TS error.
 */
export function ProviderBadges({ user }: { user: Record<string, unknown> }) {
  const badges = userProviderBadges(user as AdminUserShape);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {badges.map((b) => (
        <span
          key={b.label}
          className={`text-3xs font-bold px-1.5 py-0.5 rounded-md border ${PROVIDER_TONE_CLASS[b.tone]}`}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}
