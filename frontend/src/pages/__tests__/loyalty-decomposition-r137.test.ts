/**
 * R137 (FE) — the loyalty.tsx decomposition contract.
 *
 * The money page was a 945-line single component (the convert mutation
 * with its durable localStorage intent key, the SHARED
 * ["loyalty","overview"] cache identity referrals.tsx renders from,
 * the ledger query and every presentational card — stats tiles,
 * referral box, conversion form, earn rows, history list — inline in
 * one function). The R136 checkout/wallet/home storefront precedents
 * applied here: orchestration (pages/loyalty.tsx) + eight verbatim
 * extracts under components/loyalty/ (five presentational .tsx + three
 * React-free .ts modules).
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the
 * 99-M4/AUD103-2-F3 intent-key lifecycle, the shared-cache freshness)
 * is already pinned by the four loyalty-* render suites; this file
 * guards the STRUCTURE so the decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      945 lines at decomposition; the ceiling leaves room to grow
 *      without re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. money-path ownership — handleConvert, its conversion gates, the
 *      durable intent-key threading and the four post-success cache
 *      invalidations (incl. the SHARED loyalty cache identity) stay IN
 *      the page: a stale closure in a presentational extract could
 *      convert the wrong intent or leave the twin page stale;
 *   4. state ownership — the conversion atoms (draft/in-flight/
 *      persistent error) stay centralized in the page; the extracts
 *      take values + callbacks only;
 *   5. purity — the convert-key/meta/tiers modules are React-free, the
 *      card extracts carry no hooks, and no extract imports the
 *      auth/toast/API modules the render suites mock at the boundary.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/loyalty.tsx");

describe("R137 (FE) — loyalty.tsx decomposition: page stays an orchestration core", () => {
  it("pages/loyalty.tsx stays under the 1,000-line ceiling (was 945 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/loyalty/loyalty-convert-key",
      "@/components/loyalty/loyalty-meta",
      "@/components/loyalty/loyalty-tiers",
      "@/components/loyalty/StatsRow",
      "@/components/loyalty/ReferralBox",
      "@/components/loyalty/ConvertPointsCard",
      "@/components/loyalty/HowToEarnCard",
      "@/components/loyalty/LedgerHistoryCard",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the money-path handler + its intent-key lifecycle stay IN the page (the extracts render; the page owns the charge)", () => {
    // handleConvert carries the min/multiples gates, the keyed POST and
    // the terminal/transient resolution tree — it must never drift into
    // a presentational extract where a stale closure could convert the
    // wrong intent.
    expect(page).toContain("const handleConvert = async (e: React.FormEvent) => {");
    expect(page).toContain("if (!pts || pts < pointsPerLyd) {");
    expect(page).toContain("if (pts % pointsPerLyd !== 0) {");
    // 99-M4 + AUD103-2-F3: the durable convert-intent key — mint on the
    // intent's first attempt, replay across retries, clear at the two
    // definitive resolution points (non-IN_FLIGHT rejection + success).
    expect(page).toContain("const fingerprint = `convert|${pts}`;");
    expect(page).toContain(
      "const intentKey = loadStoredConvertKey(fingerprint) ?? generateIdempotencyKey();",
    );
    expect(page).toContain("persistStoredConvertKey(fingerprint, intentKey);");
    // G-1 (R142): the raw fetch became the generated convertPoints call —
    // the in-flight retention reads the typed error envelope now.
    expect(page).toContain(
      "if (envelope && envelope.code !== ErrorCode.IDEMPOTENCY_IN_FLIGHT) clearStoredConvertKey();",
    );
    // And the lifecycle's implementation lives in the pure module the
    // page imports by name (never duplicated inline).
    const convertKeyModule = read("src/components/loyalty/loyalty-convert-key.ts");
    expect(convertKeyModule).toContain("export function loadStoredConvertKey(");
    expect(convertKeyModule).toContain("export function persistStoredConvertKey(");
    expect(convertKeyModule).toContain("export function clearStoredConvertKey(");
  });

  it("the shared-cache coordination stays IN the page (the four invalidations + the twin-page key)", () => {
    // R120-B5: the SAME ["loyalty","overview"] entry referrals.tsx
    // renders from — the key tuple lives beside the queries that use
    // it, and the conversion's invalidation must reach the twin page's
    // observer (loyalty-referrals-shared-cache pins the behavior).
    expect(page).toContain('const LOYALTY_OVERVIEW_QUERY_KEY = ["loyalty", "overview"] as const;');
    expect(page).toContain('const LOYALTY_LEDGER_QUERY_KEY = ["loyalty", "ledger"] as const;');
    expect(page).toContain("queryKey: LOYALTY_OVERVIEW_QUERY_KEY");
    expect(page).toContain("queryKey: LOYALTY_LEDGER_QUERY_KEY");
    // Money moved: the Navbar/wallet pair + both loyalty twins.
    expect(page).toContain("queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });");
    expect(page).toContain("queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });");
    expect(page).toContain(
      "queryClient.invalidateQueries({ queryKey: LOYALTY_OVERVIEW_QUERY_KEY });",
    );
    expect(page).toContain(
      "queryClient.invalidateQueries({ queryKey: LOYALTY_LEDGER_QUERY_KEY });",
    );
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the convert form, its validation text, the persistent
    // failure banner and the submit gate all key off the same three
    // atoms — the card takes them as values + one change/submit
    // callback each.
    for (const atom of [
      'const [convertPoints, setConvertPoints] = useState("");',
      "const [converting, setConverting] = useState(false);",
      "const [convertError, setConvertError] = useState<string | null>(null);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The page-computed validation + tier math ride the pure modules by
    // name (never duplicated inline in an extract).
    expect(page).toContain(
      "const tierThresholds: Record<string, number> = resolveTierThresholds(data?.tier_thresholds);",
    );
    expect(page).toContain(
      "const tierProgressPercent = computeTierProgressPercent(data?.next_tier, tierThresholds);",
    );
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved money-card markup rides along verbatim (the r128-sweep anchors follow the surface)", () => {
    // The conversion input's a11y + keyboard contract (the inline
    // WHY-invalid anchor, the numeric mobile hint, the aria-invalid
    // binding) moved to ConvertPointsCard — the loyalty-history /
    // loyalty-convert-journey suites exercise it through the extract.
    const convertCard = read("src/components/loyalty/ConvertPointsCard.tsx");
    expect(convertCard).toContain('id="convert-input-validation"');
    expect(convertCard).toContain('enterKeyHint="done"');
    expect(convertCard).toContain('role="note"');
    expect(convertCard).toContain("aria-invalid={convertValidation !== null}");
    // The Latin-digit points tile (the 8-e §2 device-locale pin) moved
    // to StatsRow; the honest history empty/error states moved to
    // LedgerHistoryCard.
    const stats = read("src/components/loyalty/StatsRow.tsx");
    expect(stats).toContain('data.points.toLocaleString("en-US")');
    const history = read("src/components/loyalty/LedgerHistoryCard.tsx");
    expect(history).toContain("لا توجد حركات نقاط بعد");
    expect(history).toContain("تعذّر تحميل سجل النقاط");
    // The page-level error card + the R136 UX-1 skeleton adoption stay
    // in the page — skeleton-primitives reads THIS file for the
    // primitives import.
    expect(page).toContain('title="تعذّر تحميل بيانات الولاء"');
    expect(page).toMatch(/from "@\/components\/ui\/Skeleton"/);
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a card needs is passed DOWN, so
    // no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth on the money card is how the 99-M4 same-key-
    // different-body class of bugs happens.
    const files = [
      "StatsRow",
      "ReferralBox",
      "ConvertPointsCard",
      "HowToEarnCard",
      "LedgerHistoryCard",
    ];
    for (const name of files) {
      const src = read(`src/components/loyalty/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("no extract touches the mocked module boundary (auth/toast/api-client stay page-owned)", () => {
    // The loyalty-* render suites mock @/lib/auth + @/hooks/use-toast +
    // @workspace/api-client-react at the module boundary; an extract
    // importing any of them would re-couple presentation to the
    // coordinating modules the page owns.
    const files = [
      "StatsRow",
      "ReferralBox",
      "ConvertPointsCard",
      "HowToEarnCard",
      "LedgerHistoryCard",
    ];
    for (const name of files) {
      const src = read(`src/components/loyalty/${name}.tsx`);
      expect(src, name).not.toMatch(
        /@\/lib\/auth|@\/hooks\/use-toast|@workspace\/api-client-react/,
      );
    }
  });

  it("the money helper modules are React-free (pure lifecycle/types/tier math — importable by any lane)", () => {
    const files = ["loyalty-convert-key", "loyalty-meta", "loyalty-tiers"];
    for (const name of files) {
      const src = read(`src/components/loyalty/${name}.ts`);
      expect(src, name).not.toMatch(/from "react"|from "lucide-react"/);
    }
    // The r102-envelope durability bounds + the shape guard + the tier
    // math entry points (the loyalty-history suite pins their output
    // at the rendered level).
    expect(read("src/components/loyalty/loyalty-convert-key.ts")).toContain(
      'const CONVERT_KEY = "subnation_convert_key";',
    );
    expect(read("src/components/loyalty/loyalty-convert-key.ts")).toContain(
      "const CONVERT_KEY_TTL_MS = 10 * 60 * 1000;",
    );
    expect(read("src/components/loyalty/loyalty-meta.ts")).toContain(
      "export function isLoyaltyPayload(",
    );
    expect(read("src/components/loyalty/loyalty-tiers.ts")).toContain(
      "export function computeTierProgressPercent(",
    );
    expect(read("src/components/loyalty/loyalty-tiers.ts")).toContain(
      "export const TIER_THRESHOLDS_FALLBACK",
    );
  });
});
