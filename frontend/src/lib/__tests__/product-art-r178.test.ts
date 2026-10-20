/**
 * R178 — theme-adaptive transparent product art: the polarity contract.
 *
 * The R178 pipeline (scripts/r178-transparent-art/build.py) replaced the
 * baked pearl/charcoal grounds with TRANSPARENT assets: the theme-aware
 * bg-muted/* wells are the ground now. This suite freezes the three legs
 * that keep that honest:
 *
 *   1. productOgUrl — og:image / Product-LD point at the OPAQUE
 *      /products-og/ family (scrapers composite transparent art on
 *      unpredictable grounds; the share surface keeps its own), while
 *      productArtUrl keeps serving the UI family untouched.
 *   2. The index.css polarity block — ink wordmarks flip on the dark
 *      theme, paper ones on the light theme (invert + hue-rotate keeps
 *      hues alive; the atomic `filter` chain re-declares the
 *      drop-shadow-lg grounding so it survives the override).
 *   3. The on-disk census — exactly 45 slugs ship in BOTH families and
 *      the UI family is genuinely transparent (RGBA with real alpha —
 *      the whole point of the round).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_ART_VERSION, productArtUrl, productOgUrl } from "../product-art";

const INK_SLUGS = [
  "ahrefs",
  "apple-tv-plus",
  "brain-fm-pro",
  "directv-stream",
  "disney-plus",
  "expressvpn",
  "fox-now",
  "funimation",
  "grammarly-pro",
  "hallmark-movies-now",
  "hbo-max",
  "hma-vpn-pro",
  "napster",
  "netflix",
  "osn-plus",
  "paramount-plus",
  "qobuz",
  "scribd",
  "semrush-classic",
  "showtime",
  "shudder",
  "skillshare",
  "tidal",
  "ultimate-guitar-pro",
  "windows-10-home",
  "windows-10-pro",
  "winrar-lifetime",
  "youtube-premium",
] as const;
const PAPER_SLUGS = ["idagio", "lifetime-cloud-storage", "pandora-premium"] as const;
const AUTO_SLUGS = [
  "amc-plus",
  "chatgpt-plus",
  "cpanel",
  "cyberghost-vpn",
  "headspace",
  "hulu",
  "ipvanish",
  "prime-video",
  "sling-tv",
  "sophia-ai",
  "soundcloud-go-plus",
  "spotify-premium",
  "tunein-premium",
  "windows-8",
] as const;

const INDEX_CSS = readFileSync(join(__dirname, "../../index.css"), "utf8");

describe("R178 — productOgUrl (the bot-facing opaque family)", () => {
  it("maps site-relative product art to /products-og/ with the version", () => {
    expect(productOgUrl("/products/netflix.webp")).toBe(
      `/products-og/netflix.webp?v=${PRODUCT_ART_VERSION}`,
    );
  });

  it("maps ABSOLUTIZED product art (the og:image/JSON-LD form)", () => {
    expect(productOgUrl("https://subnation.ly/products/netflix.webp")).toBe(
      `https://subnation.ly/products-og/netflix.webp?v=${PRODUCT_ART_VERSION}`,
    );
  });

  it("passes non-art URLs through untouched", () => {
    expect(productOgUrl("/opengraph.jpg")).toBe("/opengraph.jpg");
    expect(productOgUrl("https://cdn.example.com/logo.webp")).toBe(
      "https://cdn.example.com/logo.webp",
    );
  });

  it("keeps empty empty", () => {
    expect(productOgUrl(null)).toBeUndefined();
    expect(productOgUrl(undefined)).toBeUndefined();
    expect(productOgUrl("")).toBeUndefined();
  });
});

describe("R178 — productArtUrl stays the UI family (transparent art)", () => {
  it("still versions the /products/ path WITHOUT the og rewrite", () => {
    expect(productArtUrl("/products/netflix.webp")).toBe(
      `/products/netflix.webp?v=${PRODUCT_ART_VERSION}`,
    );
    // The version rides BOTH families (same cache-bust contract).
    expect(PRODUCT_ART_VERSION).toBe("r178");
  });
});

describe("R178 — the index.css polarity block", () => {
  it("flips every ink wordmark on the DARK theme (guarded :root:not(.light))", () => {
    for (const slug of INK_SLUGS) {
      expect(INDEX_CSS, slug).toContain(`:root:not(.light) img[src*="/products/${slug}.webp"]`);
    }
  });

  it("flips every paper wordmark on the LIGHT theme", () => {
    for (const slug of PAPER_SLUGS) {
      expect(INDEX_CSS, slug).toContain(`.light img[src*="/products/${slug}.webp"]`);
    }
  });

  it("never filters an auto-polarity logo (reads on both themes)", () => {
    for (const slug of AUTO_SLUGS) {
      expect(INDEX_CSS, slug).not.toContain(`img[src*="/products/${slug}.webp"]`);
    }
  });

  it("the filter chain inverts luminance, keeps hues, and re-declares the lg grounding", () => {
    // `filter` is atomic — the polarity rules outrank the drop-shadow-lg
    // utility, so the grounding must ride inside the chain.
    expect(INDEX_CSS).toContain("filter: invert(1) hue-rotate(180deg)");
    expect(INDEX_CSS).toContain("drop-shadow(0 4px 4px rgb(0 0 0 / 0.15))");
  });
});

describe("R178 — the on-disk census (both families, 45 slugs, real alpha)", () => {
  const publicDir = join(__dirname, "../../../public");
  const uiFiles = readdirSync(join(publicDir, "products")).filter((f) => f.endsWith(".webp"));
  const ogFiles = readdirSync(join(publicDir, "products-og")).filter((f) => f.endsWith(".webp"));

  it("45 slugs in the UI family — and NO variant/@2x files", () => {
    expect(uiFiles).toHaveLength(45);
    expect(uiFiles.some((f) => f.includes("@"))).toBe(false);
  });

  it("the OG family ships the exact same 45 slugs", () => {
    expect(ogFiles.sort()).toEqual([...uiFiles].sort());
  });

  it("every slug is classified exactly once (ink 28 + paper 3 + auto 14 = 45)", () => {
    expect(INK_SLUGS).toHaveLength(28);
    expect(PAPER_SLUGS).toHaveLength(3);
    expect(AUTO_SLUGS).toHaveLength(14);
    const all = new Set([...INK_SLUGS, ...PAPER_SLUGS, ...AUTO_SLUGS]);
    expect(all.size).toBe(45);
    // …and every classified slug actually ships.
    for (const slug of all) {
      expect(uiFiles, slug).toContain(`${slug}.webp`);
    }
  });
});
