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

  // R104 (AG5-1/AG6-1): migration fast-path fingerprint — sha256 of
  // src/migrate.ts, injected as a compile-time constant. Steady-state
  // cold starts skip the ~141-statement idempotent replay when the
  // hash matches the value persisted in system_settings.
  const { createHash } = await import("node:crypto");
  const { readFile, readdir } = await import("node:fs/promises");
  // RT-6 (R104 red team): hash migrate.ts AND the drizzle schema files —
  // a schema edit whose DDL stage lives outside migrate.ts must also
  // invalidate the marker, or a drifted schema would ride the fast-path.
  const schemaDir = path.resolve(artifactDir, "../shared/db/src/schema");
  const schemaFiles = (await readdir(schemaDir)).filter((f) => f.endsWith(".ts")).sort();
  const corpus = [
    path.resolve(artifactDir, "src/migrate.ts"),
    ...schemaFiles.map((f) => path.join(schemaDir, f)),
  ];
  const hash = createHash("sha256");
  for (const file of corpus) hash.update(await readFile(file, "utf8"));
  const migrationsFingerprint = hash.digest("hex");
  console.log(`[build] migrations fingerprint: ${migrationsFingerprint.slice(0, 16)}…`);

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
    define: {
      __MIGRATIONS_FINGERPRINT__: JSON.stringify(migrationsFingerprint),
    },
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
    // FH-A3 F-2: emit maps ONLY when a Sentry upload is possible — default
    // OFF. The old unconditional "linked" shipped +23 MB of full backend
    // source in every image built WITHOUT SENTRY_AUTH_TOKEN (GHCR workflow,
    // docker-verify, compose/Coolify builds). Mirrors the frontend guard
    // (vite.config.ts: sourcemap: SENTRY_AUTH_TOKEN ? "hidden" : false).
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? "linked" : false,
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
  // R107: neutral release identity — GIT_SHA (Coolify/CI builds) with
  // RENDER_GIT_COMMIT (Render injects it) as the legacy fallback.
  const release = (process.env.GIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? "unknown").slice(0, 7);
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
  } else {
    console.log("[sentry] source-map upload skipped (SENTRY_AUTH_TOKEN/ORG/PROJECT not set)");
  }

  // FH-A3 F-2: ALWAYS strip .map files from the deploy artefact — moved OUT
  // of the Sentry gate above. Even a token-only build (org/project/release
  // missing → upload skipped, but `sourcemap: "linked"` emitted maps) can
  // never ship them to end users. Belt-and-braces parity with the frontend's
  // sourcemapGuardPlugin; a no-op when no maps were emitted.
  try {
    const entries = await readdir(distDir);
    let stripped = 0;
    for (const entry of entries) {
      if (entry.endsWith(".map")) {
        await unlink(path.join(distDir, entry));
        stripped += 1;
      }
    }
    if (stripped > 0) {
      console.log(`[sentry] stripped ${stripped} .map file(s) from dist`);
    }
  } catch (err) {
    console.warn("[sentry] could not strip .map files:", err?.message ?? err);
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
