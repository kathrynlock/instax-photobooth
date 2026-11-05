"""Compose captured frames into a single 600x800 instant-film print.

Supports three layouts (see config.LAYOUTS):
  single  one photo
  duo     two photos stacked
  quad    a 2x2 grid of four photos

Every layout keeps the cream border and the thick bottom chin, with a small
date caption in the chin."""

import cv2
import numpy as np

from . import config as cfg
from .film import apply_film_look


def center_crop_to_aspect(img, target_w, target_h):
    """Center-crop img to the target aspect ratio without distorting it."""
    h, w = img.shape[:2]
    target = target_w / target_h
    current = w / h
    if current > target:          # too wide, trim the sides
        new_w = int(round(h * target))
        x0 = (w - new_w) // 2
        return img[:, x0:x0 + new_w]
    new_h = int(round(w / target))  # too tall, trim top/bottom
    y0 = (h - new_h) // 2
    return img[y0:y0 + new_h, :]


def render_cell(frame_bgr, cell_w, cell_h):
    """Crop a frame to a cell's aspect, resize, and apply the film look."""
    cropped = center_crop_to_aspect(frame_bgr, cell_w, cell_h)
    photo = cv2.resize(cropped, (cell_w, cell_h), interpolation=cv2.INTER_AREA)
    return apply_film_look(photo)


def stamp_chin(canvas, text):
    """Center a small sepia caption in the bottom chin of the print."""
    font = cv2.FONT_HERSHEY_TRIPLEX
    scale = 0.9
    thick = 1
    (tw, th), _ = cv2.getTextSize(text, font, scale, thick)
    x = (cfg.CANVAS_W - tw) // 2
    y = cfg.CANVAS_H - (cfg.BOTTOM_MARGIN - th) // 2
    cv2.putText(canvas, text, (x, y), font, scale, cfg.CHIN_TEXT_COLOR, thick, cv2.LINE_AA)


def compose_print(frames, layout_name=cfg.DEFAULT_LAYOUT, caption=""):
    """Lay graded frames into the chosen layout on a 600x800 cream canvas.

    `frames` must hold at least the layout's photo_count frames; extras are
    ignored. Returns a 600x800 BGR uint8 image ready to print.
    """
    if layout_name not in cfg.LAYOUTS:
        raise ValueError(f"unknown layout {layout_name!r}; choose from {list(cfg.LAYOUTS)}")
    rows, cols, count = cfg.LAYOUTS[layout_name]
    if len(frames) < count:
        raise ValueError(f"layout {layout_name!r} needs {count} frames, got {len(frames)}")

    region_w = cfg.CANVAS_W - 2 * cfg.SIDE_MARGIN
    region_h = cfg.CANVAS_H - cfg.TOP_MARGIN - cfg.BOTTOM_MARGIN
    cell_w = (region_w - (cols - 1) * cfg.GUTTER) // cols
    cell_h = (region_h - (rows - 1) * cfg.GUTTER) // rows

    canvas = np.full((cfg.CANVAS_H, cfg.CANVAS_W, 3), cfg.BORDER_COLOR, dtype=np.uint8)

    for i in range(count):
        r, c = divmod(i, cols)
        x = cfg.SIDE_MARGIN + c * (cell_w + cfg.GUTTER)
        y = cfg.TOP_MARGIN + r * (cell_h + cfg.GUTTER)
        canvas[y:y + cell_h, x:x + cell_w] = render_cell(frames[i], cell_w, cell_h)

    if cfg.DATE_STAMP and caption:
        stamp_chin(canvas, caption)

    return canvas
