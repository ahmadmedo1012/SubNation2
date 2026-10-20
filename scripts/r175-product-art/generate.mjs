#!/usr/bin/env node
// R175 generate — resumable tile generation through the z-ai CLI.
//
// Usage:
//   node scripts/r175-product-art/generate.mjs [--only slug1,slug2] [--force]
//
// Skips slugs whose staged PNG already exists (unless --force), runs a
// bounded 3-way concurrency, retries each slug up to 3 times, and prints a
// final pass/fail table. Content-filter refusals are retried with the
// fallback prompt (brand name elided — the R174 expressvpn precedent).

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTS, buildPrompt } from "./manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGED = path.join(HERE, "staged");
fs.mkdirSync(STAGED, { recursive: true });

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const force = args.includes("--force");
const CONCURRENCY = 3;
const RETRIES = 3;

// Content-filter fallback: describe the mark without the brand name.
function fallbackPrompt(p) {
  const mark = p.mark.replace(new RegExp(p.brand.split(" ")[0], "gi"), "the");
  return buildPrompt({ ...p, mark });
}

function run(cmd, cmdArgs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

async function generateOne(p) {
  const outPath = path.join(STAGED, `${p.slug}.png`);
  if (fs.existsSync(outPath) && !force) return { slug: p.slug, status: "cached" };

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const prompt =
      attempt >= 2 && p.wordmark
        ? buildPrompt(p) // wordmark brands: same prompt, the model varies per run anyway
        : buildPrompt(p);
    const usePrompt = attempt === RETRIES && !p.wordmark ? fallbackPrompt(p) : prompt;
    const { code, out } = await run("z-ai", [
      "image",
      "-p",
      usePrompt,
      "-o",
      outPath,
      "-s",
      "1024x1024",
    ]);
    const ok = code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 30_000;
    if (ok) {
      const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
      return { slug: p.slug, status: "ok", attempt, kb };
    }
    console.error(`  [${p.slug}] attempt ${attempt} failed (exit ${code}): ${out.slice(-200)}`);
    await sleep(2000 * attempt);
  }
  return { slug: p.slug, status: "FAILED" };
}

async function main() {
  const targets = only ? PRODUCTS.filter((p) => only.includes(p.slug)) : PRODUCTS;
  console.log(`Generating ${targets.length} tiles @ concurrency ${CONCURRENCY}…`);
  const queue = [...targets];
  const results = [];
  async function worker(id) {
    while (queue.length) {
      const p = queue.shift();
      const r = await generateOne(p);
      results.push(r);
      console.log(
        `[w${id}] ${r.slug}: ${r.status}${r.attempt ? ` (attempt ${r.attempt}, ${r.kb} KB)` : ""}`,
      );
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  const failed = results.filter((r) => r.status === "FAILED");
  console.log("\n=== generate summary ===");
  console.log(`ok/cached: ${results.length - failed.length}  failed: ${failed.length}`);
  if (failed.length) {
    console.log("failed slugs:", failed.map((f) => f.slug).join(","));
    process.exitCode = 1;
  }
}

main();
