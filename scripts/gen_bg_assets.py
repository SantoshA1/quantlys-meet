#!/usr/bin/env python3
"""License-clean Quantlys Meeting backdrops + short living loops.
Procedural only — no scraped/stock photos."""
from __future__ import annotations
import math, os, random, struct, subprocess, tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
except ImportError:
    raise SystemExit("Pillow required")

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "backgrounds"
W, H = 1920, 1080


def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(v)))


def lerp(a, b, t):
    return a + (b - a) * t


def noise(img, amp=8, seed=1):
    rnd = random.Random(seed)
    px = img.load()
    for y in range(0, img.height, 2):
        for x in range(0, img.width, 2):
            d = rnd.randint(-amp, amp)
            for dy in (0, 1):
                for dx in (0, 1):
                    xx, yy = x + dx, y + dy
                    if xx >= img.width or yy >= img.height:
                        continue
                    r, g, b = px[xx, yy][:3]
                    px[xx, yy] = (clamp(r + d), clamp(g + d), clamp(b + d))


def vignette(img, strength=0.35):
    overlay = Image.new("RGB", img.size, (0, 0, 0))
    mask = Image.new("L", img.size, 0)
    m = mask.load()
    cx, cy = img.width / 2, img.height / 2
    maxd = math.hypot(cx, cy)
    for y in range(img.height):
        for x in range(img.width):
            d = math.hypot(x - cx, y - cy) / maxd
            m[x, y] = clamp(255 * (d ** 1.6) * strength)
    return Image.composite(overlay, img, mask)


def soft_blur(img, r=1.4):
    return img.filter(ImageFilter.GaussianBlur(radius=r))


def gradient(w, h, c0, c1, vertical=True):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for i in range(h if vertical else w):
        t = i / max(1, (h if vertical else w) - 1)
        c = tuple(int(lerp(c0[k], c1[k], t)) for k in range(3))
        if vertical:
            for x in range(w):
                px[x, i] = c
        else:
            for y in range(h):
                px[i, y] = c
    return img


def radial(w, h, cx, cy, c0, c1, radius):
    img = Image.new("RGB", (w, h), c1)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = min(1.0, math.hypot(x - cx, y - cy) / radius)
            px[x, y] = tuple(int(lerp(c0[k], c1[k], t)) for k in range(3))
    return img


def draw_rect(draw, box, fill, outline=None, width=1):
    draw.rectangle(box, fill=fill, outline=outline, width=width)


def office_atrium():
    """Quiet tech atrium — glass, soft cyan light, clean desks."""
    img = gradient(W, H, (214, 228, 236), (168, 186, 198))
    d = ImageDraw.Draw(img)
    # far glass wall
    d.rectangle([420, 80, 1500, 780], fill=(190, 210, 222))
    for i in range(6):
        x = 420 + i * 180
        d.line([(x, 80), (x, 780)], fill=(120, 145, 165), width=4)
    for j in range(4):
        y = 80 + j * 175
        d.line([(420, y), (1500, y)], fill=(120, 145, 165), width=3)
    # soft sky glow through glass
    glow = radial(W, H, 960, 200, (255, 250, 240), (214, 228, 236), 900)
    img = Image.blend(img, glow, 0.35)
    d = ImageDraw.Draw(img)
    # floor
    d.rectangle([0, 780, W, H], fill=(150, 160, 170))
    d.polygon([(420, 780), (1500, 780), (1700, H), (220, H)], fill=(175, 185, 195))
    # left column
    d.rectangle([80, 60, 200, 900], fill=(95, 110, 125))
    d.rectangle([200, 60, 220, 900], fill=(70, 85, 98))
    # right column
    d.rectangle([1700, 60, 1840, 900], fill=(95, 110, 125))
    # desk silhouettes
    d.rounded_rectangle([260, 860, 700, 920], radius=8, fill=(90, 100, 112))
    d.rounded_rectangle([1220, 860, 1680, 920], radius=8, fill=(90, 100, 112))
    # neon accent strip
    d.rectangle([0, 40, W, 48], fill=(80, 220, 255))
    d.rectangle([0, 48, W, 52], fill=(40, 120, 160))
    noise(img, 6, 11)
    return soft_blur(vignette(img, 0.22), 1.2)


def library_warm():
    """Deep library with warm lamp light."""
    img = gradient(W, H, (48, 32, 24), (18, 12, 10))
    d = ImageDraw.Draw(img)
    rnd = random.Random(42)
    hues = [(90, 50, 35), (70, 45, 40), (110, 70, 45), (55, 40, 55),
            (40, 55, 70), (100, 60, 40), (60, 35, 30), (80, 55, 35)]
    for shelf in range(4):
        y0 = 70 + shelf * 230
        d.rectangle([40, y0 + 190, W - 40, y0 + 210], fill=(90, 60, 40))
        d.rectangle([40, y0, W - 40, y0 + 190], fill=(55, 38, 28))
        x = 60
        while x < W - 80:
            w = rnd.randint(14, 34)
            dh = rnd.randint(0, 28)
            c = hues[rnd.randint(0, len(hues) - 1)]
            d.rectangle([x, y0 + 10 + dh, x + w, y0 + 185], fill=c)
            if rnd.random() < 0.12:
                d.rectangle([x, y0 + 10 + dh, x + w, y0 + 185], fill=tuple(clamp(v + 20) for v in c))
            x += w + 3
    # warm lamp glow
    lamp = radial(W, H, int(W * 0.82), int(H * 0.42), (255, 200, 120), (18, 12, 10), 700)
    img = Image.blend(img, lamp, 0.45)
    noise(img, 5, 7)
    return soft_blur(vignette(img, 0.28), 1.3)


def neon_loft():
    """Soft neon loft — brick + cyan/magenta accents, big window."""
    img = gradient(W, H, (140, 90, 75), (90, 55, 48))
    d = ImageDraw.Draw(img)
    # brick pattern
    for row in range(36):
        y = row * 30
        off = 40 if row % 2 else 0
        for col in range(28):
            x = off + col * 80
            d.rectangle([x, y, x + 74, y + 26], outline=(180, 130, 110), width=1)
    # window sky
    sky = gradient(900, 720, (180, 210, 240), (255, 210, 170))
    img.paste(sky, (120, 80))
    d = ImageDraw.Draw(img)
    # mullions
    d.rectangle([100, 60, 1040, 820], outline=(25, 28, 34), width=14)
    for x in (400, 700):
        d.rectangle([x, 60, x + 10, 820], fill=(25, 28, 34))
    for y in (300, 540):
        d.rectangle([100, y, 1040, y + 10], fill=(25, 28, 34))
    # neon strips
    d.rectangle([1120, 120, 1140, 700], fill=(0, 230, 255))
    d.rectangle([1160, 160, 1175, 660], fill=(255, 60, 180))
    # floor + sun pool
    d.rectangle([0, 820, W, H], fill=(70, 45, 38))
    d.polygon([(140, 820), (900, 820), (1100, H), (60, H)], fill=(255, 220, 160))
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.polygon([(140, 820), (900, 820), (1100, H), (60, H)], fill=(255, 230, 180, 90))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    noise(img, 6, 19)
    return soft_blur(vignette(img, 0.2), 1.15)


def glass_city():
    """Glass city at dusk through a window."""
    img = gradient(W, H, (20, 28, 48), (90, 55, 70))
    # mid sky band
    band = gradient(W, 400, (50, 55, 90), (140, 80, 70))
    img.paste(band, (0, 400))
    d = ImageDraw.Draw(img)
    rnd = random.Random(9)
    towers = [
        (80, 380, 180, H), (220, 300, 140, H), (380, 250, 200, H),
        (620, 340, 160, H), (820, 200, 190, H), (1050, 280, 170, H),
        (1280, 320, 150, H), (1500, 240, 200, H), (1750, 360, 140, H),
    ]
    for i, (x, y, w, h) in enumerate(towers):
        shade = 18 + (i % 4) * 6
        d.rectangle([x, y, x + w, H], fill=(shade, shade + 6, shade + 16))
        for yy in range(y + 12, H - 20, 22):
            for xx in range(x + 8, x + w - 12, 18):
                if rnd.random() > 0.35:
                    lit = (255, 210, 120) if rnd.random() > 0.4 else (120, 190, 255)
                    d.rectangle([xx, yy, xx + 10, yy + 12], fill=lit)
    # window frame
    d.rectangle([0, 0, W, 50], fill=(18, 20, 26))
    d.rectangle([0, H - 50, W, H], fill=(18, 20, 26))
    d.rectangle([0, 0, 50, H], fill=(18, 20, 26))
    d.rectangle([W - 50, 0, W, H], fill=(18, 20, 26))
    d.rectangle([W // 2 - 12, 0, W // 2 + 12, H], fill=(18, 20, 26))
    noise(img, 5, 3)
    return soft_blur(vignette(img, 0.25), 1.25)


def coastal_lounge():
    """Calm coastal modern interior."""
    img = gradient(W, H, (232, 238, 242), (210, 220, 226))
    d = ImageDraw.Draw(img)
    # ocean window
    ocean = gradient(1100, 620, (140, 190, 220), (70, 140, 170))
    # horizon haze
    for y in range(280):
        t = y / 280
        c = tuple(int(lerp(200, 140, t)) for _ in range(2)) + (int(lerp(220, 200, t)),)
        ImageDraw.Draw(ocean).line([(0, y), (1100, y)], fill=c)
    img.paste(ocean, (360, 80))
    d = ImageDraw.Draw(img)
    d.rectangle([340, 60, 1480, 720], outline=(240, 244, 248), width=18)
    # floor
    d.rectangle([0, 780, W, H], fill=(210, 195, 175))
    # sofa
    d.rounded_rectangle([200, 720, 900, 920], radius=28, fill=(120, 140, 150))
    d.rounded_rectangle([240, 660, 520, 780], radius=22, fill=(140, 160, 170))
    d.rounded_rectangle([540, 660, 820, 780], radius=22, fill=(140, 160, 170))
    # plant
    d.ellipse([1550, 640, 1720, 820], fill=(55, 110, 80))
    d.ellipse([1580, 580, 1700, 700], fill=(70, 130, 95))
    d.rectangle([1610, 800, 1660, 920], fill=(160, 120, 90))
    # soft daylight
    day = radial(W, H, 900, 200, (255, 252, 245), (232, 238, 242), 1000)
    img = Image.blend(img, day, 0.3)
    noise(img, 5, 21)
    return soft_blur(vignette(img, 0.18), 1.1)


SCENES = {
    "office": ("office.jpg", office_atrium),
    "library": ("library.jpg", library_warm),
    "loft": ("loft.jpg", neon_loft),
    "city": ("city.jpg", glass_city),
    "lounge": ("lounge.jpg", coastal_lounge),
}


def save_jpg(img, path, quality=88):
    img = img.convert("RGB")
    # slight extra DOF so backdrop sits behind a person
    img = img.filter(ImageFilter.GaussianBlur(radius=0.8))
    img.save(path, "JPEG", quality=quality, optimize=True, progressive=True)


def make_loop(name, frames, out_path, fps=24):
    """Write frames to a short muted seamless webm (vp9) + mp4 fallback."""
    tmp = Path(tempfile.mkdtemp(prefix="qmloop_"))
    try:
        for i, fr in enumerate(frames):
            fr.save(tmp / f"f{i:04d}.png")
        # Prefer webm for size; also mp4 for Safari shelf preview if needed
        webm = out_path.with_suffix(".webm")
        mp4 = out_path.with_suffix(".mp4")
        pattern = str(tmp / "f%04d.png")
        subprocess.run([
            "ffmpeg", "-y", "-framerate", str(fps), "-i", pattern,
            "-an", "-c:v", "libvpx-vp9", "-b:v", "1.2M", "-crf", "32",
            "-pix_fmt", "yuv420p", "-loop", "0", str(webm),
        ], check=True, capture_output=True)
        subprocess.run([
            "ffmpeg", "-y", "-framerate", str(fps), "-i", pattern,
            "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "26",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(mp4),
        ], check=True, capture_output=True)
        return webm, mp4
    finally:
        for p in tmp.glob("*"):
            p.unlink(missing_ok=True)
        tmp.rmdir()


def beach_frames(n=48):
    """Soft dusk waves — calm, not gimmicky."""
    base = glass_city()  # reuse dusk palette, then replace with sea
    frames = []
    for i in range(n):
        t = i / n
        img = gradient(W, H, (30, 40, 70), (180, 110, 90))
        d = ImageDraw.Draw(img)
        # sea bands with phase shift
        for band in range(14):
            y = 420 + band * 40
            phase = math.sin(t * math.pi * 2 + band * 0.45) * 18
            c = (40 + band * 6, 90 + band * 5, 130 + band * 3)
            d.polygon([
                (0, y + phase), (W, y - phase * 0.4),
                (W, y + 50), (0, y + 50),
            ], fill=c)
        # sky glow
        glow = radial(W, H, W // 2, 280, (255, 180, 120), (30, 40, 70), 800)
        img = Image.blend(img, glow, 0.35)
        # soft foam sparkle
        rnd = random.Random(i + 3)
        d = ImageDraw.Draw(img)
        for _ in range(40):
            x = rnd.randint(0, W - 1)
            y = rnd.randint(500, 900)
            d.ellipse([x, y, x + 3, y + 2], fill=(230, 230, 240))
        frames.append(soft_blur(vignette(img, 0.2), 1.0).resize((1280, 720), Image.Resampling.LANCZOS))
    return frames


def courtyard_frames(n=48):
    """Courtyard breeze — leaves drifting, soft depth."""
    frames = []
    leaves = [(random.Random(k).random(), random.Random(k + 1).random(), random.Random(k + 2).random()) for k in range(28)]
    for i in range(n):
        t = i / n
        img = gradient(W, H, (200, 215, 200), (120, 150, 130))
        d = ImageDraw.Draw(img)
        # arch / courtyard walls
        d.rectangle([0, 0, 280, H], fill=(160, 150, 135))
        d.rectangle([W - 280, 0, W, H], fill=(150, 140, 128))
        d.ellipse([400, 40, 1520, 900], outline=(100, 130, 110), width=8)
        d.rectangle([0, 820, W, H], fill=(90, 110, 85))
        for lx, ly, sp in leaves:
            x = int((lx + t * sp) % 1.0 * W)
            y = int((ly + math.sin(t * 6 + lx * 10) * 0.04) * H * 0.7 + 80)
            d.ellipse([x, y, x + 18, y + 10], fill=(50, 110, 60))
            d.ellipse([x + 6, y - 4, x + 22, y + 6], fill=(70, 140, 80))
        frames.append(soft_blur(vignette(img, 0.18), 1.0).resize((1280, 720), Image.Resampling.LANCZOS))
    return frames


def city_shimmer_frames(n=48):
    """Subtle city light shimmer."""
    base = glass_city().resize((1280, 720), Image.Resampling.LANCZOS)
    frames = []
    rnd0 = random.Random(77)
    lights = [(rnd0.randint(40, 1240), rnd0.randint(120, 600), rnd0.random()) for _ in range(80)]
    for i in range(n):
        t = i / n
        img = base.copy()
        d = ImageDraw.Draw(img)
        for x, y, phase in lights:
            pulse = 0.45 + 0.55 * (0.5 + 0.5 * math.sin(t * math.pi * 2 + phase * 12))
            if pulse < 0.55:
                continue
            c = (255, int(200 + 40 * pulse), int(100 + 40 * pulse))
            d.rectangle([x, y, x + 6, y + 8], fill=c)
        frames.append(soft_blur(img, 0.6))
    return frames


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("Generating stills…")
    for key, (fname, fn) in SCENES.items():
        img = fn()
        path = OUT / fname
        save_jpg(img, path)
        print(f"  wrote {path} ({path.stat().st_size // 1024} KB)")

    print("Generating loops…")
    loops = [
        ("beach", beach_frames),
        ("courtyard", courtyard_frames),
        ("citylights", city_shimmer_frames),
    ]
    for name, fn in loops:
        frames = fn()
        webm, mp4 = make_loop(name, frames, OUT / name)
        print(f"  wrote {webm.name} ({webm.stat().st_size // 1024} KB), {mp4.name} ({mp4.stat().st_size // 1024} KB)")
        # poster still from first frame
        frames[0].save(OUT / f"{name}.jpg", "JPEG", quality=85, optimize=True)
        print(f"  wrote {name}.jpg poster")

    print("done")


if __name__ == "__main__":
    main()
