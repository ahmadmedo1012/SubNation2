import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 98-F7 (R98-08 — A5 §2) — PWA offline-gap hardening, static contract.
 *
 * Three coordinated pieces (R98-08a/b):
 *
 *   a. vite.config.ts: a THIRD runtimeCaching rule — CacheFirst for
 *      same-origin JS (`assets-js`, 160 entries / 30 days — raised from
 *      40 in A2 F2/R124 to stop LRU thrash on the ~150-chunk build) —
 *      while the precache JS glob ban stays deliberately untouched.
 *      Rationale: mobile browsers evict the HTTP cache under storage
 *      pressure without touching SW caches, so the offline story
 *      previously died exactly when the JS chunks vanished.
 *   b. index.html: a static, inline-styled no-JS fallback div
 *      (R116-S1: «يتطلب الموقع تشغيل JavaScript» — the neutral no-JS
 *      copy; the old «لا يوجد اتصال بالإنترنت» misdiagnosed
 *      blocked/broken JS as an outage) inside #root — hidden by
 *      default (opacity:0 + a delayed CSS reveal) so a healthy boot
 *      never flashes it; only a boot whose JS never arrives lets it
 *      appear instead of a white screen.
 *   c. main.tsx: removes the div on successful boot (one line, before
 *      React takes over the container).
 *
 * Push (R98-08c) is a documented product decision, intentionally absent.
 *
 * Static-file assertions follow the design-system-css / seo-head-inject
 * test pattern (reading the real sources from the runner cwd).
 */

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("R98-08a — vite.config.ts runtime JS caching", () => {
  const configText = read("vite.config.ts");

  it("has a third runtime rule: CacheFirst assets-js with 160 entries / 30 days (A2 F2/R124)", () => {
    expect(configText).toMatch(/cacheName:\s*"assets-js"/);
    expect(configText).toMatch(/handler:\s*"CacheFirst"/);
    expect(configText).toMatch(/maxEntries:\s*160,/);
    expect(configText).toMatch(/maxAgeSeconds:\s*2_592_000/);
  });

  it("scopes the rule to SAME-ORIGIN .js GETs (remote scripts stay on the network)", () => {
    expect(configText).toContain(
      'sameOrigin && request.method === "GET" && /\\.js$/.test(url.pathname)',
    );
  });

  it("keeps the deliberate precache diet: the JS glob ignore is unchanged", () => {
    // The precache JS ban is intentional (stale-entry + fresh-chunks
    // failure mode) — the runtime rule must never creep into the precache.
    expect(configText).toContain('globIgnores: ["**/*.js"]');
  });
});

describe("R98-08b — index.html static offline fallback", () => {
  const html = read("index.html");

  it("carries the Arabic no-JS div INSIDE #root (neutral JavaScript copy)", () => {
    expect(html).toMatch(
      /<div id="root">[\s\S]*?<div id="static-offline"[^>]*>[^<]*يتطلب الموقع تشغيل JavaScript[^<]*<\/div>\s*<\/div>/,
    );
    // The misleading offline diagnosis must not come back.
    expect(html).not.toContain("لا يوجد اتصال بالإنترنت");
  });

  it("is hidden by default with a DELAYED reveal (no flash on healthy boots)", () => {
    const style = html.match(/#static-offline\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(style).toContain("opacity: 0");
    // R128-IMP-4 (B5-F4): 2.5s → 6s — the old delay sat INSIDE a
    // bandwidth-bound online first paint (entry + modulepreloaded
    // vendors still in flight), so the no-JS message flashed on healthy
    // slow boots before main.tsx's removal landed. 6s is past every
    // realistic online first paint; the truly-JS-never case still
    // reveals (an inline navigator.onLine gate is impossible under the
    // CSP src-less-script ban — see index.html's comment).
    expect(html).toMatch(/animation:\s*sn-offline-reveal[^;]*6s/);
    expect(html).not.toMatch(/animation:\s*sn-offline-reveal[^;]*2\.5s/);
  });

  it("is self-contained (inline styles + system colors — no CSS-chunk dependency)", () => {
    const style = html.match(/#static-offline\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(style).toContain("color: canvastext");
    expect(style).toContain("background: canvas");
    // RTL declared on the element itself, not inherited from the CSS chunk.
    expect(html).toMatch(/<div id="static-offline" dir="rtl"/);
  });
});

describe("R98-08b — main.tsx removes the fallback on successful boot", () => {
  const main = read("src/main.tsx");

  it("removes #static-offline synchronously during module evaluation", () => {
    expect(main).toContain('document.getElementById("static-offline")?.remove()');
    // The removal must happen BEFORE React takes the container over.
    const removalIdx = main.indexOf('document.getElementById("static-offline")?.remove()');
    const renderIdx = main.indexOf("createRoot(");
    expect(removalIdx).toBeGreaterThan(-1);
    expect(removalIdx).toBeLessThan(renderIdx);
  });
});

describe("R128-IMP-4 (B5-F1) — the SW bundle never ships a sourcemap", () => {
  const configText = read("vite.config.ts");

  it("workbox.sourcemap is hard-false — vite-plugin-pwa must not inherit the Vite build's sourcemap", () => {
    // vite-plugin-pwa copies build.sourcemap into the SW bundle when
    // workbox.sourcemap is undefined, so the token'd Docker build
    // (sourcemap: "hidden") emitted sw.js.map + workbox-*.js.map at the
    // dist ROOT — publicly fetchable (live probe 2026-10-10: /sw.js.map
    // → 200 application/json 6,484 B; /workbox-5a76e2bc.js.map → 217,501 B).
    // The SW is generated code + the workbox runtime — nothing to
    // symbolize that isn't already public via sw.js/workbox-*.js.
    expect(configText).toContain("sourcemap: false,");
    // …and the pin must sit inside the workbox block (a stray
    // `sourcemap: false` elsewhere would pass the naive contains).
    const workboxIdx = configText.indexOf("workbox: {");
    const sourcemapIdx = configText.indexOf("sourcemap: false,");
    expect(workboxIdx).toBeGreaterThan(-1);
    expect(sourcemapIdx).toBeGreaterThan(workboxIdx);
  });

  it("the sourcemap guard sweeps the dist ROOT too (belt-and-suspenders for future root-level map emitters)", () => {
    // The pre-R128 guard resolved dist/public/assets ONLY — the SW
    // maps live at the dist root and bypassed the sweep entirely.
    expect(configText).toContain('const sweptDirs = [path.join(distRoot, "assets"), distRoot];');
  });
});

describe("R128-IMP-4 (B5-F3) — navigation fallback denylist covers the SW's own root-static files", () => {
  const configText = read("vite.config.ts");

  it("the denylist pins the root-static entry (sw.js / registerSW.js / workbox-*.js / manifest.json / init.js)", () => {
    // A top-level navigation to /sw.js is a mode-"navigate" request, so
    // NavigationRoute used to answer it with the precached SPA shell
    // instead of the file (curl/devtools masked it — no controlled SW
    // context). The denylist entry below is pinned verbatim.
    expect(configText).toContain(
      "/^\\/(?:sw\\.js|registerSW\\.js|workbox-[^/]+\\.js|manifest\\.json|init\\.js)$/",
    );
  });

  it("the denylist admits SPA routes (offline shell keeps serving them) and denies only root-static files", () => {
    // A local copy of the pinned regex — the verbatim pin above guards
    // the wiring; this matrix guards its SEMANTICS (B5-F3's design).
    const denyRootStatic =
      /^\/(?:sw\.js|registerSW\.js|workbox-[^/]+\.js|manifest\.json|init\.js)$/;
    for (const denied of [
      "/sw.js",
      "/registerSW.js",
      "/workbox-5a76e2bc.js",
      "/manifest.json",
      "/init.js",
    ]) {
      expect(denied).toMatch(denyRootStatic);
    }
    // /api/* and /assets/* stay denied (pre-existing entries); every
    // other path — /admin included — is an SPA route that KEEPS the
    // offline shell (the denylist must never grow into route space).
    expect("/api/products").toMatch(/^\/api\//);
    expect("/assets/index-abc.js").toMatch(/^\/assets\//);
    for (const served of ["/", "/admin", "/admin/orders", "/product/netflix-1m", "/flash-sales"]) {
      expect(served).not.toMatch(denyRootStatic);
      expect(served).not.toMatch(/^\/api\//);
      expect(served).not.toMatch(/^\/assets\//);
    }
  });
});
