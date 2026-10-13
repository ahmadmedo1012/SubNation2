import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R-140-n — offline/PWA depth: source-scan pins for the WHOLE offline
 * surface of the app. Nothing here renders; every assertion reads the
 * real sources from the runner cwd (same pattern as
 * pwa-offline-shell.test.ts / seo parity suites).
 *
 * ── (a) SW CACHE STRATEGY MAP (vite.config.ts VitePWA/workbox) ──────
 *
 * The SW is GENERATED (vite-plugin-pwa GenerateSW — there is no
 * hand-written sw source file); vite.config.ts's workbox block is the
 * single source of truth. registerType "autoUpdate" makes the plugin
 * inject skipWaiting + clientsClaim into the generated sw.js, and
 * cleanupOutdatedCaches defaults true, so a deploy's new SW takes over
 * open tabs at once (main.tsx's controllerchange toast makes that
 * VISIBLE). The strategies, per asset class:
 *
 *   • HTML shell (SPA navigations): navigateFallback "index.html" —
 *     PRECACHE-first via createHandlerBoundToURL. NOT network-first:
 *     there is no `handler: "NetworkFirst"` anywhere in the config.
 *     Offline navigations answer instantly from the revisioned
 *     precache; deploy freshness rides autoUpdate, not the network.
 *   • Precache (install-time, revisioned): index.html, manifest.json,
 *     assets/*.css, assets/*.woff2 + favicon.svg (includeAssets).
 *     JS is DELIBERATELY never precached (globIgnores — the recursive
 *     *.js ban; stale-entry + fresh-chunks is the classic
 *     half-updated-PWA failure), with a 384 KB per-entry size ceiling.
 *   • /assets/* immutability: hashed filenames → server's 1y immutable
 *     HTTP cache + the SW's same-origin-JS runtime CacheFirst rule
 *     (survives HTTP-cache eviction — 98-F7). CSS/woff2 also ride the
 *     precache. /assets/* is in the navigateFallbackDenylist so the
 *     shell never answers a direct asset URL.
 *   • Catalog APIs: GET /api/(products|flash-sale) → StaleWhile
 *     Revalidate, "api-catalog-v1", 32 entries / 7-day response-age
 *     bound (R96 F-7a) — an offline repeat visitor keeps the
 *     last-known catalog; SWR refreshes silently whenever online.
 *   • Images (request.destination === "image", any origin): CacheFirst
 *     "images-v1", 200 entries / 30 days.
 *   • Same-origin .js GETs: CacheFirst "assets-js", 160 entries /
 *     30 days (A2 F2 raised 40 → 160 to stop LRU thrash).
 *   • Money/auth APIs: NEVER runtime-cached — no rule matches
 *     /api/wallet*, /api/topups*, /api/orders, /api/cart… (deliberate:
 *     authenticated surfaces must not live in a SW cache).
 *
 * ── (b) OFFLINE ROUTE CHAIN — hard navigation to /wallet offline ───
 *
 *   1. GET /wallet (mode "navigate") → not in the denylist → the SW's
 *      NavigationRoute serves the PRECACHED index.html shell.
 *   2. Shell boots: CSS + woff2 from the precache; the entry JS chunk
 *      from the immutable HTTP cache or the "assets-js" runtime cache
 *      (present only after a prior ONLINE visit of that release — a
 *      first-ever visitor offline never gets JS and sees the static
 *      no-JS div after its 6 s reveal; that div is the JS-NEVER case,
 *      NOT the app's offline message).
 *   3. main.tsx removes #static-offline synchronously BEFORE React
 *      takes the container — once JS is up, the SW/offline story owns
 *      the surface (per index.html's own comment).
 *   4. No token → guest redirect to /login?redirect=/wallet. Token →
 *      the three money queries fire; offline fetch rejects with the
 *      browser TypeError → isRetryableQueryError → ONE retry → still
 *      TypeError → isError lands.
 *   5. Every wallet surface renders the calm FetchErrorCard register:
 *      BalanceCard «تعذّر تحميل رصيد المحفظة» (section), TopupHistoryCard
 *      «تعذّر تحميل سجل الشحن» (compact), WalletStatementCard «تعذّر
 *      تحميل سجل الحركات» (compact) — WifiOff tile, role="alert",
 *      «إعادة المحاولة». Never a white screen, never a fake-empty
 *      wallet (93-C5: outage ≠ empty on money pages).
 *
 * ── (d) NETWORK-STATE UX ────────────────────────────────────────────
 *
 * There is NO navigator.onLine / online|offline banner anywhere in app
 * source — a DOCUMENTED gap, pinned below so introducing one is a
 * conscious family decision (proposal lives in the r140-n worklog
 * entry and in healthz.ts's R-140-n doc note).
 */

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

/** HSL → hex, matching the CSS engine, for the token cross-check. */
function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Strip block comments and line comments (source-scan only — conservative). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** App source files (tests excluded) for the network-state sweep. */
function walkAppSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "test") continue;
      out.push(...walkAppSources(p));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

describe("R-140-n (a) — SW cache strategy map (vite.config.ts workbox)", () => {
  const configText = read("vite.config.ts");

  it("registerType autoUpdate: the plugin injects skipWaiting + clientsClaim (fast takeover)", () => {
    expect(configText).toContain('registerType: "autoUpdate"');
  });

  it("the hand-written public/manifest.json stays the single manifest source (manifest: false)", () => {
    expect(configText).toContain("manifest: false");
  });

  it("precache allowlist: shell html + manifest + css + woff2 (+ favicon via includeAssets), NO js", () => {
    expect(configText).toContain('includeAssets: ["favicon.svg"]');
    const globs = configText.match(/globPatterns:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    expect(globs).toContain('"index.html"');
    expect(globs).toContain('"manifest.json"');
    expect(globs).toContain('"assets/*.css"');
    expect(globs).toContain('"assets/*.woff2"');
    expect(globs).not.toContain("*.js");
    // The JS precache ban is deliberate (stale-entry + fresh-chunks).
    expect(configText).toContain('globIgnores: ["**/*.js"]');
    // Belt & suspenders size ceiling.
    expect(configText).toContain("maximumFileSizeToCacheInBytes: 384 * 1024");
  });

  it("HTML shell is PRECACHE-first (navigateFallback), NOT network-first", () => {
    expect(configText).toContain('navigateFallback: "index.html"');
    // The verdict pin: no runtime rule (and no comment-less config) may
    // ever introduce a NetworkFirst handler for the shell or anything
    // else. (The word appears once, inside a comment about why SWR has
    // no networkTimeoutSeconds — hence the quoted-handler shape.)
    expect(configText).not.toContain('handler: "NetworkFirst"');
  });

  it("catalog APIs: StaleWhileRevalidate api-catalog-v1, 32 entries / 7 days, GET-only", () => {
    expect(configText).toContain(
      'request.method === "GET" && /^\\/api\\/(products|flash-sale)/.test(url.pathname)',
    );
    expect(configText).toContain('handler: "StaleWhileRevalidate"');
    expect(configText).toContain('cacheName: "api-catalog-v1"');
    expect(configText).toContain("maxEntries: 32,");
    expect(configText).toContain("maxAgeSeconds: 604_800,");
  });

  it("images: CacheFirst images-v1, 200 entries / 30 days", () => {
    expect(configText).toContain('request.destination === "image"');
    const images =
      configText.match(
        /request\.destination === "image"[\s\S]*?cacheName: "images-v1"[\s\S]*?\}/,
      )?.[0] ?? "";
    expect(images).toContain('handler: "CacheFirst"');
    expect(images).toContain("maxEntries: 200,");
    expect(images).toContain("maxAgeSeconds: 2_592_000");
  });

  it("same-origin JS: CacheFirst assets-js, 160 entries / 30 days (survives HTTP-cache eviction)", () => {
    expect(configText).toContain(
      'sameOrigin && request.method === "GET" && /\\.js$/.test(url.pathname)',
    );
    expect(configText).toContain('cacheName: "assets-js"');
    expect(configText).toContain("maxEntries: 160,");
  });

  it("money/auth APIs are NEVER runtime-cached — exactly three rules, none touches a money path", () => {
    // The runtime surface is pinned by COUNT: the three predicates
    // (catalog / image / same-origin JS) are pinned verbatim in the
    // tests above; a fourth rule (e.g. an /api/wallet cache) can never
    // appear silently.
    expect(configText.match(/urlPattern:/g)).toHaveLength(3);
    // And the navigation fallback never swallows /api/* or /assets/*.
    expect(configText).toContain("/^\\/api\\//");
    expect(configText).toContain("/^\\/assets\\//");
  });

  it("the SW bundle never ships a sourcemap (R128-IMP-4 B5-F1)", () => {
    expect(configText).toContain("sourcemap: false,");
  });
});

describe("R-140-n (b) — offline route chain: hard navigation to /wallet", () => {
  const configText = read("vite.config.ts");
  const wallet = read("src/pages/wallet.tsx");
  const balanceCard = read("src/components/wallet/BalanceCard.tsx");
  const topupHistory = read("src/components/wallet/TopupHistoryCard.tsx");
  const statement = read("src/components/wallet/WalletStatementCard.tsx");
  const fetchErrorCard = read("src/components/ui/fetch-error-card.tsx");
  const queryClient = read("src/app/query-client.ts");
  const main = read("src/main.tsx");
  const html = read("index.html");

  it("step 1 — /wallet is an SPA route: the denylist must NOT swallow it (precached shell answers)", () => {
    const denyApi = /^\/api\//;
    const denyAssets = /^\/assets\//;
    const denyRootStatic =
      /^\/(?:sw\.js|registerSW\.js|workbox-[^/]+\.js|manifest\.json|init\.js)$/;
    for (const route of ["/wallet", "/checkout", "/orders", "/login"]) {
      expect(route).not.toMatch(denyApi);
      expect(route).not.toMatch(denyAssets);
      expect(route).not.toMatch(denyRootStatic);
    }
    // The denylist itself stays pinned in the config (B5-F3 shape).
    expect(configText).toContain("navigateFallbackDenylist: [");
  });

  it("step 2 — the no-JS div is the JS-NEVER case only: neutral copy inside #root, 6 s delayed reveal", () => {
    expect(html).toMatch(/<div id="root">[\s\S]*?id="static-offline"/);
    expect(html).toContain("يتطلب الموقع تشغيل JavaScript");
    expect(html).not.toContain("لا يوجد اتصال بالإنترنت");
    expect(html).toMatch(/animation:\s*sn-offline-reveal[^;]*6s/);
  });

  it("step 3 — main.tsx removes #static-offline BEFORE React owns the container (JS-up ⇒ SW story rules)", () => {
    expect(main).toContain('document.getElementById("static-offline")?.remove()');
    expect(main.indexOf('document.getElementById("static-offline")?.remove()')).toBeLessThan(
      main.indexOf("createRoot("),
    );
  });

  it("step 4 — the three money queries wire isError + refetch (the page observes failure, never hides it)", () => {
    for (const hook of ["useGetWallet(", "useListTopups(", "useGetWalletLedger("]) {
      expect(wallet).toContain(hook);
    }
    expect(wallet).toContain("isError: walletError,");
    expect(wallet).toContain("refetch: refetchWallet,");
    expect(wallet).toContain("isError: topupsError,");
    expect(wallet).toContain("refetch: refetchTopups,");
    expect(wallet).toContain("isError: ledgerError,");
    expect(wallet).toContain("refetch: refetchLedger,");
  });

  it("step 4b — offline fetch = TypeError: retried exactly ONCE, then isError (no infinite spin)", () => {
    expect(queryClient).toContain("failureCount < 1 && isRetryableQueryError(error)");
    expect(queryClient).toContain("if (error instanceof TypeError) return true;");
    // Reconnect storms are deliberately NOT refetched (mobile UX).
    expect(queryClient).toContain("refetchOnReconnect: false");
  });

  it("step 5 — every wallet surface renders the calm FetchErrorCard (outage ≠ empty wallet)", () => {
    expect(wallet).toContain("error={walletError}");
    expect(wallet).toContain("onRetry={() => void refetchWallet()}");
    expect(wallet).toContain("error={topupsError}");
    expect(wallet).toContain("onRetry={() => void refetchTopups()}");
    expect(wallet).toContain("error={ledgerError}");
    expect(wallet).toContain("onRetry={() => void refetchLedger()}");

    expect(balanceCard).toContain("<FetchErrorCard");
    expect(balanceCard).toContain('size="section"');
    expect(balanceCard).toContain('title="تعذّر تحميل رصيد المحفظة"');
    expect(balanceCard).toContain("onRetry={onRetry}");

    expect(topupHistory).toContain("<FetchErrorCard");
    expect(topupHistory).toContain('size="compact"');
    expect(topupHistory).toContain('title="تعذّر تحميل سجل الشحن"');

    expect(statement).toContain("<FetchErrorCard");
    expect(statement).toContain('size="compact"');
    expect(statement).toContain('title="تعذّر تحميل سجل الحركات"');
  });

  it("step 5b — the FetchErrorCard register itself: alert role, WifiOff, Arabic retry, calm frame", () => {
    expect(fetchErrorCard).toContain('role="alert"');
    expect(fetchErrorCard).toContain("icon: Icon = WifiOff");
    expect(fetchErrorCard).toContain('retryLabel = "إعادة المحاولة"');
    // R138 calm-error re-tune: the state signal lives in the icon stage,
    // not a red frame around the whole card.
    expect(fetchErrorCard).toContain("border border-border/60");
  });

  it("update flow — autoUpdate takeover is VISIBLE: main.tsx toasts on controllerchange", () => {
    expect(main).toContain('"controllerchange"');
    expect(main).toContain("تحديث جديد متاح");
    expect(main).toContain("window.location.reload()");
  });
});

describe("R-140-n (c) — manifest.json completeness (public/manifest.json)", () => {
  const manifest = JSON.parse(read("public/manifest.json")) as Record<string, unknown>;
  const html = read("index.html");

  it("carries every installability field (name, short_name, id, start_url, scope, display)", () => {
    expect(manifest.name).toBe("SubNation — سوق الاشتراكات الرقمية");
    expect(manifest.short_name).toBe("SubNation");
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(typeof manifest.description).toBe("string");
    expect(manifest.categories).toEqual(["shopping", "entertainment"]);
  });

  it("theme_color MATCHES the index.html meta theme-color (one brand answer everywhere)", () => {
    const metaTheme = html.match(/<meta[^>]*name="theme-color"[^>]*content="([^"]+)"/)?.[1];
    expect(metaTheme).toBe("#dc1840");
    expect(manifest.theme_color).toBe(metaTheme);
  });

  it("background_color IS the dark surface token (#0a0c10 = --surface-base 220 22% 5%)", () => {
    const css = read("src/index.css");
    expect(css).toContain("--surface-base: 220 22% 5%;");
    expect(hslToHex(220, 22, 5)).toBe("#0a0c10");
    expect(manifest.background_color).toBe("#0a0c10");
  });

  it('lang/dir are ar/rtl — mirroring <html lang="ar" dir="rtl">', () => {
    expect(manifest.lang).toBe("ar");
    expect(manifest.dir).toBe("rtl");
    expect(html).toContain('<html lang="ar" dir="rtl">');
    // The app re-affirms direction at boot (the race guard).
    expect(read("src/main.tsx")).toContain('applyDocumentDirection("ar")');
  });

  it("icons: any 96/192/512 + maskable 192/512, and every referenced file EXISTS in public/", () => {
    const icons = manifest.icons as Array<{ src: string; sizes: string; purpose?: string }>;
    const purposes = (p: string) => icons.filter((i) => (i.purpose ?? "any") === p);
    expect(purposes("any").map((i) => i.sizes)).toEqual(
      expect.arrayContaining(["96x96", "192x192", "512x512"]),
    );
    expect(purposes("maskable").map((i) => i.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    for (const icon of icons) {
      expect(existsSync(resolve(process.cwd(), "public", icon.src.replace(/^\//, "")))).toBe(true);
    }
  });

  it("screenshots: narrow 540x1080 + wide 1080x540, labelled, files present (Richer Install UI)", () => {
    const shots = manifest.screenshots as Array<{
      src: string;
      sizes: string;
      form_factor: string;
      label: string;
    }>;
    expect(shots).toHaveLength(2);
    expect(shots.map((s) => s.form_factor).sort()).toEqual(["narrow", "wide"]);
    for (const shot of shots) {
      expect(shot.label).toBeTruthy();
      expect(existsSync(resolve(process.cwd(), "public", shot.src.replace(/^\//, "")))).toBe(true);
    }
  });

  it("shortcuts: store, orders AND the R-140-n wallet money path (same family idiom)", () => {
    const shortcuts = manifest.shortcuts as Array<{
      name: string;
      url: string;
      icons: Array<{ src: string }>;
    }>;
    const urls = shortcuts.map((s) => s.url);
    expect(urls).toEqual(["/", "/orders", "/wallet"]);
    // The wallet shortcut is the money-path gap R-140-n closed: an
    // installed repeat-buyer deep-launches into topup + statement.
    const walletShortcut = shortcuts.find((s) => s.url === "/wallet");
    expect(walletShortcut?.name).toBe("المحفظة");
    // Family idiom: every shortcut rides the same 96px launcher icon.
    for (const shortcut of shortcuts) {
      expect(shortcut.icons[0].src).toBe("/pwa-96x96.png");
      expect(existsSync(resolve(process.cwd(), "public", "pwa-96x96.png"))).toBe(true);
    }
  });
});

describe("R-140-n (d) — network-state UX is a DOCUMENTED gap (no navigator.onLine anywhere)", () => {
  it("no app source file reads navigator.onLine or listens to online/offline events", () => {
    // Deliberate pin of ABSENCE: the app has no offline banner/detection
    // and never guesses connectivity. Adding one is a family decision —
    // update this pin + the r140-n worklog proposal together.
    const offenders: string[] = [];
    for (const file of walkAppSources(resolve(process.cwd(), "src"))) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (code.includes("navigator.onLine") || code.includes('"offline"')) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("offline /status stays calm: healthz never throws — degrades to the «degraded» fallback", () => {
    const healthz = read("src/lib/healthz.ts");
    expect(healthz).toContain('const SUMMARY_FALLBACK: HealthzSummary = { status: "degraded" };');
    expect(healthz).toContain("return SUMMARY_FALLBACK;");
    // The offline-vs-server-degraded distinction is documented at the
    // module (R-140-n), not implemented — see the note + worklog.
    expect(healthz).toContain("R-140-n");
  });
});
