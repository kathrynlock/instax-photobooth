"""Draw text onto BGR OpenCV images with a TrueType font (via Pillow), since
OpenCV's built-in Hershey fonts can't load custom typefaces."""

from functools import lru_cache

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import config as cfg


@lru_cache(maxsize=None)
def _font(size):
    font = ImageFont.truetype(str(cfg.UI_FONT), size)
    try:
        font.set_variation_by_axes([cfg.UI_FONT_WEIGHT])
    except OSError:
        pass   # not a variable font; use it as-is
    return font


def draw_text(img, text, xy, size, color, anchor="la", outline=None, outline_width=0):
    """Draw `text` onto BGR uint8 `img` in place and return it.

    xy is interpreted per Pillow's `anchor` (e.g. "la" = left/ascender,
    "mm" = centered on both axes, "ms" = centered on the baseline).
    Colors are BGR, matching the rest of the codebase.
    """
    font = _font(size)
    ow = outline_width if outline is not None else 0
    # Work only in the region the text covers, so per-frame overlays stay cheap.
    pad = ow + 2
    l, t, r, b = ImageDraw.Draw(Image.new("L", (1, 1))).textbbox(xy, text, font=font, anchor=anchor)
    h, w = img.shape[:2]
    l, t = max(int(l) - pad, 0), max(int(t) - pad, 0)
    r, b = min(int(r) + pad, w), min(int(b) + pad, h)
    if r <= l or b <= t:
        return img

    # Render the glyphs as an anti-aliased mask. The outline is that mask
    # dilated, rather than Pillow's stroke_width, which ignores the
    # variable-font weight and draws a mismatched (thin) outline.
    mask = Image.new("L", (r - l, b - t), 0)
    ImageDraw.Draw(mask).text((xy[0] - l, xy[1] - t), text, font=font, fill=255, anchor=anchor)
    fill_a = np.asarray(mask, np.float32)[..., None] / 255.0

    region = img[t:b, l:r].astype(np.float32)
    if ow:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * ow + 1, 2 * ow + 1))
        out_a = cv2.dilate(fill_a[..., 0], kernel)[..., None]
        region = region * (1 - out_a) + np.float32(outline) * out_a
    region = region * (1 - fill_a) + np.float32(color) * fill_a
    img[t:b, l:r] = region.astype(np.uint8)
    return img


def text_width(text, size):
    """Rendered width of `text` in pixels at `size`."""
    l, _, r, _ = _font(size).getbbox(text)
    return r - l


def fit_size(text, max_width, size, min_size=12):
    """Largest size <= `size` at which `text` fits in `max_width` pixels."""
    while size > min_size and text_width(text, size) > max_width:
        size -= 1
    return size


def draw_overlay(img, text, xy, size, anchor="la"):
    """Text over the live camera feed: cream fill with an iguana outline."""
    return draw_text(img, text, xy, size, cfg.OVERLAY_TEXT, anchor=anchor,
                     outline=cfg.OVERLAY_OUTLINE, outline_width=max(2, size // 20))
