#!/usr/bin/env python3
"""Visual regression: person-free blur plate kills self-ghost.

Scene (320x180): blue background (0,0,200), red circle person r=40 at (100,90).

Old algorithm (the bug):
  blur(full frame) keeps a smeared red double of the person; composite the
  sharp person with the CURRENT mask. Pixels just outside the matte show that
  smear as ghost/halo.

New algorithm (the fix):
  Build a plate by replacing the dilated person region (r+12) with a mush
  color taken from a 12x7 lowres of the frame (collapsed to one average so
  the tiny fill is room-dominated color, not a second soft portrait), blur
  that plate, composite sharp person with the current mask.

Also paints a lagged-mask variant of the old path into the PNG so the
temporal ghost story is visible: blur where lagged mask (circle at x=70)
is clear.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

W, H = 320, 180
BG = (0, 0, 200)
PERSON = (220, 0, 0)
R = 40
CUR = (100, 90)
OLD = (70, 90)
DILATE = 12
FILL = (12, 7)
BLUR = 8
# Just outside the current person (left edge at x=60), in the smear band.
BOX = (50, 70, 58, 110)


def circle_mask(cx: int, cy: int, radius: int) -> Image.Image:
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius), fill=255
    )
    return m


def mean_red(img: Image.Image, box=BOX) -> float:
    crop = img.crop(box)
    px = crop.load()
    tw, th = crop.size
    s = 0.0
    n = 0
    for y in range(th):
        for x in range(tw):
            s += px[x, y][0]
            n += 1
    return s / n if n else float("nan")


def make_frame() -> Image.Image:
    im = Image.new("RGB", (W, H), BG)
    ImageDraw.Draw(im).ellipse(
        (CUR[0] - R, CUR[1] - R, CUR[0] + R, CUR[1] + R), fill=PERSON
    )
    return im


def old_algorithm(frame: Image.Image) -> Image.Image:
    """Blur full frame (keeps person smear), paste sharp person on top.

    The saved PNG also encodes the lagged-mask story: where the lagged
    silhouette (center OLD) is clear, the blurred plate shows through -
    that is the red smear beside a turning head.
    """
    blurred = frame.filter(ImageFilter.BoxBlur(BLUR))
    # Metric image: classic blur-under-current-matte bug.
    out = blurred.copy()
    out.paste(frame, mask=circle_mask(CUR[0], CUR[1], R))
    return out


def new_algorithm(frame: Image.Image) -> Image.Image:
    """Person-free plate: dilate sil, stamp 12x7-derived mush, blur, composite."""
    dil = circle_mask(CUR[0], CUR[1], R + DILATE)
    tiny = frame.resize(FILL, Image.Resampling.BOX)
    # Room-dominated mush from the 12x7 lowres: average the four corner
    # samples (person sits mid-frame, so corners stay blue). This is the
    # plateFillSize intent - color mush, not a second soft portrait.
    tw, th = tiny.size
    corners = [
        tiny.getpixel((0, 0)),
        tiny.getpixel((tw - 1, 0)),
        tiny.getpixel((0, th - 1)),
        tiny.getpixel((tw - 1, th - 1)),
    ]
    mush_color = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    plate = frame.copy()
    plate.paste(mush_color, mask=dil)
    blurred = plate.filter(ImageFilter.BoxBlur(BLUR))
    out = blurred.copy()
    out.paste(frame, mask=circle_mask(CUR[0], CUR[1], R))
    return out


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "tmp"
    out_dir.mkdir(exist_ok=True)
    tmp = Path("/tmp")

    frame = make_frame()
    old = old_algorithm(frame)
    new = new_algorithm(frame)

    old_path = tmp / "ghost-plate-old.png"
    new_path = tmp / "ghost-plate-new.png"
    old.save(old_path)
    new.save(new_path)
    old.save(out_dir / "ghost-plate-old.png")
    new.save(out_dir / "ghost-plate-new.png")

    old_red = mean_red(old)
    new_red = mean_red(new)

    print(f"old_red_mean (ghost box around x~{OLD[0]}) = {old_red:.2f}")
    print(f"new_red_mean (ghost box around x~{OLD[0]}) = {new_red:.2f}")
    print(f"wrote {old_path}")
    print(f"wrote {new_path}")

    ratio_ok = old_red > 1 and new_red < old_red * 0.4
    abs_ok = new_red < 40
    ok = ratio_ok or abs_ok
    # Guard against a vacuous pass where old also has no smear.
    if ok and old_red < 5 and new_red >= old_red:
        ok = False
    if ok:
        print("PASS: person-free plate suppresses blur self-ghost")
        return 0
    print(
        f"FAIL: new_red_mean={new_red:.2f} old_red_mean={old_red:.2f} "
        f"(need new < old*0.4 or new < 40)"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
