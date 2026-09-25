"""把 ImagoTune.ico 的最大帧内容倒圆角，输出为正方形源图 ImagoTune.png。

圆角半径按短边比例计算（默认 18.75%），先用 4x 超采样做遮罩再缩小，
保证小尺寸（16/24px）下圆角边缘依然平滑。
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICO_PATH = ROOT / "ImagoTune.ico"
PNG_PATH = ROOT / "ImagoTune.png"
CORNER_RATIO = 0.1875  # 256px 下约 48px 半径
SS = 4  # 超采样倍数


def rounded_mask(size: int, radius: int) -> Image.Image:
    """生成带抗锯齿的圆角矩形遮罩（L 模式，255=保留）。"""
    big = size * SS
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius * SS, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def main() -> None:
    ico = Image.open(ICO_PATH)
    # 取 ICO 中最大的帧作为源图
    size = max(ico.info.get("sizes", [(ico.width, ico.height)]), key=lambda s: s[0] * s[1])
    frame = ico.ico.getimage(size).convert("RGBA")
    if frame.width != frame.height:
        s = min(frame.size)
        frame = frame.crop(
            ((frame.width - s) // 2, (frame.height - s) // 2,
             (frame.width + s) // 2, (frame.height + s) // 2)
        )
    # 统一缩放到 512x512，保证各尺寸一致性
    frame = frame.resize((512, 512), Image.LANCZOS)

    radius = int(512 * CORNER_RATIO)
    mask = rounded_mask(512, radius)
    frame.putalpha(Image.composite(frame.getchannel("A"), Image.new("L", (512, 512), 0), mask))

    frame.save(PNG_PATH)
    print(f"saved: {PNG_PATH} (radius={radius}px)")


if __name__ == "__main__":
    main()
