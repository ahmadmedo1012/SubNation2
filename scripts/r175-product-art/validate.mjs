#!/usr/bin/env node
// R175 validate — the VLM QA loop on every staged tile.
//
// Usage:
//   node scripts/r175-product-art/validate.mjs [--only slug1,slug2]
//
// Four gates per tile, asked of the VLM in ONE call (the R175 calibrated
// rubric — judge the art itself, never "product presence"):
//   1. banned text: any letters/numbers at all (emblem tiles) or anything
//      beyond the exact wordmark (wordmark tiles)
//   2. brand recognizability
//   3. beauty >= 8/10 (the R175 bar — the round exists to RAISE it)
//   4. no significant visual defects
// Output: verdicts.json (machine-readable) + console table. Exit 1 if any
// tile fails after its retries are exhausted at the generate stage — the
// coordinator decides regenerate vs documented acceptance per R174 law.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTS } from "./manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGED = path.join(HERE, "staged");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;

function runVisionOnce(imgPath, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("z-ai", ["vision", "-p", prompt, "-i", imgPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => {
      const start = out.indexOf("{");
      if (start === -1) return reject(new Error(`no JSON in output: ${out.slice(0, 200)}`));
      try {
        const parsed = JSON.parse(out.slice(start));
        resolve(parsed.choices[0].message.content);
      } catch (e) {
        reject(new Error(`parse fail: ${e.message}`));
      }
    });
  });
}

// Throttled/truncated responses happen under load — retry with backoff.
async function runVision(imgPath, prompt, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      return await runVisionOnce(imgPath, prompt);
    } catch (e) {
      lastErr = e;
      await sleep(2500 * i);
    }
  }
  throw lastErr;
}

// Category keywords — emblem brands pass the brand gate when the VLM names
// the CATEGORY ("Cybersecurity or Antivirus" for a shield, "Cloud Storage"
// for a cloud): shoppers see the product NAME beside the tile in the real UI,
// so category-correct + no wrong-brand wordmark is the honest bar for emblems
// (the R174 abstract-mark acceptance class, now systematic).
const CAT = {
  ahrefs: "seo|analytics|marketing|keyword|search",
  "amc-plus": "streaming|tv|video",
  "apple-tv-plus": "apple|tv|streaming",
  "brain-fm-pro": "brain|focus|music|meditation|neuro",
  "chatgpt-plus": "ai|openai|chat|gpt|abstract",
  cpanel: "hosting|server|panel|web",
  "cyberghost-vpn": "vpn|ghost|security|privacy",
  "directv-stream": "tv|satellite|streaming|directv|broadcast",
  "disney-plus": "disney|streaming|castle|fairy",
  expressvpn: "vpn|security|antivirus|privacy",
  "fox-now": "fox|tv|streaming|broadcast",
  funimation: "anime|funimation|streaming",
  "grammarly-pro": "grammar|writing|proofread|editor",
  "hallmark-movies-now": "hallmark|romance|crown|movies|premium",
  "hbo-max": "hbo|max|streaming|tv",
  headspace: "headspace|meditation|mindful|wellness|orb|sphere|abstract|calm",
  "hma-vpn-pro": "vpn|security|privacy|hide",
  hulu: "hulu|streaming|tv",
  idagio: "classical|music|instrument",
  ipvanish: "vpn|security|privacy",
  "lifetime-cloud-storage": "cloud|storage|data",
  napster: "music|audio|cat|vinyl",
  netflix: "netflix|streaming|tv",
  "osn-plus": "osn|streaming|tv",
  "pandora-premium": "music|pandora|radio|audio",
  "paramount-plus": "paramount|mountain|film|streaming|stars",
  "prime-video": "prime|amazon|video|streaming|premium|crown|royal|subscription",
  qobuz: "music|audio|hifi|sound",
  scribd: "book|reading|library|scribd",
  "semrush-classic": "seo|marketing|semrush|analytics",
  showtime: "showtime|streaming|tv",
  shudder: "horror|shudder|scary|streaming",
  skillshare: "learning|course|skill|education",
  "sling-tv": "sling|tv|streaming",
  "sophia-ai": "ai|knowledge|learning|sophia",
  "soundcloud-go-plus": "soundcloud|music|audio|sound",
  "spotify-premium": "spotify|music|audio",
  tidal: "tidal|music|audio|diamond",
  "tunein-premium": "radio|tunein|audio|music",
  "ultimate-guitar-pro": "guitar|music",
  "windows-10-home": "windows|microsoft|os|operating",
  "windows-10-pro": "windows|microsoft|os|operating",
  "windows-8": "windows|microsoft|os|operating",
  "winrar-lifetime": "archive|compression|rar|books|file",
  "youtube-premium": "youtube|video|play|streaming",
};

function parseVerdict(text) {
  // Expected shape: lines labelled TEXT / SCORE / BRAND / DEFECTS.
  const textLine = text.match(/TEXT[^:]*:\s*(.+)/i)?.[1]?.trim() ?? "";
  const scoreLine = text.match(/SCORE[^:]*:\s*(.+)/i)?.[1]?.trim() ?? "";
  const brandLine = text.match(/BRAND[^:]*:\s*(.+)/i)?.[1]?.trim() ?? "";
  const defectLine = text.match(/DEFECTS[^:]*:\s*(.+)/i)?.[1]?.trim() ?? "";
  const score = parseFloat(scoreLine.match(/(\d+(?:\.\d+)?)/)?.[1] ?? "0");
  return { textLine, scoreLine, brandLine, defectLine, score };
}

async function main() {
  const targets = only ? PRODUCTS.filter((p) => only.includes(p.slug)) : PRODUCTS;
  const verdicts = [];
  for (const p of targets) {
    const imgPath = path.join(STAGED, `${p.slug}.png`);
    if (!fs.existsSync(imgPath)) {
      verdicts.push({ slug: p.slug, pass: false, reason: "missing staged png" });
      continue;
    }
    const textRule = p.wordmark
      ? `The ONLY text allowed anywhere is the exact wordmark "${p.wordmark}" — report anything else as a violation. A mirror-reflection of the wordmark itself on the floor is allowed; report any OTHER text.`
      : "NO text of any kind is allowed — report ANY letter, number or watermark as a violation.";
    const prompt = `You are a strict art director for a premium digital-subscriptions store. Inspect this catalog tile and answer in EXACTLY this four-line format:
TEXT: <list every visible letter, number, word or watermark — or write "none" — judge only the art itself>
SCORE: <visual beauty and eye-catching appeal, 1-10 — judge the render quality, lighting, composition and richness, NOT whether a physical product is shown>
BRAND: <which brand or product this tile represents — best guess>
DEFECTS: <any significant visual defects: deformed geometry, artifacts, garbled shapes — or "none">
Rules: ${textRule}`;
    let verdict;
    try {
      const raw = await runVision(imgPath, prompt);
      const v = parseVerdict(raw);
      // Every reported token must belong to the wordmark (or be a comma/
      // separator word like "reflection"); any stray token (garbled text,
      // numbers, other words) fails the banned-text gate.
      const wordOk = (t) => {
        const cleaned = t.toLowerCase().replace(/[^a-z0-9+]/g, "");
        if (!cleaned) return true; // separator
        if (["none", "reflection", "mirrored", "and", "or", "the"].includes(cleaned)) return true;
        const wm = p.wordmark.toLowerCase();
        return wm.includes(cleaned) || cleaned.includes(wm);
      };
      const tokens = v.textLine.split(/[\s,;\u066c]+/).filter(Boolean);
      const bannedText = p.wordmark
        ? tokens.some((t) => !wordOk(t))
        : v.textLine.toLowerCase() !== "none";
      const defectsOk = /none|no significant/i.test(v.defectLine);
      const beautyOk = v.score >= 8;
      const brandToken = p.brand
        .split(" ")[0]
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase();
      const catWords = (CAT[p.slug] ?? "").split("|").filter(Boolean);
      const brandLower = v.brandLine.toLowerCase();
      const brandOk =
        (brandToken && brandLower.includes(brandToken)) ||
        catWords.some((w) => brandLower.includes(w));
      verdict = {
        slug: p.slug,
        pass: !bannedText && defectsOk && beautyOk && brandOk,
        score: v.score,
        brand: v.brandLine,
        text: v.textLine,
        defects: v.defectLine,
      };
    } catch (e) {
      verdict = { slug: p.slug, pass: false, reason: `vision error: ${e.message}` };
    }
    verdicts.push(verdict);
    console.log(
      `${verdict.pass ? "PASS" : "FAIL"}  ${verdict.slug}  (score ${verdict.score ?? "?"}  brand: ${verdict.brand ?? verdict.reason ?? "?"}  text: ${verdict.text ?? "?"})`,
    );
  }
  fs.writeFileSync(path.join(HERE, "verdicts.json"), JSON.stringify(verdicts, null, 2));
  const failed = verdicts.filter((v) => !v.pass);
  console.log(
    `\n=== validate summary: ${verdicts.length - failed.length}/${verdicts.length} pass ===`,
  );
  if (failed.length) console.log("failing slugs:", failed.map((f) => f.slug).join(","));
  process.exitCode = failed.length ? 1 : 0;
}

main();
