#!/usr/bin/env python3
"""R176 stage 6 — ENCODE: tiles/*.png → frontend/public/products/*.webp
WebP q82 (flat logo art compresses far better than the R175 scenes), with an
adaptive downshift to q74 for the few photo-ish tiles that exceed 48 KB.
Verifies every output decodes at 1024x1024."""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TILES = os.path.join(HERE, "tiles")
REPO = os.path.dirname(os.path.dirname(HERE))  # scripts/r176-real-art → scripts → repo root
DEST = os.path.join(REPO, "frontend", "public", "products")
assert os.path.isdir(DEST), f"deploy target missing: {DEST}"

BUDGET = 48 * 1024


def encode(slug):
    src = os.path.join(TILES, f"{slug}.png")
    im = Image.open(src).convert("RGB")
    assert im.size == (1024, 1024), f"{slug}: {im.size}"
    out = os.path.join(DEST, f"{slug}.webp")
    q = 82
    im.save(out, "WEBP", quality=q, method=6)
    if os.path.getsize(out) > BUDGET:
        q = 74
        im.save(out, "WEBP", quality=q, method=6)
    # verify decode
    check = Image.open(out)
    check.load()
    assert check.size == (1024, 1024), f"{slug}: decoded {check.size}"
    return os.path.getsize(out), q


def main():
    slugs = sorted(f[:-4] for f in os.listdir(TILES) if f.endswith(".png"))
    total = 0
    heavy = 0
    for s in slugs:
        size, q = encode(s)
        total += size
        if q != 82:
            heavy += 1
            print(f"  {s}: adaptive q{q} ({size // 1024} KB)")
    print(
        f"\n{len(slugs)} tiles encoded → {DEST}\n"
        f"total {total / 1024:.0f} KB | avg {total / len(slugs) / 1024:.1f} KB | "
        f"max {max(os.path.getsize(os.path.join(DEST, s + '.webp')) for s in slugs) // 1024} KB | "
        f"adaptive-reduced: {heavy}"
    )


if __name__ == "__main__":
    main()
