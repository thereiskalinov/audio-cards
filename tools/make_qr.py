# -*- coding: utf-8 -*-
"""QR-код со ссылкой на приложение."""
import os
import qrcode
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = os.environ.get("APP_URL", "https://thereiskalinov.github.io/audio-cards/")
OUT = os.path.join(ROOT, "qr.png")

W, H = 900, 1120
BG = (255, 255, 255)
INK = (10, 15, 26)
MUTED = (110, 120, 140)


def font(name, size):
    for path in (os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name),):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


img = Image.new("RGB", (W, H), BG)
qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=2)
qr.add_data(URL)
qr.make(fit=True)
qr_img = qr.make_image(fill_color=INK, back_color=BG).convert("RGB")
qr_img = qr_img.resize((700, 700), Image.NEAREST)
img.paste(qr_img, ((W - 700) // 2, 70))

d = ImageDraw.Draw(img)
f_big = font("segoeuib.ttf", 46)
f_mid = font("segoeui.ttf", 30)
f_small = font("segoeui.ttf", 24)

text = "Наведите камеру iPhone"
w = d.textlength(text, font=f_big)
d.text(((W - w) / 2, 810), text, fill=INK, font=f_big)

text2 = "или откройте ссылку в Safari"
w2 = d.textlength(text2, font=f_mid)
d.text(((W - w2) / 2, 875), text2, fill=MUTED, font=f_mid)

text3 = URL.replace("https://", "")
w3 = d.textlength(text3, font=f_small)
d.text(((W - w3) / 2, 940), text3, fill=MUTED, font=f_small)

text4 = "Поделиться → На экран «Домой»"
w4 = d.textlength(text4, font=f_small)
d.text(((W - w4) / 2, 1000), text4, fill=(91, 140, 255), font=f_small)

img.save(OUT)
print("saved", OUT, img.size)
