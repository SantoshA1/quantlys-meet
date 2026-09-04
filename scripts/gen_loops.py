from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw
import math, subprocess, tempfile, random

OUT = Path("public/backgrounds")
W, H = 1280, 720

def encode(frames, stem, fps=24):
    tmp = Path(tempfile.mkdtemp(prefix="qm_"))
    for i, fr in enumerate(frames):
        fr.convert("RGB").save(tmp / f"f{i:04d}.png")
    webm, mp4 = OUT / f"{stem}.webm", OUT / f"{stem}.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-framerate", str(fps), "-i", str(tmp / "f%04d.png"),
        "-an", "-c:v", "libvpx-vp9", "-b:v", "1.5M", "-crf", "30",
        "-pix_fmt", "yuv420p", str(webm),
    ], check=True, capture_output=True)
    subprocess.run([
        "ffmpeg", "-y", "-framerate", str(fps), "-i", str(tmp / "f%04d.png"),
        "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "24",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(mp4),
    ], check=True, capture_output=True)
    frames[0].convert("RGB").save(OUT / f"{stem}.jpg", quality=86, optimize=True)
    for p in tmp.glob("*"):
        p.unlink()
    tmp.rmdir()
    print(stem, webm.stat().st_size // 1024, "KB webm", mp4.stat().st_size // 1024, "KB mp4")

def beach():
    frames = []
    for i in range(36):
        t = i / 36
        img = Image.new("RGB", (W, H), (30, 40, 70))
        d = ImageDraw.Draw(img)
        for y in range(280):
            u = y / 280
            c = (int(30 + u * 25), int(40 + u * 20), int(70 + u * 25))
            d.line([(0, y), (W, y)], fill=c)
        for y in range(280, 420):
            u = (y - 280) / 140
            c = (int(180 - u * 50), int(120 - u * 30), int(95 + u * 15))
            d.line([(0, y), (W, y)], fill=c)
        for band in range(12):
            y0 = 420 + band * 28
            phase = math.sin(t * math.pi * 2 + band * 0.45) * 16
            c = (40 + band * 6, 90 + band * 5, 130 + band * 4)
            d.polygon([(0, y0 + phase), (W, y0 - phase * 0.3), (W, y0 + 40), (0, y0 + 40)], fill=c)
        g = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(g)
        gd.ellipse([W // 2 - 160, 90, W // 2 + 160, 340], fill=(255, 170, 110, 80))
        img = Image.alpha_composite(img.convert("RGBA"), g.filter(ImageFilter.GaussianBlur(36))).convert("RGB")
        d = ImageDraw.Draw(img)
        for k in range(24):
            x = int((math.sin(t * 6 + k) * 0.5 + 0.5) * W)
            y = 520 + int(math.cos(t * 4 + k * 0.7) * 36) + k * 4
            d.ellipse([x, y, x + 3, y + 2], fill=(230, 235, 240))
        frames.append(img.filter(ImageFilter.GaussianBlur(0.8)))
    encode(frames, "beach")

def courtyard():
    base = Image.open(OUT / "lounge.jpg").convert("RGB").resize((W, H), Image.Resampling.LANCZOS)
    frames = []
    for i in range(36):
        t = i / 36
        img = base.copy()
        d = ImageDraw.Draw(img)
        for k in range(18):
            x = int(((k * 0.07 + t * 0.35 * (0.5 + 0.5 * math.sin(k))) % 1) * W)
            y = int(80 + (k * 37 + math.sin(t * 6 + k) * 30) % 500)
            d.ellipse([x, y, x + 16, y + 9], fill=(55, 120, 70))
            d.ellipse([x + 5, y - 3, x + 18, y + 5], fill=(70, 140, 85))
        frames.append(img.filter(ImageFilter.GaussianBlur(0.6)))
    encode(frames, "courtyard")

def citylights():
    base = Image.open(OUT / "city.jpg").convert("RGB").resize((W, H), Image.Resampling.LANCZOS)
    frames = []
    rnd = random.Random(7)
    lights = [(rnd.randint(60, 1220), rnd.randint(100, 580), rnd.random()) for _ in range(90)]
    for i in range(36):
        t = i / 36
        img = base.copy()
        d = ImageDraw.Draw(img)
        for x, y, ph in lights:
            pulse = 0.5 + 0.5 * math.sin(t * math.pi * 2 + ph * 14)
            if pulse < 0.55:
                continue
            d.rectangle([x, y, x + 5, y + 7], fill=(255, int(190 + 50 * pulse), int(90 + 50 * pulse)))
        frames.append(img.filter(ImageFilter.GaussianBlur(0.5)))
    encode(frames, "citylights")

if __name__ == "__main__":
    beach()
    courtyard()
    citylights()
    print("loops done")
