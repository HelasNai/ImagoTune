from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math

ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024

def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
pix = img.load()
for y in range(SIZE):
    for x in range(SIZE):
        t = (x + y) / (SIZE * 2)
        color = lerp((71, 56, 168), (21, 166, 191), t)
        pix[x, y] = (*color, 255)

mask = Image.new("L", (SIZE, SIZE), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle((18, 18, SIZE - 18, SIZE - 18), radius=210, fill=255)
img.putalpha(mask)

glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((260, 270, 764, 774), fill=(255, 255, 255, 64))
glow = glow.filter(ImageFilter.GaussianBlur(54))
img.alpha_composite(glow)

d = ImageDraw.Draw(img)
cx, cy = 512, 512
outer = [(cx + math.cos(a) * 270, cy + math.sin(a) * 270) for a in [i * math.pi / 4 - math.pi / 2 for i in range(8)]]
inner = [(cx + math.cos(a) * 92, cy + math.sin(a) * 92) for a in [i * math.pi / 4 - math.pi / 2 for i in range(8)]]
star = []
for i in range(16):
    star.append(outer[i // 2] if i % 2 == 0 else inner[i // 2])
d.polygon(star, fill=(255, 255, 255, 242))
d.ellipse((414, 414, 610, 610), fill=(255, 255, 255, 255))
d.ellipse((454, 454, 570, 570), fill=(103, 85, 210, 255))
d.rounded_rectangle((704, 202, 808, 306), radius=26, fill=(255, 214, 125, 255))
d.ellipse((730, 228, 782, 280), fill=(255, 244, 207, 255))

png_path = ROOT / "AI Image Studio.png"
ico_path = ROOT / "AI Image Studio.ico"
img.save(png_path, "PNG")
img.save(ico_path, "ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print(png_path)
print(ico_path)
