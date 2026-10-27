#!/usr/bin/env python3
"""
Build the app icons from assets/Logo.png.

Platform rules this follows:
- macOS (Big Sur and later): a 1024 canvas with an 824px rounded body and
  transparent margin; the artwork inside should fill most of the body. The
  .icns is written with Pillow, so this runs on Windows too.
- Windows: the ICO carries 16/20/24/32/40/48/64/128/256 and the art fills the
  canvas (no macOS margin), otherwise the taskbar button looks smaller than
  every other app.
- Menu bar / notification area: platform-native sizes (16 and 32 for the macOS
  template, multi-size ICO for the Windows tray).

Run after changing the logo:

    npm run icons
"""
from pathlib import Path
import io
import struct

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "Logo.png"
OUT = ROOT / "resources"
SIZE = 1024
BODY = 824
RADIUS = 185
SUPERSAMPLE = 4

# The source is a white V on black with generous breathing room. Scaling the
# mark to ~74% of the macOS body keeps the platform's padding while making the
# logo read at Dock size; Windows has no such padding, so it gets more.
MAC_MARK = 0.74
WIN_INSET = 24
WIN_MARK = 0.72

OUT.mkdir(exist_ok=True)
source = Image.open(SOURCE).convert("RGB")
background = source.getpixel((0, 0))

# Pull the white mark out of the black background once.
mask = source.convert("L").point(lambda value: 255 if value > 24 else 0)
bbox = mask.getbbox()
if bbox is None:
    raise SystemExit("assets/Logo.png has no visible mark")
mark = mask.crop(bbox)


def mark_image(width: int) -> Image.Image:
    height = round(mark.height * width / mark.width)
    alpha = mark.resize((width, height), Image.Resampling.LANCZOS)
    image = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    image.putalpha(alpha)
    return image


def rounded_tile(body: int, radius: int, mark_ratio: float) -> Image.Image:
    """A rounded, filled tile centred on a 1024 canvas, mark scaled inside."""
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    tile = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mask_big = Image.new("L", (SIZE * SUPERSAMPLE, SIZE * SUPERSAMPLE), 0)
    ImageDraw.Draw(mask_big).rounded_rectangle(
        ((SIZE - body) // 2 * SUPERSAMPLE, (SIZE - body) // 2 * SUPERSAMPLE,
         (SIZE + body) // 2 * SUPERSAMPLE, (SIZE + body) // 2 * SUPERSAMPLE),
        radius=radius * SUPERSAMPLE,
        fill=255,
    )
    tile.paste(Image.new("RGBA", (SIZE, SIZE), (*background, 255)), (0, 0),
               mask_big.resize((SIZE, SIZE), Image.Resampling.LANCZOS))

    glyph = mark_image(round(body * mark_ratio))
    tile.alpha_composite(
        glyph,
        ((SIZE - glyph.width) // 2, (SIZE - glyph.height) // 2),
    )
    canvas.alpha_composite(tile)
    return canvas


def write_icns(path: Path, image: Image.Image) -> None:
    """Write a complete ICNS (base and @2x sizes) without macOS-only tools."""
    # Pixmap types macOS expects; Pillow's writer omits the 16/32 base sizes.
    chunks = [
        ("icp4", 16),
        ("icp5", 32),
        ("icp6", 64),
        ("ic07", 128),
        ("ic08", 256),
        ("ic09", 512),
        ("ic10", 1024),
        ("ic11", 32),
        ("ic12", 64),
        ("ic13", 256),
        ("ic14", 512),
    ]

    payloads = []
    for key, size in chunks:
        buffer = io.BytesIO()
        image.resize((size, size), Image.Resampling.LANCZOS).save(buffer, format="PNG")
        payloads.append((key, buffer.getvalue()))

    toc = b"TOC " + struct.pack(">I", 8 + 8 * len(payloads))
    for key, payload in payloads:
        toc += key.encode("ascii") + struct.pack(">I", 8 + len(payload))

    body = toc + b"".join(
        key.encode("ascii") + struct.pack(">I", 8 + len(payload)) + payload
        for key, payload in payloads
    )
    path.write_bytes(b"icns" + struct.pack(">I", 8 + len(body)) + body)


# macOS: the standard 824px body on a 1024px canvas.
mac = rounded_tile(BODY, RADIUS, MAC_MARK)
mac.save(OUT / "icon.png")
write_icns(OUT / "icon.icns", mac)

# Windows: art fills the canvas; the taskbar and jump lists use this.
win_body = SIZE - WIN_INSET * 2
win = rounded_tile(win_body, round(RADIUS * win_body / BODY), WIN_MARK)
win.save(OUT / "icon-win.png")
win.save(
    OUT / "icon.ico",
    format="ICO",
    sizes=[
        (16, 16),
        (20, 20),
        (24, 24),
        (32, 32),
        (40, 40),
        (48, 48),
        (64, 64),
        (128, 128),
        (256, 256),
    ],
)

for name in ("icon.png", "icon-win.png", "icon.icns", "icon.ico"):
    path = OUT / name
    print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")

# Tray icons: macOS wants a black template mask so it follows the menu bar;
# Windows wants a multi-size ICO because the notification area rescales it.
TRAY = OUT / "tray"
TRAY.mkdir(exist_ok=True)

for scale in (1, 2):
    size = 16 * scale
    width = size - scale
    height = round(mark.height * width / mark.width)
    glyph = mark.resize((width, height), Image.Resampling.LANCZOS)
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    black = Image.new("RGBA", glyph.size, (0, 0, 0, 255))
    black.putalpha(glyph)
    image.alpha_composite(black, ((size - width) // 2, (size - height) // 2))
    suffix = "@2x" if scale == 2 else ""
    image.save(TRAY / f"trayTemplate{suffix}.png")

# Windows draws tray icons as supplied, so use the full-bleed tile rather than
# the macOS-margin artwork; that was what made the mark look tiny there.
win.save(
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
