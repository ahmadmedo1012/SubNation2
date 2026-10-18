import {
  Bell,
  Crown,
  Gift,
  MessageSquare,
  ShoppingBag,
  ShoppingCart,
  User,
  Wallet,
} from "lucide-react";
import { categoryLabel, LIVE_CATEGORY_SLUGS } from "@/lib/utils";

// R167 (layout decomposition): extracted verbatim from
// components/layout/Navbar.tsx — the drawers' shared data: the category
// shortcut table, the authed drawer's account-row table and the shared
// internal-scroll cap. Pure DATA (icon references + class tokens, no
// JSX), so it rides the nav-sections.ts idiom (the R137 admin-layout
// precedent: a React-free module any lane can import). DRAWER_CATEGORIES
// also feeds the desktop categories disclosure (one table, zero drift —
// by design since R132). The move only changes the data's home — zero
// behavior, zero markup change.

// R120-B1 (A3-F1): the guest drawer's category shortcuts. Mirrors the
// live slugs in lib/categories.ts (verified against the catalog).
// R134 (A2-F1): labels DERIVE from categoryLabel() (lib/utils — the
// canonical chip-brevity map; home.tsx's chips derive from it too) —
// the hand-rolled table was the drifting fourth source («ذكاء اصطناعي»
// vs the canonical «أدوات ذكاء اصطناعي», «VPN وشبكات» vs «شبكات
// VPN», …). No bundle cost: Navbar already imports lib/utils (cn/
// formatCount), and CATEGORY_META itself stays out of the eager chunk.
// R146 (components audit F2): the slug ORDER now rides utils'
// LIVE_CATEGORY_SLUGS — the eager-safe twin of lib/category-registry's
// live rows (sync pinned by category-registry.test.ts). Importing the
// registry itself here would hoist its lucide icon set into the eager
// entry chunk (the R120-B5 eager-sum budget) for icons this surface
// never renders — the drawer's rows are text links.
export const DRAWER_CATEGORIES = LIVE_CATEGORY_SLUGS.map((slug) => ({
  slug,
  label: categoryLabel(slug),
}));

// R135 (FE-1 / R124-A4 #5): the authed drawer's account rows — the escape
// hatch an authed phone needs once the bottom nav hides (landscape
// <480px height — MobileNav's max-height fallback) and, before this round,
// the hamburger was guest-only, leaving «المحفظة/طلباتي/حسابي» unreachable
// until rotation. Order is money-first (wallet → orders → cart → profile),
// then the engagement cluster (loyalty/referrals/notifications/support).
// The row icons: ShoppingBag is MobileNav's «طلباتي» tab idiom; Crown/Gift
// mirror /profile's quick-links table; Bell the NotificationBell trigger;
// MessageSquare the bell's support TYPE_CONFIG. One per-route vocabulary
// across every nav surface (R135 FE-1).
export const AUTHED_DRAWER_LINKS = [
  { href: "/wallet", icon: Wallet, label: "المحفظة" },
  { href: "/orders", icon: ShoppingBag, label: "طلباتي" },
  { href: "/cart", icon: ShoppingCart, label: "السلة" },
  { href: "/profile", icon: User, label: "حسابي" },
  { href: "/loyalty", icon: Crown, label: "الولاء" },
  { href: "/referrals", icon: Gift, label: "الإحالات" },
  { href: "/notifications", icon: Bell, label: "الإشعارات" },
  { href: "/support", icon: MessageSquare, label: "الدعم الفني" },
] as const;

// R135 (FE-1): BOTH drawers scroll internally — the authed variant (8
// account rows + the category grid + logout ≈ 700px of rows) outgrows a
// landscape viewport while the body is scroll-locked (an open drawer owns
// the whole scroll), so without an internal scroller the tail rows
// (تسجيل الخروج) sit unreachable exactly in the stranding scenario the
// drawer exists to fix; the guest drawer rides the same scroll-lock and
// has the same latent geometry, so both share one cap. The portrait cap
// mirrors the codebase's below-header offset (home.tsx
// top-[calc(3.5rem_+_env(safe-area-inset-top))]) PLUS the MobileNav
// clearance idiom (mobile-sticky-above-nav: --mobile-nav-h + env inset)
// so the panel stops above the fixed bottom nav instead of running under
// it; the ≤480px variant drops that reservation because the nav itself
// hides there — the keyboard fallback pinned by mobile-nav-clearance.
export const DRAWER_SCROLL_CAP =
  "max-h-[calc(100dvh_-_3.5rem_-_env(safe-area-inset-top)_-_var(--mobile-nav-h)_-_env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain [@media(max-height:480px)]:max-h-[calc(100dvh_-_3.5rem_-_env(safe-area-inset-top))]";
