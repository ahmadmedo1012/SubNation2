import { test, expect, type Page, type Route } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

/**
 * R162-E — the AUTHENTICATED product page, verified in a real browser
 * WITHOUT a real login. This is the closure of the R161 gap: the 640–
 * 1023.98px sticky-bar CSS scopes were fixed in R161-G (index.css
 * mobile-sticky-above-nav split), but the AUTHED bar's geometry could
 * not be live-verified because production logins are prohibited (the
 * R161-F-AUDIT code-level suspicion at product.tsx:744 — the authed
 * bar rides `fixed left-0 right-0 mobile-sticky-above-nav`, whose
 * `bottom` rule was historically scoped ≤639.98px).
 *
 * HERMETIC METHODOLOGY (the coordinator's decision for this round):
 * every `/api/**` request is intercepted with `page.route()` and
 * answered from seeded JSON — the authenticated session comes from
 * GET /api/auth/probe `{authenticated: true, user}` (the exact boot
 * contract in lib/auth.tsx: the sentinel token flips the PDP into its
 * authed branch), the product from GET /api/products/by-slug/:slug.
 * The REAL production JS bundle renders the page; only the data is
 * fake. Because the handler FULFILLS every request, nothing ever
 * reaches the network — GET-only seeds by construction, and every
 * non-GET (POST /api/orders, /api/cwv, …) is answered 503 with a
 * message that names the interception, NEVER a success. No login, no
 * OTP, no order, no topup can happen.
 *
 * The service worker is deliberately neutered (registration stub +
 * aborted sw.js fetch): workbox runtime-caches GET /api/products*
 * from inside the SW, and SW-context fetches bypass page.route —
 * without this the by-slug seed could race the SW's own network hit.
 *
 * Assertions use roles/text/aria-state only (the soldout-pdp /
 * pdp-band conventions); the bar container is addressed by its pin
 * hook class `.mobile-sticky-above-nav` — the exact selector the
 * R161-G fix targets (asserted unique before use).
 */

// ── Seeds ──────────────────────────────────────────────────────────────────

const PRODUCT_SLUG = "r162-hermetic-pdp";

interface HermeticVariant {
  id: number;
  plan_label: string | null;
  duration_label: string | null;
  label: string;
  price: number;
  sale_price: number | null;
  discount_percent: number | null;
  is_available: boolean;
}

interface HermeticProduct {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  description_long: string | null;
  faq: { question: string; answer: string }[];
  features: string[];
  seo_title: string | null;
  seo_description: string | null;
  image_url: string | null;
  price: number;
  price_from: boolean;
  category: string | null;
  is_active: boolean;
  usage_terms: string | null;
  stock_count: number;
  is_available: boolean;
  sale_price: number | null;
  discount_percent: number | null;
  order_count: number;
  variants: HermeticVariant[];
}

interface HermeticUser {
  id: number;
  phone: string;
  email: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  display_name: string | null;
  photo_url: string | null;
  auth_provider: string;
  wallet_balance: number;
  loyalty_points: number;
  loyalty_tier: string;
  lifetime_spend: number;
  referral_code: string | null;
  onboarded_at: string | null;
  onboarding_step: number;
  created_at: string;
}

/** Solvent buyer (500 د.ل) — the «رصيد كافٍ / اشترِ» branch. */
const HERMETIC_USER: HermeticUser = {
  id: 424242,
  phone: "0910000000",
  email: null,
  email_verified: false,
  phone_verified: true,
  display_name: "R162 Hermetic Buyer",
  photo_url: null,
  // whatsapp_phone: isFirebaseBackedUser() is false — no Firebase SDK
  // import is armed for this fake identity.
  auth_provider: "whatsapp_phone",
  wallet_balance: 500,
  loyalty_points: 0,
  loyalty_tier: "bronze",
  lifetime_spend: 0,
  referral_code: "R162E2E",
  onboarded_at: "2026-10-17T00:00:00.000Z",
  onboarding_step: 0,
  created_at: "2026-10-17T00:00:00.000Z",
};

/** Insolvent buyer (10 د.ل < every price) — the «تحتاج … إضافية / شحن» branch. */
const POOR_USER: HermeticUser = { ...HERMETIC_USER, id: 424243, wallet_balance: 10 };

const VARIANTS: HermeticVariant[] = [
  // فردي — cheapest option carries a sale price (25 regular 30)
  {
    id: 101,
    plan_label: "فردي",
    duration_label: "شهر واحد",
    label: "فردي — شهر واحد",
    price: 30,
    sale_price: 25,
    discount_percent: 17,
    is_available: true,
  },
  {
    id: 102,
    plan_label: "فردي",
    duration_label: "سنة",
    label: "فردي — سنة",
    price: 120,
    sale_price: null,
    discount_percent: null,
    is_available: true,
  },
  // عائلي — the one-month option is sold out, the year is on sale (150/200)
  {
    id: 103,
    plan_label: "عائلي",
    duration_label: "شهر واحد",
    label: "عائلي — شهر واحد",
    price: 45,
    sale_price: null,
    discount_percent: null,
    is_available: false,
  },
  {
    id: 104,
    plan_label: "عائلي",
    duration_label: "سنة",
    label: "عائلي — سنة",
    price: 200,
    sale_price: 150,
    discount_percent: 25,
    is_available: true,
  },
  // ثنائي — every option sold out (the plan-level «نفد» copy)
  {
    id: 105,
    plan_label: "ثنائي",
    duration_label: "شهر واحد",
    label: "ثنائي — شهر واحد",
    price: 35,
    sale_price: null,
    discount_percent: null,
    is_available: false,
  },
  {
    id: 106,
    plan_label: "ثنائي",
    duration_label: "سنة",
    label: "ثنائي — سنة",
    price: 130,
    sale_price: null,
    discount_percent: null,
    is_available: false,
  },
];

const PRODUCT: HermeticProduct = {
  id: 9001,
  slug: PRODUCT_SLUG,
  name: "منتج اختبار R162 الهرمي",
  description: "منتج اختباري لجلسة الشراء المُصادَق عليها في الجولة R162.",
  description_long:
    "هذه الصفحة تُصيَّر من حزمة الإنتاج الحقيقية عبر متصفح حقيقي، لكن كل بيانات الواجهة تُخدَم من مُعترِض مسارات محلي ولا يغادر أي طلب المتصفح. " +
    "الفقرة الطويلة مقصودة: تضمن أن صفحة المنتج أطول من إطار العرض بفارق كبير، حتى يكون تثبيت شريط الشراء السفلي تحت التمرير العميق اختباراً حقيقياً لا تمريراً فارغاً. " +
    "يعرض هذا القسم تفاصيل الباقة والمدة والسعر، ثم مدى التوفير عند وجود خصم، ثم الأسئلة الشائعة وشروط الاستخدام أسفل عمود الشراء. " +
    "كل الأرقام هنا افتراضية بالدينار الليبي وتُستخدم للتأكد من أن التسلسل الهرمي للأسعار (سعر التخفيض ثم السعر العادي ثم السعر الابتدائي) ينعكس بدقة على كل سطح نقدي في الصفحة: لوحة السعر، وحبوب اختيار الباقة، وشريط الشراء المثبّت. " +
    "كما تُستخدم لاختبار انتماء زر الشراء لحالة التوفر: الخيار غير المتوفر يظهر بنص صادق «نفد» ولا يمكن تحديده، وزر الشراء يبقى حياً ما دام الخيار المحدد متوفراً. " +
    "وأخيراً تُستخدم الصفحة للتحقق من سلوك النقر على زر الشراء نفسه: يجب أن تدخل الواجهة حالة «جارٍ المعالجة…» بصدق، ثم تعرض رسالة الخطأ التي يخدّمها المعترض دون إنشاء أي طلب فعلي.",
  faq: [
    {
      question: "هل هذا منتج حقيقي؟",
      answer:
        "لا — إنه حمولة اختبار هرمية لجولة R162، تُخدَم من معترض مسارات المتصفح ولا تصل إلى الشبكة.",
    },
    {
      question: "هل يمكن الشراء من هذه الصفحة؟",
      answer:
        "لا — طلب الشراء يُعترَض داخل المتصفح ويُجاب بخطأ مقصود، فلا يُخصم أي رصيد ولا يُنشأ أي طلب.",
    },
  ],
  features: [
    "تسليم فوري بعد التفعيل",
    "ضمان استبدال خلال 48 ساعة",
    "دعم فني على مدار الساعة",
    "فاتورة رسمية لكل عملية",
  ],
  seo_title: null,
  seo_description: null,
  image_url: null,
  // MIN(variants.price) by the backend's read-time contract.
  price: 30,
  price_from: true,
  category: "streaming",
  is_active: true,
  usage_terms: "شروط استخدام تجريبية للجولة R162 — هذا المنتج غير قابل للشراء الفعلي.",
  stock_count: 12,
  is_available: true,
  sale_price: null,
  discount_percent: null,
  order_count: 7,
  variants: VARIANTS,
};

/** The 503 body every non-GET gets — an Arabic message the app's own
 * error mapper (getErrorMessage prefers the server's Arabic sentence)
 * surfaces verbatim, so the failure is self-describing in the UI. */
const INTERCEPTED_MESSAGE =
  "اختبار R162: تم اعتراض الطلب داخل المتصفح — لم يصل إلى الشبكة ولم يُنشأ أي طلب";

type ApiCall = { method: string; path: string };
type ApiWrite = { method: string; path: string; body: string | null };

interface HermeticOptions {
  user: HermeticUser;
  /** Delay before POST /api/orders is (not-)answered — the window in
   * which the UI's honest pending state is observable. */
  orderDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Install the hermetic API surface + the service-worker neutering.
 * Returns the live request log (evidence of exactly what the authed
 * PDP asked for, and of what write attempts were intercepted).
 */
async function installHermeticApi(page: Page, opts: HermeticOptions) {
  const seen: ApiCall[] = [];
  const writes: ApiWrite[] = [];

  // 1) Service worker: abort the script fetch AND stub register(). The
  //    workbox runtime cache owns GET /api/products* from inside the
  //    SW context, and those bypass page.route entirely.
  await page.route("**/sw.js", (route) => route.abort("blockedbyclient"));
  await page.route("**/workbox-*.js", (route) => route.abort("blockedbyclient"));
  await page.addInitScript(() => {
    try {
      if ("serviceWorker" in navigator) {
        const stub = {
          addEventListener: () => {},
          unregister: () => Promise.resolve(true),
          update: () => Promise.resolve(undefined),
        };
        // Resolves a duck-typed registration so any .then() on the
        // caller side no-ops instead of rejecting.
        navigator.serviceWorker.register = () => Promise.resolve(stub as never);
      }
    } catch {
      // Belt-and-braces only — the aborted sw.js fetch is the gate.
    }
  });

  // 2) The catch-all /api interception.
  await page.route("**/api/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    seen.push({ method, path });

    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    // NON-GET: never a success — the money-writing surfaces see an
    // honest failure while nothing leaves the browser.
    if (method !== "GET") {
      writes.push({ method, path, body: req.postData() });
      if (path === "/api/orders" && method === "POST") {
        await sleep(opts.orderDelayMs ?? 0);
      }
      return json({ error: INTERCEPTED_MESSAGE }, 503);
    }

    // GET dispatch — the authed-session + PDP contracts.
    if (path === "/api/auth/probe") {
      return json({ authenticated: true, user: opts.user, linked_identities: [] });
    }
    if (path === "/api/auth/me") {
      return json({ ...opts.user, linked_identities: [] });
    }
    if (path === `/api/products/by-slug/${PRODUCT_SLUG}`) {
      return json(PRODUCT);
    }
    if (path.startsWith("/api/products/by-slug/")) {
      return json({ message: "R162: منتج غير موجود" }, 404);
    }
    if (path === `/api/products/${PRODUCT.id}/recommendations`) {
      return json([]);
    }
    const byId = path.match(/^\/api\/products\/(\d+)$/);
    if (byId && Number(byId[1]) === PRODUCT.id) {
      return json(PRODUCT);
    }
    if (path === "/api/products") {
      return json([]);
    }
    if (path === "/api/flash-sale") {
      return json({ flash_sale: null });
    }
    if (path === "/api/notifications") {
      return json([]);
    }
    if (path === "/api/wallet") {
      return json({
        balance: opts.user.wallet_balance,
        loyalty_points: opts.user.loyalty_points,
        loyalty_tier: opts.user.loyalty_tier,
        pending_topups_count: 0,
        recent_orders: [],
      });
    }
    if (
      path === "/api/wallet/topups" ||
      path === "/api/wallet/ledger" ||
      path === "/api/orders" ||
      path === "/api/loyalty/ledger" ||
      path === "/api/loyalty/referrals" ||
      path === "/api/support/tickets"
    ) {
      return json([]);
    }
    // Benign default for anything unlisted.
    return json({});
  });

  return { seen, writes };
}

/** The compact sticky-bar buy CTA — «اشترِ» exists ONLY in the compact
 * twin (the desktop panel renders «اشترِ الآن — …»), so this name is
 * the precise locator for the bar at every width. */
function barBuyCta(page: Page) {
  return page.getByRole("button", { name: "اشترِ", exact: true });
}

function stickyBar(page: Page) {
  return page.locator(".mobile-sticky-above-nav");
}

async function openAuthedPdp(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(`/product/${PRODUCT_SLUG}`);
  // The PDP settled: a LYD price renders once the by-slug query
  // resolves (the product-detail.spec idiom).
  await expect(page.locator("main").getByText(/د\.ل/).first()).toBeVisible({ timeout: 20_000 });
}

// ── T1: the R161 gap — authed bar geometry across the five widths ─────────

const WIDTHS = [
  { width: 390, height: 844 }, // <640: the bar docks above the MobileNav
  { width: 640, height: 960 }, // 640–767.98: THE R161 verification gap
  { width: 768, height: 1024 }, // 768–1023.98: no nav; safe-area floor
  { width: 1024, height: 768 }, // lg: the desktop buy panel takes over
  { width: 1280, height: 800 }, // desktop
];

test.describe("authed PDP — hermetic session (R162-E)", () => {
  for (const vp of WIDTHS) {
    test(`the authed fixed buy bar holds its geometry at ${vp.width}×${vp.height}`, async ({
      page,
    }) => {
      const { seen } = await installHermeticApi(page, { user: HERMETIC_USER });
      await openAuthedPdp(page, vp);

      // Hermetic evidence: the session and the product both came from
      // the interceptor, and no write was attempted at rest.
      expect(seen.some((c) => c.method === "GET" && c.path === "/api/auth/probe")).toBe(true);
      expect(
        seen.some((c) => c.method === "GET" && c.path === `/api/products/by-slug/${PRODUCT_SLUG}`),
      ).toBe(true);

      // RTL end-to-end, zero horizontal overflow (the R161-F sweep idiom).
      expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      if (vp.width >= 1024) {
        // (e) ≥lg: the bar is lg:hidden; the desktop panel owns the buy.
        await expect(stickyBar(page)).toBeHidden();
        await expect(barBuyCta(page)).toBeHidden();
        await expect(
          page.getByRole("button", { name: "اشترِ الآن — 25.00 د.ل", exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("navigation", { name: "التنقل السفلي" })).toBeHidden();
      } else {
        // The AUTHED branch is what renders: the solvent «رصيد كافٍ»
        // line + the compact buy CTA, and NO guest login CTA.
        const bar = stickyBar(page);
        await expect(bar).toHaveCount(1);
        await expect(bar.getByText("رصيد كافٍ")).toBeVisible();
        await expect(barBuyCta(page)).toBeVisible();
        await expect(
          page.getByRole("button", { name: "سجّل دخولك للشراء", exact: true }),
        ).toHaveCount(0);

        // (a) the bar is FIXED (product.tsx:744 authed branch)…
        expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");

        // Deep scroll must be meaningful, not a no-op.
        const scrollable = await page.evaluate(
          () => document.body.scrollHeight - window.innerHeight,
        );
        expect(scrollable).toBeGreaterThan(300);

        if (vp.width < 768) {
          // (b)/(d) <768: the pin carries the 60px MobileNav offset…
          expect(Number.parseInt(await bar.evaluate((el) => getComputedStyle(el).bottom), 10)).toBe(
            60,
          );
          const nav = page.getByRole("navigation", { name: "التنقل السفلي" });
          await expect(nav).toBeVisible();

          // (a) deep scroll — mid-page, then the very bottom…
          await page.evaluate(() =>
            window.scrollTo(0, Math.round(document.body.scrollHeight * 0.6)),
          );
          await page.waitForTimeout(120);
          let barBox = await bar.boundingBox();
          expect(barBox, "the bar must have a box mid-scroll").not.toBeNull();
          expect(barBox!.y).toBeGreaterThanOrEqual(0);
          expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(vp.height + 1);

          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(120);
          barBox = await bar.boundingBox();
          const navBox = await nav.boundingBox();
          expect(barBox, "the bar must have a box at full scroll").not.toBeNull();
          expect(navBox, "the MobileNav must have a box").not.toBeNull();
          expect(barBox!.y).toBeGreaterThanOrEqual(0);
          expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(vp.height + 1);
          // (b) no overlap with the mobile bottom nav — the bar's
          // bottom edge docks exactly on the nav's top edge (±1px).
          expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(navBox!.y + 1);
          expect(navBox!.y - (barBox!.y + barBox!.height)).toBeLessThanOrEqual(1);
        } else {
          // 768–1023.98: the nav does not render; the pin is the
          // safe-area floor (env() = 0 in this browser).
          expect(
            await bar.evaluate((el) => Number.parseInt(getComputedStyle(el).bottom, 10)),
          ).toBeLessThanOrEqual(2);
          await expect(page.getByRole("navigation", { name: "التنقل السفلي" })).toBeHidden();

          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(120);
          const barBox = await bar.boundingBox();
          expect(barBox, "the bar must have a box at full scroll").not.toBeNull();
          expect(barBox!.y).toBeGreaterThanOrEqual(0);
          expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(vp.height + 1);
          // Docked at the viewport floor (no nav term in the offset).
          expect(Math.abs(barBox!.y + barBox!.height - vp.height)).toBeLessThanOrEqual(1);
        }
      }
      await page.screenshot({ path: `/home/z/my-project/download/r162-e-bar-${vp.width}.png` });
    });
  }

  // ── T2: keyboard focus contract (DESIGN.md — the ring-2 recipe) ──────────

  test("the authed bar's buy CTA is Tab-reachable and shows the ring-2 focus indicator (640×960)", async ({
    page,
  }) => {
    await installHermeticApi(page, { user: HERMETIC_USER });
    await openAuthedPdp(page, { width: 640, height: 960 });

    const cta = barBuyCta(page);
    await expect(cta).toBeVisible();
    const restShadow = await cta.evaluate((el) => getComputedStyle(el).boxShadow);

    // Genuine keyboard navigation: Tab until the CTA is the active
    // element (bounded — a page this size stays well under this).
    const ctaEl = await cta.elementHandle();
    let reached = false;
    for (let i = 0; i < 120 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate((el) => document.activeElement === el, ctaEl);
    }
    expect(reached, "the compact buy CTA must be reachable by Tab").toBe(true);

    // The Button-family focus treatment (DESIGN.md do/don't #8): a NEW
    // ring layer — ring-2 + ring-offset-1 = the 3px spread — in the
    // crimson --ring token, not the resting elevation shadow.
    const focusedShadow = await cta.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(focusedShadow).not.toBe(restShadow);
    expect(focusedShadow).toContain("0px 0px 0px 3px");
    expect(focusedShadow).toContain("rgb(220, 24, 64)");
    await page.screenshot({ path: "/home/z/my-project/download/r162-e-focus-640.png" });
  });

  // ── T3: variant selector semantics ──────────────────────────────────────

  test("variant selection drives the displayed price (sale/regular); sold-out options render honest «نفد» copy (640×960)", async ({
    page,
  }) => {
    await installHermeticApi(page, { user: HERMETIC_USER });
    await openAuthedPdp(page, { width: 640, height: 960 });

    const bar = stickyBar(page);
    // The panel is anchored on its own stock chip (role=status), not
    // on document order.
    const panel = page
      .getByRole("status", { name: "المنتج متوفر، الكمية 12", exact: true })
      .locator("xpath=..");
    const pill = (name: string) => page.getByRole("button", { name, exact: true });

    // 1. Default = the cheapest AVAILABLE variant, at its sale price.
    await expect(pill("فردي — شهر واحد — 25.00 د.ل")).toHaveAttribute("aria-pressed", "true");
    await expect(bar.getByText("25.00 د.ل")).toBeVisible();
    await expect(panel.getByText("25.00 د.ل")).toBeVisible();
    await expect(panel.getByText("30.00 د.ل")).toBeVisible(); // the strike

    // 2. Switching plan selects that plan's cheapest available option
    //    (عائلي — سنة, sale 150 over regular 200).
    await page.getByRole("button", { name: "عائلي", exact: true }).click();
    await expect(pill("عائلي — سنة — 150.00 د.ل")).toHaveAttribute("aria-pressed", "true");
    await expect(bar.getByText("150.00 د.ل")).toBeVisible();
    await expect(panel.getByText("150.00 د.ل")).toBeVisible();
    await expect(panel.getByText("200.00 د.ل")).toBeVisible(); // the strike

    // 3. Honest sold-out copy: the unavailable duration pill is
    //    disabled and says so in its accessible name…
    const soldOutDuration = pill("عائلي — شهر واحد — 45.00 د.ل — نفد");
    await expect(soldOutDuration).toBeVisible();
    await expect(soldOutDuration).toBeDisabled();
    // …and the fully sold-out plan pill too.
    const soldOutPlan = page.getByRole("button", { name: "ثنائي — نفد", exact: true });
    await expect(soldOutPlan).toBeVisible();
    await expect(soldOutPlan).toBeDisabled();

    // 4. The buy CTA's state follows variant availability: an
    //    available selection keeps it live.
    await expect(barBuyCta(page)).toBeEnabled();

    // 5. A regular (no-sale) variant: its own price, no fabricated
    //    strike on the panel. (The duration row only shows the
    //    SELECTED plan's options — switch back to فردي first.)
    await page.getByRole("button", { name: "فردي", exact: true }).click();
    await expect(pill("فردي — شهر واحد — 25.00 د.ل")).toHaveAttribute("aria-pressed", "true");
    await pill("فردي — سنة — 120.00 د.ل").click();
    await expect(pill("فردي — سنة — 120.00 د.ل")).toHaveAttribute("aria-pressed", "true");
    await expect(bar.getByText("120.00 د.ل")).toBeVisible();
    await expect(panel.getByText("120.00 د.ل")).toBeVisible();
    await expect(panel.getByText("30.00 د.ل")).toHaveCount(0);
    await page.screenshot({ path: "/home/z/my-project/download/r162-e-variant-640.png" });
  });

  // ── T4: the buy interaction — intercepted, honest pending → error ───────

  test("buy: the POST is intercepted (never on the wire); the UI renders its real pending → error states (640×960)", async ({
    page,
  }) => {
    const { writes } = await installHermeticApi(page, { user: HERMETIC_USER, orderDelayMs: 2000 });
    await openAuthedPdp(page, { width: 640, height: 960 });

    // A PAGE-SIDE state recorder: while the route handler holds the
    // order POST open, Playwright's Node-side protocol reads are
    // queued behind the pending interception (empirically verified
    // this round), so the in-flight window must be observed from
    // inside the page. The recorder samples the compact buy CTA every
    // 50 ms and logs state TRANSITIONS only.
    await page.evaluate(() => {
      const w = window as unknown as { __r162BuyStates?: { text: string; disabled: boolean }[] };
      w.__r162BuyStates = [];
      const read = () => {
        // The compact bar's FIRST button is the buy CTA (CtaBlock
        // renders it before the add-to-cart twin) — scoped to the bar
        // under test, not to any button that says اشترِ.
        const btn = document.querySelector(".mobile-sticky-above-nav button");
        if (!btn) return;
        const state = {
          text: (btn.textContent ?? "").trim(),
          disabled: (btn as HTMLButtonElement).disabled,
        };
        const log = w.__r162BuyStates!;
        const last = log[log.length - 1];
        if (!last || last.text !== state.text || last.disabled !== state.disabled) log.push(state);
      };
      read();
      setInterval(read, 50);
    });

    const cta = barBuyCta(page);
    await expect(cta).toBeEnabled();
    await cta.click();

    // The 503 lands (after the deliberate 2 s hold) → the page
    // surfaces the interception message in its error alert and
    // re-arms the CTA.
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText("لم يصل إلى الشبكة");
    await expect(cta).toBeEnabled();
    await expect(cta).toContainText("اشترِ");

    // No receipt screen, no navigation away from the PDP.
    expect(page.url()).toContain(`/product/${PRODUCT_SLUG}`);

    // The honest pending state WAS rendered during the in-flight
    // window (disabled + «جارٍ المعالجة…»)… (observed page-side)
    const states = await page.evaluate(
      () =>
        (window as unknown as { __r162BuyStates?: { text: string; disabled: boolean }[] })
          .__r162BuyStates,
    );
    const pendingStates = (states ?? []).filter(
      (s) => s.text.includes("جارٍ المعالجة…") && s.disabled,
    );
    const armedStates = (states ?? []).filter((s) => s.text === "اشترِ" && !s.disabled);
    console.log(`[r162-e] buy CTA transitions: ${JSON.stringify(states)}`);
    expect(
      pendingStates.length,
      "the pending state must render while the order is in flight",
    ).toBeGreaterThan(0);
    expect(armedStates.length, "the CTA must re-arm after the failure").toBeGreaterThan(0);

    // Evidence: exactly ONE order POST was attempted — through the
    // interceptor, with the real order body (product + variant).
    const orders = writes.filter((w) => w.path === "/api/orders");
    expect(orders).toHaveLength(1);
    expect(orders[0]!.method).toBe("POST");
    const body = JSON.parse(orders[0]!.body ?? "{}") as {
      product_id?: number;
      variant_id?: number;
    };
    expect(body.product_id).toBe(PRODUCT.id);
    expect(body.variant_id).toBe(101); // the default cheapest-available selection
    await page.screenshot({ path: "/home/z/my-project/download/r162-e-buy-error-640.png" });
  });

  // ── T5: add-to-cart from the authed bar — local-only by design ──────────

  test("add-to-cart from the authed bar is a local write: toast + localStorage, zero /api attempts (390×844)", async ({
    page,
  }) => {
    const { writes } = await installHermeticApi(page, { user: HERMETIC_USER });
    await openAuthedPdp(page, { width: 390, height: 844 });

    const add = page.getByRole("button", { name: "أضف للسلة", exact: true });
    await expect(add).toBeVisible();
    await add.click();

    // The confirmation toast (product.tsx handleAddToCart).
    await expect(page.getByText("أُضيف إلى السلة").first()).toBeVisible({ timeout: 10_000 });

    // The write stayed client-side: the cart grew in localStorage…
    const cart = await page.evaluate(() => localStorage.getItem("subnation_cart_v2"));
    expect(cart).toContain(`"productId":${PRODUCT.id}`);
    // …and NOTHING attempted the app's write surfaces — no order, no
    // /api/cart POST (the Sentry telemetry envelope that also matches
    // the catch-all is intercepted too and is not an app write).
    expect(
      writes.filter((w) => w.path.startsWith("/api/cart") || w.path.startsWith("/api/orders")),
    ).toHaveLength(0);

    // The bar's geometry is unaffected by the add.
    const bar = stickyBar(page);
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    expect(Number.parseInt(await bar.evaluate((el) => getComputedStyle(el).bottom), 10)).toBe(60);
    await page.screenshot({ path: "/home/z/my-project/download/r162-e-addtocart-390.png" });
  });

  // ── T6: the insufficient-balance branch (checkout CTA gating) ───────────

  test("insolvent session: «تحتاج … إضافية» + the شحن recovery navigates to /wallet?return= (640×960)", async ({
    page,
  }) => {
    await installHermeticApi(page, { user: POOR_USER });
    await openAuthedPdp(page, { width: 640, height: 960 });

    const bar = stickyBar(page);
    await expect(bar.getByText("تحتاج 15.00 د.ل إضافية")).toBeVisible();
    // The buy CTA is replaced by the top-up affordance — no dead buy
    // promise for a balance that cannot cover the price.
    await expect(barBuyCta(page)).toHaveCount(0);
    const topup = page.getByRole("button", { name: "شحن", exact: true });
    await expect(topup).toBeVisible();

    await topup.click();
    // The wallet-return contract (R94-A1 #7): /wallet?return=/product/…
    await page.waitForURL(/\/wallet\?return=/, { timeout: 10_000 });
    expect(page.url()).toContain("return=%2Fproduct%2F");
    // The wallet page itself renders under the hermetic data.
    await expect(page.locator("main")).toBeVisible();
    await page.screenshot({ path: "/home/z/my-project/download/r162-e-shortfall-640.png" });
  });

  // ── T7: RTL (default) + both themes via the app's own toggle ────────────

  test("RTL default + light theme via the header toggle: the bar stays correct in both themes (640×960 → 390×844)", async ({
    page,
  }) => {
    await installHermeticApi(page, { user: HERMETIC_USER });

    // Dark is the default (:root) — no .light class at boot.
    await openAuthedPdp(page, { width: 640, height: 960 });
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/(^|\s)light(\s|$)/);

    // Toggle through the app's own mechanism (Navbar aria-label).
    await page.getByRole("button", { name: "تبديل المظهر (داكن/فاتح)" }).click();
    await expect(html).toHaveClass(/(^|\s)light(\s|$)/);

    // The bar stays correct in light at 640 (the R161 gap band).
    const bar = stickyBar(page);
    await expect(barBuyCta(page)).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    expect(Number.parseInt(await bar.evaluate((el) => getComputedStyle(el).bottom), 10)).toBe(60);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "/home/z/my-project/download/r162-e-theme-light-640.png" });

    // The persisted light theme survives a fresh boot at 390.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/product/${PRODUCT_SLUG}`);
    await expect(page.locator("main").getByText(/د\.ل/).first()).toBeVisible({ timeout: 20_000 });
    await expect(html).toHaveClass(/(^|\s)light(\s|$)/);
    await expect(barBuyCta(page)).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    expect(Number.parseInt(await bar.evaluate((el) => getComputedStyle(el).bottom), 10)).toBe(60);
    const overflow390 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow390).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "/home/z/my-project/download/r162-e-theme-light-390.png" });
  });
});
