"""Bakes the refraction map for one glass element.

Same rounded-rect SDF and circular arc as the AGSL shaders in
Kyant0/AndroidLiquidGlass (Apache-2.0) and styropyr0/PrismalAGSL (MIT):
R/G carry the displacement vector around 0.5, so feDisplacementMap with
scale = 2 * amount reproduces the shader's inward compression band.

    python tools/gen-glass-map.py 352 58 29 14 10 .tmp/island-map.b64

Arguments: width height radius band amount [outfile]
"""
import base64
import math
import sys

from PIL import Image


def sd_round_rect(px, py, hx, hy, r):
    qx = abs(px) - hx + r
    qy = abs(py) - hy + r
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0)) - r
    inside = min(max(qx, qy), 0.0)
    return outside + inside


def grad(px, py, hx, hy, r):
    qx = abs(px) - hx + r
    qy = abs(py) - hy + r
    if qx >= 0.0 or qy >= 0.0:
        nx, ny = max(qx, 0.0), max(qy, 0.0)
        length = math.hypot(nx, ny) or 1.0
        gx, gy = nx / length, ny / length
    else:
        gx, gy = (1.0, 0.0) if qx >= qy else (0.0, 1.0)
    return (math.copysign(gx, px) if px else 0.0,
            math.copysign(gy, py) if py else 0.0)


def build(w, h, radius, band, amount):
    hx, hy = w / 2.0, h / 2.0
    image = Image.new("RGBA", (w, h), (128, 128, 128, 255))
    pixels = image.load()
    for y in range(h):
        for x in range(w):
            cx, cy = x + 0.5 - hx, y + 0.5 - hy
            sd = sd_round_rect(cx, cy, hx, hy, radius)
            if -sd >= band:            # flat interior: sampling passes straight through
                continue
            t = max(0.0, min(1.0, 1.0 + sd / band))
            lift = 1.0 - math.sqrt(max(0.0, 1.0 - t * t))
            d = lift * amount
            gx, gy = grad(cx, cy, hx, hy, radius)
            # inward, along the SDF gradient — the inverted sampling that reads as glass
            vx, vy = -gx * d, -gy * d
            pixels[x, y] = (
                max(0, min(255, int(round(255 * (0.5 + vx / (2 * amount)))))),
                max(0, min(255, int(round(255 * (0.5 + vy / (2 * amount)))))),
                128,
                255,
            )
    return image


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 5:
        raise SystemExit(__doc__)
    w, h, radius, band, amount = (float(a) for a in args[:5])
    out = args[5] if len(args) > 5 else "island-map.b64"
    image = build(int(w), int(h), radius, band, amount)
    from io import BytesIO
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    with open(out, "w", encoding="utf-8") as handle:
        handle.write(base64.b64encode(buffer.getvalue()).decode())
    print(f"{out}: {int(w)}x{int(h)} radius={radius} band={band} amount={amount} -> {len(buffer.getvalue())} bytes")
