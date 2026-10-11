import express from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, initTestDb, productsTable, resetTestDb } from "../../test/db";
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
): Promise<{ status: number; body: T; text: string }> {
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
        resolve({ status: res.status, body: body as T, text });
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
// compounds, and exact-match-first ranking. The seed mirrors the LIVE
// catalog's plan-shaped naming ("Netflix Premium 1-Month",
// "PlayStation Plus 12-Month" — the real product/variant convention).
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
