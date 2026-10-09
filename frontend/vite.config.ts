import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import { existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { gzipSync } from "zlib";
import { injectGoogleSiteVerification } from "./src/lib/seo";

/**
 * Bundle budget plugin that checks gzip size of the main index JS bundle.
 * - Exits non-zero if size > 56320 bytes (55 KiB)
 * - Warns if 47120 < size ≤ 56320 bytes
 * - Exits 0 silently if size ≤ 47120 bytes
 *
 * R120-B5 (A5-F3): the entry gate above is kept, but it only measured
 * ONE file of the eager path. This plugin now ADDITIONALLY gates the
 * FULL eager set resolved from dist/public/index.html — every
 * `rel="modulepreload"` JS chunk, the module-entry script, and the
 * stylesheet(s) — summing their gzip sizes: hard-fail > 160 KiB, warn
 * > 145 KiB. (At R120 the entry chunk is ~27 KiB gz of a ~149 KiB gz
 * eager path — the old gate watched 18% of the bytes a cold visitor
 * downloads before first paint.)
 */

// R1 (R124 review P2-1): chunkGraphDebugPlugin removed — it was the
// A2 investigation's console.log map of sentry module placement and
// printed on every production build. The structural guarantee it was
// used to verify (replay bytes off the every-visitor path) is now
// pinned by tests: instrument-replay-lazy.test.ts + the eager-path
// bundle budget gate.

function bundleBudgetPlugin(): Plugin {
  return {
    name: "bundle-budget",
    apply: "build",
    closeBundle: async () => {
      const outDir = path.resolve(import.meta.dirname, "dist/public/assets");
      if (!existsSync(outDir)) {
        console.error("[bundle-budget] Output directory not found:", outDir);
        process.exit(1);
      }

      // Find the ENTRY index-*.js file. R118: must resolve from the HTML —
      // route splitting can emit MULTIPLE index-*.js chunks (a shared
      // index-* chunk landed next to the real entry this round), and the
      // old files.find() picked whichever readdir() returned first,
      // measuring a 9.5 KB shared chunk while the actual module entry was
      // 27.1 KB — the gate was silently vacuous. The HTML's
      // <script type="module" src> is the ground truth.
      const htmlPath = path.resolve(import.meta.dirname, "dist/public/index.html");
      if (!existsSync(htmlPath)) {
        console.error("[bundle-budget] index.html not found:", htmlPath);
        process.exit(1);
      }
      const html = readFileSync(htmlPath, "utf8");
      const entryMatch = html.match(
        /<script[^>]*type="module"[^>]*src="[^"]*\/(index-[A-Za-z0-9-_]+\.js)"/,
      );
      const indexFile = entryMatch?.[1];
      if (!indexFile) {
        console.error("[bundle-budget] No module entry index-*.js found in index.html");
        process.exit(1);
      }

      const filePath = path.join(outDir, indexFile);
      // Containment guard: the scanned file must resolve inside outDir.
      if (path.relative(outDir, filePath).startsWith("..")) {
        console.error("[bundle-budget] Resolved path escapes outDir:", filePath);
        process.exit(1);
      }

      // 96-main (R96 P3-8): gzipSync over the full buffer — the old
      // streaming createGzip + pipeline combo resolved on "finish" and
      // missed the final flushed chunk, undercounting ~35% (21,482
      // reported vs 33,090 actual for the same file, reproduced in
      // isolation). The gate now measures what it claims.
      const gzipSize = gzipSync(readFileSync(filePath)).length;

      const GZIP_LIMIT_ERROR = 56320; // 55 KiB
      const GZIP_LIMIT_WARN = 47120; // ~46 KiB

      console.log(`[bundle-budget] ${indexFile}: ${gzipSize} bytes (gzip)`);

      if (gzipSize > GZIP_LIMIT_ERROR) {
        console.error(
          `[bundle-budget] ERROR: Gzip size ${gzipSize} bytes exceeds limit of ${GZIP_LIMIT_ERROR} bytes (55 KiB)`,
        );
        process.exit(1);
      } else if (gzipSize > GZIP_LIMIT_WARN) {
        console.warn(
          `[bundle-budget] WARNING: Gzip size ${gzipSize} bytes is close to limit of ${GZIP_LIMIT_ERROR} bytes (55 KiB)`,
        );
      }
      // Otherwise exit 0 silently for the entry chunk.

      // ── R120-B5 (A5-F3): the FULL eager-path SUM gate ──────────────
      //
      // The entry check above certifies ONE file; a cold visit downloads
      // the whole eager graph the HTML declares before first paint:
      // every modulepreload chunk Vite emits for the entry's static
      // imports, the module-entry script itself, and the entry
      // stylesheet(s). Resolve the set from the HTML (the same ground
      // truth as the entry lookup), sum their gzip sizes, and gate the
      // SUM: hard-fail above 160 KiB, warn above 145 KiB.
      const eagerFiles = new Set<string>([indexFile]);
      for (const tagMatch of html.matchAll(/<link\b[^>]*>/g)) {
        const tag = tagMatch[0];
        const rel = tag.match(/\brel="([^"]*)"/)?.[1] ?? "";
        const href = tag.match(/\bhref="([^"]*)"/)?.[1];
        if (!href) continue;
        const file = path.basename(href);
        if (rel === "modulepreload" && /\.js$/.test(file)) eagerFiles.add(file);
        else if (rel === "stylesheet" && /\.css$/.test(file)) eagerFiles.add(file);
      }

      // A2 F7 (R124): the deliberately modulepreload-linked HOME route
      // chunk is skipped from the eager sum. It is not part of the
      // entry's static import graph — the boot head-start (App.tsx
      // startBootHeadStart, leg (a)) fetches the very same chunk at
      // module-eval time on EVERY non-admin boot, i.e. before first
      // paint anyway. The HTML preload only moves that identical fetch
      // earlier (HTML parse instead of post-entry-parse); the pre-paint
      // byte total is unchanged, so counting the link here would
      // falsely fail/warn on an intentional, byte-neutral hint. Every
      // other modulepreload/entry/stylesheet file stays fully guarded.
      for (const file of [...eagerFiles]) {
        if (/^home-[A-Za-z0-9_-]+\.js$/.test(file)) eagerFiles.delete(file);
      }

      let eagerGzipSum = 0;
      const breakdown: string[] = [];
      for (const file of eagerFiles) {
        const eagerPath = path.join(outDir, file);
        // Containment guard: every scanned file must resolve inside outDir.
        if (path.relative(outDir, eagerPath).startsWith("..")) {
          console.error("[bundle-budget] Resolved path escapes outDir:", eagerPath);
          process.exit(1);
        }
        if (!existsSync(eagerPath)) {
          console.error(
            "[bundle-budget] Eager-path file referenced by index.html not found:",
            eagerPath,
          );
          process.exit(1);
        }
        const fileGzip = gzipSync(readFileSync(eagerPath)).length;
        breakdown.push(`${file}=${fileGzip}`);
        eagerGzipSum += fileGzip;
      }

      const EAGER_GZIP_LIMIT_ERROR = 160 * 1024; // 160 KiB hard fail
      const EAGER_GZIP_LIMIT_WARN = 145 * 1024; // 145 KiB warning threshold

      console.log(
        `[bundle-budget] eager path (${eagerFiles.size} files: ${breakdown.join(" + ")}): ` +
          `${eagerGzipSum} bytes (gzip)`,
      );

      if (eagerGzipSum > EAGER_GZIP_LIMIT_ERROR) {
        console.error(
          `[bundle-budget] ERROR: Eager-path gzip size ${eagerGzipSum} bytes exceeds limit of ${EAGER_GZIP_LIMIT_ERROR} bytes (160 KiB)`,
        );
        process.exit(1);
      } else if (eagerGzipSum > EAGER_GZIP_LIMIT_WARN) {
        console.warn(
          `[bundle-budget] WARNING: Eager-path gzip size ${eagerGzipSum} bytes is close to limit of ${EAGER_GZIP_LIMIT_ERROR} bytes (160 KiB)`,
        );
      }
    },
  };
}

/**
 * Inject SEO meta tags that need build-time env substitution.
 *
 * Vite's native `%VAR%` HTML replacement only fires when the env is
 * defined; when unset, the literal placeholder remains in the output —
 * which would surface as garbage in <head>. This plugin injects the
 * google-site-verification meta with a safe empty default so an
 * unconfigured environment ships clean HTML.
 */
function seoHeadInject(): Plugin {
  return {
    name: "seo-head-inject",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const token = (process.env.VITE_GSC_VERIFICATION ?? "").trim();
        // 97-F6 (R97 J-2): the matching logic lives in src/lib/seo.ts so it
        // is unit-testable. The previous inline regex
        // `/(<meta name="viewport"[^>]*>)/` never matched the real tag
        // shape — index.html (and the live production HTML) declare the
        // viewport meta MULTILINE with `data-rh` attributes BEFORE
        // `name`, so the literal `<meta name="viewport"` prefix always
        // failed and the verification meta was never emitted (R97-A1
        // §3.6 / finding J-2). The shared helper matches any meta tag
        // carrying name="viewport" regardless of attribute order, quote
        // style or newlines, falls back to </head> when no viewport meta
        // exists, and is idempotent (never duplicates an existing
        // verification meta).
        return injectGoogleSiteVerification(html, token);
      },
    },
  };
}

/**
 * Inject <link rel="preload"> for the critical Readex Pro woff2 fonts
 * (Arabic 400/600/700 + Latin 400 — the LCP-text faces).
 *
 * Why preload: the browser only discovers @font-face rules AFTER it has
 * parsed the index CSS bundle. Without a preload, the woff2 fetch waits
 * on the CSS download + parse (~50-100 ms on mobile). Preload makes the
 * browser start the woff2 fetch in parallel with the CSS, shaving
 * ~10-30 ms off LCP for Arabic-text LCP elements (most of the homepage).
 *
 * F4-F4 (R111): the Arabic 700 face joined the preload set. The guest
 * hero h1 (text-fluid-3xl font-black — font-weight 900) renders with
 * the 700 woff2: Readex Pro ships no 900 face, so the browser resolves
 * 900 to the closest registered weight BELOW it (700). With only the
 * 400s preloaded, the LCP headline text paid a full extra RTT (CSS
 * parse → @font-face discovery → fetch) before its final paint on
 * network-bound visits (−150-350 ms expected LCP when network-bound).
 * font-display stays `swap` (set by every @fontsource face CSS) — the
 * preload only removes the fetch discovery latency, never the swap
 * semantics. Latin-700 is deliberately NOT preloaded: no Latin text
 * above the fold renders heavier than 400 on the guest hero, and
 * every extra preload competes for the same first-paint bandwidth.
 *
 * A5-10 (R116): Arabic 600 joined the set — Navbar renders its
 * above-the-fold labels (nav links, balance chip, section headers)
 * at font-semibold, and every one of them paid the CSS-parse →
 * @font-face-discovery → fetch RTT before its final paint while the
 * 400/700 faces were already in flight. The arabic-600 woff2 ships in
 * the bundle already (@fontsource/readex-pro/arabic-600.css is
 * imported by index.css); this only moves its fetch earlier. Latin
 * weights beyond 400 stay unpreloaded (no above-fold Latin text uses
 * them).
 *
 * Why per-build: @fontsource's woff2 files are emitted with content
 * hashes (`readex-pro-arabic-400-normal-De1vYjJZ.woff2`). The hash
 * changes whenever the font version bumps. We can't hard-code the
 * hash in index.html — this plugin reads the rollup bundle at the
 * very end of the build and emits the correct preload tags.
 */
function criticalPreloadInject(): Plugin {
  return {
    name: "critical-preload-inject",
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;

        const tags: string[] = [];

        // Find the LCP-text woff2 files by name pattern: Arabic 400
        // (body text), Latin 400 (Latin glyphs), Arabic 700 (the
        // font-black hero headline's actual face — F4-F4), Arabic 600
        // (Navbar's above-the-fold semibold labels — A5-10).
        const woff2 = Object.keys(bundle).filter((name) =>
          /readex-pro-arabic-(400|600|700)-normal-[A-Za-z0-9_-]+\.woff2$|readex-pro-latin-400-normal-[A-Za-z0-9_-]+\.woff2$/.test(
            name,
          ),
        );
        for (const name of woff2) {
          tags.push(
            `<link rel="preload" as="font" type="font/woff2" crossorigin href="/${name}" />`,
          );
        }

        // A2 F7 (R124) + R125-I2 (A5-F4): modulepreload the HOME route
        // chunk — NON-ADMIN BOOTS ONLY. Vite only modulepreloads the
        // entry's STATIC imports (the vendor chunks); the home chunk —
        // the money page, warmed on EVERY non-admin boot by the boot
        // head-start's module-eval import() (App.tsx, leg (a)) —
        // previously started fetching only AFTER the entry chunk had
        // downloaded AND parsed (~150-300 ms on 4G). The link moves the
        // fetch to HTML-parse time, in parallel with the entry +
        // vendors. Net-new bytes: zero — every non-admin boot fetches
        // this exact chunk at module-eval time regardless of entry
        // path; the browser dedupes the module map entry. (The
        // bundle-budget plugin deliberately skipped the old static
        // link — see its comment.)
        //
        // R125-I2 (A5-F4) — the ADMIN gate. The built HTML is a SINGLE
        // SPA shell served for every route (storefront paths AND the
        // /admin/* fallback), so a build-time gate is impossible. The
        // old unconditional static <link> made every /admin/* boot
        // fetch (+ per spec parse) 8.53 KB gz of home-*.js that an
        // admin session NEVER executes — the only storefront waste on
        // the admin path (App.tsx:310-312 already skips the boot
        // head-start and route warm-up for /admin).
        //
        // Why a conditional-create script and not A5's init.js
        // removal sketch: the preload scanner discovers a static link
        // in the RAW MARKUP as the bytes arrive — before any later
        // script (init.js at index.html:120, or any remover we could
        // inject) executes — so removal cannot reliably cancel the
        // fetch. Creating the link only on non-admin paths is the
        // reliable gate. The script is injected right after <head>
        // opens — BEFORE the stylesheet links (a classic inline script
        // that follows a pending stylesheet waits for that stylesheet
        // to load, which would push the home fetch behind the CSS on
        // cold storefront boots). Storefront behavior is otherwise
        // unchanged from the static link: the append runs during head
        // parse, in the same first-HTML-chunk discovery window, in
        // parallel with the CSS/entry/vendor fetches. Admin boots
        // append nothing.
        const homeChunks = Object.keys(bundle).filter((name) =>
          /^assets\/home-[A-Za-z0-9_-]+\.js$/.test(name),
        );
        if (homeChunks.length > 0) {
          const homePreloadCalls = homeChunks
            .map(
              (name) =>
                `document.head.appendChild(Object.assign(document.createElement("link"),{rel:"modulepreload",href:"/${name}"}));`,
            )
            .join("");
          const gate = `<script>if(!location.pathname.startsWith("/admin")){${homePreloadCalls}}</script>`;
          // Inject immediately after <head> opens — see the comment
          // above for why this must precede the stylesheet links. The
          // $$ escaping neutralizes any `$` in the replacement string
          // for String.replace (chunk hashes are [A-Za-z0-9_-] so this
          // is belt-and-suspenders).
          html = html.replace(/(<head[^>]*>)/, `$1\n    ${gate.replace(/\$/g, "$$$$")}`);
        }

        if (tags.length === 0) return html;

        // Inject right before the </head> close so the hints sit
        // alongside the existing network hints. The browser starts the
        // font/chunk fetches during HTML parse, in parallel with the CSS
        // bundle and the entry script.
        const tagBlock = tags.join("\n    ");
        return html.replace(/(\s*<\/head>)/, `\n    ${tagBlock}$1`);
      },
    },
  };
}

/**
 * 96-main (R96 F-8): sourcemap guard — after the build settles, sweep any
 * *.map left in dist/public/assets. With a Sentry token the plugin's
 * deleteSourcemapsAfterUpload should have removed them (a failed upload
 * would leave them — sweep so they never deploy, warn). Without a token
 * sourcemap:false should have produced none — if maps exist anyway,
 * delete them AND fail the build (a source-exposure regression must
 * never ship silently).
 */
function sourcemapGuardPlugin(): Plugin {
  return {
    name: "sourcemap-guard",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const assetsDir = path.resolve(import.meta.dirname, "dist/public/assets");
      if (!existsSync(assetsDir)) return;
      const maps = readdirSync(assetsDir).filter((f) => f.endsWith(".map"));
      if (maps.length === 0) return;
      for (const m of maps) rmSync(path.join(assetsDir, m));
      if (process.env.SENTRY_AUTH_TOKEN) {
        console.warn(
          `[sourcemap-guard] deleted ${maps.length} lingering .map file(s) from dist after the Sentry upload path — they will not deploy`,
        );
      } else {
        console.error(
          `[sourcemap-guard] ${maps.length} sourcemap(s) were produced WITHOUT SENTRY_AUTH_TOKEN — deleted locally and failing the build; investigate why sourcemap was not disabled`,
        );
        process.exit(1);
      }
    },
  };
}

/**
 * A2 F1 (R124): absolute path to @sentry-internal/replay's ESM entry —
 * the package that physically contains the rrweb Session Replay recorder
 * (~⅔ of the old 469 KB vendor-sentry chunk; @sentry/react merely re-exports
 * `replayIntegration` from it through its barrel).
 *
 * Resolved at CONFIG LOAD by walking the installed dependency chain
 * @sentry/react → @sentry/browser → @sentry-internal/replay (never a
 * version-pinned literal), so SDK upgrades keep working as long as the
 * package exists — and if it ever stops existing, the build fails LOUDLY
 * on an unresolvable import instead of silently re-merging the recorder
 * into the every-visitor chunk. See sentryDsnGuardPlugin below for why
 * app code imports this package at all.
 */
function resolveSentryReplaySdkEntry(): string | null {
  try {
    const requireFromFrontend = createRequire(path.resolve(import.meta.dirname, "package.json"));
    const sentryReactPkg = requireFromFrontend.resolve("@sentry/react/package.json");
    const sentryBrowserPkg = createRequire(sentryReactPkg).resolve("@sentry/browser/package.json");
    const replayPkg = createRequire(sentryBrowserPkg).resolve(
      "@sentry-internal/replay/package.json",
    );
    // Prefer the ESM (import) entry — the same code Vite would load for a
    // normal dependency import.
    const replayExports = JSON.parse(readFileSync(replayPkg, "utf8"))["exports"]?.["."];
    const entry = replayExports?.import?.default ?? replayExports?.default?.default;
    return entry ? path.resolve(path.dirname(replayPkg), entry) : null;
  } catch {
    return null;
  }
}

const sentryReplaySdkEntry = resolveSentryReplaySdkEntry();

/**
 * 97-F6 (R97 J-3): Sentry dead-weight guard.
 *
 * Live production (R97-A1 §3.5 [46]) showed the vendor-sentry chunk
 * (~151 KB brotli) being fetched at boot even though
 * VITE_SENTRY_DSN is unset — the SDK initializes with no DSN, reports
 * nothing, and the bytes contend with the LCP image for zero value.
 *
 * Layered fix (the runtime gate lives in src/lib/boot-sentry.ts —
 * scheduleSentryBoot only dynamic-imports ../instrument when the DSN is
 * present at build time):
 *
 *   - When VITE_SENTRY_DSN is SET at build time this plugin is inert and
 *     @sentry/react resolves normally — current behavior is unchanged,
 *     EXCEPT the A2 F1 build-graph severance below.
 *   - When it is UNSET, this plugin swaps @sentry/react for a no-op
 *     virtual module. Result: no `node_modules/@sentry/` ids enter the
 *     module graph, the manualChunks `vendor-sentry` rule matches
 *     nothing, and the vendor-sentry chunk is not emitted AT ALL —
 *     neither in the entry graph nor as an async chunk. The only
 *     remaining Sentry surface is the few-byte stub consumed by
 *     ErrorBoundary's error-path dynamic import (a no-op there too: with
 *     no DSN there is nothing to report).
 *
 * A2 F1 (R124) — replay byte-gating, the missing build half. The runtime
 * half lives in src/instrument.ts + src/lib/sentry-replay.ts: the replay
 * recorder is fetched ONLY when a session will record (sticky 10% roll /
 * first error). But that only moves bytes if the rrweb code sits OUTSIDE
 * vendor-sentry — and @sentry/react re-exports `replayIntegration` from
 * @sentry-internal/replay through its BARREL, the barrel is pinned into
 * the vendor-sentry manual chunk, and a module whose only chunk-level
 * importer is that barrel merges INTO it. Importing `replayIntegration`
 * through the barrel from even a lazy module therefore re-ships the whole
 * recorder to every visitor. Two coordinated build moves sever it:
 *
 *   1. `transform` rewrites src/lib/sentry-replay.ts's import of
 *      `replayIntegration` from the public barrel to the internal
 *      package entry. The on-disk module keeps importing "@sentry/react"
 *      so TypeScript + vitest see the public API (it is the identical
 *      binding — the barrel re-exports exactly this package's export).
 *   2. `resolveId` maps that specifier to the resolved ESM entry (app
 *      code cannot resolve @sentry-internal/* itself under pnpm).
 *
 * With the binding severed, the barrel's re-export is unused → tree-shaken
 * (every @sentry package ships sideEffects:false) → the recorder rides
 * ONLY the lazy sentry-replay async chunk. The swap is pinned by
 * src/lib/__tests__/instrument-replay-lazy.test.ts.
 *
 * A2 F1 move #3 (verified necessary, R124): tree-shaking alone did NOT
 * drop the barrel re-export — the prebundled @sentry/browser dist keeps
 * `export { getReplay, replayIntegration } from '@sentry-internal/replay'`
 * alive through the chunk graph, and the recorder then merged back into
 * vendor-sentry (measured: 469,777 B chunk, rrweb markers inside) —
 * every idle SDK load fetched ~151 KB br of recorder for nothing, and
 * the unused replay-canvas re-export rode along too. Two more moves
 * make the boundary deterministic instead of tree-shake-dependent:
 *
 *   3. `transform` strips the two replay re-export lines from
 *      @sentry/browser's ESM barrel (loud shape-drift error, same
 *      discipline as the wrapper swap). Nothing in app code imports
 *      getReplay/replayIntegration/replayCanvasIntegration from the
 *      barrel — the wrapper imports the recorder directly via move 1.
 *   4. `manualChunks` pins the recorder package + the wrapper source
 *      file into one named "sentry-replay" chunk. Rollup's default
 *      grouping merged the 2 KB wrapper into the instrument chunk
 *      (experimentalMinChunkSize), dissolving the dynamic-import
 *      boundary; the named chunk is 314 KB — far above the merge
 *      threshold — so import("./lib/sentry-replay") stays a REAL
 *      network boundary: fetched only when a session will record.
 */
function sentryDsnGuardPlugin(dsnConfigured: boolean): Plugin {
  // Virtual-module id resolved for "@sentry/react" when the DSN is unset.
  // The \0 prefix keeps it out of Vite's public-path resolution.
  const STUB_ID = "\0virtual:sentry-stub";
  const STUB_CODE = [
    "// 97-F6 (J-3): no-op stand-in for @sentry/react,",
    "// generated by sentryDsnGuardPlugin in vite.config.ts. Used ONLY in",
    "// builds where VITE_SENTRY_DSN is unset — the real SDK reports nothing",
    "// without a DSN, so these no-ops preserve call shapes at zero bytes.",
    "const noop = () => {};",
    "export const init = noop;",
    "export const captureException = noop;",
    "export const captureMessage = noop;",
    "export const withScope = noop; // scope callback intentionally not invoked",
    "export const withIsolation = noop;",
    "export const browserTracingIntegration = () => ({});",
    "export const replayIntegration = () => ({});",
    // A2 F1 (R124): src/lib/sentry-replay.ts imports addIntegration from
    // @sentry/react. Under a DSN-less build this stub replaces the module,
    // so the named import must exist here too (the wrapper chunk is never
    // executed in such builds — instrument.ts never loads — but Rollup
    // still resolves its imports at build time).
    "export const addIntegration = noop;",
    "export const flush = () => Promise.resolve(false);",
    "export default { init, captureException, captureMessage, withScope, withIsolation, browserTracingIntegration, replayIntegration, flush };",
  ].join("\n");

  return {
    name: "sentry-dsn-guard",
    enforce: "pre",
    resolveId(source) {
      if (source === "@sentry-internal/replay") {
        // A2 F1 (R124): the swap below makes this the import source for
        // `replayIntegration`. DSN-less builds get the same no-op stub as
        // the rest of the SDK (the sentry graph is closed there anyway —
        // instrument.ts never loads — this only keeps the import
        // resolvable). Node_modules-internal imports of the same specifier
        // (the @sentry/browser barrel's own re-export) resolve to the same
        // entry, so nothing is duplicated.
        if (dsnConfigured) {
          return sentryReplaySdkEntry; // null → unresolvable → loud build error
        }
        return STUB_ID;
      }
      if (dsnConfigured || source !== "@sentry/react") return null;
      return STUB_ID;
    },
    load(id) {
      if (id !== STUB_ID) return null;
      return STUB_CODE;
    },
    transform(code, id) {
      // A2 F1 (R124): DSN-set builds only — sever the replay binding from
      // the @sentry/react barrel (full rationale in the plugin docblock
      // above). Shape-drift is a LOUD failure, never a silent no-op: if
      // sentry-replay.ts's import line changes, this errors so the swap
      // is updated in lockstep instead of quietly re-eagering the
      // recorder into vendor-sentry.
      if (!dsnConfigured) return null;
      // ── A2 F1 move #3: strip the replay re-exports from the ─────────
      // prebundled @sentry/browser barrel (docblock above). Same loud
      // shape-drift discipline as the wrapper swap: the SDK upgrade that
      // reformats these lines must fail the build, not silently re-ship
      // the recorder to every visitor. Scoped to the BARREL entry
      // (build/npm/esm[/dev|/prod]/index.js) — the esm tree also ships
      // side entries (feedbackAsync.js, integrations/*) that never carry
      // these lines.
      if (id.includes("@sentry/browser") && /build\/npm\/esm\/(dev\/|prod\/)?index\.js$/.test(id)) {
        const BARREL_LINES = [
          "export { getReplay, replayIntegration } from '@sentry-internal/replay';\n",
          "export { replayCanvasIntegration } from '@sentry-internal/replay-canvas';\n",
        ];
        let stripped = code;
        let found = 0;
        for (const line of BARREL_LINES) {
          if (stripped.includes(line)) {
            stripped = stripped.replace(line, "");
            found += 1;
          }
        }
        if (found !== BARREL_LINES.length) {
          this.error(
            "[sentry-dsn-guard] @sentry/browser's barrel no longer matches the A2 F1 replay re-export shape — update BARREL_LINES in vite.config.ts.",
          );
        }
        return { code: stripped, map: null };
      }
      // ── A2 F1 moves 1+2: the wrapper swap ────────────────────────────
      if (!id.endsWith("src/lib/sentry-replay.ts")) return null;
      const SWAP_FROM = 'import { addIntegration, replayIntegration } from "@sentry/react";';
      const SWAP_TO = [
        'import { addIntegration } from "@sentry/react";',
        'import { replayIntegration } from "@sentry-internal/replay";',
      ].join("\n");
      if (!code.includes(SWAP_FROM)) {
        this.error(
          "[sentry-dsn-guard] src/lib/sentry-replay.ts no longer matches the A2 F1 barrel-import shape — update the swap in vite.config.ts.",
        );
      }
      // R1 (R124 review P1-2): no build markers in shipped code — the
      // swap itself is load-bearing (breaking the @sentry/react barrel
      // import is what keeps the rrweb recorder out of the every-visitor
      // SDK chunk); the debug marker that used to ride along is gone.
      // map:null stays honest: the string replace invalidates the
      // original sourcemap, and this chunk's frames are minified-short.
      return { code: code.replace(SWAP_FROM, SWAP_TO), map: null };
    },
  };
}

const rawPort = process.env.PORT?.trim() || process.env.FRONTEND_PORT?.trim() || "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = "/";
const apiProxyTarget =
  process.env.API_PROXY_TARGET ?? process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8080";

// 97-F6 (R97 J-3): resolved ONCE at config load so both the plugin graph
// and src/lib/boot-sentry.ts (which reads the same env var via
// import.meta.env at build time) agree on whether this build ships Sentry.
// Render/Vercel inject env vars before the build command runs, so the
// config always sees the deployment's value.
const sentryDsnConfigured = (process.env.VITE_SENTRY_DSN ?? "").trim().length > 0;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    bundleBudgetPlugin(),
    seoHeadInject(),
    criticalPreloadInject(),
    sentryDsnGuardPlugin(sentryDsnConfigured),
    VitePWA({
      registerType: "autoUpdate",
      // The hand-written public/manifest.json is the single source of truth
      // (Arabic-first metadata + shortcuts). Generating a second webmanifest
      // here created two <link rel="manifest"> candidates with conflicting
      // theme colors.
      manifest: false,
      // R104 (AG11-1): subnation-logo.png (66.5 KB) removed from the
      // precache — it is ONLY read by crawler/unfurl surfaces
      // (seo-builders og:image + JSON-LD logo), which never run a
      // service worker. Keeping it in the manifest burned ~66 KB of the
      // 5 GB monthly bandwidth budget per NEW visitor for zero runtime
      // value. favicon.svg (163 B) stays.
      includeAssets: ["favicon.svg"],
      workbox: {
        // Fonts are now bundled into /assets/ via @fontsource (no longer
        // fetched from fonts.googleapis.com), so the previous
        // google-fonts-cache runtime rule has been removed. The bundled
        // woff2 are covered by the standard precache + the 1y immutable
        // cache header on /assets/.
        //
        // Round-4 (perf P1-4 — runtime caching): the precache diet covers
        // the offline shell, but every REPEAT visit still re-downloaded
        // the catalog JSON and every product image. Two runtime rules:
        //   1. Catalog API — StaleWhileRevalidate with a 60s maxAge that
        //      mirrors the backend's `s-maxage=60` edge-cache window on
        //      /api/products* and /api/flash-sale (public, read-only GETs
        //      only — never /api/cart, /api/orders, /api/notifications or
        //      any authenticated surface). SWR serves the cache instantly
        //      and refreshes in the background, so no networkTimeout is
        //      needed (workbox only allows that option on NetworkFirst).
        //   2. Images — CacheFirst for 30 days (product photos are remote
        //      originals on image2url.com; no variants exist, so the bytes
        //      are effectively immutable). Biggest byte win on revisits:
        //      ~0.8–3 MB per product-grid page view.
        //   3. 98-F7 (R98-08a — A5 §2): same-origin JS chunks, CacheFirst.
        //      The precache globIgnores **/*.js (deliberate, unchanged —
        //      see its comment below) banked the whole JS story on the
        //      server's immutable 1y HTTP cache, but mobile browsers evict
        //      the HTTP cache wholesale under storage pressure WITHOUT
        //      touching SW caches — a repeat offline visit then had the
        //      precached HTML + CSS + SWR catalog but zero JS: a white
        //      screen whose only recovery (lazyWithRetry's one reload)
        //      also needs JS. CacheFirst keyed by the hashed /assets/*.js
        //      URLs is release-atomic (a deploy mints new filenames; the
        //      precached index.html references exactly one release's set,
        //      so the "stale entry + fresh chunks" failure mode that
        //      motivated globIgnores cannot occur here), one successful
        //      online visit leaves every visited route's chunks in the SW
        //      cache, and maxEntries 40 / 30d LRU keeps the footprint
        //      bounded (~40 × entry+vendor chunks).
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.method === "GET" && /^\/api\/(products|flash-sale)/.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-catalog-v1",
              expiration: {
                maxEntries: 32,
                // 96-main (R96 F-7a): 60s → 7 days. The old TTL made an
                // offline user older than 60s hit the WifiOff error card
                // instead of the last-known catalog. SWR still refreshes
                // whenever online — the staleness bound is the RESPONSE
                // age, not a cache TTL — so online behavior is unchanged
                // while the offline story completes.
                maxAgeSeconds: 604_800,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "images-v1",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 2_592_000, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // 98-F7 (R98-08a): same-origin JS only — remote scripts
            // (firebase, sentry, gtag…) must keep going to the network so
            // their own cache headers/SRI govern them.
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin && request.method === "GET" && /\.js$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "assets-js",
              expiration: {
                // A2 F2 (R124): 40 → 160. The build emits ~150 JS chunks
                // and one storefront session loads 13-56 of them (home 30,
                // product 27, admin products 56 — measured in the A2
                // report). The old 40-entry cap let a single
                // home→product→cart session exceed it, so the LRU evicted
                // chunks a back-navigation immediately re-fetched —
                // silently defeating this rule's R98-08a offline goal on
                // any 2-3-page session. 160 × avg ~1.5 KB br ≈ 240 KB
                // worst-case footprint, well within a sane SW quota
                // budget (images already use 200 entries).
                maxEntries: 160,
                maxAgeSeconds: 2_592_000, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
        // Round-3 (8-c §1.1 — precache diet): the default
        // precacheAndRoute globbed the ENTIRE build — 78 files / ~760 KB
        // gzip including vendor-sentry (156 KB gz), vendor-charts
        // (109 KB gz) and every admin page chunk — downloaded right
        // after first paint on a phone, competing with the LCP image.
        // A storefront visitor never opens admin pages or charts.
        // Allowlist the offline-critical shell only; everything else is
        // runtime-cached on first use (see runtimeCaching note above).
        // NOTE: robots.txt/sitemap.xml are served dynamically by the
        // backend routes — they don't exist in the build output and must
        // not appear here (workbox hard-fails on unmatched globs).
        globPatterns: [
          "index.html",
          // 96-main (R96 P3-2): favicon.svg + subnation-logo.png removed —
          // includeAssets above already precaches favicon; no overlap.
          // R104 (AG11-1): opengraph.jpg (39.6 KB) ALSO removed — it is
          // an unfurl-only asset (crawlers don't run SWs); precaching it
          // burned ~40 KB per new visitor for zero offline value. Both
          // stay served with normal cache headers for their real
          // consumers.
          // -> nothing image-like is precached anymore.
          "manifest.json",
          "assets/*.css",
          "assets/*.woff2",
        ],
        // Belt & suspenders: even if a future glob somehow matches the
        // deferred-vendor chunks, refuse to precache anything heavy —
        // runtime caching exists precisely for the rarely/never-visited
        // routes. 384 KB raw (≈ 45 KB gz) still excludes every vendor
        // chunk (all ≥ 1 MB) while admitting the entry CSS (271 KB after
        // the r100 five-category palette expansion — the offline shell
        // must precache its own stylesheet or a cold offline boot
        // renders unstyled) and the allowlisted font subsets.
        maximumFileSizeToCacheInBytes: 384 * 1024,
        // Never precache JS: the entry HTML already links the entry
        // chunk, and a stale precached entry + freshly runtime-cached
        // chunks is the classic "partially updated PWA" failure mode.
        // JS chunks ride the immutable /assets/ HTTP cache AND, since
        // 98-F7 (R98-08a), the same-origin runtime CacheFirst rule
        // above (survives HTTP-cache eviction) + lazyWithRetry recovery.
        globIgnores: ["**/*.js"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/assets\//],
      },
    }),
    // 96-main (R96 F-8): sourcemap hygiene — 9.38 MB of hidden .map
    // files were deployed publicly at /assets/*.js.map (fetchable by
    // URL; full TS sources exposed + dead deploy weight). With a Sentry
    // token the maps are uploaded then DELETED from dist
    // (deleteSourcemapsAfterUpload); without a token no maps are
    // generated at all (sourcemap: false) — plus the sourcemap-guard
    // plugin sweeps/fails the build if any *.map still lingers.
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            // R121: the upload MUST land on the same release the runtime
            // reports — instrument.ts's release is VITE_RELEASE_SHA (GIT_SHA
            // short, set by the Dockerfile RUN) — not the plugin default
            // (name@version), which would orphan the maps from the events.
            release: {
              name:
                (
                  process.env.VITE_RELEASE_SHA ||
                  process.env.GIT_SHA ||
                  process.env.SOURCE_COMMIT ||
                  ""
                ).slice(0, 7) || undefined,
            },
            telemetry: false,
            silent: false,
            sourcemaps: { deleteSourcemapsAfterUpload: true },
          }),
        ]
      : []),
    sourcemapGuardPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // 96-main (R96 F-8): hidden maps ONLY when they will actually be
    // uploaded (and deleted) by the Sentry plugin; without a token no
    // maps are generated at all — a publicly fetchable .map at
    // /assets/<chunk>.js.map must never ship.
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? ("hidden" as const) : false,
    // Split CSS per chunk so non-critical routes don’t block initial load
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // A2 F6 (R124): merge micro-chunks. The R122 icon de-chunking left
        // ~70-90 per-icon chunks at 511-855 B br each — every lazy route
        // navigation paid 13-56 requests where a handful would do (h2
        // per-request header overhead + stream scheduling). NOTE: Rollup
        // 4's option is `experimentalMinChunkSize` (the A2 report's
        // `minChunkSize` does not exist in rollup 4.59 — verified against
        // rollup/dist/rollup.d.ts). The value is ESTIMATED SOURCE bytes
        // (pre-minify), not wire bytes; 2048 merges the icon/one-liner
        // chunks into their consumers. Merge candidates are ranked by the
        // dead bytes they would add to other routes, so icons do not
        // re-eager — and if anything ever does, the eager-sum gate above
        // fails the build.
        experimentalMinChunkSize: 2048,
        manualChunks(id) {
          // Ensure tiny shared utility libs stay with the eager critical
          // bundle so admin-only chart libs don't get pulled into the
          // home page's import graph.
          if (
            id.includes("node_modules/clsx") ||
            id.includes("node_modules/tailwind-merge") ||
            id.includes("node_modules/class-variance-authority")
          ) {
            return "vendor-utils";
          }
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          if (id.includes("node_modules/@tanstack")) {
            return "vendor-query";
          }
          if (
            id.includes("node_modules/recharts") ||
            id.includes("node_modules/d3-") ||
            id.includes("node_modules/victory-")
          ) {
            return "vendor-charts";
          }
          // R122 (A6-P1-1): lucide-react NO LONGER gets a manual chunk. The
          // old rule pinned ALL 135 icons the app imports into ONE
          // vendor-icons chunk; since the eager path references that chunk
          // (Navbar/App/error pages use 14 icons), every cold storefront
          // visit preloaded all 135 icons (11.2 KB gz) while only ~1.2 KB
          // gz of them are eager-reachable — the other 121 icons (90%) are
          // referenced exclusively by lazy admin/storefront routes. With no
          // rule, Rollup's default chunking inlines the entry-reachable
          // icons into their importing chunks and assigns lazy-only icons
          // to the lazy page chunks (or a small on-demand shared chunk):
          // eager path 152,438 → 144,430 B gz (−8.0 KB), back under the
          // 145 KiB warn line; the entry chunk absorbed the eager icons
          // (27,718 → 30,881 B gz, still far under its 55 KiB gate).
          // Named per-icon imports are tree-shaken either way (no
          // barrel imports in src), so nothing regresses for lazy routes.
          if (
            id.includes("node_modules/socket.io-client") ||
            id.includes("node_modules/engine.io-client")
          ) {
            return "vendor-socket";
          }
          // Round-4 (perf P0-1 — de-eager vendor-radix): Button (eager via
          // Navbar) imports @radix-ui/react-slot. If slot stays inside the
          // merged vendor-radix chunk, that single eager static import drags
          // the whole Radix bundle (dialog/popper/alert-dialog/switch/label,
          // ~25 KB gz) into the storefront's modulepreload set. Route slot
          // (and its only dependency, react-compose-refs) into the eager
          // vendor-utils chunk instead so vendor-radix is referenced ONLY by
          // lazily-loaded pages (support/wallet/admin) and drops out of the
          // critical path entirely. compose-refs must follow slot — a
          // vendor-utils → vendor-radix static import would re-eager the
          // whole chunk.
          if (
            id.includes("node_modules/@radix-ui/react-slot") ||
            id.includes("node_modules/@radix-ui/react-compose-refs")
          ) {
            return "vendor-utils";
          }
          if (id.includes("node_modules/@radix-ui")) {
            return "vendor-radix";
          }
          if (id.includes("node_modules/wouter") || id.includes("node_modules/regexparam")) {
            return "vendor-router";
          }
          // Isolate Firebase into its own async chunk so it never blocks
          // initial page render — it’s only needed post-auth-check.
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) {
            return "vendor-firebase";
          }
          // Sentry is on the critical path (instrument.ts is the first
          // import in main.tsx) but should not bloat the index entry. By
          // chunking it separately, the main bundle stays tiny while Sentry
          // is still preloaded in parallel via Vite's module preload.
          // 97-F6 (J-3): when VITE_SENTRY_DSN is unset at build time,
          // sentryDsnGuardPlugin swaps @sentry/react for a no-op stub, so
          // no id ever matches this rule and the vendor-sentry chunk is
          // not emitted at all — the ~151 KB brotli dead weight stays out
          // of the deployment entirely.
          // A2 F1 move #4 (R124): the replay recorder + its wrapper get
          // their OWN named chunk. Without this pin, Rollup's default
          // grouping merged the 2 KB wrapper into the instrument chunk
          // (experimentalMinChunkSize) — dissolving the dynamic-import
          // boundary — and the recorder followed the barrel's re-export
          // into vendor-sentry. With the pin (and the barrel strip in
          // sentryDsnGuardPlugin), "sentry-replay" is ~314 KB, far above
          // any merge threshold, and import("./lib/sentry-replay") is a
          // real network boundary: fetched only when a session will
          // actually record (sticky 10% roll / first error).
          // NOTE the id shapes: pnpm store paths carry
          // "@sentry-internal+replay@" in the directory segment, while
          // the package-internal segment is "@sentry-internal/replay/".
          // The wrapper is matched by its source path suffix.
          if (
            id.includes("@sentry-internal+replay") ||
            id.includes("node_modules/@sentry-internal/replay/") ||
            id.endsWith("src/lib/sentry-replay.ts")
          ) {
            return "sentry-replay";
          }
          if (id.includes("node_modules/@sentry/")) {
            return "vendor-sentry";
          }
        },
      },
    },
  },
  server: {
    port,
    strictPort: false,
    host: "0.0.0.0",
    allowedHosts: true,
    // Open a browser tab on first dev start. Disable with VITE_OPEN=false
    // (the workspace orchestrator sets this for non-TTY / CI runs).
    open: process.env.VITE_OPEN === "false" ? false : true,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
