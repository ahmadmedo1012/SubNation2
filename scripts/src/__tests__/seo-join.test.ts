import { describe, expect, it, vi } from "vitest";
import { resolveSeoTarget, type SeoTargetPredicate } from "../seo-join";

/**
 * R162-B — pins the SEO importer's join priority. The old single
 * `or(eq(slug), eq(name)).limit(1)` query documented "slug first, name
 * fallback" but implemented no priority: a slug-vs-name conflict (or a
 * duplicate name) resolved to an arbitrary row, so which product an
 * entry updated depended on scan order. resolveSeoTarget sequences the
 * two lookups; these tests pin that sequencing against the live drift
 * shapes observed in the R162 census (netflix/disney-plus/prime-video/
 * apple-tv-plus resolve via the exact-name fallback; spotify-premium
 * via slug despite the "Spotify" vs "Spotify Premium" name drift).
 */

const slugRow = { id: 1, slug: "netflix-premium", name: "Netflix" };
const nameRow = { id: 2, slug: "some-other-product", name: "Netflix" };

function makeFind(
  bySlug: Record<string, object | undefined>,
  byName: Record<string, object | undefined>,
) {
  return vi.fn(async (p: SeoTargetPredicate) =>
    p.by === "slug" ? bySlug[p.slug] : byName[p.name],
  );
}

describe("resolveSeoTarget (deterministic slug-first join)", () => {
  it("a slug match WINS even when the exact name matches a DIFFERENT row", async () => {
    const find = makeFind({ "netflix-premium": slugRow }, { Netflix: nameRow });
    await expect(resolveSeoTarget(find, "netflix-premium", "Netflix")).resolves.toBe(slugRow);
    // Priority is structural, not ordering luck: the name lookup is
    // never even issued when the slug matched.
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({ by: "slug", slug: "netflix-premium" });
  });

  it("falls back to the exact product_name lookup only when the slug matched nothing", async () => {
    // The live netflix shape: JSON slug "netflix" matches no live row,
    // but product_name "Netflix" matches netflix-premium (id=1).
    const find = makeFind({}, { Netflix: { id: 1, slug: "netflix-premium", name: "Netflix" } });
    await expect(resolveSeoTarget(find, "netflix", "Netflix")).resolves.toEqual({
      id: 1,
      slug: "netflix-premium",
      name: "Netflix",
    });
    expect(find).toHaveBeenNthCalledWith(1, { by: "slug", slug: "netflix" });
    expect(find).toHaveBeenNthCalledWith(2, { by: "name", name: "Netflix" });
  });

  it("normalizes the slug (trim + lowercase) before the slug lookup", async () => {
    const find = makeFind({ "disney-plus": { id: 3 } }, {});
    await expect(resolveSeoTarget(find, "  Disney-PLUS  ", "Disney+")).resolves.toEqual({ id: 3 });
    expect(find).toHaveBeenCalledWith({ by: "slug", slug: "disney-plus" });
  });

  it("passes product_name through VERBATIM (exact-match fallback, no case folding)", async () => {
    const find = makeFind({}, { "Prime Video": { id: 17 } });
    await expect(resolveSeoTarget(find, "prime-video", "Prime Video")).resolves.toEqual({ id: 17 });
    expect(find).toHaveBeenLastCalledWith({ by: "name", name: "Prime Video" });
  });

  it("resolves to undefined (the importer's 'missing' classification) when neither matches", async () => {
    const find = makeFind({}, {});
    await expect(resolveSeoTarget(find, "ghost-slug", "Ghost Product")).resolves.toBeUndefined();
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("skips the slug lookup entirely for an empty or whitespace-only slug", async () => {
    const find = makeFind({}, { Hulu: { id: 26 } });
    await expect(resolveSeoTarget(find, "   ", "Hulu")).resolves.toEqual({ id: 26 });
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({ by: "name", name: "Hulu" });
  });
});
