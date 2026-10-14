/**
 * R140-c — the CHUNK-ARCHITECTURE pin suite (bundle lane: vite.config.ts
 * manualChunks + route-chunk-warmup.ts + lazy-with-retry.ts).
 *
 * Source-scan pins in the r128-sweep / 139-c/f/g idiom (LINE-COMMENTS-
 * FIRST stripComments — rationale comments NAME the pinned strings, so
 * raw absence checks would false-fail on the pin's own documentation),
 * plus the first BEHAVIORAL pins on lazyWithRetry's one-reload
 * recovery (jsdom: stubbed location.reload + a real Suspense/Error-
 * Boundary render, so the semantics are truth-tabled instead of merely
 * scanned). Three contracts frozen here:
 *
 *   1. manualChunks — the named-rule list is FROZEN (both deletions
 *      and additions fail loudly): the 11 return sites / 10 chunk
 *      names, the load-bearing module matchers behind each rule, and
 *      the A2 F6 experimentalMinChunkSize merge value. The bundle story
 *      (vendor-sentry DSN-conditional, sentry-replay byte-gating,
 *      vendor-charts the lone >400 KB admin-only monster) has deep WHY
 *      history in vite.config.ts comments — an accidental rule
 *      deletion silently re-merges recorder/vendor bytes into the
 *      every-visitor path, and only the eager-sum budget gate would
 *      notice, at build time, in CI.
 *
 *   2. warmup ↔ registry — every route family route-chunk-warmup.ts
 *      warms must still exist in the page-registry source under the
 *      SAME specifier (the module map dedupe contract: the warm
 *      import() and the lazyWithRetry import() must resolve against
 *      one module or the warm is dead bytes), the warmed set stays the
 *      five money-path families (product/category/cart/checkout/
 *      wallet + home via the boot head-start), and the safety guards
 *      (admin skip, saveData skip, delegated pointerenter-capture +
 *      focusin listeners) stay wired.
 *
 *   3. lazyWithRetry — the one-reload counter (sessionStorage key
 *      prefix, getItem gate, Date.now() stamp, the never-settling
 *      return) stays intact in source AND behavior: reload exactly
 *      once per pathname per session on a chunk-load error, bubble to
 *      the boundary when the counter is armed, never reload for
 *      non-chunk errors, happy path untouched.
 *
 * DOM-order/modulepreload load-bearing lines (task e) ride section 1:
 * the external home-chunk preload gate (data-home-chunk attribute +
 * conditional-create on non-admin paths), the budget plugin's home-*
 * skip from the eager sum, and the F4-F4/A5-10 font preload family —
 * verified live against the built dist/public/index.html at r140.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Component, Suspense, createElement, type ComponentType, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Line-comments-first stripper (the 139-c/i craft: block-first opens
 *  phantom comments on `/*`-bearing paths). */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "");
}

const viteConfig = stripComments(read("vite.config.ts"));
const warmup = stripComments(read("src/app/route-chunk-warmup.ts"));
const registry = stripComments(read("src/app/page-registry.ts"));
const routesTree = stripComments(read("src/app/routes.tsx"));
const bootHeadStart = stripComments(read("src/app/boot-head-start.ts"));
const lazyRetry = stripComments(read("src/lib/lazy-with-retry.ts"));

// ── Section 1: manualChunks frozen rule list ───────────────────────────────

/** R140-c freeze: the 11 manualChunks return sites (vendor-utils
 *  appears twice by design — the eager utils trio AND the Round-4
 *  de-eager radix-slot/compose-refs pair both target vendor-utils). */
const FROZEN_MANUAL_CHUNK_RULES = [
  "vendor-utils",
  "vendor-react",
  "vendor-query",
  "vendor-charts",
  "vendor-socket",
  "vendor-utils",
  "vendor-radix",
  "vendor-router",
  "vendor-firebase",
  "sentry-replay",
  "vendor-sentry",
];

/** R140-c freeze: the module-id matchers each rule lives on. A rule
 *  whose matcher string vanished (dep removed, path moved under pnpm's
 *  +sigil layout, specifier renamed) silently matches NOTHING — the
 *  rule id still parses, the build still passes, and the vendor bytes
 *  re-merge into the entry or a route chunk. These pins make that a
 *  loud test failure instead. */
const FROZEN_RULE_MATCHERS: readonly [label: string, pin: string][] = [
  ["vendor-utils: clsx", 'id.includes("node_modules/clsx")'],
  ["vendor-utils: tailwind-merge", 'id.includes("node_modules/tailwind-merge")'],
  [
    "vendor-utils: class-variance-authority",
    'id.includes("node_modules/class-variance-authority")',
  ],
  ["vendor-utils (de-eager pair): radix slot", 'id.includes("node_modules/@radix-ui/react-slot")'],
  [
    "vendor-utils (de-eager pair): compose-refs",
    'id.includes("node_modules/@radix-ui/react-compose-refs")',
  ],
  ["vendor-react: react", 'id.includes("node_modules/react/")'],
  ["vendor-react: react-dom", 'id.includes("node_modules/react-dom/")'],
  ["vendor-react: scheduler", 'id.includes("node_modules/scheduler/")'],
  ["vendor-query: @tanstack", 'id.includes("node_modules/@tanstack")'],
  ["vendor-charts: recharts", 'id.includes("node_modules/recharts")'],
  ["vendor-charts: d3-*", 'id.includes("node_modules/d3-")'],
  ["vendor-charts: victory-*", 'id.includes("node_modules/victory-")'],
  ["vendor-socket: socket.io-client", 'id.includes("node_modules/socket.io-client")'],
  ["vendor-socket: engine.io-client", 'id.includes("node_modules/engine.io-client")'],
  ["vendor-radix: @radix-ui rest", 'id.includes("node_modules/@radix-ui")'],
  ["vendor-router: wouter", 'id.includes("node_modules/wouter")'],
  ["vendor-router: regexparam", 'id.includes("node_modules/regexparam")'],
  ["vendor-firebase: firebase", 'id.includes("node_modules/firebase")'],
  ["vendor-firebase: @firebase", 'id.includes("node_modules/@firebase")'],
  ["sentry-replay: pnpm store path shape", 'id.includes("@sentry-internal+replay")'],
  [
    "sentry-replay: node_modules path shape",
    'id.includes("node_modules/@sentry-internal/replay/")',
  ],
  ["sentry-replay: the wrapper source pin", 'id.endsWith("src/lib/sentry-replay.ts")'],
  ["vendor-sentry: @sentry/", 'id.includes("node_modules/@sentry/")'],
  ["A2 F6 micro-chunk merge value", "experimentalMinChunkSize: 2048"],
];

describe("R140-c — manualChunks (vite.config.ts): the named-rule list is frozen", () => {
  it("emits exactly the 11 known return sites / 10 named chunks — deletions AND additions fail", () => {
    const ruleReturns = [...viteConfig.matchAll(/return\s+"(vendor-[a-z-]+|sentry-replay)";/g)].map(
      (m) => m[1],
    );
    expect(ruleReturns).toEqual(FROZEN_MANUAL_CHUNK_RULES);
  });

  it("keeps every rule's module-id matcher (a moved/removed dep must fail loudly, not match nothing)", () => {
    for (const [label, pin] of FROZEN_RULE_MATCHERS) {
      expect(viteConfig, label).toContain(pin);
    }
  });

  it("keeps the modulepreload/DOM-order load-bearing lines (external home gate, eager-sum home skip, font preload family)", () => {
    // The external gate (R126-L1): conditional-create on non-admin
    // paths, hashed chunk URLs ride a data-* attribute (CSP-clean),
    // the tag is emitted right after <head> opens — before the
    // stylesheet links.
    expect(viteConfig).toContain('location.pathname.startsWith("/admin")');
    expect(viteConfig).toContain('document.querySelector("script[data-home-chunk]")');
    // The budget gate skips the deliberately modulepreload-linked home
    // chunk from the eager sum (byte-neutral hint, A2 F7).
    expect(viteConfig).toContain("eagerFiles.delete(file)");
    expect(viteConfig).toContain('rel === "modulepreload"');
    // F4-F4 + A5-10 + R143 L3-3: Arabic 400/600/700 + Latin 400/700 are
    // the preloaded LCP-text faces (latin-700 = the Navbar wordmark).
    expect(viteConfig).toContain("readex-pro-arabic-(400|600|700)");
    // R143 (L3-3): the Latin family grew to (400|700) — the Navbar
    // wordmark's font-bold face rides every route above the fold.
    expect(viteConfig).toContain("readex-pro-latin-(400|700)");
  });
});

// ── Section 2: warmup ↔ registry cross-reference ───────────────────────────

/** R140-c freeze: the five warmed money-path families, in the file's
 *  own declaration order. Widening this set is a deliberate product
 *  decision (hover-eagering new chunks costs bytes for every visitor)
 *  that must also update the R124 predicate suite — these pins make
 *  the silent version impossible. */
const WARMED_SPECIFIERS = [
  "@/pages/product",
  "@/pages/category",
  "@/pages/cart",
  "@/pages/checkout",
  "@/pages/wallet",
] as const;

describe("R140-c — route-chunk warm-up: every warmed family exists in the registry, guards wired", () => {
  it("warms exactly the five money-path families (module specifiers frozen in declaration order)", () => {
    const warmedInSource = [...warmup.matchAll(/import\("(@\/pages\/[a-z-]+)"\)/g)].map(
      (m) => m[1],
    );
    expect(warmedInSource).toEqual([...WARMED_SPECIFIERS]);
  });

  it("each warmed specifier is a lazyWithRetry route in page-registry.ts (same module → the warm dedupes)", () => {
    for (const spec of WARMED_SPECIFIERS) {
      expect(registry, `registry wraps ${spec}`).toContain(
        `lazyWithRetry(() => import("${spec}"))`,
      );
    }
  });

  it("each warmed family matches a real registered route path in routes.tsx", () => {
    expect(routesTree).toContain('path="/product/:slug"');
    expect(routesTree).toContain('path="/category/:slug"');
    expect(routesTree).toContain('path="/cart"');
    expect(routesTree).toContain('path="/checkout"');
    expect(routesTree).toContain('path="/wallet"');
  });

  it("home is warmed by the boot head-start leg (a), not the hover map — same specifier the registry lazy-mounts", () => {
    expect(bootHeadStart).toContain('import("@/pages/home")');
    expect(registry).toContain('lazyWithRetry(() => import("@/pages/home"))');
  });

  it("page-registry wraps EVERY page dynamic import in lazyWithRetry — no bare lazy routes", () => {
    const pageImports = registry.match(/import\("@\/pages\//g)?.length ?? 0;
    const lazyWrapped = registry.match(/lazyWithRetry\(\(\) => import\(/g)?.length ?? 0;
    expect(pageImports).toBeGreaterThan(0);
    expect(lazyWrapped).toBe(pageImports);
    expect(registry).toContain('from "@/lib/lazy-with-retry"');
  });

  it("routes.tsx consumes the registry and never hand-rolls lazy itself (the R137 decomposition contract)", () => {
    expect(routesTree).toContain('from "@/app/page-registry"');
    expect(routesTree).not.toMatch(/lazyWithRetry\(|React\.lazy|\blazy\(/);
  });

  it("keeps the warm-up safety guards: admin skip, saveData skip, delegated pointerenter-capture + focusin", () => {
    expect(warmup).toContain('normalized === "/admin" || normalized.startsWith("/admin/")');
    expect(warmup).toContain("connection?.saveData");
    expect(warmup).toContain(
      'document.addEventListener("pointerenter", warmFromEvent, { capture: true })',
    );
    expect(warmup).toContain('document.addEventListener("focusin", warmFromEvent)');
  });
});

// ── Section 3: lazyWithRetry semantics ─────────────────────────────────────

/** Minimal in-file boundary: surfaces the thrown error as BOOM:<msg>
 *  so the bubble path is assertable without the app's ErrorBoundary
 *  chrome. */
class ChunkErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render(): ReactNode {
    return this.state.message === null
      ? this.props.children
      : createElement("div", null, `BOOM:${this.state.message}`);
  }
}

const RELOAD_KEY = "sn:chunk-reload:/wallet";
const CHUNK_ERROR = new Error(
  "Failed to fetch dynamically imported module: https://subnation.ly/assets/wallet-deadbeef.js",
);
const PLAIN_ERROR = new TypeError("a plain render-time failure, not a chunk 404");

const reloadMock = vi.fn();
const realLocation = window.location;

beforeAll(() => {
  // lazyWithRetry reads window.location.pathname + .reload() only;
  // replace the jsdom location with a plain stub so the reload is
  // observable instead of a jsdom "Not implemented: navigation" error.
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { pathname: "/wallet", reload: reloadMock },
  });
});

afterAll(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: realLocation,
  });
});

beforeEach(() => {
  reloadMock.mockClear();
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

function renderLazy(Lazy: React.LazyExoticComponent<ComponentType>): void {
  render(
    createElement(
      ChunkErrorBoundary,
      null,
      createElement(
        Suspense,
        { fallback: createElement("div", null, "route-fallback") },
        createElement(Lazy),
      ),
    ),
  );
}

describe("R140-c — lazyWithRetry: one-reload recovery semantics (behavioral)", () => {
  it("reloads exactly ONCE on a chunk-load failure and arms the per-pathname sessionStorage counter", async () => {
    const factory: () => Promise<{ default: ComponentType }> = () => Promise.reject(CHUNK_ERROR);
    renderLazy(lazyWithRetry(factory));

    await vi.waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
    // The counter is a Date.now() stamp under the documented prefix.
    expect(sessionStorage.getItem(RELOAD_KEY)).toMatch(/^\d+$/);
    // The never-settling return: still suspended on the fallback, the
    // error never reached the boundary (the page is "unloading").
    expect(screen.getByText("route-fallback")).toBeInTheDocument();
    expect(screen.queryByText(/^BOOM:/)).not.toBeInTheDocument();
  });

  it("bubbles to the ErrorBoundary when the counter is already armed — no second reload", async () => {
    sessionStorage.setItem(RELOAD_KEY, "42");
    const factory: () => Promise<{ default: ComponentType }> = () => Promise.reject(CHUNK_ERROR);
    renderLazy(lazyWithRetry(factory));

    expect(await screen.findByText(/^BOOM:/)).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
    // The armed value is left as-is (no re-stamp: exactly one attempt).
    expect(sessionStorage.getItem(RELOAD_KEY)).toBe("42");
  });

  it("never reloads for a non-chunk error — it bubbles straight to the boundary", async () => {
    const factory: () => Promise<{ default: ComponentType }> = () => Promise.reject(PLAIN_ERROR);
    renderLazy(lazyWithRetry(factory));

    expect(await screen.findByText(/BOOM:a plain render-time failure/)).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });

  it("happy path: renders the page, no reload, no counter", async () => {
    const OkPage = () => createElement("p", null, "chunk-loaded-ok");
    renderLazy(lazyWithRetry(() => Promise.resolve({ default: OkPage })));

    expect(await screen.findByText("chunk-loaded-ok")).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });

  it("recognizes the ChunkLoadError name variant (not just message patterns)", async () => {
    const named = Object.assign(new Error("Loading chunk 7 failed"), { name: "ChunkLoadError" });
    const factory: () => Promise<{ default: ComponentType }> = () => Promise.reject(named);
    renderLazy(lazyWithRetry(factory));

    await vi.waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
    expect(sessionStorage.getItem(RELOAD_KEY)).toMatch(/^\d+$/);
  });
});

describe("R140-c — lazyWithRetry: one-reload counter machinery (source pins)", () => {
  it("keeps the counter: key prefix, getItem gate, Date.now() stamp, reload call, never-settling return", () => {
    expect(lazyRetry).toContain('const RELOAD_KEY_PREFIX = "sn:chunk-reload:";');
    expect(lazyRetry).toContain("if (!sessionStorage.getItem(key)) {");
    expect(lazyRetry).toContain("sessionStorage.setItem(key, String(Date.now()));");
    expect(lazyRetry).toContain("window.location.reload();");
    expect(lazyRetry).toContain("new Promise<{ default: T }>(() => {");
  });

  it("keeps the cross-browser chunk-error pattern coverage (Vite/Firefox/Safari/Webpack variants)", () => {
    expect(lazyRetry).toContain("const CHUNK_ERROR_PATTERNS = [");
    expect(lazyRetry).toContain("/Failed to fetch dynamically imported module/i,");
    expect(lazyRetry).toContain("/error loading dynamically imported module/i,");
    expect(lazyRetry).toContain("/Importing a module script failed/i,");
    expect(lazyRetry).toContain("/Unable to preload CSS/i,");
    expect(lazyRetry).toContain("/Loading chunk \\S+ failed/i,");
    expect(lazyRetry).toContain("/ChunkLoadError/i,");
    expect(lazyRetry).toContain('if (err.name === "ChunkLoadError") return true;');
  });
});
