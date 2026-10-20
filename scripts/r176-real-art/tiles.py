#!/usr/bin/env python3
"""R176 stage 4 — COMPOSITE: build the 45 catalog tiles.

The family: the brand's REAL official artwork (downloaded in stage 2) centered
on one of two neutral grounds, identical geometry everywhere — generous
margins, LANCZOS resampling, JPEG dark-plates alpha-extracted. No AI, no
decoration beyond a whisper of light: the logo IS the art.

  pearl    #FFFFFF -> #F4F5F8 vertical   (for dark/colored logos)
  charcoal #23242D -> #17181F vertical   (for white/light logos)

Outputs scripts/r176-real-art/tiles/<slug>.png at 1024x1024.
"""
import json
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
TILES = os.path.join(HERE, "tiles")
os.makedirs(TILES, exist_ok=True)

S = 1024

PEARL_TOP = (255, 255, 255, 255)
PEARL_BOT = (244, 245, 248, 255)
CHAR_TOP = (35, 36, 45, 255)
CHAR_BOT = (23, 24, 31, 255)

# files whose source is a dark-plate JPEG (white logo baked on black) →
# luminance becomes alpha, color forced white
DARK_PLATE_JPEGS = {"idagio"}


def key_white_plate(im):
    """Dark logo baked on a white plate → key whiteness to alpha.
    Content ink keeps its own color; the white ground drops out so the
    composited pearl/charcoal gradient shows through cleanly."""
    g = im.convert("L")
    alpha = g.point(
        lambda v: 0 if v > 238 else (255 if v < 205 else round((238 - v) * 255 / 33))
    )
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def vertical_gradient(top, bottom):
    im = Image.new("RGBA", (S, S))
    d = ImageDraw.Draw(im)
    for y in range(S):
        t = y / (S - 1)
        d.line(
            [(0, y), (S, y)],
            fill=(
                round(top[0] + (bottom[0] - top[0]) * t),
                round(top[1] + (bottom[1] - top[1]) * t),
                round(top[2] + (bottom[2] - top[2]) * t),
                255,
            ),
        )
    return im


def add_radial_glow(im, center=(0.5, 0.42), radius=0.75, color=(255, 255, 255), strength=0.03):
    """A whisper of light behind the logo — barely perceptible depth."""
    glow = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(glow)
    cx, cy = round(center[0] * S), round(center[1] * S)
    r = round(radius * S)
    for i in range(28, 0, -1):
        rr = round(r * i / 28)
        val = round(255 * strength * (28 - i) / 28)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=val)
    glow = glow.filter(ImageFilter.GaussianBlur(60))
    white = Image.new("RGBA", (S, S), color + (255,))
    im.paste(white, (0, 0), glow)


def load_logo(slug, path, white_plate=False):
    if slug in DARK_PLATE_JPEGS:
        im = Image.open(path).convert("L")
        # luminance -> alpha; content forced pure white
        alpha = im.point(lambda v: 0 if v < 24 else (255 if v > 210 else round((v - 24) * 255 / 186)))
        logo = Image.new("RGBA", im.size, (255, 255, 255, 255))
        logo.putalpha(alpha)
        return logo
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
    if scale > 1.6:  # small source — gentle sharpen after the upscale
        out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=55, threshold=2))
    return out


def main():
    decisions = {d["slug"]: d for d in json.load(open(os.path.join(HERE, "decisions.json")))}
    for f in sorted(os.listdir(RAW)):
        if not f.endswith(".png"):
            continue
        slug = f[:-4]
        d = decisions.get(slug)
        if not d:
            print(f"! {slug}: no decision row, skipped")
            continue
        logo = trim(load_logo(slug, os.path.join(RAW, d.get("src", f)), d.get("white_plate", False)))
        variant = d["variant"]
        if variant == "pearl":
            tile = vertical_gradient(PEARL_TOP, PEARL_BOT)
            add_radial_glow(tile, color=(255, 255, 255), strength=0.035)
        else:
            tile = vertical_gradient(CHAR_TOP, CHAR_BOT)
            add_radial_glow(tile, color=(255, 255, 255), strength=0.05)
        logo = fit(logo, d["box"])
        x = (S - logo.width) // 2
        y = (S - logo.height) // 2
        tile.alpha_composite(logo, (x, y))
        out = os.path.join(TILES, f"{slug}.png")
        tile.convert("RGB").save(out, "PNG")
        kb = os.path.getsize(out) // 1024
        print(f"✓ {slug:26} {variant:8} logo {logo.width}x{logo.height}  → {kb} KB")
    print(f"\n{len(os.listdir(TILES))} tiles → {TILES}")


if __name__ == "__main__":
    main()
