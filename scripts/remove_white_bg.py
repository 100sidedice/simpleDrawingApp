#!/usr/bin/env python3
"""Remove near-white background from an image and save with alpha.

Usage: python remove_white_bg.py input.png output.png [base_hex]
Example: python remove_white_bg.py icons.png icons_alpha.png #220236
"""
import sys
from PIL import Image


def hex_to_rgb(hexstr):
    hexstr = hexstr.lstrip('#')
    return tuple(int(hexstr[i:i+2], 16) for i in (0, 2, 4))


def remove_white_bg(src_path, dst_path, base_hex="#222222"):
    """Replace anti-aliased white background by mapping pixels onto a gradient
    from transparent to the base color. For each pixel compute t = 1 - (avg/255)
    where avg = (r+g+b)/3, and output base_color with alpha = round(t*255).
    This avoids white-fringe by converting blended pixels into the base color
    with proportional alpha.
    """
    base_rgb = hex_to_rgb(base_hex)
    im = Image.open(src_path).convert('RGBA')
    w, h = im.size
    src = im.load()
    out = Image.new('RGBA', (w, h))
    out_px = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            # compute average intensity (0..255)
            avg = (r + g + b) / 3.0
            t = (255.0 - avg) / 255.0
            if t <= 0:
                # fully transparent
                out_px[x, y] = (0, 0, 0, 0)
            else:
                alpha = int(round(max(0.0, min(1.0, t)) * 255.0))
                out_px[x, y] = (base_rgb[0], base_rgb[1], base_rgb[2], alpha)
    out.save(dst_path)


def main():
    if len(sys.argv) < 3:
        print('Usage: remove_white_bg.py input.png output.png [base_hex]')
        sys.exit(1)
    src = sys.argv[1]
    dst = sys.argv[2]
    base_hex = sys.argv[3] if len(sys.argv) >= 4 else "#252525"
    remove_white_bg(src, dst, base_hex)


if __name__ == '__main__':
    main()
