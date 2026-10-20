#!/usr/bin/env python3
"""R176 stage 3 — ANALYZE: inspect every raw logo (bbox, aspect, luminance,
saturation, alpha coverage) and decide the tile variant (pearl/charcoal) +
sizing class. Prints a review table; writes decisions.json for the compositor.
"""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")

# Manual overrides (applied after auto-analysis, keyed by slug).
# variant: "pearl" | "charcoal"; force_box: max logo box in px (1024 tile).
# src: alternate source file under raw/ (e.g. the brand's own official CDN
# asset fetched into raw/hi/ — higher fidelity than the Wikipedia thumb).
OVERRIDES = {
    # White wordmarks that MUST sit on the dark variant:
    "idagio": {"variant": "charcoal"},            # white IDAGIO on dark JPEG (alpha-extracted)
    "lifetime-cloud-storage": {"variant": "charcoal"},  # near-white cloud glyph, low contrast on pearl
    # small sources: cap the box so the upscale stays graceful
    "sophia-ai": {"force_box": 360},                # 180px favicon source
    "winrar-lifetime": {"force_box": 560},          # 250px source
    "ipvanish": {"force_box": 620},                  # 330px source
    # upgraded sources from the brands' own CDNs (raw/hi/):
    "hma-vpn-pro": {"src": "hi/hma-vpn-pro.png", "white_plate": True, "force_box": 430},   # official 400x400
    "cyberghost-vpn": {"src": "hi/cyberghost-icon.png", "force_box": 400},                 # official 192x192 ghost mark
}


def analyze(path):
    im = Image.open(path)
    im.load()
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    # tight bbox of non-transparent content
    alpha = im.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    aspect = w / h if h else 99
    # pixel stats on opaque pixels
    px = im.resize((min(w, 256), min(h, 256) or 1)).tobytes() if False else None
    small = im.copy()
    small.thumbnail((256, 256))
    data = list(small.getdata())
    opaque = [(r, g, b) for r, g, b, a in data if a > 128]
    n = len(opaque) or 1
    lum = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in opaque]
    lum.sort()
    med = lum[n // 2] / 255.0
    dark_frac = sum(1 for x in lum if x < 60) / n
    light_frac = sum(1 for x in lum if x > 200) / n
    sat = sorted(
        (max(r, g, b) - min(r, g, b)) / 255.0 for r, g, b in opaque
    )
    med_sat = sat[len(sat) // 2]
    return {
        "w": w, "h": h, "aspect": round(aspect, 2),
        "med_lum": round(med, 3), "med_sat": round(med_sat, 3),
        "dark_frac": round(dark_frac, 3), "light_frac": round(light_frac, 3),
    }


def decide(a):
    if a["med_lum"] > 0.82 and a["med_sat"] < 0.30 and a["light_frac"] > 0.45:
        return "charcoal"  # white/monochrome-light logo
    if a["med_lum"] < 0.16 and a["dark_frac"] > 0.55:
        return "pearl"      # black logo
    if a["med_lum"] > 0.82:  # bright but saturated (e.g. full-white with glow)
        return "charcoal"
    return "pearl"


def box_for(aspect):
    if aspect >= 3.0:
        return 737  # 72% — very wide wordmarks
    if aspect >= 1.4:
        return 635  # 62% — standard lockups
    return 471     # 46% — compact marks/squares


def main():
    rows = []
    for f in sorted(os.listdir(RAW)):
        if not f.endswith(".png"):
            continue
        slug = f[:-4]
        a = analyze(os.path.join(RAW, f))
        variant = decide(a)
        ov = OVERRIDES.get(slug, {})
        variant = ov.get("variant", variant)
        rows.append({
            "slug": slug, **a,
            "variant": variant, "box": ov.get("force_box", box_for(a["aspect"])),
            "src": ov.get("src", f), "white_plate": ov.get("white_plate", False),
        })
    # print table
    print(f"{'slug':26} {'size':>11} {'aspect':>6} {'lum':>5} {'sat':>5} {'lt%':>5} {'dk%':>5}  variant  box")
    for r in rows:
        print(f"{r['slug']:26} {str(r['w'])+'x'+str(r['h']):>11} {r['aspect']:>6} "
              f"{r['med_lum']:>5} {r['med_sat']:>5} {r['light_frac']:>5} {r['dark_frac']:>5}  "
              f"{r['variant']:8} {r['box']}")
    out = os.path.join(HERE, "decisions.json")
    with open(out, "w") as fh:
        json.dump(rows, fh, indent=2)
    print(f"\n→ {out}  ({len(rows)} entries)")
    pearl = sum(1 for r in rows if r["variant"] == "pearl")
    print(f"pearl: {pearl}  charcoal: {len(rows) - pearl}")


if __name__ == "__main__":
    main()
