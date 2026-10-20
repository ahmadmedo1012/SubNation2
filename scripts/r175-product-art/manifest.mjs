// R175 — the product-art attraction round (the "أجمل وأكثر جاذبية" directive).
//
// The R174 family (deep charcoal + radial glow + one glossy 3D emblem) was
// clean but static: 45 tiles of "single object centered on a gradient" read
// monotone in the grid. The R175 family keeps every hard law (one designed
// family, strictly no prices/promo/watermarks/URLs, generous margins,
// 1024×1024) and upgrades the VISUAL RICHNESS: each tile becomes a cinematic
// 3D scene — glossy hero above a reflective floor with a mirror reflection,
// brand-color volumetric light haze, floating contextual elements, bokeh
// orbs and sparkle particles, rim light, shallow depth of field.
//
// Brands whose own short wordmark IS the mark (NETFLIX, hulu, SHOWTIME…)
// keep the wordmark (spelling strictly QA'd); every other tile is pure
// emblem. The brand name is NAMED in every prompt — the calibration run
// proved an unnamed emblem renders unrecognizable (the spotify test).

export const FAMILY = {
  size: "1024x1024",
  // The shared scene skeleton every prompt is built from.
  scene: (mark, context, colors) =>
    `Ultra-premium 3D render advertisement art: ${mark} floating above a polished dark glass floor with a soft mirror reflection, ${context}, in a rich cinematic environment of layered ${colors} gradients with volumetric light haze, soft glowing bokeh orbs and drifting sparkle particles, gentle rim light, shallow depth of field, octane render quality, perfectly centered composition with generous margins.`,
  noText:
    "Strictly no text, no letters, no numbers anywhere in the image (including on any floating panels, cards, screens or papers — they must be completely blank), no prices, no watermarks, no URLs, no other brand logos.",
  wordmarkOnly: (word) =>
    `The ONLY text allowed is the exact wordmark "${word}" spelled perfectly with no extra or missing letters (it may repeat as its own mirror reflection on the floor); every floating panel, card, screen or page must be completely blank — no other text, no numbers, no prices, no watermarks, no URLs.`,
};

export const PRODUCTS = [
  {
    slug: "ahrefs",
    brand: "Ahrefs",
    wordmark: "ahrefs",
    mark: 'the "ahrefs" wordmark in bold rounded lowercase letters with a glossy warm-orange 3D finish',
    context:
      "floating translucent analytics dashboard panels with abstract glowing bar charts only (the panels are blank), and a glass magnifying lens orbiting nearby",
    colors: "deep navy and warm amber-orange",
  },
  {
    slug: "amc-plus",
    brand: "AMC+",
    wordmark: "AMC+",
    mark: 'the "AMC+" wordmark in glossy champagne-gold 3D letters',
    context:
      "floating glowing blank widescreen panes (no text) and drifting film-strip ribbons curling through the light",
    colors: "warm gold and bronze on near-black",
  },
  {
    slug: "apple-tv-plus",
    brand: "Apple TV+",
    wordmark: null,
    mark: "a glossy white apple silhouette emblem with a soft radiant plus-shaped glow floating beside it (no words, the apple shape only)",
    context:
      "floating blank translucent screens (no text), star-like sparkles and a soft horizon glow",
    colors: "midnight black with a subtle cool-white and rainbow rim glow",
  },
  {
    slug: "brain-fm-pro",
    brand: "Brain.fm",
    wordmark: null,
    mark: "a luminous stylized human brain formed from soft glowing sound-wave ribbons",
    context: "floating headphones and concentric focus rings of light around the hero",
    colors: "teal, cyan and violet",
  },
  {
    slug: "chatgpt-plus",
    brand: "ChatGPT Plus",
    wordmark: null,
    mark: "the OpenAI knot emblem — an interwoven flower of glossy pearl-white ribbons forming a knot sphere",
    context:
      "orbiting translucent rings of light and a glowing neural constellation of connected light points (no screens, no panels, nothing text-like)",
    colors: "deep teal fading to black",
  },
  {
    slug: "cpanel",
    brand: "cPanel",
    wordmark: "cPanel",
    mark: 'the "cPanel" wordmark in glossy warm-orange 3D letters with a bold capital P',
    context: "floating server cubes with glowing port lights and orbiting glass gear shards",
    colors: "graphite grey and orange",
  },
  {
    slug: "cyberghost-vpn",
    brand: "CyberGhost VPN",
    wordmark: null,
    mark: "the CyberGhost ghost mascot emblem — a friendly glossy indigo ghost mask with soft rounded eyes",
    context: "protective glowing security rings and a receding tunnel of violet light behind it",
    colors: "violet and deep indigo",
  },
  {
    slug: "directv-stream",
    brand: "DIRECTV",
    wordmark: null,
    mark: "a glossy deep-blue satellite dish tilted toward the sky, catching a beam of golden signal light from a small orbiting satellite, with a white swoosh ring encircling it",
    context: "floating blank screens (no text) with satellite light arcs sweeping through the haze",
    colors: "deep blue and cyan",
  },
  {
    slug: "disney-plus",
    brand: "Disney+",
    wordmark: null,
    mark: "the majestic silver-blue fairy-tale castle emblem with elegant spires",
    context: "orbiting golden stars, a shooting-star light trail and a deep midnight sky",
    colors: "midnight blue with silver and soft gold",
  },
  {
    slug: "expressvpn",
    brand: "ExpressVPN",
    wordmark: null,
    mark: "a glossy red angular shield emblem with a subtle white motion swoosh across it",
    context: "concentric security rings of light and a receding tunnel of crimson glow",
    colors: "crimson red on near-black",
  },
  {
    slug: "fox-now",
    brand: "FOX",
    wordmark: "FOX",
    mark: 'the "FOX" wordmark in bold glossy cobalt-blue 3D letters',
    context: "sweeping searchlight beams and floating glowing blank screen panes (no text)",
    colors: "deep cobalt blue with cool white accents",
  },
  {
    slug: "funimation",
    brand: "Funimation",
    wordmark: "Funimation",
    mark: 'the "Funimation" wordmark in glossy sunny-amber 3D letters',
    context:
      "dynamic anime-style light trails and speed-line bursts of glowing energy (abstract, no characters)",
    colors: "warm amber and orange",
  },
  {
    slug: "grammarly-pro",
    brand: "Grammarly",
    wordmark: null,
    mark: "a glossy emerald-green circular badge with a dynamic white pen-stroke flourish sweeping across it (a fountain-pen swirl, not a letter, no trademark symbols)",
    context:
      "orbiting rings of emerald light and soft glowing underline streaks (no pages, no pens, nothing text-like anywhere)",
    colors: "emerald green on deep teal",
  },
  {
    slug: "hallmark-movies-now",
    brand: "Hallmark",
    wordmark: null,
    mark: "an elegant glossy golden crown emblem with delicate filigree points",
    context: "floating warm film ribbons, soft romantic bokeh and gentle golden haze",
    colors: "warm gold and rose",
  },
  {
    slug: "hbo-max",
    brand: "HBO",
    wordmark: "HBO",
    mark: 'the "HBO" wordmark in bold glossy letters with a violet-blue gradient finish',
    context:
      "floating widescreen panes of light (blank screens, no text) and a deep cinematic haze",
    colors: "deep violet and indigo",
  },
  {
    slug: "headspace",
    brand: "Headspace",
    wordmark: null,
    mark: "a serene glowing gradient orb with soft concentric aura rings, made of pure light with absolutely no letters, words or symbols on or around it",
    context:
      "gentle concentric meditation ripples, a few soft lotus-petal light shapes and floating motes of light",
    colors: "warm peach and coral fading to dusk violet",
  },
  {
    slug: "hma-vpn-pro",
    brand: "HMA VPN",
    wordmark: null,
    mark: "a glossy lime-green rounded shield emblem with a subtle friendly stylized face",
    context: "orbiting security rings and a tunnel of green light",
    colors: "green and lime on near-black",
  },
  {
    slug: "hulu",
    brand: "hulu",
    wordmark: "hulu",
    mark: 'the "hulu" wordmark in bold lowercase letters with a glossy bright spring-green finish',
    context:
      "a soft aurora ribbon of green light flowing behind, drifting light motes and gentle beams through blank glowing screens (no text)",
    colors: "spring green on near-black",
  },
  {
    slug: "idagio",
    brand: "IDAGIO",
    wordmark: null,
    mark: "an elegant glossy golden lyre harp emblem (classical music)",
    context:
      "floating translucent sheet-music ribbons with abstract golden glints (no notes or letters, just light) and a warm concert-hall glow",
    colors: "burnished gold on deep burgundy-black",
  },
  {
    slug: "ipvanish",
    brand: "IPVanish",
    wordmark: null,
    mark: "a glossy deep-blue shield emblem wrapped by a vivid orange comet-swirl trail",
    context: "security rings of light and a receding tunnel of blue glow",
    colors: "deep blue with orange accents",
  },
  {
    slug: "lifetime-cloud-storage",
    brand: "lifetime cloud storage",
    wordmark: null,
    mark: "a large glossy white-and-blue cloud emblem with orbiting rings of light and a subtle infinity shimmer",
    context: "floating glass cubes with data glints and upward arrows of light",
    colors: "sky blue and white on deep blue",
  },
  {
    slug: "napster",
    brand: "Napster",
    wordmark: null,
    mark: "the iconic glossy black cat head wearing glossy amber headphones",
    context: "floating vinyl records and glowing waveform ribbons",
    colors: "electric amber and yellow on near-black",
  },
  {
    slug: "netflix",
    brand: "Netflix",
    wordmark: "NETFLIX",
    mark: 'the iconic bold red "NETFLIX" wordmark in glossy 3D lettering',
    context: "a subtle widescreen light-streak horizon behind and drifting ember sparkles",
    colors: "deep red to near-black",
  },
  {
    slug: "osn-plus",
    brand: "OSN+",
    wordmark: "OSN+",
    mark: 'the "OSN+" wordmark in glossy onyx letters with a radiant golden plus',
    context:
      "floating ornate blank screens (no text) with arabesque light patterns and warm dusk dunes of light",
    colors: "warm gold and rose on near-black",
  },
  {
    slug: "pandora-premium",
    brand: "Pandora",
    wordmark: null,
    mark: "a glossy sapphire-blue vinyl record with concentric grooves glowing softly and a ring of light at its center (no letters on it, pure disc shapes)",
    context:
      "floating crystal light ribbons and gem-like sparkles (no musical notation, no symbols, just light shapes)",
    colors: "sapphire blue with cool white accents",
  },
  {
    slug: "paramount-plus",
    brand: "Paramount+",
    wordmark: null,
    mark: "the majestic snow-capped mountain emblem ringed by a circle of glowing stars",
    context: "shooting stars and cinematic light rays sweeping around the peak",
    colors: "midnight blue with a luminous white peak",
  },
  {
    slug: "prime-video",
    brand: "Prime Video",
    wordmark: null,
    mark: "a glossy radiant golden crown hovering above a curved white smile-swoosh of light, the crown and smile together as one emblem",
    context: "floating blank screens (no text) and star sparkles around a deep royal-blue glow",
    colors: "deep royal blue and cyan",
  },
  {
    slug: "qobuz",
    brand: "Qobuz",
    wordmark: "QOBUZ",
    mark: 'the "QOBUZ" wordmark in glossy onyx-black 3D letters with warm gold rim light',
    context: "floating hi-fi speaker cabinets, golden waveform lines and vinyl discs",
    colors: "black and gold with a violet accent",
  },
  {
    slug: "scribd",
    brand: "Scribd",
    wordmark: "Scribd",
    mark: 'the "Scribd" wordmark in a glossy teal-green friendly serif finish',
    context:
      "floating blank open book pages (no text on them), glass bookmarks and gentle ink swirls of light",
    colors: "emerald teal with warm paper-gold accents",
  },
  {
    slug: "semrush-classic",
    brand: "SEMrush",
    wordmark: "SEMrush",
    mark: 'the "SEMrush" wordmark in bold glossy orange 3D letters with a capital S, M and r',
    context:
      "orbiting translucent glass shards of amber light and glowing upward-trending arrows (no charts, no panels, nothing text-like)",
    colors: "deep navy and vivid orange",
  },
  {
    slug: "showtime",
    brand: "Showtime",
    wordmark: "SHOWTIME",
    mark: 'the "SHOWTIME" wordmark in bold glossy crimson 3D letters',
    context: "floating blank screens (no text), sweeping spotlight beams and a velvet-red haze",
    colors: "crimson on near-black",
  },
  {
    slug: "shudder",
    brand: "Shudder",
    wordmark: "SHUDDER",
    mark: 'the "SHUDDER" wordmark in eerie glossy acid-green 3D letters with a wet luminous finish',
    context:
      "a dramatic horror scene: thick fog curling around the letters, a huge glowing full moon behind, rising ghost-light wisps and drifting green spores of light",
    colors: "acid green in black mist",
  },
  {
    slug: "skillshare",
    brand: "Skillshare",
    wordmark: "skillshare",
    mark: 'the "skillshare" wordmark stacked in two glossy mint-green lowercase lines ("skill" above "share")',
    context:
      "floating blank translucent lesson cards (no text on them) and a constellation of pencil-shaped light streaks",
    colors: "mint green with warm amber accents",
  },
  {
    slug: "sling-tv",
    brand: "Sling TV",
    wordmark: null,
    mark: "a glossy vivid-orange ribbon swoosh emblem curling like a soft wave",
    context: "floating blank screens (no text), motion light trails and a cool blue glow",
    colors: "vivid orange on deep blue",
  },
  {
    slug: "sophia-ai",
    brand: "Sophia AI",
    wordmark: null,
    mark: "a luminous pearl orb emblem wrapped in orbiting golden neural rings",
    context: "floating translucent knowledge panels and delicate constellation lines",
    colors: "pearl white and gold with a soft violet glow",
  },
  {
    slug: "soundcloud-go-plus",
    brand: "SoundCloud",
    wordmark: null,
    mark: "the SoundCloud emblem — a glossy orange cloud with vertical sound-wave striations",
    context: "floating waveform ribbons and softly glowing audio dials",
    colors: "warm orange and peach on near-black",
  },
  {
    slug: "spotify-premium",
    brand: "Spotify",
    wordmark: null,
    mark: "the Spotify logo emblem — a large forest-green circular badge containing three white curved sound-wave arcs",
    context: "floating translucent music-stream ribbons and soft glowing bokeh orbs",
    colors: "deep green and emerald",
  },
  {
    slug: "tidal",
    brand: "TIDAL",
    wordmark: null,
    mark: "the TIDAL emblem — a cluster of luminous diamond facets forming the brand mark",
    context: "refracting light prisms and glacial crystal shards floating around it",
    colors: "ice blue and cyan on near-black",
  },
  {
    slug: "tunein-premium",
    brand: "TuneIn",
    wordmark: null,
    mark: "a glossy glass globe emblem radiating concentric radio-wave rings",
    context: "floating radio dials and orbiting rings of sound",
    colors: "teal with warm amber accents",
  },
  {
    slug: "ultimate-guitar-pro",
    brand: "Ultimate Guitar",
    wordmark: null,
    mark: "a beautiful glossy sunburst-finish electric guitar as the hero",
    context: "floating guitar picks, glowing string light-lines and a warm amp glow",
    colors: "amber and orange sunburst on near-black",
  },
  {
    slug: "windows-10-home",
    brand: "Windows 10",
    wordmark: null,
    mark: "the Windows emblem — four glossy azure-blue panes forming a tilted window",
    context: "floating glass tiles and clean light beams",
    colors: "azure blue on deep navy",
  },
  {
    slug: "windows-10-pro",
    brand: "Windows 10 Pro",
    wordmark: null,
    mark: "the Windows emblem — four glossy graphite-steel panes forming a tilted window with a cool blue glow",
    context: "floating brushed-metal tiles and precise light beams",
    colors: "graphite and steel blue",
  },
  {
    slug: "windows-8",
    brand: "Windows 8",
    wordmark: null,
    mark: "the Windows emblem — four bright glossy cyan-blue panes forming a tilted window",
    context: "floating flat glass tiles and crisp light rays",
    colors: "bright cyan-blue on deep teal",
  },
  {
    slug: "winrar-lifetime",
    brand: "WinRAR",
    wordmark: null,
    mark: "a stack of three glossy books — violet, crimson and green — with rounded spines",
    context: "floating zipper seals of light and translucent glass folder icons",
    colors: "violet, crimson and green on near-black",
  },
  {
    slug: "youtube-premium",
    brand: "YouTube",
    wordmark: null,
    mark: "the YouTube emblem — a glossy red rounded-rectangle play button with a white triangle",
    context: "floating blank screens (no text) and sweeping spotlight beams",
    colors: "signature red on charcoal black",
  },
];

// The fully-built generation prompt for a product entry.
export function buildPrompt(p) {
  const scene = FAMILY.scene(p.mark, p.context, p.colors);
  const law = p.wordmark ? FAMILY.wordmarkOnly(p.wordmark) : FAMILY.noText;
  return `${scene} ${law}`;
}
