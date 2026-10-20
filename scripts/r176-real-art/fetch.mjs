// R176 — the real-source art round (the owner directive: «صور من المصدر حقيقية
// مش صور تم انشاءها ب ai» — real images from the source, NOT AI-generated).
//
// Stage 1 — SEARCH: for each of the 45 catalog tiles, find the brand's REAL
// official artwork on English Wikipedia's file namespace (where official
// logos live — free ones mirrored from Commons, non-free ones hosted locally
// as fair-use). Result sets are cached under scripts/r176-real-art/candidates/
// (non-empty only) so the stage is resumable.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout } from "node:timers";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = path.join(HERE, "candidates");
await mkdir(CANDIDATES, { recursive: true });

const UA = "Mozilla/5.0 (X11; Linux x86_64) SubNationArtResearch/1.2 (catalog art curation)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node's undici (HTTP/1.1) gets edge-throttled by Wikipedia while curl
// (HTTP/2) sails through — verified 5/5 200s vs 429/403s. Shell out to curl.
async function api(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const { stdout } = await execFileP(
        "curl",
        ["-s", "--max-time", "30", "--compressed", "-H", `User-Agent: ${UA}`, url],
        { maxBuffer: 20 * 1024 * 1024 },
      );
      return JSON.parse(stdout);
    } catch (e) {
      const msg = String(e.message || e);
      const code = e.stderr ? String(e.stderr) : "";
      if (/429|Too Many/i.test(msg + code) && i < tries - 1) {
        const wait = 8000 * (i + 1);
        process.stderr.write(`    429 — backoff ${(wait / 1000).toFixed(0)}s\n`);
        await sleep(wait);
        continue;
      }
      throw new Error(`curl failed: ${msg.slice(0, 120)}`, { cause: e });
    }
  }
  throw new Error("backoff exhausted");
}

// Search terms tuned per brand. `want`: title fragments that identify the
// OFFICIAL main logo. `avoid`: fragments for subsidiaries/shows/variants.
export const BRANDS = [
  {
    slug: "netflix",
    brand: "Netflix",
    q: "Netflix logo",
    want: ["netflix 2015 logo", "netflix logo"],
    avoid: ["originals", "animation", "sprint", "studios", "games", "comedy", "film"],
  },
  {
    slug: "disney-plus",
    brand: "Disney+",
    q: "Disney+ logo",
    want: ["disney+ logo"],
    avoid: ["channel", "junior", "xd"],
  },
  {
    slug: "spotify-premium",
    brand: "Spotify",
    q: "Spotify logo",
    want: ["spotify logo with text", "spotify logo"],
    avoid: ["podcast", "wrapped", "studios"],
  },
  {
    slug: "youtube-premium",
    brand: "YouTube",
    q: "YouTube logo",
    want: ["youtube logo"],
    avoid: ["music", "kids", "shorts", "tv"],
  },
  {
    slug: "prime-video",
    brand: "Prime Video",
    q: "Amazon Prime Video logo",
    want: ["prime video logo", "amazon prime video"],
    avoid: ["studios", "originals"],
  },
  {
    slug: "hbo-max",
    brand: "HBO Max",
    q: "HBO Max logo",
    want: ["hbo max logo"],
    avoid: ["the girls", "parkműsor", "europe", "asia"],
  },
  {
    slug: "hulu",
    brand: "Hulu",
    q: "Hulu logo",
    want: ["hulu logo"],
    avoid: ["originals", "films", "the handmaid"],
  },
  {
    slug: "paramount-plus",
    brand: "Paramount+",
    q: "Paramount+ logo",
    want: ["paramount+ logo", "paramount plus logo"],
    avoid: ["networks", "pictures", "animation"],
  },
  {
    slug: "apple-tv-plus",
    brand: "Apple TV+",
    q: "Apple TV+ logo",
    want: ["apple tv+ logo", "apple tv plus logo"],
    avoid: ["app"],
  },
  {
    slug: "amc-plus",
    brand: "AMC+",
    q: "AMC+ streaming service",
    want: ["amc+", "amc plus"],
    avoid: ["networks", "theatres"],
  },
  {
    slug: "showtime",
    brand: "Showtime",
    q: "Showtime TV network logo",
    want: ["showtime (tv network)", "showtime network", "showtime logo"],
    avoid: ["exo", "ziwe", "nascar", "championship", "boxing", "inside the nfl", "dexter"],
  },
  {
    slug: "fox-now",
    brand: "FOX",
    q: "Fox Broadcasting Company logo",
    want: ["fox broadcasting company logo", "fox logo", "fox (u.s.)"],
    avoid: ["news", "sports", "weather", "movies", "nation", "corp"],
  },
  {
    slug: "osn-plus",
    brand: "OSN+",
    q: "OSN logo",
    want: ["osn logo", "osn+ logo", "orbit showtime network"],
    avoid: [],
  },
  {
    slug: "sling-tv",
    brand: "Sling TV",
    q: "Sling TV logo",
    want: ["sling tv logo", "sling tv"],
    avoid: ["dish"],
  },
  {
    slug: "directv-stream",
    brand: "DIRECTV",
    q: "DirecTV logo",
    want: ["directv logo", "directv 2021 logo", "directv (logo)"],
    avoid: ["stream app", "now"],
  },
  {
    slug: "funimation",
    brand: "Funimation",
    q: "Funimation logo",
    want: ["funimation logo"],
    avoid: ["one piece", "dragon ball", "anime series"],
  },
  {
    slug: "hallmark-movies-now",
    brand: "Hallmark Movies Now",
    q: "Hallmark Movies Now",
    want: [
      "hallmark movies now",
      "hallmark movies & more",
      "hallmark tv",
      "hallmark channel",
      "hallmark logo",
    ],
    avoid: ["cards", "hall of fame", "entertainer"],
  },
  {
    slug: "shudder",
    brand: "Shudder",
    q: "Shudder logo",
    want: ["shudder logo", "shudder (logo)"],
    avoid: ["film", "movie"],
  },
  {
    slug: "tidal",
    brand: "TIDAL",
    q: "Tidal (music service) logo",
    want: ["tidal logo", "tidal (music service)"],
    avoid: ["wave", "power"],
  },
  {
    slug: "soundcloud-go-plus",
    brand: "SoundCloud",
    q: "SoundCloud logo",
    want: ["soundcloud logo"],
    avoid: ["pulse"],
  },
  {
    slug: "pandora-premium",
    brand: "Pandora",
    q: "Pandora Radio logo",
    want: ["pandora logo", "pandora radio logo", "pandora media"],
    avoid: ["jewelry", "avatar", "greek"],
  },
  { slug: "qobuz", brand: "Qobuz", q: "Qobuz logo", want: ["qobuz"], avoid: [] },
  {
    slug: "napster",
    brand: "Napster",
    q: "Napster logo",
    want: ["napster logo", "napster 2"],
    avoid: ["shawn fanning"],
  },
  { slug: "idagio", brand: "IDAGIO", q: "Idagio", want: ["idagio"], avoid: [] },
  {
    slug: "tunein-premium",
    brand: "TuneIn",
    q: "TuneIn logo",
    want: ["tunein logo", "tunein"],
    avoid: ["radio network"],
  },
  {
    slug: "brain-fm-pro",
    brand: "Brain.fm",
    q: "Brain.fm",
    want: ["brain.fm", "brain fm"],
    avoid: [],
  },
  {
    slug: "chatgpt-plus",
    brand: "ChatGPT",
    q: "OpenAI logo",
    want: ["openai logo", "openai's logo", "chatgpt logo"],
    avoid: ["sora", "dall", "gpt-4", "api", "devday"],
  },
  {
    slug: "grammarly-pro",
    brand: "Grammarly",
    q: "Grammarly logo",
    want: ["grammarly logo"],
    avoid: [],
  },
  { slug: "scribd", brand: "Scribd", q: "Scribd logo", want: ["scribd logo"], avoid: [] },
  {
    slug: "skillshare",
    brand: "Skillshare",
    q: "Skillshare logo",
    want: ["skillshare logo"],
    avoid: [],
  },
  {
    slug: "semrush-classic",
    brand: "Semrush",
    q: "Semrush logo",
    want: ["semrush logo", "semrush"],
    avoid: ["seMrush"],
  },
  { slug: "ahrefs", brand: "Ahrefs", q: "Ahrefs logo", want: ["ahrefs"], avoid: [] },
  {
    slug: "expressvpn",
    brand: "ExpressVPN",
    q: "ExpressVPN logo",
    want: ["expressvpn logo", "expressvpn"],
    avoid: [],
  },
  {
    slug: "cyberghost-vpn",
    brand: "CyberGhost",
    q: "CyberGhost VPN logo",
    want: ["cyberghost logo", "cyberghost vpn", "cyberghost"],
    avoid: [],
  },
  {
    slug: "ipvanish",
    brand: "IPVanish",
    q: "IPVanish logo",
    want: ["ipvanish logo", "ipvanish"],
    avoid: [],
  },
  {
    slug: "hma-vpn-pro",
    brand: "HMA",
    q: "HMA VPN logo",
    want: ["hma vpn logo", "hidemyass logo", "hma logo", "hma! logo", "hma"],
    avoid: [],
  },
  {
    slug: "headspace",
    brand: "Headspace",
    q: "Headspace company",
    want: ["headspace logo", "headspace (app)", "headspace inc", "headspace (company)"],
    avoid: ["mars", "nasa"],
  },
  {
    slug: "cpanel",
    brand: "cPanel",
    q: "CPanel logo",
    want: ["cpanel logo", "cpanel"],
    avoid: ["webhost manager", "whm"],
  },
  {
    slug: "winrar-lifetime",
    brand: "WinRAR",
    q: "WinRAR logo",
    want: ["winrar logo", "winrar"],
    avoid: ["5.0", "3.7"],
  },
  {
    slug: "windows-10-home",
    brand: "Windows 10",
    q: "Windows 10 Logo",
    want: ["windows 10 logo", "windows 10"],
    avoid: ["mobile", "phone", "screenshot"],
  },
  {
    slug: "windows-10-pro",
    brand: "Windows 10 Pro",
    q: "Windows 10 Logo",
    want: ["windows 10 logo", "windows 10"],
    avoid: ["mobile", "phone", "screenshot"],
  },
  {
    slug: "windows-8",
    brand: "Windows 8",
    q: "Windows 8 Logo",
    want: ["windows 8 logo", "windows 8"],
    avoid: ["phone", "rt", "surface"],
  },
  {
    slug: "ultimate-guitar-pro",
    brand: "Ultimate Guitar",
    q: "Ultimate Guitar logo",
    want: ["ultimate guitar"],
    avoid: [],
  },
  {
    slug: "lifetime-cloud-storage",
    brand: "Cloud storage",
    q: "Cloud icon",
    want: ["cloud"],
    avoid: ["rain", "weather", "storm"],
  },
  { slug: "sophia-ai", brand: "Shopia", q: "Shopia logo", want: ["shopia"], avoid: [] },
];

async function fileSearch(query, limit = 10) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&generator=search" +
    `&gsrsearch=${encodeURIComponent(query)}` +
    `&gsrnamespace=6&gsrlimit=${limit}` +
    "&prop=imageinfo&iiprop=url%7Csize%7Cmime&iiurlwidth=1280" +
    "&format=json&formatversion=2";
  const d = await api(url);
  const pages = d?.query?.pages ?? [];
  return pages
    .filter((p) => p.imageinfo?.[0])
    .map((p) => {
      const ii = p.imageinfo[0];
      return {
        title: p.title.replace(/^File:/, ""),
        pageid: p.pageid,
        width: ii.width,
        height: ii.height,
        mime: ii.mime,
        url: ii.url,
        thumb: ii.thumburl ?? ii.url,
      };
    });
}

// Score a candidate: bigger = more likely the official main logo.
function score(c, b) {
  const t = c.title.toLowerCase();
  let s = 0;
  for (const w of b.want)
    if (t.includes(w)) {
      s += 100;
      break;
    }
  for (const a of b.avoid) if (t.includes(a)) s -= 200;
  if (t.endsWith("logo.svg") || t.endsWith("logo.png")) s += 40; // exact "<brand> logo" file
  if (/logo[^a-z]*(\(.*\))?\.svg/.test(t)) s += 15;
  if (c.mime === "image/svg+xml") s += 25; // vector master
  if (c.width >= 900) s += 15;
  else if (c.width >= 500) s += 8;
  if (/20\d\d/.test(t) && !/19\d\d/.test(t)) s += 2;
  if (
    /(dark|light|white|print|variant|icon|symbol|square)/.test(t) &&
    !b.want.some((w) => t.includes(w))
  )
    s -= 25;
  return s;
}

async function main() {
  const only = process.argv[2];
  const list = only ? BRANDS.filter((b) => b.slug === only) : BRANDS;
  const out = {};
  const missing = [];
  for (const b of list) {
    const cachePath = path.join(CANDIDATES, `${b.slug}.json`);
    if (existsSync(cachePath) && !only) {
      out[b.slug] = JSON.parse(await readFile(cachePath, "utf8"));
      continue;
    }
    let cands = [];
    try {
      cands = await fileSearch(b.q);
    } catch (e) {
      console.error(`  ! ${b.slug}: ${e.message}`);
    }
    if (cands.length) {
      const ranked = cands
        .map((c) => ({ ...c, score: score(c, b) }))
        .sort((x, y) => y.score - x.score);
      await writeFile(cachePath, JSON.stringify(ranked, null, 2));
      out[b.slug] = ranked;
      console.log(
        `✓ ${b.slug.padEnd(24)} ${ranked.length} found  →  ${ranked[0].title}  (${ranked[0].width}x${ranked[0].height}) [${ranked[0].score}]`,
      );
    } else {
      missing.push(b.slug);
      console.log(`✗ ${b.slug.padEnd(24)} 0 found`);
    }
    await sleep(2200); // be polite to the API
  }
  if (missing.length) console.log(`\nMISSING (${missing.length}): ${missing.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
