import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 98-F7 (R98-08 — A5 §2) — PWA offline-gap hardening, static contract.
 *
 * Three coordinated pieces (R98-08a/b):
 *
 *   a. vite.config.ts: a THIRD runtimeCaching rule — CacheFirst for
 *      same-origin JS (`assets-js`, 40 entries / 30 days) — while the
 *      precache JS glob ban stays deliberately untouched.
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

  it("has a third runtime rule: CacheFirst assets-js with 40 entries / 30 days", () => {
    expect(configText).toMatch(/cacheName:\s*"assets-js"/);
    expect(configText).toMatch(/handler:\s*"CacheFirst"/);
    expect(configText).toMatch(/maxEntries:\s*40,/);
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
    expect(html).toMatch(/animation:\s*sn-offline-reveal[^;]*2\.5s/);
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
