// R176 stage 2 — DOWNLOAD: resolve each pick to a local file under raw/.
// Wikipedia picks: one batched imageinfo query (43 titles, one request),
// then download each thumburl (1280px render) with polite spacing.
// Direct picks: plain download. Idempotent — skips files already on disk.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout } from "node:timers";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
await mkdir(RAW, { recursive: true });

const UA = "Mozilla/5.0 (X11; Linux x86_64) SubNationArtResearch/1.2 (catalog art curation)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function curl(args) {
  const { stdout } = await execFileP("curl", args, { maxBuffer: 40 * 1024 * 1024 });
  return stdout;
}

async function downloadTo(url, dest) {
  await execFileP(
    "curl",
    ["-sL", "--max-time", "90", "--compressed", "-H", `User-Agent: ${UA}`, "-o", dest, url],
    { maxBuffer: 40 * 1024 * 1024 },
  );
  if (!existsSync(dest)) throw new Error("no file written");
  const stat = await readFile(dest).catch(() => Buffer.alloc(0));
  if (stat.length < 100) throw new Error(`file too small (${stat.length}B)`);
  return stat.length;
}

async function main() {
  const only = process.argv.slice(2); // optional slugs to (re)download
  const picks = JSON.parse(await readFile(path.join(HERE, "picks.json"), "utf8")).picks;
  const entries = only.length
    ? Object.entries(picks).filter(([s]) => only.includes(s))
    : Object.entries(picks);
  const wikiPicks = entries.filter(([, p]) => p.source === "wikipedia");

  // 1. one batched imageinfo query for all Wikipedia files
  console.log(`Resolving ${wikiPicks.length} Wikipedia file URLs (1 batched request)...`);
  const titles = wikiPicks.map(([, p]) => `File:${p.file}`).join("|");
  const infoUrl =
    "https://en.wikipedia.org/w/api.php?action=query&prop=imageinfo&titles=" +
    encodeURIComponent(titles) +
    "&iiprop=url%7Csize%7Cmime&iiurlwidth=1280&format=json&formatversion=2";
  const infoJson = await curl([
    "-s",
    "--max-time",
    "60",
    "--compressed",
    "-H",
    `User-Agent: ${UA}`,
    infoUrl,
  ]);
  const d = JSON.parse(infoJson);
  const byTitle = new Map();
  for (const p of d?.query?.pages ?? []) {
    const ii = p.imageinfo?.[0];
    if (ii) byTitle.set(p.title.replace(/^File:/, ""), ii);
  }
  const missing = wikiPicks.filter(([, p]) => !byTitle.has(p.file));
  if (missing.length) console.log("  ! unresolved:", missing.map(([s]) => s).join(", "));

  // 2. download each (skip exists unless explicitly listed)
  for (const [slug, p] of entries) {
    const dest = path.join(RAW, `${slug}.png`);
    if (existsSync(dest) && !only.includes(slug)) {
      console.log(`= ${slug.padEnd(24)} cached`);
      continue;
    }
    try {
      let url;
      if (p.source === "wikipedia") {
        const ii = byTitle.get(p.file);
        if (!ii) throw new Error("no imageinfo");
        url = ii.thumburl ?? ii.url;
      } else {
        url = p.url;
      }
      const size = await downloadTo(url, dest);
      console.log(
        `✓ ${slug.padEnd(24)} ${(size / 1024).toFixed(0)} KB  ← ${p.file ?? p.url.slice(0, 60)}`,
      );
      await sleep(only.length ? 12000 : 2500); // longer spacing on redownload batches
    } catch (e) {
      console.log(`✗ ${slug.padEnd(24)} ${e.message.slice(0, 80)}`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
