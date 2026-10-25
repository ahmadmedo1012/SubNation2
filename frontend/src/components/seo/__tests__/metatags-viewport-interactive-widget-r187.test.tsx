/**
 * R187 (H-F1) — the runtime viewport rewrite keeps the R96 Android
 * keyboard key.
 *
 * MetaTags re-upserts meta[name=viewport] on EVERY route (the V3-A1
 * head manager's upsert contract). Its content string used to be the
 * legacy short form — "width=device-width, initial-scale=1,
 * viewport-fit=cover" — while the static shell (index.html) ships
 * "..., interactive-widget=resizes-content" (the R96 P2-2a Android
 * keyboard reflow fix: resizes-visual never reflows the page under the
 * virtual keyboard). Navbar's MutationObserver guard re-appends the
 * key, but Navbar is gated !isAdmin && !isChromeless (routes.tsx)
 * while the fallback MetaTags mounts unconditionally — so every
 * /admin/* boot (login, 2FA, the product editor — the keyboard-critical
 * admin surface) permanently lost the key after React mounted.
 *
 * Fix: the MetaTags upsert string is now byte-identical to the static
 * shell. Pin: pre-seed the static-shell viewport meta exactly as
 * index.html ships it, render MetaTags (the instance an /admin boot
 * mounts), and assert the runtime rewrite PRESERVES the key in place.
 */

import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MetaTags } from "@/components/seo/MetaTags";

/** The static shell's viewport content (index.html) — read LIVE so the
 * runtime-vs-static parity the fix claims is pinned against the real
 * shipped string, not a second hand-copied twin (a drifting copy here
 * would be exactly the H-F1 class again). */
const STATIC_VIEWPORT = (() => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const meta = html.match(/<meta[^>]*name="viewport"[^>]*>/)?.[0] ?? "";
  return meta.match(/content="([^"]*)"/)?.[1] ?? "";
})();

function viewportContent(): string | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? null;
}

afterEach(() => {
  // MetaTags never removes what it upserted on unmount (R122 A7) —
  // reset between tests so each starts from a clean <head>.
  document.querySelector('meta[name="viewport"]')?.remove();
});

describe("MetaTags — the viewport upsert keeps interactive-widget (R187 H-F1)", () => {
  it("harness truth: the static shell ships the key (index.html unchanged)", () => {
    expect(STATIC_VIEWPORT).toContain("interactive-widget=resizes-content");
    expect(STATIC_VIEWPORT).toContain("viewport-fit=cover");
  });

  it("a route's apply() rewrites the PRE-SEEDED static-shell viewport WITHOUT stripping the key", () => {
    // The /admin boot shape: the static shell's meta is in the head,
    // then React mounts and MetaTags' apply() upserts over it (the
    // fallback instance mounts unconditionally on admin routes — the
    // exact path Navbar's storefront-only guard never covers).
    const meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    meta.setAttribute("content", STATIC_VIEWPORT);
    document.head.appendChild(meta);

    render(
      <MetaTags
        title="اختبار"
        description="وصف الاختبار"
        path="/admin/products"
        robots="noindex,follow"
      />,
    );

    // The rewrite is IN PLACE (the upsert contract — same element, no
    // duplicate)…
    const tags = document.head.querySelectorAll('meta[name="viewport"]');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toBe(meta);
    // …and the rewritten content is byte-identical to the static shell:
    // the Android keyboard reflow key survives the runtime rewrite.
    expect(viewportContent()).toBe(STATIC_VIEWPORT);
    expect(viewportContent()).toContain("interactive-widget=resizes-content");
  });

  it("a bare boot (no pre-seeded meta) CREATES the viewport with the key", () => {
    // The upsert's create arm carries the same string — a head without
    // the static tag (tests, exotic embeds) still gets the full key.
    render(<MetaTags title="اختبار" description="وصف الاختبار" path="/" />);

    expect(viewportContent()).toContain("interactive-widget=resizes-content");
    expect(viewportContent()).toContain("viewport-fit=cover");
  });
});
