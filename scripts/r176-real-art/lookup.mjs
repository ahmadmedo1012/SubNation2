// Direct title lookup — bypass search for known file names.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);
const UA = "Mozilla/5.0 (X11; Linux x86_64) SubNationArtResearch/1.2 (catalog art curation)";

async function lookup(titles) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&prop=imageinfo" +
    `&titles=${encodeURIComponent(titles.map((t) => `File:${t}`).join("|"))}` +
    "&iiprop=url%7Csize%7Cmime&iiurlwidth=1280&format=json&formatversion=2";
  const { stdout } = await execFileP(
    "curl",
    ["-s", "--max-time", "30", "--compressed", "-H", `User-Agent: ${UA}`, url],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  const d = JSON.parse(stdout);
  for (const p of d?.query?.pages ?? []) {
    const ii = p.imageinfo?.[0];
    console.log(
      `${ii ? "✓" : "✗"} ${p.title.replace(/^File:/, "").padEnd(46)} ${ii ? `${ii.width}x${ii.height} ${ii.mime}` : "missing"}`,
    );
    if (ii) console.log(`    → ${ii.thumburl ?? ii.url}`);
  }
}

const groups = process.argv[2];
const MAP = {
  showtime: [
    "Showtime logo.svg",
    "Showtime Logo.svg",
    "Showtime Networks logo.svg",
    "Showtime 2005 logo.svg",
  ],
  hma: ["HMA logo.svg", "HideMyAss logo.svg", "HMA VPN logo.svg", "HideMyAss! logo.svg"],
  hallmark: [
    "Hallmark Channel logo.svg",
    "Hallmark Movies Now logo.png",
    "Hallmark logo.svg",
    "Hallmark Cards logo.svg",
  ],
  cloud: ["Cloud computing icon.svg", "Cloud icon.svg", "Cloud-logo.svg", "Icon - Cloud.svg"],
  hulu: ["Hulu 2021 logo.svg", "Hulu logo.svg", "Hulu 2017 logo.svg"],
  fox: ["Fox logo.svg", "Fox Broadcasting Company logo.svg"],
  osn: ["OSN+ logo.svg"],
  tidal: ["Tidal logo.svg", "TIDAL logo.svg"],
  directv: ["DirecTV 2021 logo.svg"],
  winrar: ["WinRAR logo.svg", "WinRAR icon.svg"],
};
for (const g of groups.split(",")) {
  console.log(`── ${g}:`);
  await lookup(MAP[g] ?? []);
}
