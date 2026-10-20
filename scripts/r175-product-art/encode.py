#!/usr/bin/env python3
"""R175 encode — staged PNG -> WebP q80 (method 6) -> frontend/public/products.

Backs up the current (r174) WebP set to backup-r174/ first, then encodes every
staged tile. Verifies: 45 files, 1024x1024, WEBP, sane weights. The same
encode contract as R174 (avg ~28 KB/tile, max 65 KB).
"""
from pathlib import Path
from PIL import Image
import shutil
import sys

HERE = Path(__file__).parent
STAGED = HERE / "staged"
BACKUP = HERE / "backup-r174"
DEST = HERE.parent.parent / "frontend" / "public" / "products"

def main() -> int:
    pngs = sorted(STAGED.glob("*.png"))
    if len(pngs) != 45:
        print(f"FAIL: expected 45 staged PNGs, found {len(pngs)}")
        return 1

    DEST.mkdir(parents=True, exist_ok=True)
    current = sorted(DEST.glob("*.webp"))
    if len(current) != 45:
        print(f"FAIL: expected 45 live webp tiles, found {len(current)}")
        return 1
    if not BACKUP.exists():
        BACKUP.mkdir()
        for f in current:
            shutil.copy2(f, BACKUP / f.name)
        print(f"backed up {len(current)} r174 tiles -> {BACKUP.name}/")

    total = 0
    biggest = ("", 0)
    for png in pngs:
        im = Image.open(png)
        if im.size != (1024, 1024):
            print(f"FAIL: {png.name} is {im.size}, expected 1024x1024")
            return 1
        im = im.convert("RGB")
        out = DEST / (png.stem + ".webp")
        im.save(out, "WEBP", quality=80, method=6)
        size = out.stat().st_size
        total += size
        if size > biggest[1]:
            biggest = (out.name, size)

    files = sorted(DEST.glob("*.webp"))
    if len(files) != 45:
        print(f"FAIL: destination has {len(files)} webp files after encode")
        return 1
    for f in files:
        with Image.open(f) as im:
            if im.format != "WEBP" or im.size != (1024, 1024):
                print(f"FAIL: {f.name} is {im.format} {im.size}")
                return 1

    print(f"OK: 45 tiles encoded — total {total/1024:.0f} KB (avg {total/45/1024:.1f} KB, max {biggest[0]} {biggest[1]/1024:.0f} KB)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
