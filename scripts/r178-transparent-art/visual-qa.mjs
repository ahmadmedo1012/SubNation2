/* global URL, document, getComputedStyle, localStorage -- the URL/d/getComputedStyle
 * uses live inside page.evaluate browser callbacks (serialized to Chromium) and
 * the route mocks; URL is also a Node global — the flat no-undef just can't see
 * either world from a bare .mjs. */
// R178 visual QA — real DOM, both themes, with computed-style proof that the
// polarity filter fires (also empirically validates the minified invert()).
// Serves the BUILT dist/public (the exact bytes production ships) behind a
// static server; /api/* is mocked read-only (no backend, no DB, no Neon).
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { chromium } from "@playwright/test";

const DIST = "/home/z/my-project/SubNation2/frontend/dist/public";
const OUT = new URL("./docs/engineering/R178/screenshots", import.meta.url).pathname;
const PORT = 4187;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".ico": "image/x-icon",
};

const mk = (i, slug, name, price, category) => ({
  id: i,
  slug,
  name,
  description: "اشتراك رقمي رسمي",
  image_url: `/products/${slug}.webp`,
  price,
  price_from: false,
  category,
  is_active: true,
  stock_count: 99,
  is_available: true,
  sale_price: null,
  discount_percent: null,
  order_count: 12,
  variant_count: 1,
});

// polarity representatives: ink (flip on dark) / paper (flip on light) / auto
const PRODUCTS = [
  mk(1, "netflix", "Netflix", 79.8, "streaming"),
  mk(2, "hbo-max", "HBO Max", 59.0, "streaming"),
  mk(3, "apple-tv-plus", "Apple TV+", 19.9, "streaming"),
  mk(4, "fox-now", "FOX NOW", 14.5, "streaming"),
  mk(5, "spotify-premium", "Spotify Premium", 22.0, "music"),
  mk(6, "soundcloud-go-plus", "SoundCloud Go+", 18.0, "music"),
  mk(7, "pandora-premium", "Pandora Premium", 15.0, "music"),
  mk(8, "idagio", "IDAGIO", 12.0, "music"),
  mk(9, "tidal", "TIDAL", 25.0, "music"),
  mk(10, "ahrefs", "Ahrefs", 120.0, "seo_tools"),
  mk(11, "windows-10-pro", "Windows 10 Pro", 89.0, "software"),
  mk(12, "youtube-premium", "YouTube Premium", 32.0, "streaming"),
];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  let p = url.pathname;
  if (p === "/") p = "/index.html";
  const file = join(DIST, p);
  if (existsSync(file)) {
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(readFileSync(file));
    return;
  }
  // SPA fallback for client routes
  res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  res.end(readFileSync(join(DIST, "index.html")));
});

await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
console.log(`serving ${DIST} → http://127.0.0.1:${PORT}`);

let browser;
try {
  browser = await chromium.launch();
} catch {
  // dev-box fallback: the sandbox's playwright pin differs from its cache
  browser = await chromium.launch({
    executablePath: "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome",
  });
}
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: "block",
});
const page = await ctx.newPage();

await page.route("**/api/**", (route) => {
  const u = new URL(route.request().url());
  const json = (body) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  if (u.pathname === "/api/products") return json(PRODUCTS);
  if (/^\/api\/products\/by-slug\/[^/]+$/.test(u.pathname)) {
    const slug = u.pathname.split("/").pop();
    const p = PRODUCTS.find((x) => x.slug === slug) ?? PRODUCTS[0];
    return json({
      ...p,
      description_long: "اشتراك رسمي سريع التسليم مع تسليم فوري على مدار الساعة.",
      faq: null,
      features: ["تسليم فوري", "ضمان طوال مدة الاشتراك"],
      seo_title: null,
      seo_description: null,
      usage_terms: null,
      variants: [],
    });
  }
  if (/^\/api\/products\/[^/]+$/.test(u.pathname)) {
    const slug = u.pathname.split("/").pop();
    const p = PRODUCTS.find((x) => x.slug === slug) ?? PRODUCTS[0];
    return json({
      ...p,
      description_long: "اشتراك رسمي سريع التسليم مع تسليم فوري على مدار الساعة.",
      faq: null,
      features: ["تسليم فوري", "ضمان طوال مدة الاشتراك"],
      seo_title: null,
      seo_description: null,
      usage_terms: null,
      variants: [],
    });
  }
  if (/^\/api\/products\/[^/]+\/recommendations$/.test(u.pathname)) return json([]);
  if (u.pathname === "/api/flash-sale") return json(null);
  if (u.pathname === "/api/catalog/stats") {
    return json({
      total_products: 45,
      available_products: 41,
      total_units: 900,
      lowest_price: 9.5,
      has_flash_sale: false,
    });
  }
  if (u.pathname === "/api/auth/me")
    return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  return json([]);
});

const shot = async (name) => page.screenshot({ path: join(OUT, name), fullPage: false });

// ── DARK (default) ──
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForSelector("img[src*='/products/']", { timeout: 15000 });
await page.waitForTimeout(600);
await shot("r178-home-dark.png");

// computed-style proof: ink logo flipped, auto logo NOT filtered
const probe = async (slug) =>
  page.evaluate((s) => {
    const el = document.querySelector(`img[src*="/products/${s}.webp"]`);
    return el ? getComputedStyle(el).filter : "MISSING";
  }, slug);
console.log("[dark] netflix (ink)   filter:", await probe("netflix"));
console.log("[dark] hbo-max (ink)   filter:", await probe("hbo-max"));
console.log("[dark] spotify (auto)  filter:", await probe("spotify-premium"));
console.log("[dark] pandora (paper) filter:", await probe("pandora-premium"));

// PDP dark
await page.goto(`http://127.0.0.1:${PORT}/product/netflix`, { waitUntil: "networkidle" });

await page.waitForTimeout(800);
await shot("r178-pdp-netflix-dark.png");

// ── LIGHT ── (fresh context — the ThemeProvider reads sn_theme at boot)
const lctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: "block",
});
await lctx.addInitScript(() => localStorage.setItem("sn_theme", "light"));
const lpage = await lctx.newPage();
await lpage.route("**/api/**", (route) => {
  const u = new URL(route.request().url());
  const json = (body) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  if (u.pathname === "/api/products") return json(PRODUCTS);
  if (/^\/api\/products\/by-slug\/[^/]+$/.test(u.pathname)) {
    const slug = u.pathname.split("/").pop();
    const p = PRODUCTS.find((x) => x.slug === slug) ?? PRODUCTS[0];
    return json({
      ...p,
      description_long: "اشتراك رسمي سريع التسليم مع تسليم فوري على مدار الساعة.",
      faq: null,
      features: ["تسليم فوري", "ضمان طوال مدة الاشتراك"],
      seo_title: null,
      seo_description: null,
      usage_terms: null,
      variants: [],
    });
  }
  if (/^\/api\/products\/[^/]+$/.test(u.pathname)) {
    const slug = u.pathname.split("/").pop();
    const p = PRODUCTS.find((x) => x.slug === slug) ?? PRODUCTS[0];
    return json({
      ...p,
      description_long: "اشتراك رسمي سريع التسليم مع تسليم فوري على مدار الساعة.",
      faq: null,
      features: ["تسليم فوري", "ضمان طوال مدة الاشتراك"],
      seo_title: null,
      seo_description: null,
      usage_terms: null,
      variants: [],
    });
  }
  if (/^\/api\/products\/[^/]+\/recommendations$/.test(u.pathname)) return json([]);
  if (u.pathname === "/api/flash-sale") return json(null);
  if (u.pathname === "/api/catalog/stats") {
    return json({
      total_products: 45,
      available_products: 41,
      total_units: 900,
      lowest_price: 9.5,
      has_flash_sale: false,
    });
  }
  if (u.pathname === "/api/auth/me")
    return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  return json([]);
});
await lpage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await lpage.waitForSelector("img[src*='/products/']", { timeout: 15000 });
await lpage.waitForTimeout(600);
await lpage.screenshot({ path: join(OUT, "r178-home-light.png") });
const probeL = async (slug) =>
  lpage.evaluate((sl) => {
    const el = document.querySelector(`img[src*="/products/${sl}.webp"]`);
    return el ? getComputedStyle(el).filter : "MISSING";
  }, slug);
console.log("[light] netflix (ink)   filter:", await probeL("netflix"));
console.log("[light] pandora (paper) filter:", await probeL("pandora-premium"));
console.log("[light] idagio (paper)  filter:", await probeL("idagio"));
console.log("[light] spotify (auto)  filter:", await probeL("spotify-premium"));

// PDP light
await lpage.goto(`http://127.0.0.1:${PORT}/product/netflix`, { waitUntil: "networkidle" });
await lpage.waitForTimeout(800);
await lpage.screenshot({ path: join(OUT, "r178-pdp-netflix-light.png") });

await browser.close();
server.close();
console.log("QA screenshots →", OUT);
