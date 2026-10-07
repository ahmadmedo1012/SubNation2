/**
 * R120-B4 (A2-F1) — admin nav scope ↔ backend permission parity.
 *
 * The coupons nav item was scoped `inventory` while EVERY coupon admin
 * API enforces requirePermission("finance") (backend/src/routes/
 * coupons.ts list/create/patch/delete): an inventory-only operator saw
 * the nav item, clicked it, and hit a 403 wall — RBAC drift between the
 * shell's visibility gate and the server's enforcement.
 *
 * This suite pins the parity two ways:
 *
 *   1. EXPLICIT source pins for the drift-prone cases — coupons (leaf
 *      route file with per-route requirePermission) and promotions
 *      (router-level mount gate in admin/index.ts). The test reads the
 *      actual backend source and fails when either side drifts, so a
 *      future scope change must update BOTH files consciously.
 *   2. A static table for the remaining scoped nav items (their gates
 *      live in admin/index.ts mounts), asserting every item carries a
 *      scope from the real permission catalog.
 *
 * Source-scan pattern follows no-native-confirm.test.ts (readFileSync).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "@/pages/admin/layout";

type NavItem = { href: string; label: string; scope?: string };

const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) =>
  s.items.map((i) => ({
    href: i.href,
    label: i.label,
    ...("scope" in i ? { scope: (i as { scope?: string }).scope } : {}),
  })),
);

const navItem = (href: string) => NAV_ITEMS.find((i) => i.href === href);

function backendSource(rel: string): string {
  // The frontend vitest cwd is frontend/ — the backend tree is a sibling.
  return readFileSync(resolve(process.cwd(), "..", "backend", "src", rel), "utf8");
}

describe("AdminLayout nav scope ↔ API permission parity (R120-B4 A2-F1)", () => {
  it("coupons: nav scope matches the finance gate every coupon admin API enforces", () => {
    const item = navItem("/admin/coupons");
    expect(item).toBeDefined();
    // THE F1 pin: the nav scope must be finance, not inventory.
    expect(item?.scope).toBe("finance");

    // Parity against the real backend: every requirePermission on the
    // coupons admin surface must be finance. If someone re-scopes the
    // API (or re-scopes the nav), this fails and forces a conscious
    // update of both sides.
    const src = backendSource("routes/coupons.ts");
    const scopes = [...src.matchAll(/requirePermission\("([a-z]+)"\)/g)].map((m) => m[1]);
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes).toContain("finance");
    expect(scopes.every((s) => s === "finance")).toBe(true);
  });

  it("promotions: nav scope matches the inventory mount gate on the flash-sales router", () => {
    const item = navItem("/admin/promotions");
    expect(item).toBeDefined();
    expect(item?.scope).toBe("inventory");

    // The promotions page rides the adminFlashSalesRouter mount, gated
    // requirePermission("inventory") in admin/index.ts.
    const src = backendSource("routes/admin/index.ts");
    const mountMatch = src.match(/requirePermission\("inventory"\),\s*\n\s*adminFlashSalesRouter/s);
    expect(mountMatch).not.toBeNull();
  });

  it("every scoped nav item carries a scope from the permission catalog (no typos, no orphans)", () => {
    // The scopes the backend permission catalog actually defines (see
    // lib/permissions.ts PERMISSION_SCOPES + the admin/index.ts mounts).
    const CATALOG = [
      "finance",
      "orders",
      "support",
      "inventory",
      "users",
      "admins",
      "settings",
    ] as const;
    const scoped = NAV_ITEMS.filter((i) => "scope" in i);
    expect(scoped.length).toBeGreaterThan(10);
    for (const item of scoped) {
      expect(CATALOG).toContain(item.scope);
    }
  });

  it("the documented mount-gated mappings stay pinned (drift breaks this table)", () => {
    // R120-B4: toEqual(arrayContaining(objectContaining(…))) — the nav
    // items carry more keys than the table pins (label/icon/badgeKey),
    // so each pinned entry is an objectContaining subset and the
    // arrayContaining wrapper allows the extra nav items around them.
    // (toMatchObject(arrayContaining(…)) does not resolve asymmetric
    // matchers at the top level — it paired elements index-wise and
    // failed on the label the subset never mentioned.)
    expect(NAV_ITEMS.filter((i) => "scope" in i)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "/admin/topups", scope: "finance" }),
        expect.objectContaining({ href: "/admin/orders", scope: "orders" }),
        expect.objectContaining({ href: "/admin/tickets", scope: "support" }),
        expect.objectContaining({ href: "/admin/alerts", scope: "support" }),
        expect.objectContaining({ href: "/admin/products", scope: "inventory" }),
        expect.objectContaining({ href: "/admin/users", scope: "users" }),
        expect.objectContaining({ href: "/admin/referrals", scope: "users" }),
        expect.objectContaining({ href: "/admin/coupons", scope: "finance" }),
        expect.objectContaining({ href: "/admin/promotions", scope: "inventory" }),
        expect.objectContaining({ href: "/admin/admins", scope: "admins" }),
        expect.objectContaining({ href: "/admin/risk", scope: "users" }),
        expect.objectContaining({ href: "/admin/security", scope: "admins" }),
        expect.objectContaining({ href: "/admin/system", scope: "settings" }),
        expect.objectContaining({ href: "/admin/whatsapp", scope: "settings" }),
      ]),
    );
  });
});
