// Site-source fallback — fetch the brand's OWN artwork (og:image /
// apple-touch-icon / icon links) straight from the official website.
// Literally "the image from the source".
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
await mkdir(RAW, { recursive: true });

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SITES = [
  { slug: "brain-fm-pro", url: "https://www.brain.fm" },
  { slug: "sophia-ai", url: "https://shopia.io" },
  { slug: "hma-vpn-pro", url: "https://www.hma.com" },
  { slug: "hallmark-movies-now", url: "https://www.hallmarktv.com" },
  { slug: "showtime", url: "https://www.showtime.com" },
];

async function curlText(url) {
  const { stdout } = await execFileP(
    "curl",
    ["-sL", "--max-time", "30", "--compressed", "-H", `User-Agent: ${UA}`, url],
    { maxBuffer: 30 * 1024 * 1024 },
  );
  return stdout;
}

function extractAssets(html, baseUrl) {
  const out = [];
  // og:image (marketing hero — usually the brand art)
  const og =
    html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
  if (og) out.push({ kind: "og:image", url: new URL(og[1], baseUrl).href });
  // twitter image
  const tw =
    html.match(/name=["']twitter:image["']\s+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["']\s+name=["']twitter:image["']/i);
  if (tw) out.push({ kind: "twitter:image", url: new URL(tw[1], baseUrl).href });
  // apple-touch-icon (180x180 app icon — the official app mark)
  const ati =
    html.match(/rel=["']apple-touch-icon[^"']*["']\s+href=["']([^"']+)["']/i) ||
    html.match(/href=["']([^"']+)["']\s+rel=["']apple-touch-icon[^"']*["']/i);
  if (ati) out.push({ kind: "apple-touch-icon", url: new URL(ati[1], baseUrl).href });
  // png/svg icons
  const icon =
    html.match(
      /rel=["']icon["']\s+type=["']image\/(?:png|svg\+xml)["']\s+href=["']([^"']+)["']/i,
    ) ||
    html.match(/href=["']([^"']+)["']\s+rel=["']icon["']\s+type=["']image\/(?:png|svg\+xml)["']/i);
  if (icon) out.push({ kind: "icon", url: new URL(icon[1], baseUrl).href });
  return out;
}

async function main() {
  const only = process.argv[2];
  const list = only ? SITES.filter((s) => s.slug === only) : SITES;
  for (const s of list) {
    try {
      const html = await curlText(s.url);
      const assets = extractAssets(html, s.url);
      console.log(`── ${s.slug} (${s.url})`);
      for (const a of assets) console.log(`   ${a.kind.padEnd(17)} ${a.url.slice(0, 110)}`);
      await writeFile(path.join(RAW, `site-${s.slug}.json`), JSON.stringify(assets, null, 2));
    } catch (e) {
      console.log(`── ${s.slug} (${s.url})  ERROR: ${e.message.slice(0, 100)}`);
    }
  }
}
main();
