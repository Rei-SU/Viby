#!/usr/bin/env python3
"""
Build the app icons from assets/Logo.png.

The source is a 1024px square; macOS icons are a rounded tile with a transparent
margin, so the logo is placed on the standard 824px body inside a 1024px canvas.
Run after changing the logo:

    npm run icons
"""
from pathlib import Path
import shutil
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

# `iconutil` ships with macOS only. On Windows the PNG/ICO outputs are all that
# is needed; keep the existing .icns rather than failing the whole script.
if shutil.which("iconutil"):
    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(OUT / "icon.icns")], check=True
    )
else:
    print("iconutil not found - keeping the existing resources/icon.icns")
for file in iconset.iterdir():
    file.unlink()
iconset.rmdir()

for name in ("icon.png", "icon.icns", "icon.ico"):
    path = OUT / name
    print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")

# Tray icons: macOS wants a black template mask so it follows the menu bar;
# Windows wants a multi-size ICO because the notification area rescales it.
TRAY = OUT / "tray"
TRAY.mkdir(exist_ok=True)

alpha = source.convert("L").point(lambda value: 255 if value > 24 else 0)
alpha = alpha.crop(alpha.getbbox())
for scale in (1, 2):
    size = 16 * scale
    width = size - 2 * scale
    height = round(alpha.height * width / alpha.width)
    glyph = alpha.resize((width, height), Image.Resampling.LANCZOS)
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    black = Image.new("RGBA", glyph.size, (0, 0, 0, 255))
    black.putalpha(glyph)
    image.alpha_composite(black, ((size - width) // 2, (size - height) // 2))
    suffix = "@2x" if scale == 2 else ""
    image.save(TRAY / f"trayTemplate{suffix}.png")

canvas.save(
    TRAY / "tray-win.ico",
    format="ICO",
    sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48)],
)

for path in sorted(TRAY.iterdir()):
    print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.1f} KB")

# Windows taskbar thumbnail-toolbar icons. The shell draws these bitmaps as
# supplied, so each theme gets its own set: `dark` is for a dark taskbar (white
# glyphs), `light` for a light one (near-black glyphs). 32px keeps them sharp
# at 200% scaling and still downsamples cleanly to 16px.
THUMBAR = OUT / "thumbar"
GLYPH_GRID = 16
GLYPH_SUPERSAMPLE = 4
GLYPH_SIZE = 32


def thumbar_glyph(name: str, color: tuple[int, int, int, int]) -> Image.Image:
    unit = GLYPH_SIZE / GLYPH_GRID * GLYPH_SUPERSAMPLE
    canvas = Image.new("RGBA", (GLYPH_SIZE * GLYPH_SUPERSAMPLE,) * 2, (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    def point(x: float, y: float) -> tuple[float, float]:
        return (x * unit, y * unit)

    if name == "play":
        draw.polygon([point(5.2, 3.4), point(12.6, 8.0), point(5.2, 12.6)], fill=color)
    elif name == "pause":
        draw.rounded_rectangle(
            [*point(4.5, 3.4), *point(7.0, 12.6)], radius=0.7 * unit, fill=color
        )
        draw.rounded_rectangle(
            [*point(9.0, 3.4), *point(11.5, 12.6)], radius=0.7 * unit, fill=color
        )
    elif name == "previous":
        draw.rounded_rectangle(
            [*point(3.7, 3.6), *point(5.2, 12.4)], radius=0.35 * unit, fill=color
        )
        draw.polygon([point(12.4, 3.6), point(5.2, 8.0), point(12.4, 12.4)], fill=color)
    elif name == "next":
        draw.rounded_rectangle(
            [*point(10.8, 3.6), *point(12.3, 12.4)], radius=0.35 * unit, fill=color
        )
        draw.polygon([point(3.6, 3.6), point(10.8, 8.0), point(3.6, 12.4)], fill=color)
    return canvas.resize((GLYPH_SIZE, GLYPH_SIZE), Image.Resampling.LANCZOS)


for theme, color in (("dark", (242, 242, 245, 255)), ("light", (23, 23, 28, 255))):
    folder = THUMBAR / theme
    folder.mkdir(parents=True, exist_ok=True)
    for glyph in ("previous", "play", "pause", "next"):
        thumbar_glyph(glyph, color).save(folder / f"{glyph}.png")

for path in sorted(THUMBAR.rglob("*.png")):
    print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.1f} KB")
