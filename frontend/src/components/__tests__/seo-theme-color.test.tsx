/**
 * 94-C3 — seo/MetaTags theme-color (A3 P3-6).
 *
 * The browser-chrome tint was a single raw #e11d48 — a rose hex that
 * matches neither theme's --primary (dark 348 80% 48% ≈ #dc1840 /
 * light 348 80% 46% ≈ #d3173d). These tests pin the two-value,
 * media-scoped replacement:
 *
 *   1. Base (no media) tag carries the dark-theme primary — also the
 *      fallback for browsers that ignore `media` on theme-color, which
 *      matches the app's default dark chrome.
 *   2. A second tag scoped to `(prefers-color-scheme: light)` carries
 *      the light-theme primary.
 *   3. Upsert semantics: re-rendering a route's MetaTags never
 *      duplicates the tags (the whole point of the V3-A1 head manager).
 */

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MetaTags } from "@/components/seo/MetaTags";

const BASE_INPUT = { title: "اختبار", description: "وصف الاختبار", path: "/" };

function themeColorTags(): HTMLMetaElement[] {
  return Array.from(document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
}

afterEach(() => {
  // MetaTags' unmount doesn't remove head tags it upserted — reset
  // between tests so each starts from a clean <head>.
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((t) => t.remove());
});

describe("MetaTags — theme-color rides the brand ramp (A3 P3-6)", () => {
  it("writes a base tag with the dark-theme primary (#dc1840, no media)", () => {
    render(<MetaTags {...BASE_INPUT} />);

    const base = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
    expect(base).not.toBeNull();
    expect(base!.getAttribute("content")).toBe("#dc1840");
  });

  it("writes a light-scheme tag with the light-theme primary (#d3173d)", () => {
    render(<MetaTags {...BASE_INPUT} />);

    const light = document.head.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"][media="(prefers-color-scheme: light)"]',
    );
    expect(light).not.toBeNull();
    expect(light!.getAttribute("content")).toBe("#d3173d");
  });

  it("never duplicates the theme-color tags across re-renders (upsert semantics)", () => {
    const { rerender } = render(<MetaTags {...BASE_INPUT} />);
    rerender(<MetaTags {...BASE_INPUT} title="عنوان آخر" path="/other" />);

    const tags = themeColorTags();
    expect(tags).toHaveLength(2);
    // …and the raw legacy hex is gone from every one of them.
    for (const tag of tags) {
      expect(tag.getAttribute("content")).not.toBe("#e11d48");
    }
  });
});
