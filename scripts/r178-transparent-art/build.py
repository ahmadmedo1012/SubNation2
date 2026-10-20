#!/usr/bin/env python3
"""R178 — THEME-ADAPTIVE TRANSPARENT PRODUCT ART (single-stage builder).

The R176 family put every real logo on one of two BAKED grounds (pearl for
dark marks, charcoal for white marks) — a static compromise that reads as a
foreign white square on the dark theme's card wells (the owner's ask: logos
WITHOUT the white ground, the background following the theme).

This stage rebuilds both asset families from the SAME R176 sources (same
geometry, same plate-keying rules — one behavioral delta each):

  frontend/public/products/<slug>.webp    TRANSPARENT 1024x1024 (RGBA) —
      the theme-aware bg-muted/* well IS the ground now; the CSS polarity
      block (index.css, generated below) flips ink/paper logos on the
      mismatched theme so no wordmark ever drowns.
  frontend/public/products-og/<slug>.webp OPAQUE 1024x1024 (RGB) — the
      pearl/charcoal grounds live on for the BOT family (og:image,
      Product-LD, WhatsApp unfurls — scrapers composite transparent art on
      unpredictable grounds, so the share surface keeps its own).

Source fixes this round (the R176 visual audit — VLM on the deployed tiles
— caught three defective sources):
  fox-now               was a blank white rectangle (broken fetch) → the
                        official Fox Broadcasting Company 2019 wordmark
                        (commons c/c0, thumb.wikimedia.org raster).
  soundcloud-go-plus    was a faint gray circle outline → the official
                        SoundCloud orange lockup (commons 7/78).
  sophia-ai             shipped its black favicon plate as a square on the
                        pearl ground → luminance-keyed here (cyan mark
                        survives, the plate drops).

Polarity contract (emitted to polarity.json → the index.css block):
  ink   med content luminance <= 0.42        → invert+hue-rotate on the
        DARK theme only (dark mark drowns on the dark well)
  paper med lum >= 0.72 AND med sat <= 0.35  → invert+hue-rotate on the
        LIGHT theme only (white mark drowns on the light well)
  auto  everything else                      → no filter, reads on both
Dark-plate-forced-white content (idagio) is paper by construction.

Run:  python3 scripts/r178-transparent-art/build.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
R176 = os.path.join(os.path.dirname(HERE), "r176-real-art")
RAW = os.path.join(R176, "raw")
SRC = os.path.join(HERE, "sources")
TILES = os.path.join(HERE, "tiles")          # transparent family
OGS = os.path.join(HERE, "og")               # opaque bot family
REPO = os.path.dirname(os.path.dirname(HERE))
DEST_UI = os.path.join(REPO, "frontend", "public", "products")
DEST_OG = os.path.join(REPO, "frontend", "public", "products-og")

S = 1024
BUDGET = 48 * 1024

# R176 grounds — the OG family keeps them verbatim.
PEARL_TOP, PEARL_BOT = (255, 255, 255), (244, 245, 248)
CHAR_TOP, CHAR_BOT = (35, 36, 45), (23, 24, 31)

# slug → replacement official source (this round's defect fixes)
SOURCE_OVERRIDES = {
    "fox-now": "fox-official.png",
    "soundcloud-go-plus": "soundcloud-official.png",
}

# Dark-plate sources: black plate, bright content.
#   forced white (R176's recipe — content is white): idagio
#   keyed, color kept (cyan mark on black plate): sophia-ai
DARK_PLATE_WHITE = {"idagio"}
DARK_PLATE_COLOR = {"sophia-ai"}


def key_white_plate(im):
    """Dark logo baked on a white plate → key whiteness to alpha (R176)."""
    g = im.convert("L")
    alpha = g.point(lambda v: 0 if v > 238 else (255 if v < 205 else round((238 - v) * 255 / 33)))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def key_dark_plate(im, force_white):
    """Bright content baked on a black plate → luminance becomes alpha.
    force_white keeps R176's recipe (idagio); otherwise ink keeps its own
    color (sophia-ai's cyan)."""
    g = im.convert("L")
    alpha = g.point(lambda v: 0 if v < 24 else (255 if v > 210 else round((v - 24) * 255 / 186)))
    if force_white:
        out = Image.new("RGBA", im.size, (255, 255, 255, 255))
    else:
        out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def load_logo(slug, path, white_plate):
    if slug in DARK_PLATE_WHITE:
        return key_dark_plate(Image.open(path), force_white=True)
    if slug in DARK_PLATE_COLOR:
        return key_dark_plate(Image.open(path), force_white=False)
    im = Image.open(path)
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    if white_plate:
        return key_white_plate(im)
    return im


def trim(im):
    bbox = im.getchannel("A").getbbox()
    return im.crop(bbox) if bbox else im


def fit(im, box):
    w, h = im.size
    scale = min(box / w, box / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    out = im.resize((nw, nh), Image.LANCZOS)
    if scale > 1.6:  # small source — gentle sharpen after the upscale (R176)
        out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=55, threshold=2))
    return out


def vertical_gradient(top, bottom):
    im = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(im)
    for y in range(S):
        t = y / (S - 1)
        d.line([(0, y), (S, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return im


def content_stats(im):
    """Median luminance + saturation over the OPAQUE content (sampled)."""
    px = im.load()
    w, h = im.size
    lums, sats = [], []
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            r, g, b, a = px[x, y]
            if a < 200:
                continue
            lums.append((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255)
            sats.append((max(r, g, b) - min(r, g, b)) / 255)
    if not lums:
        return 0.0, 1.0
    lums.sort()
    return lums[len(lums) // 2], sum(sats) / len(sats)


def polarity(slug, med_lum, med_sat):
    if slug in DARK_PLATE_WHITE:
        return "paper"  # forced-white content drowns on light grounds
    if med_lum <= 0.42:
        return "ink"
    if med_lum >= 0.72 and med_sat <= 0.35:
        return "paper"
    return "auto"


def encode(src_png, dest_webp, want_alpha):
    im = Image.open(src_png)
    if want_alpha:
        im = im.convert("RGBA")
    else:
        im = im.convert("RGB")
    q = 82
    im.save(dest_webp, "WEBP", quality=q, method=6)
    if os.path.getsize(dest_webp) > BUDGET:
        q = 74
        im.save(dest_webp, "WEBP", quality=q, method=6)
    check = Image.open(dest_webp)
    check.load()
    assert check.size == (S, S), f"{dest_webp}: decoded {check.size}"
    return os.path.getsize(dest_webp), q


def main():
    os.makedirs(TILES, exist_ok=True)
    os.makedirs(OGS, exist_ok=True)
    os.makedirs(DEST_OG, exist_ok=True)
    decisions = {d["slug"]: d for d in json.load(open(os.path.join(R176, "decisions.json")))}

    manifest = {}
    for slug in sorted(decisions):
        dec = decisions[slug]
        # source path: this round's official overrides, else the R176 raw
        override = SOURCE_OVERRIDES.get(slug)
        path = os.path.join(SRC, override) if override else os.path.join(RAW, dec.get("src", slug + ".png"))
        assert os.path.isfile(path), f"{slug}: source missing {path}"

        logo = trim(load_logo(slug, path, dec.get("white_plate", False)))
        assert logo.getchannel("A").getbbox(), f"{slug}: keyed to nothing — source defect"
        logo = fit(logo, dec["box"])
        x, y = (S - logo.width) // 2, (S - logo.height) // 2

        # 1) transparent family — the theme well is the ground
        tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        tile.alpha_composite(logo, (x, y))
        tile.save(os.path.join(TILES, f"{slug}.png"), "PNG")

        med_lum, med_sat = content_stats(tile)
        pol = polarity(slug, med_lum, med_sat)
        manifest[slug] = {"polarity": pol, "med_lum": round(med_lum, 3), "med_sat": round(med_sat, 3)}

        # 2) opaque OG family — pearl for dark/colored marks, charcoal for
        #    white ones (R176's rule, keyed off the MEASURED polarity so the
        #    two defect fixes land on the right ground)
        og = vertical_gradient(PEARL_TOP, PEARL_BOT) if pol != "paper" else vertical_gradient(CHAR_TOP, CHAR_BOT)
        og.paste(logo, (x, y), logo)
        og.save(os.path.join(OGS, f"{slug}.png"), "PNG")

    json.dump(manifest, open(os.path.join(HERE, "polarity.json"), "w"), indent=1, sort_keys=True)

    # 3) encode both families
    report = {"ui_total": 0, "og_total": 0, "adaptive": []}
    for slug in sorted(manifest):
        for kind, src_dir, dest, key in (
            ("ui", TILES, DEST_UI, "ui_total"),
            ("og", OGS, DEST_OG, "og_total"),
        ):
            size, q = encode(os.path.join(src_dir, f"{slug}.png"), os.path.join(dest, f"{slug}.webp"), want_alpha=kind == "ui")
            report[key] += size
            if q != 82:
                report["adaptive"].append(f"{slug}/{kind}")

    # 4) alpha sanity on the shipped UI family
    weak = []
    for slug in sorted(manifest):
        im = Image.open(os.path.join(DEST_UI, f"{slug}.webp")).convert("RGBA")
        hist = im.getchannel("A").histogram()
        if sum(hist[:16]) / (S * S) < 0.10:
            weak.append(slug)

    n = len(manifest)
    counts = {p: sum(1 for v in manifest.values() if v["polarity"] == p) for p in ("ink", "paper", "auto")}
    print(f"\n{n} slugs — polarity: {counts}")
    print(f"UI family:  {report['ui_total'] / 1024:.0f} KB total, avg {report['ui_total'] / n / 1024:.1f} KB (transparent RGBA)")
    print(f"OG family:   {report['og_total'] / 1024:.0f} KB total, avg {report['og_total'] / n / 1024:.1f} KB (opaque pearl/charcoal)")
    print(f"adaptive q74: {report['adaptive'] or 'none'}")
    print(f"weak-alpha tiles (<10% transparent): {weak or 'none'}")

    # 5) the CSS block (paste into frontend/src/index.css — pinned by test)
    ink = [s for s in sorted(manifest) if manifest[s]["polarity"] == "ink"]
    paper = [s for s in sorted(manifest) if manifest[s]["polarity"] == "paper"]
    print("\n/* ── polarity manifest → index.css ── */")
    print("/* ink (dark content — flip on the dark theme) */")
    for s in ink:
        print(f':root:not(.light) img[src*="/products/{s}.webp"] {{ filter: invert(1) hue-rotate(180deg) drop-shadow(0 4px 4px rgb(0 0 0 / 0.15)); }}')
    print("/* paper (white content — flip on the light theme) */")
    for s in paper:
        print(f'.light img[src*="/products/{s}.webp"] {{ filter: invert(1) hue-rotate(180deg) drop-shadow(0 4px 4px rgb(0 0 0 / 0.15)); }}')


if __name__ == "__main__":
    main()
