#!/usr/bin/env python3
"""
Build the app icons from assets/Logo.png.

The source is a 1024px square; macOS icons are a rounded tile with a transparent
margin, so the logo is placed on the standard 824px body inside a 1024px canvas.
Run after changing the logo:

    npm run icons
"""
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "Logo.png"
OUT = ROOT / "resources"
SIZE = 1024
BODY = 824
RADIUS = 185
SUPERSAMPLE = 4

OUT.mkdir(exist_ok=True)

source = Image.open(SOURCE).convert("RGB")
body = source.resize((BODY, BODY), Image.Resampling.LANCZOS).convert("RGBA")

# Draw the rounded mask at 4x and downsample, otherwise the corners alias badly.
mask = Image.new("L", (BODY * SUPERSAMPLE, BODY * SUPERSAMPLE), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    (0, 0, BODY * SUPERSAMPLE - 1, BODY * SUPERSAMPLE - 1),
    radius=RADIUS * SUPERSAMPLE,
    fill=255,
)
body.putalpha(mask.resize((BODY, BODY), Image.Resampling.LANCZOS))

canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
canvas.alpha_composite(body, ((SIZE - BODY) // 2, (SIZE - BODY) // 2))

canvas.save(OUT / "icon.png")

canvas.save(
    OUT / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

iconset = OUT / "icon.iconset"
iconset.mkdir(exist_ok=True)
for size in (16, 32, 128, 256, 512):
    canvas.resize((size, size), Image.Resampling.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
    canvas.resize((size * 2, size * 2), Image.Resampling.LANCZOS).save(
        iconset / f"icon_{size}x{size}@2x.png"
    )

subprocess.run(
    ["iconutil", "-c", "icns", str(iconset), "-o", str(OUT / "icon.icns")], check=True
)
for file in iconset.iterdir():
    file.unlink()
iconset.rmdir()

for name in ("icon.png", "icon.icns", "icon.ico"):
    path = OUT / name
    print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")
