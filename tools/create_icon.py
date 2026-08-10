from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PNG_PATH = ROOT / "AI Image Studio.png"
ICO_PATH = ROOT / "AI Image Studio.ico"
ICON_SIZES = [
    (16, 16),
    (24, 24),
    (32, 32),
    (48, 48),
    (64, 64),
    (96, 96),
    (128, 128),
    (256, 256),
]


image = Image.open(PNG_PATH).convert("RGBA")
if image.width != image.height:
    raise ValueError("The application icon source must be square.")

image.save(ICO_PATH, "ICO", sizes=ICON_SIZES)
print(ICO_PATH)
