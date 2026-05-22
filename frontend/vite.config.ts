import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, readdirSync } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { createGzip } from "zlib";

/**
 * Bundle budget plugin that checks gzip size of the main index JS bundle.
 * - Exits non-zero if size > 56320 bytes (55 KiB)
 * - Warns if 47120 < size ≤ 56320 bytes
 * - Exits 0 silently if size ≤ 47120 bytes
 */
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

      // Find index-*.js file
      const files = readdirSync(outDir);
      const indexFile = files.find((f) => /^index-[A-Za-z0-9-_]+\.js$/.test(f));
      if (!indexFile) {
        console.error("[bundle-budget] No index-*.js file found in", outDir);
        process.exit(1);
      }

      const filePath = path.join(outDir, indexFile);

      // Calculate gzip size
      let gzipSize = 0;
      const gzip = createGzip();
      gzip.on("data", (chunk) => {
        gzipSize += chunk.length;
      });

      const source = createReadStream(filePath);
      await pipeline(source, gzip);

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
      // Otherwise exit 0 silently
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
        const tag = `<meta name="google-site-verification" content="${token}" />`;
        // Inject right after the viewport meta so it lives near the top
        // of <head> where Search Console looks for it.
        return html.replace(
          /(<meta name="viewport"[^>]*>)/,
          `$1\n    ${tag}`,
        );
      },
    },
  };
}

/**
 * Inject <link rel="preload"> for the critical Readex Pro woff2 fonts
 * (Arabic + Latin, weight 400 — the LCP-text faces).
 *
 * Why preload: the browser only discovers @font-face rules AFTER it has
 * parsed the index CSS bundle. Without a preload, the woff2 fetch waits
 * on the CSS download + parse (~50-100 ms on mobile). Preload makes the
 * browser start the woff2 fetch in parallel with the CSS, shaving
 * ~10-30 ms off LCP for Arabic-text LCP elements (most of the homepage).
 *
 * Why per-build: @fontsource's woff2 files are emitted with content
 * hashes (`readex-pro-arabic-400-normal-De1vYjJZ.woff2`). The hash
 * changes whenever the font version bumps. We can't hard-code the
 * hash in index.html — this plugin reads the rollup bundle at the
 * very end of the build and emits the correct preload tags.
 */
function fontPreloadInject(): Plugin {
  return {
    name: "font-preload-inject",
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;

        // Find the Arabic-400 + Latin-400 woff2 files by name pattern.
        const woff2 = Object.keys(bundle).filter((name) =>
          /readex-pro-(arabic|latin)-400-normal-[A-Za-z0-9_-]+\.woff2$/.test(name),
        );

        if (woff2.length === 0) return html;

        const tags = woff2
          .map(
            (name) =>
              `<link rel="preload" as="font" type="font/woff2" crossorigin href="/${name}" />`,
          )
          .join("\n    ");

        // Inject right before the </head> close so the preload tags sit
        // alongside the existing network hints. The browser starts the
        // font fetch during HTML parse, in parallel with the CSS bundle.
        return html.replace(/(\s*<\/head>)/, `\n    ${tags}$1`);
      },
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

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    bundleBudgetPlugin(),
    seoHeadInject(),
    fontPreloadInject(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "mask-icon.svg"],
      manifest: {
        name: "SubNation",
        short_name: "SubNation",
        description: "Premium SaaS Subscription Platform",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Fonts are now bundled into /assets/ via @fontsource (no longer
        // fetched from fonts.googleapis.com), so the previous
        // google-fonts-cache runtime rule has been removed. The bundled
        // woff2 are covered by the standard precache + the 1y immutable
        // cache header on /assets/.
        runtimeCaching: [],
      },
    }),
    // Sentry source-map upload — only active when SENTRY_AUTH_TOKEN is set
    // (so local + unprovisioned CI builds skip cleanly). With sourcemap:
    // "hidden" below, maps are produced + uploaded but never linked from
    // the production bundle, so end users can't fetch them.
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            telemetry: false,
            silent: false,
          }),
        ]
      : []),
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
    // "hidden" = produce source maps but don't reference them from the bundle.
    // Sentry's vite plugin uploads them by hash, so issues get readable stack
    // traces while end users can't fetch the maps.
    sourcemap: "hidden",
    // Split CSS per chunk so non-critical routes don’t block initial load
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
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
          if (id.includes("node_modules/lucide-react")) {
            return "vendor-icons";
          }
          if (
            id.includes("node_modules/socket.io-client") ||
            id.includes("node_modules/engine.io-client")
          ) {
            return "vendor-socket";
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
