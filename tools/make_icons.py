"""Generate the Valence Garage app icons programmatically.

Draws a deep oxblood radial gradient background, a large serif italic gold V
monogram centered, and a thin champagne ring inset near the edge. Produces
icon-512.png, icon-192.png, and apple-touch-icon.png (180x180).

Standard library plus Pillow only. No em dashes anywhere in this file.
Run once from the app/tools directory or by absolute path.
"""

import os
from PIL import Image, ImageDraw, ImageFont


# Palette (matches style.css tokens)
OXBLOOD_CENTER = (62, 18, 18)    # #3E1212
VOID_EDGE = (18, 5, 5)           # #120505
GOLD = (201, 168, 76)            # #C9A84C
CHAMPAGNE = (232, 213, 160)      # #E8D5A0

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\georgiai.ttf",  # Georgia Italic, preferred
    r"C:\Windows\Fonts\timesi.ttf",    # Times New Roman Italic
    r"C:\Windows\Fonts\times.ttf",     # Times New Roman
]

OUT_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def load_font(size):
    """Return a truetype font, trying serif italics before the bitmap default."""
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def radial_background(size):
    """Build a smooth oxblood radial-ish gradient, center to edge."""
    img = Image.new("RGB", (size, size), VOID_EDGE)
    px = img.load()
    cx = cy = (size - 1) / 2.0
    # Distance at which the gradient reaches the edge color. Slightly past the
    # corner so the very corners stay deep and dark.
    max_d = (size / 2.0) * 1.18
    for y in range(size):
        dy = y - cy
        for x in range(size):
            dx = x - cx
            d = (dx * dx + dy * dy) ** 0.5
            t = min(1.0, d / max_d)
            # Ease so the warm center holds longer before falling to void.
            t = t * t
            px[x, y] = lerp(OXBLOOD_CENTER, VOID_EDGE, t)
    return img


def draw_icon(size):
    img = radial_background(size)
    draw = ImageDraw.Draw(img, "RGBA")

    # Thin champagne ring inset near the edge.
    inset = int(round(size * 0.085))
    ring_w = max(1, int(round(size * 0.006)))
    draw.ellipse(
        [inset, inset, size - 1 - inset, size - 1 - inset],
        outline=CHAMPAGNE + (150,),
        width=ring_w,
    )
    # A fainter gold ring just inside it for depth.
    inset2 = inset + max(2, int(round(size * 0.02)))
    draw.ellipse(
        [inset2, inset2, size - 1 - inset2, size - 1 - inset2],
        outline=GOLD + (70,),
        width=max(1, int(round(size * 0.003))),
    )

    # Large serif italic gold V monogram, centered.
    font = load_font(int(round(size * 0.62)))
    letter = "V"
    try:
        box = draw.textbbox((0, 0), letter, font=font)
        tw = box[2] - box[0]
        th = box[3] - box[1]
        tx = (size - tw) / 2.0 - box[0]
        # Optical centering: nudge up a touch since serif caps sit low in box.
        ty = (size - th) / 2.0 - box[1] - size * 0.02
    except Exception:
        tw, th = draw.textsize(letter, font=font)
        tx = (size - tw) / 2.0
        ty = (size - th) / 2.0

    # Soft champagne shadow under the monogram for a struck-metal feel.
    off = max(1, int(round(size * 0.006)))
    draw.text((tx + off, ty + off), letter, font=font, fill=(20, 6, 6, 200))
    draw.text((tx, ty), letter, font=font, fill=GOLD + (255,))

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    targets = [
        (512, "icon-512.png"),
        (192, "icon-192.png"),
        (180, "apple-touch-icon.png"),
    ]
    # Render once at high resolution, downscale for crisp small icons.
    master = draw_icon(512)
    for size, name in targets:
        if size == 512:
            out = master
        else:
            out = draw_icon(size) if size >= 192 else master.resize(
                (size, size), Image.LANCZOS
            )
            # Prefer supersampled downscale from the 512 master for smoothness.
            out = master.resize((size, size), Image.LANCZOS)
        path = os.path.join(OUT_DIR, name)
        out.save(path, "PNG")
        print("wrote", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()
