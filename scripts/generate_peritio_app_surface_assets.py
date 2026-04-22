from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "mobile" / "assets"

SAGE = "#657063"
SAGE_DEEP = "#566052"
SAGE_SHADOW = "#465045"
GOLD = "#F0DFC0"
GOLD_MUTED = "#D8C5A1"
CREAM = "#F5EAD2"
SHADOW = (35, 39, 35, 92)

ICON_PATH = ASSETS_DIR / "peritio-app-icon.png"
ADAPTIVE_PATH = ASSETS_DIR / "peritio-adaptive-icon.png"
FAVICON_PATH = ASSETS_DIR / "peritio-favicon.png"
SPLASH_PATH = ASSETS_DIR / "peritio-startup-screen.png"

GEORGIA_BOLD = Path(r"C:\Windows\Fonts\georgiab.ttf")
GEORGIA_REGULAR = Path(r"C:\Windows\Fonts\georgia.ttf")
ARIAL_BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")


def load_font(path: Path, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def make_background(width: int, height: int) -> Image.Image:
    base = Image.new("RGBA", (width, height), SAGE)
    noise = Image.effect_noise((width, height), 12).convert("L").filter(ImageFilter.GaussianBlur(0.7))
    noise_tint = ImageOps.colorize(noise, black=SAGE_DEEP, white="#7A8575").convert("RGBA")
    noise_tint.putalpha(34)
    base.alpha_composite(noise_tint)

    weave = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(weave)
    for y in range(0, height, max(6, height // 160)):
        draw.line((0, y, width, y), fill=(255, 255, 255, 11), width=1)
    for x in range(0, width, max(8, width // 120)):
        draw.line((x, 0, x, height), fill=(30, 36, 30, 10), width=1)
    weave = weave.filter(ImageFilter.GaussianBlur(0.5))
    base.alpha_composite(weave)

    highlight = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    hdraw = ImageDraw.Draw(highlight)
    hdraw.ellipse((-width * 0.2, -height * 0.15, width * 0.9, height * 0.55), fill=(255, 255, 255, 24))
    hdraw.ellipse((width * 0.35, height * 0.45, width * 1.25, height * 1.15), fill=(0, 0, 0, 30))
    highlight = highlight.filter(ImageFilter.GaussianBlur(max(24, width // 28)))
    base.alpha_composite(highlight)
    return base


def parallelogram_points(x: float, y: float, width: float, height: float, slant: float) -> list[tuple[float, float]]:
    return [
        (x + slant, y),
        (x + width, y),
        (x + width - slant, y + height),
        (x, y + height),
    ]


def draw_tracked_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    center_x: float,
    top_y: float,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: tuple[int, int, int, int],
    tracking: int,
) -> None:
    widths: list[int] = []
    for character in text:
        left, _, right, bottom = draw.textbbox((0, 0), character, font=font)
        widths.append(right - left)
    total_width = sum(widths) + max(0, len(text) - 1) * tracking
    cursor_x = center_x - total_width / 2
    for index, character in enumerate(text):
        draw.text((cursor_x, top_y), character, font=font, fill=fill)
        cursor_x += widths[index] + tracking


def draw_mark(canvas: Image.Image, *, center_x: float, center_y: float, scale: float, include_wordmark: bool) -> None:
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    main = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(main)

    stroke = max(6, int(scale * 9))
    accent_stroke = max(4, int(scale * 6))
    shadow_offset = max(8, int(scale * 12))

    outer = parallelogram_points(center_x - scale * 245, center_y - scale * 245, scale * 500, scale * 520, scale * 118)
    inner = parallelogram_points(center_x - scale * 170, center_y - scale * 188, scale * 405, scale * 432, scale * 96)
    right = parallelogram_points(center_x + scale * 150, center_y - scale * 180, scale * 190, scale * 275, scale * 70)

    def draw_frame(target: ImageDraw.ImageDraw, offset_x: float, offset_y: float, color: tuple[int, int, int, int]) -> None:
        def offset(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
            return [(x + offset_x, y + offset_y) for x, y in points]

        for points in (outer, inner, right):
            frame_points = offset(points)
            target.line(frame_points + [frame_points[0]], fill=color, width=stroke, joint="curve")

        target.line(
            [
                (center_x - scale * 334 + offset_x, center_y - scale * 16 + offset_y),
                (center_x - scale * 334 + offset_x, center_y + scale * 186 + offset_y),
            ],
            fill=color,
            width=accent_stroke,
        )
        target.line(
            [
                (center_x - scale * 362 + offset_x, center_y + scale * 4 + offset_y),
                (center_x - scale * 362 + offset_x, center_y + scale * 154 + offset_y),
            ],
            fill=color,
            width=max(3, accent_stroke - 1),
        )
        target.line(
            [
                (center_x - scale * 390 + offset_x, center_y + scale * 28 + offset_y),
                (center_x - scale * 390 + offset_x, center_y + scale * 214 + offset_y),
            ],
            fill=color,
            width=max(3, accent_stroke - 1),
        )
        target.line(
            [
                (center_x + scale * 307 + offset_x, center_y - scale * 170 + offset_y),
                (center_x + scale * 307 + offset_x, center_y + scale * 65 + offset_y),
            ],
            fill=color,
            width=accent_stroke,
        )

        target.line(
            [
                (center_x - scale * 38 + offset_x, center_y - scale * 130 + offset_y),
                (center_x + scale * 198 + offset_x, center_y - scale * 224 + offset_y),
            ],
            fill=color,
            width=max(4, accent_stroke - 1),
        )
        target.line(
            [
                (center_x - scale * 205 + offset_x, center_y + scale * 242 + offset_y),
                (center_x - scale * 78 + offset_x, center_y + scale * 196 + offset_y),
            ],
            fill=color,
            width=max(4, accent_stroke - 1),
        )

    draw_frame(shadow_draw, shadow_offset, shadow_offset, SHADOW)
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(8, int(scale * 12))))
    canvas.alpha_composite(shadow)

    gold_rgba = ImageColor.getcolor(GOLD, "RGBA")
    muted_rgba = ImageColor.getcolor(GOLD_MUTED, "RGBA")
    draw_frame(draw, 0, 0, muted_rgba)

    serif_font = load_font(GEORGIA_BOLD, max(80, int(scale * 260)))
    p_shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    p_shadow_draw = ImageDraw.Draw(p_shadow)
    p_text = "P"
    p_box = p_shadow_draw.textbbox((0, 0), p_text, font=serif_font)
    p_width = p_box[2] - p_box[0]
    p_height = p_box[3] - p_box[1]
    p_x = center_x - p_width / 2
    p_y = center_y - p_height / 2 - scale * 10
    p_shadow_draw.text((p_x + shadow_offset, p_y + shadow_offset), p_text, font=serif_font, fill=SHADOW)
    p_shadow = p_shadow.filter(ImageFilter.GaussianBlur(max(12, int(scale * 14))))
    canvas.alpha_composite(p_shadow)

    gradient = Image.new("RGBA", (1, p_height + max(1, int(scale * 16))), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(gradient)
    top_color = ImageColor.getrgb(CREAM)
    bottom_color = ImageColor.getrgb("#E7D1AB")
    for y in range(gradient.height):
        ratio = y / max(1, gradient.height - 1)
        color = tuple(int(top_color[index] * (1 - ratio) + bottom_color[index] * ratio) for index in range(3))
        gdraw.line((0, y, 1, y), fill=color + (255,))
    gradient = gradient.resize((p_width + max(1, int(scale * 12)), p_height + max(1, int(scale * 16))))

    p_mask = Image.new("L", gradient.size, 0)
    mask_draw = ImageDraw.Draw(p_mask)
    mask_draw.text((max(1, int(scale * 6)), max(1, int(scale * 8))), p_text, font=serif_font, fill=255)
    gradient_position = (int(p_x - scale * 6), int(p_y - scale * 8))
    main.paste(gradient, gradient_position, p_mask)

    if include_wordmark:
        wordmark_font = load_font(GEORGIA_REGULAR, max(50, int(scale * 110)))
        tagline_font = load_font(ARIAL_BOLD, max(24, int(scale * 34)))

        wordmark_top = center_y + scale * 350
        tagline_top = wordmark_top + scale * 144
        shadow_wordmark = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        shadow_wordmark_draw = ImageDraw.Draw(shadow_wordmark)
        draw_tracked_text(
            shadow_wordmark_draw,
            "PERITIO",
            center_x=center_x,
            top_y=wordmark_top + shadow_offset * 0.7,
            font=wordmark_font,
            fill=SHADOW,
            tracking=max(4, int(scale * 24)),
        )
        draw_tracked_text(
            shadow_wordmark_draw,
            "IMPROVE WITH PRECISION",
            center_x=center_x,
            top_y=tagline_top + shadow_offset * 0.45,
            font=tagline_font,
            fill=SHADOW,
            tracking=max(3, int(scale * 11)),
        )
        shadow_wordmark = shadow_wordmark.filter(ImageFilter.GaussianBlur(max(4, int(scale * 7))))
        canvas.alpha_composite(shadow_wordmark)

        draw_tracked_text(
            draw,
            "PERITIO",
            center_x=center_x,
            top_y=wordmark_top,
            font=wordmark_font,
            fill=gold_rgba,
            tracking=max(4, int(scale * 24)),
        )
        draw_tracked_text(
            draw,
            "IMPROVE WITH PRECISION",
            center_x=center_x,
            top_y=tagline_top,
            font=tagline_font,
            fill=muted_rgba,
            tracking=max(3, int(scale * 11)),
        )

    canvas.alpha_composite(main)


def build_icon(size: int, *, adaptive: bool = False) -> Image.Image:
    canvas = make_background(size, size)
    scale = size / 1024
    if adaptive:
        scale *= 0.82
    draw_mark(
        canvas,
        center_x=size * 0.51,
        center_y=size * 0.48 if not adaptive else size * 0.5,
        scale=scale,
        include_wordmark=False,
    )
    return canvas.convert("RGB")


def build_startup_art(width: int, height: int) -> Image.Image:
    canvas = make_background(width, height)
    scale = min(width / 1024, height / 2400) * 1.35
    draw_mark(
        canvas,
        center_x=width * 0.5,
        center_y=height * 0.3,
        scale=scale,
        include_wordmark=True,
    )
    return canvas.convert("RGB")


def main() -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    build_icon(1024).save(ICON_PATH)
    build_icon(1024, adaptive=True).save(ADAPTIVE_PATH)
    build_icon(196).save(FAVICON_PATH)
    build_startup_art(1440, 3040).save(SPLASH_PATH)
    print(f"Wrote {ICON_PATH}")
    print(f"Wrote {ADAPTIVE_PATH}")
    print(f"Wrote {FAVICON_PATH}")
    print(f"Wrote {SPLASH_PATH}")


if __name__ == "__main__":
    from PIL import ImageColor  # Imported lazily to keep the module list near the helpers.

    main()
