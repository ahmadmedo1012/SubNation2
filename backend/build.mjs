import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, readdir, unlink } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/worker.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] }),
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // ── Sentry CLI source-map upload (gated) ────────────────────────────────────
  //
  // Active only when SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT are
  // present. After uploading, we delete the `.map` files from the deploy
  // artefact so end users never receive them — Sentry retains the maps and
  // resolves stack traces server-side via the release identifier.
  const release = (process.env.RENDER_GIT_COMMIT ?? "unknown").slice(0, 7);
  if (
    process.env.SENTRY_AUTH_TOKEN &&
    process.env.SENTRY_ORG &&
    process.env.SENTRY_PROJECT &&
    release !== "unknown"
  ) {
    try {
      console.log(`[sentry] uploading source maps for release ${release}`);
      execSync(
        `pnpm exec sentry-cli sourcemaps inject ./dist && ` +
          `pnpm exec sentry-cli sourcemaps upload --release="${release}" ./dist`,
        { cwd: artifactDir, stdio: "inherit" },
      );
      console.log("[sentry] source-map upload complete");
    } catch (err) {
      // Don't block the deploy on a Sentry upload hiccup.
      console.warn("[sentry] source-map upload failed (continuing build):", err?.message ?? err);
    }

    // Strip .map files from the deploy artefact regardless of whether the
    // upload succeeded — we don't want maps to ship to end users.
    try {
      const entries = await readdir(distDir);
      for (const entry of entries) {
        if (entry.endsWith(".map")) {
          await unlink(path.join(distDir, entry));
        }
      }
      console.log("[sentry] stripped .map files from dist");
    } catch (err) {
      console.warn("[sentry] could not strip .map files:", err?.message ?? err);
    }
  } else {
    console.log("[sentry] source-map upload skipped (SENTRY_AUTH_TOKEN/ORG/PROJECT not set)");
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
