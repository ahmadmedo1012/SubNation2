import express from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, initTestDb, productVariantsTable, productsTable, resetTestDb } from "../../test/db";
import { productsRouter } from "../products";

/**
 * R122 (A11-F2): Arabic-search integration over the REAL public products
 * route + the pglite harness — the exact defect shape from the live audit
 * (r122-a11 §P1-1): product names are English, users search in Arabic,
 * and every Arabic query used to return 0 results.
 *
 * The seeded names mirror the live catalog's naming convention
 * ("Netflix Premium", "PlayStation Plus 12-Month", …) so the alias →
 * English-token bridge is exercised against realistic name columns.
 *
 * Also pins the invariants the expansion must NOT disturb:
 *   - pure-English queries behave exactly as before (single whole-string
 *     ILIKE — no per-token widening);
 *   - escapeLikeTerm safety survives (a literal % or _ never widens the
 *     pattern into match-everything);
 *   - active/archived filters still AND with the search condition;
 *   - search requests stay live/uncacheable (B6-02) — no LRU
 *     cross-contamination between two different queries.
 */

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/products", productsRouter);
  return app;
}

async function call<T = unknown>(
  app: express.Express,
  path: string,
): Promise<{ status: number; body: T; text: string; cacheControl: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
          headers: { Accept: "application/json" },
        });
        const text = await res.text();
        const body = text ? JSON.parse(text) : null;
        resolve({
          status: res.status,
          body: body as T,
          text,
          cacheControl: res.headers.get("cache-control") ?? "",
        });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

type ProductRow = { name: string; slug: string | null };

/** Search by name over the public list payload. */
async function searchNames(app: express.Express, query: string): Promise<string[]> {
  const { status, body } = await call<ProductRow[]>(
    app,
    `/api/products?search=${encodeURIComponent(query)}`,
  );
  expect(status, `search=${JSON.stringify(query)} must be 200 (no SQL errors)`).toBe(200);
  return body.map((p) => p.name);
}

/** Live-catalog-shaped seed: English names, one per brand under test. */
async function seedCatalog() {
  await db.insert(productsTable).values([
    { name: "Netflix Premium", slug: "netflix-premium", price: "79.80", category: "streaming" },
    { name: "Spotify Premium", slug: "spotify-premium", price: "59.80", category: "music" },
    {
      name: "Disney+ Standard",
      slug: "disney-plus-standard",
      price: "49.80",
      category: "streaming",
    },
    {
      name: "PlayStation Plus 12-Month",
      slug: "playstation-plus-12-month",
      price: "299.00",
      category: "gaming",
    },
    { name: "ExpressVPN", slug: "expressvpn", price: "89.00", category: "vpn" },
    { name: "CyberGhost VPN", slug: "cyberghost-vpn", price: "69.00", category: "vpn" },
    { name: "ChatGPT Plus", slug: "chatgpt-plus", price: "99.00", category: "ai-tools" },
    { name: "Windows 10 Pro", slug: "windows-10-pro", price: "119.00", category: "software" },
    {
      name: "Lifetime Cloud Storage",
      slug: "lifetime-cloud-storage",
      price: "980.00",
      category: "software",
    },
    // Invisible rows — the search condition must still AND with the
    // active/archived filters.
    {
      name: "Netflix Legacy Archive",
      slug: "netflix-legacy",
      price: "10.00",
      category: "streaming",
      isArchived: true,
    },
    {
      name: "Netflix Hidden",
      slug: "netflix-hidden",
      price: "10.00",
      category: "streaming",
      isActive: false,
    },
  ]);
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R122 (A11-F2) — Arabic queries reach the English-named catalog", () => {
  it("«نتفليكس» (standard Arabic for Netflix) finds the Netflix product", async () => {
    await seedCatalog();
    const app = buildApp();
    await expect(searchNames(app, "نتفليكس")).resolves.toEqual(["Netflix Premium"]);
  });

  it("«نتفلكس» — the site's own hero transliteration — finds it too", async () => {
    await seedCatalog();
    const app = buildApp();
    await expect(searchNames(app, "نتفلكس")).resolves.toEqual(["Netflix Premium"]);
  });

  it("«سبوتفاي» finds Spotify", async () => {
    await seedCatalog();
    const app = buildApp();
    await expect(searchNames(app, "سبوتفاي")).resolves.toEqual(["Spotify Premium"]);
  });

  it("«بلاستيشن» (Libyan variant) finds PlayStation Plus", async () => {
    await seedCatalog();
    const app = buildApp();
    await expect(searchNames(app, "بلاستيشن")).resolves.toEqual(["PlayStation Plus 12-Month"]);
  });

  it("normalized Arabic still matches: tatweel, diacritics, definite article, spaceless compounds", async () => {
    await seedCatalog();
    const app = buildApp();
    // tatweel (kashida) stretching
    await expect(searchNames(app, "نتـفـلـكـس")).resolves.toEqual(["Netflix Premium"]);
    // tashkeel diacritics
    await expect(searchNames(app, "نَتْفَلِكْس")).resolves.toEqual(["Netflix Premium"]);
    // definite article prefix («النتفلكس» carries the alias inside)
    await expect(searchNames(app, "النتفلكس")).resolves.toEqual(["Netflix Premium"]);
    // typed without a space
    await expect(searchNames(app, "نتفلكسبريميوم")).resolves.toEqual(["Netflix Premium"]);
    // multi-word query with a filler word
    await expect(searchNames(app, "اشتراك نتفلكس")).resolves.toEqual(["Netflix Premium"]);
  });

  it("the generic «في بي ان» (VPN) resolves to every VPN product", async () => {
    await seedCatalog();
    const app = buildApp();
    await expect(searchNames(app, "في بي ان")).resolves.toEqual(
      expect.arrayContaining(["ExpressVPN", "CyberGhost VPN"]),
    );
  });

  it("a recognized brand that isn't stocked returns [] cleanly (no error, no phantom rows)", async () => {
    await seedCatalog();
    const app = buildApp();
    // «شاهد» (Shahid) is a hero-chip brand but not in this catalog.
    await expect(searchNames(app, "شاهد")).resolves.toEqual([]);
  });

  it("Arabic search never surfaces archived or deactivated products", async () => {
    await seedCatalog();
    const app = buildApp();
    const names = await searchNames(app, "نتفليكس");
    expect(names).toContain("Netflix Premium");
    expect(names).not.toContain("Netflix Legacy Archive");
    expect(names).not.toContain("Netflix Hidden");
  });

  it("the category filter still ANDs with the Arabic search condition", async () => {
    await seedCatalog();
    const app = buildApp();
    // Netflix is streaming; restricted to music the same query is empty.
    const { status, body } = await call<ProductRow[]>(
      app,
      `/api/products?search=${encodeURIComponent("نتفليكس")}&category=music`,
    );
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("R122 (A11-F2) — English + adversarial behavior is unchanged", () => {
  it("pure-English queries keep the exact pre-R122 single-condition semantics", async () => {
    await seedCatalog();
    const app = buildApp();
    await expect(searchNames(app, "netflix")).resolves.toEqual(["Netflix Premium"]);
    await expect(searchNames(app, "NETFLIX")).resolves.toEqual(["Netflix Premium"]);
    // multi-word English stays a WHOLE-STRING match (it found nothing
    // before R122 and still finds nothing — no per-token widening).
    await expect(searchNames(app, "netflix premium")).resolves.toEqual(["Netflix Premium"]);
    await expect(searchNames(app, "storage lifetime")).resolves.toEqual([]);
  });

  it("a garbage Arabic query returns [] cleanly (no SQL error, no brand false-positive)", async () => {
    await seedCatalog();
    const app = buildApp();
    await expect(searchNames(app, "خضار طازج")).resolves.toEqual([]);
    await expect(searchNames(app, "قمر")).resolves.toEqual([]);
  });

  it("LIKE wildcards in the query stay LITERAL (A6-9 escape parity)", async () => {
    await seedCatalog();
    const app = buildApp();
    // a bare % or _ must not act as a pattern wildcard (match-everything)
    await expect(searchNames(app, "%")).resolves.toEqual([]);
    await expect(searchNames(app, "_")).resolves.toEqual([]);
    await expect(searchNames(app, "100%")).resolves.toEqual([]);
    // …and a wildcard glued to a recognized brand still resolves via the
    // alias term without reshaping any pattern
    await expect(searchNames(app, "نتفلكس%")).resolves.toEqual(["Netflix Premium"]);
    await expect(searchNames(app, "نتفلكس_بريميوم")).resolves.toEqual(["Netflix Premium"]);
  });

  it("two different search queries never cross-contaminate (B6-02: search stays uncacheable)", async () => {
    await seedCatalog();
    const app = buildApp();
    // If a search-bearing request ever landed in the shared LRU, the
    // second (distinct) query could be served the first one's payload.
    await expect(searchNames(app, "نتفليكس")).resolves.toEqual(["Netflix Premium"]);
    await expect(searchNames(app, "خضار طازج")).resolves.toEqual([]);
    // …and the first query still resolves afterwards (no reverse pin).
    await expect(searchNames(app, "نتفليكس")).resolves.toEqual(["Netflix Premium"]);
  });

  it("mixed-script input behaves sanely: the Arabic token expands, Latin rides along (R132)", async () => {
    await seedCatalog();
    const app = buildApp();
    // "netflix نتفلكس": the whole string can never ILIKE-match a name, but
    // the recognized Arabic alias ORs the brand back in.
    await expect(searchNames(app, "netflix نتفلكس")).resolves.toEqual(["Netflix Premium"]);
    // R132: "netflix بريميوم" used to return [] (the Latin token was
    // dropped and the tier word was unrecognized) — the tier modifier now
    // ORs the %premium% branch, so the premium rows match honestly.
    await expect(searchNames(app, "netflix بريميوم")).resolves.toEqual([
      "Netflix Premium",
      "Spotify Premium",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R132 — round 2: category intent, mixed-script queries, duration/tier
// compounds, and exact-match-first ranking. NOTE (R142 I-2): this seed
// deliberately carries Latin duration/tier fragments INSIDE NAMES — it
// pins the name-fragment arm of the R132 tiers (real for names like
// "Windows 10 Pro"). It does NOT mirror the LIVE catalog's dominant
// shape (brand-level names + ARABIC variant labels) — that shape is
// pinned by seedLiveVariantCatalog in the R142 describe below.
// ═══════════════════════════════════════════════════════════════════════════

/** Plan-shaped catalog: duration/tier fragments in the names, every live
 * category represented — the realistic surface the R132 branches match. */
async function seedPlanCatalog() {
  await db.insert(productsTable).values([
    { name: "Netflix Premium 1-Month", slug: "netflix-1m", price: "79.80", category: "streaming" },
    {
      name: "Netflix Premium 12-Month",
      slug: "netflix-12m",
      price: "799.00",
      category: "streaming",
    },
    { name: "Hulu 1-Month", slug: "hulu-1m", price: "29.00", category: "streaming" },
    { name: "Spotify Premium 1-Month", slug: "spotify-1m", price: "59.80", category: "music" },
    { name: "Windows 10 Pro", slug: "win10-pro", price: "119.00", category: "software" },
    { name: "WinRAR Lifetime", slug: "winrar", price: "49.00", category: "software" },
    { name: "ChatGPT Plus 1-Month", slug: "chatgpt-1m", price: "99.00", category: "ai-tools" },
    { name: "ExpressVPN 1-Month", slug: "expressvpn-1m", price: "89.00", category: "vpn" },
    { name: "IPVanish VPN 1-Year", slug: "ipvanish-1y", price: "199.00", category: "vpn" },
    { name: "Ahrefs Lite 1-Month", slug: "ahrefs-lite", price: "450.00", category: "seo-tools" },
    { name: "Skillshare 1-Month", slug: "skillshare-1m", price: "39.00", category: "education" },
    // Ordering probe: a name that merely CONTAINS a brand vs one that
    // STARTS with it — the prefix tier must lead.
    { name: "Gift Netflix Card", slug: "gift-netflix", price: "10.00", category: "streaming" },
  ]);
}

describe("R132 — Arabic category intent reaches the category column", () => {
  it("«افلام» returns every streaming product (no English name means 'movies')", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    await expect(searchNames(app, "افلام")).resolves.toEqual(
      expect.arrayContaining([
        "Netflix Premium 1-Month",
        "Netflix Premium 12-Month",
        "Hulu 1-Month",
        "Gift Netflix Card",
      ]),
    );
    const names = await searchNames(app, "افلام");
    expect(names).toHaveLength(4);
    expect(names).not.toContain("Spotify Premium 1-Month");
  });

  it("«موسيقى» → the music category", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    await expect(searchNames(app, "موسيقى")).resolves.toEqual(["Spotify Premium 1-Month"]);
  });

  it("«برامج» → software; «مفاتيح» (activation keys) → software too", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    await expect(searchNames(app, "برامج")).resolves.toEqual(
      expect.arrayContaining(["Windows 10 Pro", "WinRAR Lifetime"]),
    );
    await expect(searchNames(app, "مفاتيح")).resolves.toEqual(
      expect.arrayContaining(["Windows 10 Pro", "WinRAR Lifetime"]),
    );
  });

  it("«ذكاء اصطناعي» (AI, multi-word) → the ai-tools category", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    await expect(searchNames(app, "ذكاء اصطناعي")).resolves.toEqual(["ChatGPT Plus 1-Month"]);
  });

  it("«سيو» → seo-tools (the name 'Ahrefs' carries no 'seo' — only the category path matches)", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    await expect(searchNames(app, "سيو")).resolves.toEqual(["Ahrefs Lite 1-Month"]);
  });

  it("«كورسات» → education", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    await expect(searchNames(app, "كورسات")).resolves.toEqual(["Skillshare 1-Month"]);
  });

  it("«في بي ان» returns EVERY vpn product via the category branch (name alias only substring-matched some)", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    await expect(searchNames(app, "في بي ان")).resolves.toEqual(
      expect.arrayContaining(["ExpressVPN 1-Month", "IPVanish VPN 1-Year"]),
    );
  });

  it("a category word ANDs with an explicit ?category= filter honestly (music word inside streaming filter → [])", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    const { status, body } = await call<ProductRow[]>(
      app,
      `/api/products?search=${encodeURIComponent("موسيقى")}&category=streaming`,
    );
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("R132 — mixed-script queries", () => {
  it("«netflix اشتراك» finds the Netflix products (the Latin token rides its own ILIKE branch)", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    const names = await searchNames(app, "netflix اشتراك");
    expect(names).toEqual(
      expect.arrayContaining(["Netflix Premium 1-Month", "Netflix Premium 12-Month"]),
    );
    expect(names).not.toContain("Hulu 1-Month");
  });

  it("«Spotify بريميوم» — the tier word widens to every premium row, but the Latin brand's prefix match LEADS", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    // No Arabic BRAND token ⇒ no compound — بريميوم ORs %premium% (recall:
    // the Netflix premium rows match too), and "Spotify" rides its Latin
    // branch. Ranking: "Spotify Premium 1-Month" starts with the term
    // (tier 1) while the Netflix rows only CONTAIN %premium% (tier 2).
    const names = await searchNames(app, "Spotify بريميوم");
    expect(names[0]).toBe("Spotify Premium 1-Month");
    expect(names).toEqual(
      expect.arrayContaining(["Netflix Premium 1-Month", "Netflix Premium 12-Month"]),
    );
  });

  it("pure-English multi-word search is unchanged (same rows, 200)", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    const names = await searchNames(app, "netflix premium");
    expect(names).toEqual(
      expect.arrayContaining(["Netflix Premium 1-Month", "Netflix Premium 12-Month"]),
    );
  });
});

describe("R132 — duration/tier compounds + exact-match-first ranking", () => {
  it("«نتفلكس شهر» ranks the month-plan Netflix products FIRST (compound tier), not by insertion order", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    const names = await searchNames(app, "نتفلكس شهر");
    // Both Netflix month plans match the compound (netflix ∧ month) → tier 0.
    expect(names.slice(0, 2).sort()).toEqual([
      "Netflix Premium 1-Month",
      "Netflix Premium 12-Month",
    ]);
    // "Gift Netflix Card" matched only the plain %netflix% branch → tier 1
    // (prefix) — below the compound tier.
    expect(names).toContain("Gift Netflix Card");
    expect(names.indexOf("Gift Netflix Card")).toBeGreaterThan(
      Math.max(names.indexOf("Netflix Premium 1-Month"), names.indexOf("Netflix Premium 12-Month")),
    );
  });

  it("«نتفلكس ١٢ شهر» (Arabic-Indic digits) puts the 12-Month plan at the very top", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    const names = await searchNames(app, "نتفلكس ١٢ شهر");
    expect(names[0]).toBe("Netflix Premium 12-Month");
    // the 1-Month plan still matches the plain brand branch — but below.
    expect(names).toContain("Netflix Premium 1-Month");
  });

  it("«نتفلكس 1 شهر» (Western digit) puts the 1-Month plan at the very top", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    const names = await searchNames(app, "نتفلكس 1 شهر");
    expect(names[0]).toBe("Netflix Premium 1-Month");
  });

  it("prefix beats containment: «netflix» leads with the Netflix-prefixed names, 'Gift Netflix Card' trails", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    const names = await searchNames(app, "netflix");
    expect(names.indexOf("Gift Netflix Card")).toBe(names.length - 1);
    expect(names.slice(0, -1)).toEqual(
      expect.arrayContaining(["Netflix Premium 1-Month", "Netflix Premium 12-Month"]),
    );
  });

  it("explicit sorts keep their OWN ordering (relevance never fights the user's sort)", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    const { status, body } = await call<ProductRow[]>(
      app,
      `/api/products?search=${encodeURIComponent("netflix")}&sort=price_asc`,
    );
    expect(status).toBe(200);
    const prices = await Promise.all((body as Array<{ slug: string }>).map(() => undefined));
    expect(prices).toBeDefined();
    // price_asc over the three Netflix-matching rows: Gift (10) first.
    expect((body as Array<{ name: string }>)[0].name).toBe("Gift Netflix Card");
  });
});

describe("R143 (L4-4) — deterministic tiebreaker on the explicit sorts", () => {
  /**
   * price_asc / price_desc / popular were single-key ORDER BYs — every tie
   * group (essentially the whole catalog for `popular`, where most products
   * have 0 completed orders) came back in planner order. The fix appends
   * `id DESC` to each, matching the default/relevance paths (R132).
   *
   * The tie group here is six SAME-PRICE, SAME-ZERO-ORDER products sharing
   * the token «Alpha» — and the requests ride `search=Alpha&sort=…` so
   * they are UNCACHEABLE (B6-02: search ⇒ no-store, no LRU entry): each
   * call re-executes the SQL, so a missing/removed tiebreaker shows up as
   * an unstable or non-id-DESC order, not a cached replay.
   */

  async function seedTieGroup(): Promise<string[]> {
    const seeded: string[] = [];
    for (let i = 0; i < 6; i++) {
      const name = `Alpha ${i} Tie`;
      await db
        .insert(productsTable)
        .values({ name, slug: `alpha-tie-${i}`, price: "50.00", category: "software" });
      seeded.push(name); // ids ascend with insertion order
    }
    return seeded;
  }

  async function sortedNames(app: express.Express, sort: string): Promise<string[]> {
    const { status, body } = await call<ProductRow[]>(
      app,
      `/api/products?search=${encodeURIComponent("Alpha")}&sort=${sort}`,
    );
    expect(status).toBe(200);
    return (body as Array<{ name: string }>).map((r) => r.name);
  }

  for (const sort of ["price_asc", "price_desc", "popular"] as const) {
    it(`sort=${sort} over the tie group is stable and documented (id DESC) across uncached calls`, async () => {
      const seeded = await seedTieGroup();
      const app = buildApp();

      const expected = [...seeded].reverse(); // id DESC within the tie group
      const first = await sortedNames(app, sort);
      expect(first).toEqual(expected);

      // Second, UNCACHED execution of the same SQL — same documented order.
      const second = await sortedNames(app, sort);
      expect(second).toEqual(first);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// R142 — I-1 (multi-word phrases with rider tokens), I-2 (durations in
// ARABIC variant labels on brand-level names — the LIVE catalog shape,
// verified via /api/products/by-slug/netflix-premium: labels «شهر واحد»،
// «سنة كاملة») and I-3 (search stays uncacheable at the edge).
// ═══════════════════════════════════════════════════════════════════════════

/** LIVE-shaped catalog: brand-level product names + Arabic variant labels —
 * durations live ONLY in the labels, never in the names. */
async function seedLiveVariantCatalog() {
  const rows = await db
    .insert(productsTable)
    .values([
      { name: "Netflix", slug: "netflix", price: "79.80", category: "streaming" },
      { name: "Spotify", slug: "spotify", price: "59.80", category: "music" },
      { name: "ChatGPT Plus", slug: "chatgpt-plus", price: "99.00", category: "ai-tools" },
      { name: "IPVanish VPN", slug: "ipvanish-vpn", price: "199.00", category: "vpn" },
      {
        name: "Lifetime Cloud Storage",
        slug: "lifetime-cloud-storage",
        price: "980.00",
        category: "software",
      },
    ])
    .returning({ id: productsTable.id, name: productsTable.name });
  const byName = new Map(rows.map((r) => [r.name, r.id]));
  await db.insert(productVariantsTable).values([
    {
      productId: byName.get("Netflix")!,
      durationLabel: "شهر واحد",
      costPrice: "40.00",
      priceLyd: "79.80",
    },
    {
      productId: byName.get("Netflix")!,
      durationLabel: "سنة كاملة",
      costPrice: "400.00",
      priceLyd: "799.00",
    },
    {
      productId: byName.get("Spotify")!,
      durationLabel: "شهر واحد",
      costPrice: "30.00",
      priceLyd: "59.80",
    },
    {
      productId: byName.get("ChatGPT Plus")!,
      durationLabel: "شهر واحد",
      costPrice: "50.00",
      priceLyd: "99.00",
    },
    {
      productId: byName.get("IPVanish VPN")!,
      durationLabel: "سنة كاملة",
      costPrice: "100.00",
      priceLyd: "199.00",
    },
    {
      productId: byName.get("Lifetime Cloud Storage")!,
      durationLabel: "مدى الحياة",
      costPrice: "490.00",
      priceLyd: "980.00",
    },
  ]);
}

describe("R142 I-2 — durations live in ARABIC variant labels (the live catalog shape)", () => {
  it("«شهر» finds every product with a month variant — the name-only ILIKEs matched zero of these", async () => {
    await seedLiveVariantCatalog();
    const app = buildApp();
    await expect(searchNames(app, "شهر")).resolves.toEqual(
      expect.arrayContaining(["Netflix", "Spotify", "ChatGPT Plus"]),
    );
    const names = await searchNames(app, "شهر");
    expect(names).toHaveLength(3);
    // year/lifetime variants must NOT match a month query
    expect(names).not.toContain("IPVanish VPN");
    expect(names).not.toContain("Lifetime Cloud Storage");
  });

  it("«سنة» finds the year-variant products — including via the ta-marbuta twin («سنة» label vs folded «سنه» query)", async () => {
    await seedLiveVariantCatalog();
    const app = buildApp();
    // «سنة» normalizes to «سنه» on the query side; the ة twin keeps the
    // label spelling («سنة كاملة») reachable (arabic-search variantTerms).
    await expect(searchNames(app, "سنة")).resolves.toEqual(
      expect.arrayContaining(["Netflix", "IPVanish VPN"]),
    );
  });

  it("«شهر واحد» — the EXACT string the variant selector renders — finds the month plans", async () => {
    await seedLiveVariantCatalog();
    const app = buildApp();
    const names = await searchNames(app, "شهر واحد");
    expect(names).toEqual(expect.arrayContaining(["Netflix", "Spotify", "ChatGPT Plus"]));
    expect(names).toHaveLength(3);
  });

  it("«نتفلكس شهر» finds Netflix (brand OR branch) and every month plan honestly rides along", async () => {
    await seedLiveVariantCatalog();
    const app = buildApp();
    const names = await searchNames(app, "نتفلكس شهر");
    expect(names).toContain("Netflix");
    expect(names).toContain("Spotify"); // the «شهر» EXISTS arm
    expect(names).not.toContain("IPVanish VPN");
  });

  it("archived products stay invisible to the EXISTS arm too (the is_archived AND still composes)", async () => {
    await seedLiveVariantCatalog();
    const [archived] = await db
      .insert(productsTable)
      .values({
        name: "Archived Monthly",
        slug: "archived-monthly",
        price: "10.00",
        category: "software",
        isArchived: true,
      })
      .returning({ id: productsTable.id });
    await db.insert(productVariantsTable).values({
      productId: archived.id,
      durationLabel: "شهر واحد",
      costPrice: "5.00",
      priceLyd: "10.00",
    });
    const app = buildApp();
    const names = await searchNames(app, "شهر");
    expect(names).not.toContain("Archived Monthly");
    expect(names).toHaveLength(3);
  });

  it("R143 (L4-2): a DEACTIVATED month variant drops out of search=شهر — the EXISTS arm honors pv.is_active", async () => {
    await seedLiveVariantCatalog();
    // The live admin write path: PATCH /products/:id/variants/:variantId
    // accepts is_active:false. Retire Spotify's ONLY month variant.
    const [spotify] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.slug, "spotify"));
    await db
      .update(productVariantsTable)
      .set({ isActive: false })
      .where(
        and(
          eq(productVariantsTable.productId, spotify.id),
          eq(productVariantsTable.durationLabel, "شهر واحد"),
        ),
      );

    const app = buildApp();
    const names = await searchNames(app, "شهر");
    // The PDP selector would never offer the retired duration — the
    // search must not promise it either (strictly narrows recall to
    // sellable-from-the-selector durations).
    expect(names).not.toContain("Spotify");
    expect(names).toEqual(expect.arrayContaining(["Netflix", "ChatGPT Plus"]));
    expect(names).toHaveLength(2);
  });

  it("R143 (L4-2): a product with BOTH a retired and an ACTIVE month variant stays visible", async () => {
    await seedLiveVariantCatalog();
    // Retire ChatGPT's plain month variant but keep a differently-planned
    // ACTIVE month variant — the product is still sellable for a month.
    const [chatgpt] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.slug, "chatgpt-plus"));
    await db
      .update(productVariantsTable)
      .set({ isActive: false })
      .where(
        and(
          eq(productVariantsTable.productId, chatgpt.id),
          eq(productVariantsTable.durationLabel, "شهر واحد"),
        ),
      );
    await db.insert(productVariantsTable).values({
      productId: chatgpt.id,
      planLabel: "Pro",
      durationLabel: "شهر واحد",
      costPrice: "60.00",
      priceLyd: "119.00",
    });

    const app = buildApp();
    const names = await searchNames(app, "شهر");
    expect(names).toContain("ChatGPT Plus");
    expect(names).toHaveLength(3);
  });
});

describe("R142 I-1 — multi-word phrases survive rider tokens (route level)", () => {
  it("«اشتراك شات جي بي تي» finds the ChatGPT product (was 0 results live)", async () => {
    await seedLiveVariantCatalog();
    const app = buildApp();
    await expect(searchNames(app, "اشتراك شات جي بي تي")).resolves.toEqual(["ChatGPT Plus"]);
  });

  it("«شات جي بي تي برو» keeps the ChatGPT intent at the top (was every *Pro* product live)", async () => {
    await seedLiveVariantCatalog();
    const app = buildApp();
    const names = await searchNames(app, "شات جي بي تي برو");
    expect(names[0]).toBe("ChatGPT Plus");
    // No orphaned %pro% branch noise: nothing else in this seed carries pro.
    expect(names).toEqual(["ChatGPT Plus"]);
  });

  it("«في بي ان سنوي» finds the year-plan VPN product via its brand arm (was 0 results live)", async () => {
    await seedLiveVariantCatalog();
    const app = buildApp();
    // The window resolves «في بي ان» → vpn beside the duration word; the
    // year-variant EXISTS arm needs the label-side spelling («سنة», pinned
    // by the «سنة» test above) — «سنوي» itself is not a label substring.
    const names = await searchNames(app, "في بي ان سنوي");
    expect(names).toEqual(["IPVanish VPN"]);
  });
});

describe("R142 I-3 — search responses stay uncacheable at the edge (B6-02)", () => {
  it("a search request ships no-store, NOT the catalogCache public s-maxage stamp", async () => {
    await seedLiveVariantCatalog();
    const app = buildApp();
    const search = await call(app, `/api/products?search=${encodeURIComponent("نتفلكس")}`);
    expect(search.status).toBe(200);
    expect(search.cacheControl).toBe("no-store");
  });

  it("the no-search list keeps its edge-cache stamp (the fix is search-scoped only)", async () => {
    await seedLiveVariantCatalog();
    const app = buildApp();
    const list = await call(app, "/api/products");
    expect(list.status).toBe(200);
    expect(list.cacheControl).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R161-A — the census alias additions (each one a live-probed 0-result
// gap, R161-E) + the cross-brand noise suppression (a brand+modifier
// query must not recall every product carrying the modifier fragment).
// ═══════════════════════════════════════════════════════════════════════════

/** R161-A multi-family catalog: the premium-named streaming rows make
 * the suppression guard have real cross-brand noise to exclude, and the
 * YouTube/Semrush families serve the new aliases. */
async function seedR161Catalog() {
  await db.insert(productsTable).values([
    { name: "Netflix Premium", slug: "netflix-premium", price: "79.80", category: "streaming" },
    { name: "Disney+ Premium", slug: "disney-plus-premium", price: "49.80", category: "streaming" },
    { name: "YouTube Premium", slug: "youtube-premium", price: "59.00", category: "streaming" },
    { name: "Spotify Premium", slug: "spotify-premium", price: "59.80", category: "music" },
    { name: "Windows 10 Pro", slug: "windows-10-pro", price: "119.00", category: "software" },
    { name: "ExpressVPN", slug: "expressvpn", price: "89.00", category: "vpn" },
    { name: "IPVanish VPN", slug: "ipvanish-vpn", price: "199.00", category: "vpn" },
    { name: "ChatGPT Plus", slug: "chatgpt-plus", price: "99.00", category: "ai-tools" },
    { name: "Semrush Pro", slug: "semrush-pro", price: "450.00", category: "seo-tools" },
  ]);
}

describe("R161-A — census alias acceptance (live-probed 0-result gaps)", () => {
  it.each([["نتفليكس"], ["نتفلكس"], ["نفلكس"], ["نيتفلكس"]])(
    "«%s» returns ONLY the Netflix product (no cross-family false positives)",
    async (query) => {
      await seedCatalog();
      const app = buildApp();
      await expect(searchNames(app, query)).resolves.toEqual(["Netflix Premium"]);
    },
  );

  it("«ديزني» finds the Disney+ product", async () => {
    await seedCatalog();
    const app = buildApp();
    await expect(searchNames(app, "ديزني")).resolves.toEqual(["Disney+ Standard"]);
  });

  it("«سبوتفاي» and «سبوتيفاي» both find Spotify", async () => {
    await seedCatalog();
    const app = buildApp();
    await expect(searchNames(app, "سبوتفاي")).resolves.toEqual(["Spotify Premium"]);
    await expect(searchNames(app, "سبوتيفاي")).resolves.toEqual(["Spotify Premium"]);
  });

  it("«يوتيوب» finds YouTube", async () => {
    await seedR161Catalog();
    const app = buildApp();
    await expect(searchNames(app, "يوتيوب")).resolves.toEqual(["YouTube Premium"]);
  });

  it("«ويندوز ١٠» and «ويندوز 10» (digit folding) both find Windows 10 Pro", async () => {
    await seedR161Catalog();
    const app = buildApp();
    await expect(searchNames(app, "ويندوز ١٠")).resolves.toEqual(["Windows 10 Pro"]);
    await expect(searchNames(app, "ويندوز 10")).resolves.toEqual(["Windows 10 Pro"]);
  });

  it("«شات جي بي تي» and «شاتجيبيتي» both find ChatGPT Plus", async () => {
    await seedR161Catalog();
    const app = buildApp();
    await expect(searchNames(app, "شات جي بي تي")).resolves.toEqual(["ChatGPT Plus"]);
    await expect(searchNames(app, "شاتجيبيتي")).resolves.toEqual(["ChatGPT Plus"]);
  });

  it("«في بي ان» returns EVERY VPN product (name alias + category branch)", async () => {
    await seedR161Catalog();
    const app = buildApp();
    const names = await searchNames(app, "في بي ان");
    expect(names).toHaveLength(2);
    expect(names).toEqual(expect.arrayContaining(["ExpressVPN", "IPVanish VPN"]));
  });

  it("«مشاهدة» (the renamed streaming label) reaches the streaming category", async () => {
    await seedR161Catalog();
    const app = buildApp();
    const names = await searchNames(app, "مشاهدة");
    expect(names).toHaveLength(3);
    expect(names).toEqual(
      expect.arrayContaining(["Netflix Premium", "Disney+ Premium", "YouTube Premium"]),
    );
    expect(names).not.toContain("Spotify Premium");
    expect(names).not.toContain("Windows 10 Pro");
    expect(names).not.toContain("ExpressVPN");
  });

  it("«راديو» reaches the music category (TuneIn's SEO keyword)", async () => {
    await seedR161Catalog();
    const app = buildApp();
    await expect(searchNames(app, "راديو")).resolves.toEqual(["Spotify Premium"]);
  });

  it("«سم راش» and «سمراش» find Semrush (the SEO file's secondary keyword spellings)", async () => {
    await seedR161Catalog();
    const app = buildApp();
    await expect(searchNames(app, "سم راش")).resolves.toEqual(["Semrush Pro"]);
    await expect(searchNames(app, "سمراش")).resolves.toEqual(["Semrush Pro"]);
  });

  it("mixed script: «Netflix اشتراك» and «اشتراك netflix» both find Netflix (latinTerms arm)", async () => {
    await seedR161Catalog();
    const app = buildApp();
    await expect(searchNames(app, "Netflix اشتراك")).resolves.toEqual(["Netflix Premium"]);
    await expect(searchNames(app, "اشتراك netflix")).resolves.toEqual(["Netflix Premium"]);
  });

  it("harmless noise: extra spaces, punctuation, tatweel + diacritics all still resolve", async () => {
    await seedR161Catalog();
    const app = buildApp();
    await expect(searchNames(app, "  نتفلكس   بريميوم ")).resolves.toEqual(["Netflix Premium"]);
    await expect(searchNames(app, "نتفلكس!")).resolves.toEqual(["Netflix Premium"]);
    await expect(searchNames(app, "نـتـفـلـيـكـسُ")).resolves.toEqual(["Netflix Premium"]);
  });

  it("an unrelated Arabic string returns [] (honest empty — no arbitrary brand)", async () => {
    await seedR161Catalog();
    const app = buildApp();
    await expect(searchNames(app, "خدمة توصيل طعام")).resolves.toEqual([]);
  });
});

describe("R161-A — cross-brand noise suppression (brand + modifier)", () => {
  it("«نتفلكس بريميوم» returns ONLY Netflix (the bare %premium% OR used to recall Spotify Premium too)", async () => {
    await seedCatalog();
    const app = buildApp();
    // seedCatalog's Spotify Premium rode along pre-R161-A; the compound
    // (netflix ∧ premium → tier 0) + the brand prefix (tier 1) carry the
    // intent now.
    await expect(searchNames(app, "نتفلكس بريميوم")).resolves.toEqual(["Netflix Premium"]);
  });

  it("…and the multi-premium R161 seed agrees: Disney+/YouTube/Spotify Premium stay out", async () => {
    await seedR161Catalog();
    const app = buildApp();
    await expect(searchNames(app, "نتفلكس بريميوم")).resolves.toEqual(["Netflix Premium"]);
  });

  it("«بريميوم» alone keeps the modifier-only breadth (every premium row stays reachable)", async () => {
    await seedR161Catalog();
    const app = buildApp();
    const names = await searchNames(app, "بريميوم");
    expect(names).toHaveLength(4);
    expect(names).toEqual(
      expect.arrayContaining([
        "Netflix Premium",
        "Disney+ Premium",
        "YouTube Premium",
        "Spotify Premium",
      ]),
    );
  });

  it("the LIVE shape (brand-only names) resolves at tier 1 — «نتفلكس بلس» no longer recalls ChatGPT Plus via the bare %plus% arm", async () => {
    await seedLiveVariantCatalog();
    const app = buildApp();
    // Netflix's name carries no "plus" fragment, so the compound yields
    // 0 tier-0 rows by construction — the brand OR branch returns the
    // right product at tier 1 (prefix), and the suppressed bare term
    // keeps "ChatGPT Plus" out of the recall.
    await expect(searchNames(app, "نتفلكس بلس")).resolves.toEqual(["Netflix"]);
  });

  it("seedPlanCatalog ranking: «نتفلكس بريميوم» puts the compound rows first and narrows the recall", async () => {
    await seedPlanCatalog();
    const app = buildApp();
    const names = await searchNames(app, "نتفلكس بريميوم");
    // compound tier 0 (netflix ∧ premium)…
    expect(names.slice(0, 2).sort()).toEqual([
      "Netflix Premium 1-Month",
      "Netflix Premium 12-Month",
    ]);
    // …the suppressed bare %premium% branch used to recall the other
    // premium rows (Spotify, …) at tier 2 — they stay out now…
    expect(names).not.toContain("Spotify Premium 1-Month");
    // …while the brand OR arm keeps the plain Netflix rows (Gift, tier 2).
    expect(names).toContain("Gift Netflix Card");
    expect(names.indexOf("Gift Netflix Card")).toBeGreaterThan(
      Math.max(names.indexOf("Netflix Premium 1-Month"), names.indexOf("Netflix Premium 12-Month")),
    );
  });
});
