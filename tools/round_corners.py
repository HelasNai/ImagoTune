"""把方形满幅源图处理为 squircle（连续曲率圆角）512 图标源图 ImagoTune.png。

倒角算法为 figma-squircle（MIT，phamfoo/figma-squircle）的精确移植——iOS 图标
连续曲率圆角的公认拟合：每个角由「三次贝塞尔 + 真圆弧 + 三次贝塞尔」三段构成，
相对命令与上游逐字一致。参数 cornerRadius=27%、cornerSmoothing=0.6（比 iOS 图标
标准的 22.37% 更圆一档），8x 超采样 + BOX 平均抗锯齿。

输出 512x512 后运行 tools/create_icon.py 生成多尺寸 ImagoTune.ico。仅依赖 Pillow。

用法:
    python tools/round_corners.py <方形的源图.png>
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PNG_PATH = ROOT / "ImagoTune.png"
SIZE = 512
CORNER_RATIO = 0.27  # cornerRadius / size（iOS 图标标准 0.2237，此处更圆一档）
CORNER_SMOOTHING = 0.6  # iOS 连续曲率的常见平滑度
SUPERSAMPLE = 8
SEG_STEPS = 96  # 每段曲线的采样点数


def cubic_points(p0, p1, p2, p3, steps=SEG_STEPS):
    """三次贝塞尔采样（含首尾点）。"""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1.0 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def arc_points_through(p, q, radius, inner_bias, steps=SEG_STEPS):
    """figma-squircle 角部圆弧段（SVG 小弧，半径固定）采样。

    求过 p、q 且半径为 radius 的圆心，取靠近形状中心（inner_bias）的一侧，
    沿短弧采样；返回不含 p、含 q 的点列。
    """
    mx, my = (p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0
    dx, dy = q[0] - p[0], q[1] - p[1]
    dist = math.hypot(dx, dy)
    assert dist <= 2 * radius + 1e-9, (dist, radius)
    h = math.sqrt(max(0.0, radius * radius - (dist / 2) ** 2))
    ux, uy = dx / dist, dy / dist
    nx, ny = -uy, ux
    c1 = (mx + nx * h, my + ny * h)
    c2 = (mx - nx * h, my - ny * h)
    d1 = math.hypot(c1[0] - inner_bias[0], c1[1] - inner_bias[1])
    d2 = math.hypot(c2[0] - inner_bias[0], c2[1] - inner_bias[1])
    cx, cy = c1 if d1 <= d2 else c2
    a0 = math.atan2(p[1] - cy, p[0] - cx)
    a1 = math.atan2(q[1] - cy, q[0] - cx)
    dtheta = a1 - a0
    while dtheta > math.pi:
        dtheta -= 2 * math.pi
    while dtheta < -math.pi:
        dtheta += 2 * math.pi
    return [
        (cx + radius * math.cos(a0 + dtheta * i / steps), cy + radius * math.sin(a0 + dtheta * i / steps))
        for i in range(1, steps + 1)
    ]


def corner_params(corner_radius, corner_smoothing):
    """figma-squircle 的 getPathParamsForCorner（四角相同半径）。"""
    p = (1 + corner_smoothing) * corner_radius
    arc_measure = 90 * (1 - corner_smoothing)
    arc_section_length = math.sin(math.radians(arc_measure / 2)) * corner_radius * math.sqrt(2)
    angle_alpha = (90 - arc_measure) / 2
    p3p4 = corner_radius * math.tan(math.radians(angle_alpha / 2))
    angle_beta = 45 * corner_smoothing
    c = p3p4 * math.cos(math.radians(angle_beta))
    d = c * math.tan(math.radians(angle_beta))
    b = (p - arc_section_length - c - d) / 3
    a = 2 * b
    return dict(a=a, b=b, c=c, d=d, p=p, arc=arc_section_length, r=corner_radius)


def squircle_polygon(width, height, params):
    """figma-squircle 的 getSVGPathFromPathParams + 四角绘制（相对命令逐字移植）。"""
    a, b, c, d = params["a"], params["b"], params["c"], params["d"]
    p, arc, r = params["p"], params["arc"], params["r"]
    ctr = (width / 2, height / 2)
    pts = []
    cur = [width - p, 0.0]
    pts.append(tuple(cur))

    def rel(dx, dy):
        return (cur[0] + dx, cur[1] + dy)

    def cubic(dx1, dy1, dx2, dy2, dx, dy):
        p0 = tuple(cur)
        p1, p2, p3 = rel(dx1, dy1), rel(dx2, dy2), rel(dx, dy)
        pts.extend(cubic_points(p0, p1, p2, p3)[1:])
        cur[0], cur[1] = p3

    def arc_cmd(dx, dy):
        q = rel(dx, dy)
        pts.extend(arc_points_through(tuple(cur), q, r, ctr)[1:])
        cur[0], cur[1] = q

    def line(x, y):
        pts.append((x, y))
        cur[0], cur[1] = x, y

    # 右上角
    cubic(a, 0, a + b, 0, a + b + c, d)
    arc_cmd(arc, arc)
    cubic(d, c, d, b + c, d, a + b + c)
    line(width, height - p)
    # 右下角
    cubic(0, a, 0, a + b, -d, a + b + c)
    arc_cmd(-arc, arc)
    cubic(-c, d, -(b + c), d, -(a + b + c), d)
    line(p, height)
    # 左下角
    cubic(-a, 0, -(a + b), 0, -(a + b + c), -d)
    arc_cmd(-arc, -arc)
    cubic(-d, -c, -d, -(b + c), -d, -(a + b + c))
    line(0, p)
    # 左上角
    cubic(0, -a, 0, -(a + b), d, -(a + b + c))
    arc_cmd(arc, -arc)
    cubic(c, -d, b + c, -d, a + b + c, -d)
    return pts


def squircle_mask(size: int, ratio: float = CORNER_RATIO, smoothing: float = CORNER_SMOOTHING,
                  ss: int = SUPERSAMPLE) -> Image.Image:
    """抗锯齿 squircle 遮罩（L 模式，255=保留，0=透明）。"""
    polygon = squircle_polygon(1.0, 1.0, corner_params(ratio, smoothing))
    canvas = size * ss
    big = Image.new("L", (canvas, canvas), 0)
    ImageDraw.Draw(big).polygon([(x * canvas, y * canvas) for (x, y) in polygon], fill=255)
    return big.resize((size, size), Image.BOX)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("用法: python tools/round_corners.py <方形的源图.png>")
    src = Image.open(sys.argv[1]).convert("RGBA")
    if src.width != src.height:
        s = min(src.size)
        src = src.crop(
            ((src.width - s) // 2, (src.height - s) // 2,
             (src.width + s) // 2, (src.height + s) // 2)
        )

    frame = src.resize((SIZE, SIZE), Image.LANCZOS)
    mask = squircle_mask(SIZE)
    base_alpha = frame.getchannel("A")
    frame.putalpha(Image.composite(base_alpha, Image.new("L", (SIZE, SIZE), 0), mask))
    frame.save(PNG_PATH)
    print(f"saved: {PNG_PATH} ({SIZE}x{SIZE}, figma-squircle r={CORNER_RATIO} s={CORNER_SMOOTHING})")


if __name__ == "__main__":
    main()
