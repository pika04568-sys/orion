#!/usr/bin/env python3
"""Generate the Orion Windows app icon from simple vector geometry.

This keeps the logo reproducible without depending on external image tooling.
The script writes a multi-size PNG-compressed ICO that Windows and Electron
can use for the app window and packaged build.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "assets" / "orion.ico"

SIZES = [16, 24, 32, 48, 64, 128, 256]


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if v < lo else hi if v > hi else v


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge0 == edge1:
        return 1.0 if x <= edge1 else 0.0
    t = clamp((x - edge0) / (edge1 - edge0))
    return t * t * (3.0 - 2.0 * t)


def mix(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def blend(dst: tuple[float, float, float], src: tuple[float, float, float, float]) -> tuple[float, float, float]:
    sr, sg, sb, sa = src
    if sa <= 0.0:
        return dst
    dr, dg, db = dst
    sa = clamp(sa)
    inv = 1.0 - sa
    return (
        sr * sa + dr * inv,
        sg * sa + dg * inv,
        sb * sa + db * inv,
    )


def angle_deg(x: float, y: float) -> float:
    return math.degrees(math.atan2(y, x)) % 360.0


def in_arc(theta: float, start: float, end: float) -> bool:
    theta %= 360.0
    start %= 360.0
    end %= 360.0
    if start <= end:
        return start <= theta <= end
    return theta >= start or theta <= end


def endpoint_position(cx: float, cy: float, radius: float, deg: float) -> tuple[float, float]:
    rad = math.radians(deg)
    return cx + math.cos(rad) * radius, cy + math.sin(rad) * radius


def stroke_alpha(
    x: float,
    y: float,
    cx: float,
    cy: float,
    radius: float,
    width: float,
    start: float,
    end: float,
    soft: float,
) -> float:
    dx = x - cx
    dy = y - cy
    dist = math.hypot(dx, dy)
    theta = angle_deg(dx, dy)
    half = width * 0.5
    if in_arc(theta, start, end):
        return 1.0 - smoothstep(half - soft, half + soft, abs(dist - radius))
    sx, sy = endpoint_position(cx, cy, radius, start)
    ex, ey = endpoint_position(cx, cy, radius, end)
    ds = math.hypot(x - sx, y - sy)
    de = math.hypot(x - ex, y - ey)
    cap = 1.0 - min(
        smoothstep(half - soft, half + soft, ds),
        smoothstep(half - soft, half + soft, de),
    )
    return cap if cap > 0.0 else 0.0


def circle_alpha(x: float, y: float, cx: float, cy: float, radius: float, soft: float) -> float:
    return 1.0 - smoothstep(radius - soft, radius + soft, math.hypot(x - cx, y - cy))


def render(size: int) -> bytes:
    w = h = size
    cx = cy = (size - 1) * 0.5

    # Reference art is a 1024px square. These values are scaled from that grid.
    def s(v: float) -> float:
        return v * size / 1024.0

    bg_inner = (9.0, 35.0, 74.0)
    bg_outer = (5.0, 20.0, 46.0)
    white = (252.0, 252.0, 252.0)
    cyan = (90.0, 243.0, 245.0)
    pale_cyan = (226.0, 250.0, 255.0)
    sparkle = (160.0, 174.0, 193.0)

    white_radius = s(370.0)
    white_width = max(s(84.0), 2.1)
    white_start = 84.0
    white_end = 276.0

    cyan_radius = s(333.0)
    cyan_width = max(s(20.0), 1.15)
    cyan_start = 304.0
    cyan_end = 56.0

    node_radius = max(s(30.0), 1.75)
    node_soft = max(s(10.0), 0.9)
    glow_radius = max(s(52.0), 2.6)
    glow_soft = max(s(16.0), 1.3)

    star_x = s(962.0)
    star_y = s(964.0)
    star_size = max(s(34.0), 1.0)

    pixels = bytearray(w * h * 4)
    i = 0
    for y in range(h):
        for x in range(w):
            dx = (x - cx) / (size * 0.5)
            dy = (y - cy) / (size * 0.5)
            radial = min(1.0, math.hypot(dx, dy) / 1.02)
            bg_t = 1.0 - radial
            bg_t = bg_t * bg_t
            br = mix(bg_outer[0], bg_inner[0], bg_t)
            bg = (
                br,
                mix(bg_outer[1], bg_inner[1], bg_t),
                mix(bg_outer[2], bg_inner[2], bg_t),
            )

            # White C-shaped arc.
            white_a = stroke_alpha(x, y, cx, cy, white_radius, white_width, white_start, white_end, max(s(3.0), 0.35))
            if white_a > 0.0:
                bg = blend(bg, (white[0], white[1], white[2], white_a))

            # Cyan arc glow.
            glow_a = stroke_alpha(x, y, cx, cy, cyan_radius, cyan_width + glow_radius, cyan_start, cyan_end, glow_soft) * 0.12
            if glow_a > 0.0:
                bg = blend(bg, (82.0, 247.0, 255.0, glow_a))

            # Cyan arc core.
            arc_a = stroke_alpha(x, y, cx, cy, cyan_radius, cyan_width, cyan_start, cyan_end, max(s(2.0), 0.25))
            if arc_a > 0.0:
                bg = blend(bg, (cyan[0], cyan[1], cyan[2], arc_a))

            # Arc nodes with a soft halo and a bright center.
            for deg in (48.0, 0.0, 312.0):
                nx, ny = endpoint_position(cx, cy, cyan_radius, deg)
                halo = circle_alpha(x, y, nx, ny, glow_radius, glow_soft) * 0.28
                if halo > 0.0:
                    bg = blend(bg, (160.0, 255.0, 255.0, halo))
                node = circle_alpha(x, y, nx, ny, node_radius, node_soft)
                if node > 0.0:
                    bg = blend(bg, (pale_cyan[0], pale_cyan[1], pale_cyan[2], node))

            # Small sparkle in the lower-right corner.
            sx = x - star_x
            sy = y - star_y
            local = math.hypot(sx, sy)
            if local <= star_size * 1.35:
                d1 = abs(sx + sy) / math.sqrt(2.0)
                d2 = abs(sx - sy) / math.sqrt(2.0)
                arm = max(
                    1.0 - smoothstep(star_size * 0.08, star_size * 0.26, d1),
                    1.0 - smoothstep(star_size * 0.08, star_size * 0.26, d2),
                )
                core = 1.0 - smoothstep(star_size * 0.18, star_size * 0.72, local)
                star = arm * core * 0.55
            else:
                star = 0.0
            if star > 0.0:
                bg = blend(bg, (sparkle[0], sparkle[1], sparkle[2], star))

            pixels[i] = int(bg[0] + 0.5)
            pixels[i + 1] = int(bg[1] + 0.5)
            pixels[i + 2] = int(bg[2] + 0.5)
            pixels[i + 3] = 255
            i += 4
    return bytes(pixels)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def encode_png(width: int, height: int, rgba: bytes) -> bytes:
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride : (y + 1) * stride])
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
            png_chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            png_chunk(b"IEND", b""),
        ]
    )


def encode_ico(images: list[tuple[int, bytes]]) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = []
    payload = []
    for size, png_data in images:
        width_byte = size if size < 256 else 0
        height_byte = size if size < 256 else 0
        entries.append(
            struct.pack(
                "<BBBBHHII",
                width_byte,
                height_byte,
                0,
                0,
                1,
                32,
                len(png_data),
                offset,
            )
        )
        payload.append(png_data)
        offset += len(png_data)
    return header + b"".join(entries) + b"".join(payload)


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    images: list[tuple[int, bytes]] = []
    for size in SIZES:
        rgba = render(size)
        images.append((size, encode_png(size, size, rgba)))
    OUT_PATH.write_bytes(encode_ico(images))
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
