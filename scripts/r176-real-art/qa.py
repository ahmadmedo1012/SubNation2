#!/usr/bin/env python3
"""R176 stage 5 — QA (geometric, offline): every tile must be 1024x1024, the
logo must be comfortably inside safe margins, and — critically — the logo must
be VISIBLE: contrast between the logo's ink and its ground. Flags tiles whose
center-region vs corner-region luminance delta is too low to read."""
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TILES = os.path.join(HERE, "tiles")
S = 1024
SAFE = 132  # min margin to tile edge (box 737 → 143px; compact boxes more)


def region_lum(im, box):
    px = list(im.crop(box).convert("L").getdata())
    px.sort()
    return px[len(px) // 2] / 255.0


def main():
    decisions = {d["slug"]: d for d in json.load(open(os.path.join(HERE, "decisions.json")))}
    problems, rows = [], []
    for f in sorted(os.listdir(TILES)):
        if not f.endswith(".png"):
            continue
        slug = f[:-4]
        im = Image.open(os.path.join(TILES, f)).convert("L")
        w, h = im.size
        if (w, h) != (S, S):
            problems.append(f"{slug}: size {w}x{h}")
            continue
        data = im.load()
        # ground = median of the two corner squares (far from the logo)
        corners = region_lum(im, (0, 0, int(S * 0.14), int(S * 0.14)))
        corners2 = region_lum(im, (int(S * 0.86), int(S * 0.86), S, S))
        ground = (corners + corners2) / 2
        # ink coverage: fraction of central-area pixels differing from ground
        # (the median strip misses wordmark gaps — coverage is the honest check)
        cx0, cy0, cx1, cy1 = int(S * 0.28), int(S * 0.28), int(S * 0.72), int(S * 0.72)
        n = 0
        ink = 0
        darkest = 1.0
        lightest = 0.0
        for y in range(cy0, cy1, 4):
            for x in range(cx0, cx1, 4):
                v = data[x, y] / 255.0
                n += 1
                if abs(v - ground) > 0.15:
                    ink += 1
                    darkest = min(darkest, v)
                    lightest = max(lightest, v)
        ink_frac = ink / n
        ink_span = lightest - darkest
        # ink extent over the whole tile (margin check)
        far = [
            (x, y)
            for y in range(0, S, 8)
            for x in range(0, S, 8)
            if abs(data[x, y] / 255.0 - ground) > 0.18
        ]
        flag = ""
        if far:
            xs = [p[0] for p in far]
            ys = [p[1] for p in far]
            extent = (min(xs), min(ys), max(xs), max(ys))
            margins = (extent[0], extent[1], S - extent[2], S - extent[3])
            min_margin = min(margins)
        else:
            min_margin = -1
        if ink_frac < 0.005:
            flag = " ⚠️ NO-VISIBLE-INK"
            problems.append(f"{slug}: ink fraction {ink_frac:.4f} — logo invisible?")
        else:
            # contrast = how far the ink sits from the ground (either direction)
            ink_contrast = max(abs(darkest - ground), abs(lightest - ground))
            if ink_contrast < 0.25:
                flag = " ⚠️ WASHED-OUT"
                problems.append(f"{slug}: ink contrast {ink_contrast:.2f} vs ground {ground:.2f}")
        if min_margin < SAFE - 40:  # compact-box tiles have ≥276px; allow slack for glow
            flag += f" ⚠️ TIGHT-MARGIN({min_margin})"
            problems.append(f"{slug}: margin {min_margin}px < {SAFE - 40}")
        rows.append(f"{slug:26} ground={ground:.2f} ink%={ink_frac * 100:5.1f} span={ink_span:.2f} margin={min_margin}{flag}")
    for r in rows:
        print(r)
    print()
    if problems:
        print("PROBLEMS:")
        for p in problems:
            print("  -", p)
    else:
        print("ALL CLEAR — every tile 1024², visible ink, margins honored.")


if __name__ == "__main__":
    main()
