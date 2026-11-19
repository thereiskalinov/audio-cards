# -*- coding: utf-8 -*-
"""Генерирует иконки приложения."""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "icons")
os.makedirs(OUT, exist_ok=True)

ACCENT = (91, 140, 255)
BG_TOP = (18, 27, 46)
BG_BOTTOM = (9, 13, 23)
WHITE = (255, 255, 255)


def gradient(size):
    img = Image.new("RGB", (size, size), BG_BOTTOM)
    px = img.load()
    for y in range(size):
        k = y / max(1, size - 1)
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * k)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * k)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * k)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img


def draw_icon(size, safe=1.0):
    S = size * 4
    img = gradient(S)
    d = ImageDraw.Draw(img, "RGBA")
    cx, cy = S / 2, S / 2
    scale = S * 0.5 * safe
    d.ellipse([cx - scale * 0.62, cy - scale * 0.62, cx + scale * 0.62, cy + scale * 0.62],
              fill=(91, 140, 255, 38))
    r = scale * 0.40
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT)
    d.ellipse([cx - r, cy - r, cx + r * 0.15, cy + r * 0.15], fill=(255, 255, 255, 18))
    tr = r * 0.52
    pts = [
        (cx - tr * 0.62, cy - tr * 0.95),
        (cx - tr * 0.62, cy + tr * 0.95),
        (cx + tr * 1.05, cy),
    ]
    d.polygon(pts, fill=WHITE)
    for i, k in enumerate((0.58, 0.72, 0.86)):
        rr = scale * k
        bbox = [cx - rr, cy - rr, cx + rr, cy + rr]
        color = (124, 164, 255, 220 - i * 55)
        d.arc(bbox, start=-42, end=42, fill=color, width=max(2, int(S * 0.012)))
    return img.resize((size, size), Image.LANCZOS)


def main():
    sizes = {
        "icon-512.png": (512, 1.0),
        "icon-192.png": (192, 1.0),
        "apple-touch-icon.png": (180, 1.0),
        "icon-maskable-512.png": (512, 0.78),
        "icon-1024.png": (1024, 1.0),
    }
    for name, (size, safe) in sizes.items():
        draw_icon(size, safe).save(os.path.join(OUT, name))
        print("saved", name)


if __name__ == "__main__":
    main()
