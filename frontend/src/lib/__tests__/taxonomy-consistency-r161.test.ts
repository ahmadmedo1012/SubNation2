/**
 * R161-C — the category taxonomy consistency net.
 *
 * The streaming category's label family said «بث مباشر» (live
 * broadcast) while every one of its 17 live products is an on-demand
 * viewing-platform subscription (Netflix, Disney+, Prime Video, Apple
 * TV+, YouTube Premium, HBO Max, Hulu, OSN+, Paramount+, Showtime,
 * AMC+, Sling, DirecTV, Fox Now, Funimation, Hallmark, Shudder) — a
 * semantic falsehood to customers and search engines. The music family
 * said plain «موسيقى» while 3 of its 11 live products are audio
 * services, not music (TuneIn radio, Headspace meditation, Brain.fm
 * focus audio). This suite pins the honest vocabulary across ALL THREE
 * label maps (utils' chip-brevity categoryLabel, the registry's
 * adminLabel, categories.ts's landing meta) so a future edit cannot
 * silently fork them:
 *
 *   streaming → «منصات المشاهدة» (chip = admin; landing label/h1 ride
 *               the same vocabulary)
 *   music     → «موسيقى وصوتيات» (chip = admin; landing «الموسيقى
 *               والصوتيات»)
 *
 * Plus a source guard: none of the four canonical label sources (the
 * three above + the backend spa-shell mirror) may carry the old
 * live-broadcast phrase again — the Sling TV / DirecTV Stream keyword
 * blocks in docs/SEO_PRODUCTS.json are the only sanctioned homes for
 * it (those two products genuinely ARE live-TV services).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { categoryLabel, LIVE_CATEGORY_SLUGS } from "@/lib/utils";
import { LIVE_CATEGORY_ROWS } from "@/lib/category-registry";
import { CATEGORY_META } from "@/lib/categories";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** The R161-C canonical values — byte-exact, all three maps. */
const STREAMING_LABEL = "منصات المشاهدة";
const MUSIC_LABEL = "موسيقى وصوتيات";

// ── (a) chip-brevity: categoryLabel IS the registry label ─────────────────

describe("R161-C (a) — categoryLabel is the registry label, new values byte-exact", () => {
  it("every live row's label rides utils.categoryLabel (no fork)", () => {
    expect([...LIVE_CATEGORY_SLUGS]).toEqual(LIVE_CATEGORY_ROWS.map((row) => row.slug));
    for (const row of LIVE_CATEGORY_ROWS) {
      expect(row.label).toBe(categoryLabel(row.slug));
    }
  });

  it("the two R161-C values are pinned explicitly (a future edit cannot drift them)", () => {
    expect(categoryLabel("streaming")).toBe(STREAMING_LABEL);
    expect(categoryLabel("music")).toBe(MUSIC_LABEL);
    // The retired pair stays byte-identical (labels only — no slug or
    // historical-record renames in R161-C).
    expect(categoryLabel("gaming")).toBe("ألعاب");
    expect(categoryLabel("productivity")).toBe("إنتاجية");
    // Every OTHER live category's label is untouched by the rename.
    expect(categoryLabel("software")).toBe("برامج وتراخيص");
    expect(categoryLabel("vpn")).toBe("شبكات VPN");
    expect(categoryLabel("ai-tools")).toBe("أدوات ذكاء اصطناعي");
    expect(categoryLabel("seo-tools")).toBe("أدوات SEO");
    expect(categoryLabel("education")).toBe("تعليم ومكتبات");
  });
});

// ── (b) adminLabel: identical to the label, except where documented ────────

describe("R161-C (b) — registry adminLabel equals the label (documented exceptions only)", () => {
  it("streaming + music: adminLabel is byte-exactly the new chip label", () => {
    const streaming = LIVE_CATEGORY_ROWS.find((row) => row.slug === "streaming")!;
    const music = LIVE_CATEGORY_ROWS.find((row) => row.slug === "music")!;
    expect(streaming.adminLabel).toBe(STREAMING_LABEL);
    expect(streaming.adminLabel).toBe(streaming.label);
    expect(music.adminLabel).toBe(MUSIC_LABEL);
    expect(music.adminLabel).toBe(music.label);
  });

  it("the ONLY label/adminLabel divergence is ai-tools, and the registry documents it", () => {
    const registrySrc = read("src/lib/category-registry.ts");
    const diverging = LIVE_CATEGORY_ROWS.filter((row) => row.adminLabel !== row.label);
    // ai-tools keeps its deliberate definite-article admin form —
    // documented in the registry's own docblock (R146), which this
    // asserts so the exception can never go undocumented.
    expect(diverging.map((row) => row.slug)).toEqual(["ai-tools"]);
    expect(registrySrc).toContain("definite article on ai-tools");
  });
});

// ── (c) landing labels: the definite-article form of the same vocabulary ──

describe("R161-C (c) — categories.ts labels are the landing form of the chip vocabulary", () => {
  /** Strip the definite article/conjunction prefixes the landing form
   *  adds (ال + the و…ال conjunct) so the two maps can be compared at
   *  the vocabulary level: «موسيقى وصوتيات» ≡ «الموسيقى والصوتيات». */
  function vocabWords(label: string): string[] {
    return label
      .split(/\s+/)
      .map((w) => w.replace(/^و?ال/, "").replace(/^و(?=.)/, ""))
      .filter(Boolean);
  }

  it("streaming's landing label CONTAINS «منصات المشاهدة» (mission contract)", () => {
    expect(CATEGORY_META.streaming.label).toContain(STREAMING_LABEL);
    expect(CATEGORY_META.streaming.h1).toContain(STREAMING_LABEL);
    // The landing metaTitle rides the same vocabulary inside the ≤60
    // budget the runtime clamp enforces (55 chars).
    expect(CATEGORY_META.streaming.metaTitle).toContain(STREAMING_LABEL);
    expect(CATEGORY_META.streaming.metaTitle.length).toBeLessThanOrEqual(60);
  });

  it("music's landing label/h1 ride «الموسيقى والصوتيات»", () => {
    expect(CATEGORY_META.music.label).toBe("الموسيقى والصوتيات");
    expect(CATEGORY_META.music.h1).toBe("اشتراكات الموسيقى والصوتيات في ليبيا");
    // Coordinator decision: music's metaTitle is UNCHANGED — the search
    // intent is موسيقى.
    expect(CATEGORY_META.music.metaTitle).toBe("اشتراكات الموسيقى في ليبيا — Spotify | SubNation");
  });

  it("every live slug's landing label is the definite-article form of its chip label", () => {
    expect(Object.keys(CATEGORY_META).sort()).toEqual([...LIVE_CATEGORY_SLUGS].sort());
    for (const row of LIVE_CATEGORY_ROWS) {
      const landing = CATEGORY_META[row.slug as keyof typeof CATEGORY_META].label;
      expect(
        vocabWords(landing),
        `${row.slug}: landing «${landing}» must carry the chip vocabulary «${row.label}»`,
      ).toEqual(vocabWords(row.label));
    }
  });
});

// ── (d) source guard: the four canonical label sources stay clean ─────────

describe("R161-C (d) — no canonical label source carries the retired live-broadcast phrase", () => {
  // The phrase is retired from the taxonomy: streaming sells on-demand
  // platforms, not live broadcast. It stays ONLY where it is TRUE — the
  // Sling TV / DirecTV Stream keyword blocks in docs/SEO_PRODUCTS.json
  // (genuinely live-TV services; deliberately outside this guard's
  // scope). The shadda variant (بثّ) and line-breaks inside the phrase
  // are both matched — the R161-E census caught exactly that escape in
  // GuestHero.
  const RETIRED_PHRASE = /بثّ?\s*مباشر/;
  const CANONICAL_SOURCES = [
    "src/lib/utils.ts",
    "src/lib/category-registry.ts",
    "src/lib/categories.ts",
    "../backend/src/lib/shell-meta.ts",
  ] as const;

  it.each([...CANONICAL_SOURCES])(
    "%s carries no «بث مباشر» anywhere (labels or comments)",
    (rel) => {
      expect(read(rel)).not.toMatch(RETIRED_PHRASE);
    },
  );

  it("the backend spa-shell mirror still carries the streaming metaTitle verbatim", () => {
    // The parity suite (backend/src/__tests__/spa-shell-category-parity)
    // already pins both sides via imports; this pins the MIRROR from
    // the frontend tree too, so a one-sided edit fails closest to home.
    expect(read("../backend/src/lib/shell-meta.ts")).toContain(
      `metaTitle: "${CATEGORY_META.streaming.metaTitle}"`,
    );
  });
});
