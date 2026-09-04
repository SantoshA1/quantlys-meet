#!/usr/bin/env python3
"""Visual regression: temporal background hist kills dark self-ghost.

Scene (320x180): blue background (0,0,200), DARK circle person (cap-like)
r=35. Frame A at x=80, Frame B at x=200 (person moved far enough that the
old pose sits outside the dilated current silhouette).

Old bug path (post-PR#20 lowres stamp):
  Downscale FULL frame B (including the dark person) and stamp that mush
  over the dilated person region. At the person location the tiny image is
  mostly the subject - so the plate still contains a dark self-blob that
  blur smears into a ghost beside the head.

New path (temporal hist):
  hist starts as frame A (blue under where B will stand); update hist with
  frame B only OUTSIDE the dilated person at x=200; blur hist; composite
  sharp person from B. Probe beside current head AND at old pose x=80:
  mean should be near blue (no dark ghost).
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

W, H = 320, 180
BG = (0, 0, 200)
# Dark cap-like subject - the real failure mode (not bright red on blue).
PERSON = (20, 20, 40)
R = 35
POS_A = (80, 90)
POS_B = (200, 90)
DILATE = 20  # match generous HIST_DILATE exclusion
FILL = (12, 7)
BLUR = 8
# Smear band just outside the sharp person at B (left of head).
GHOST_BOX = (150, 70, 162, 110)
# Old pose after the person moved - must stay blue on the hist path.
OLD_BOX = (60, 70, 78, 110)


def circle_mask(cx: int, cy: int, radius: int) -> Image.Image:
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius), fill=255
    )
    return m


def make_frame(cx: int, cy: int) -> Image.Image:
    im = Image.new("RGB", (W, H), BG)
    ImageDraw.Draw(im).ellipse(
        (cx - R, cy - R, cx + R, cy + R), fill=PERSON
    )
    return im


def mean_channel(img: Image.Image, ch: int, box) -> float:
    crop = img.crop(box)
    px = crop.load()
    tw, th = crop.size
    s = 0.0
    n = 0
    for y in range(th):
        for x in range(tw):
            s += px[x, y][ch]
            n += 1
    return s / n if n else float("nan")


def mean_luma(img: Image.Image, box) -> float:
    crop = img.crop(box)
    px = crop.load()
    tw, th = crop.size
    s = 0.0
    n = 0
    for y in range(th):
        for x in range(tw):
            r, g, b = px[x, y][:3]
            s += 0.299 * r + 0.587 * g + 0.114 * b
            n += 1
    return s / n if n else float("nan")


def old_algorithm(frame_b: Image.Image) -> Image.Image:
    """Lowres stamp of FULL frame B over dilated person - keeps dark self-blob."""
    dil = circle_mask(POS_B[0], POS_B[1], R + DILATE)
    tiny = frame_b.resize(FILL, Image.Resampling.BOX)
    mush = tiny.resize((W, H), Image.Resampling.BILINEAR)
    plate = frame_b.copy()
    plate.paste(mush, mask=dil)
    blurred = plate.filter(ImageFilter.BoxBlur(BLUR))
    out = blurred.copy()
    out.paste(frame_b, mask=circle_mask(POS_B[0], POS_B[1], R))
    return out


def new_algorithm(frame_a: Image.Image, frame_b: Image.Image) -> Image.Image:
    """Temporal hist: seed with A, update with B only outside dilated person."""
    dil = circle_mask(POS_B[0], POS_B[1], R + DILATE)
    room = Image.eval(dil, lambda v: 255 - v)
    hist = frame_a.copy()
    hist.paste(frame_b, mask=room)
    blurred = hist.filter(ImageFilter.BoxBlur(BLUR))
    out = blurred.copy()
    out.paste(frame_b, mask=circle_mask(POS_B[0], POS_B[1], R))
    return out


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "tmp"
    out_dir.mkdir(exist_ok=True)
    tmp = Path("/tmp")

    frame_a = make_frame(*POS_A)
    frame_b = make_frame(*POS_B)
    old = old_algorithm(frame_b)
    new = new_algorithm(frame_a, frame_b)

    old_path = out_dir / "ghost-hist-old.png"
    new_path = out_dir / "ghost-hist-new.png"
    old.save(old_path)
    new.save(new_path)
    old.save(tmp / "ghost-hist-old.png")
    new.save(tmp / "ghost-hist-new.png")

    bg_luma = 0.299 * BG[0] + 0.587 * BG[1] + 0.114 * BG[2]
    old_ghost = mean_luma(old, GHOST_BOX)
    new_ghost = mean_luma(new, GHOST_BOX)
    old_blue = mean_channel(old, 2, GHOST_BOX)
    new_blue = mean_channel(new, 2, GHOST_BOX)
    new_oldpose = mean_luma(new, OLD_BOX)
    new_oldpose_blue = mean_channel(new, 2, OLD_BOX)

    print(f"ghost box beside current head @x~{POS_B[0]}: {GHOST_BOX}")
    print(f"old_luma (dark mush ghost) = {old_ghost:.2f}")
    print(f"new_luma (near blue {bg_luma:.2f}) = {new_ghost:.2f}")
    print(f"old_blue = {old_blue:.2f}  new_blue = {new_blue:.2f}")
    print(f"old-pose box @x~{POS_A[0]}: new_luma={new_oldpose:.2f} new_blue={new_oldpose_blue:.2f}")
    print(f"wrote {old_path}")
    print(f"wrote {new_path}")

    # New path near current head and at old pose must stay near blue.
    new_ok = (
        abs(new_ghost - bg_luma) < 30
        and new_blue > 140
        and abs(new_oldpose - bg_luma) < 30
        and new_oldpose_blue > 140
    )
    # Old path must be visibly darker / less blue in the smear band.
    old_worse = old_ghost < new_ghost - 8 or old_blue < new_blue - 25

    # Sharpness: hard person paste must leave core pixels identical to source.
    hard = circle_mask(POS_B[0], POS_B[1], R - 4)  # well inside hard core
    px_src = frame_b.load()
    px_new = new.load()
    max_diff = 0
    for y in range(H):
        for x in range(W):
            if hard.getpixel((x, y)) < 255:
                continue
            a = px_src[x, y]
            b = px_new[x, y]
            for c in range(3):
                d = abs(a[c] - b[c])
                if d > max_diff:
                    max_diff = d
    sharp_ok = max_diff <= 2
    print(f"person-core max abs diff vs source = {max_diff} (need <= 2)")

    ok = new_ok and old_worse and sharp_ok
    if ok:
        print("PASS: temporal hist suppresses dark self-ghost + hard person stays sharp")
        return 0
    print(
        f"FAIL: new_ghost={new_ghost:.2f} old_ghost={old_ghost:.2f} "
        f"new_blue={new_blue:.2f} old_blue={old_blue:.2f} "
        f"oldpose_luma={new_oldpose:.2f} sharp_diff={max_diff} "
        f"(need new near blue {bg_luma:.2f}, old darker, person core == source)"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
