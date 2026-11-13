"""Compose captured frames into a single 600x800 instant-film print.

Supports three layouts (see config.LAYOUTS):
  single  one photo
  duo     two photos stacked, rotated to be viewed with the print sideways
  quad    a 2x2 grid of four photos

The print fills the film's whole picture area: the white frame and chin are
part of the physical film, not the image. film_card() draws a print on a
true-proportioned Instax Mini card for on-screen previews."""

import cv2
import numpy as np

from . import config as cfg
from .film import apply_film_look


def center_crop_to_aspect(img, target_w, target_h):
    """Center-crop img to the target aspect ratio without distorting it."""
    h, w = img.shape[:2]
    target = target_w / target_h
    if w / h > target:              # too wide, trim the sides
        new_w = int(round(h * target))
        x0 = (w - new_w) // 2
        return img[:, x0:x0 + new_w]
    new_h = int(round(w / target))  # too tall, trim top/bottom
    y0 = (h - new_h) // 2
    return img[y0:y0 + new_h, :]


def cell_rects(layout_name):
    """(x, y, w, h) of each photo cell on the print, in fill order."""
    rows, cols, count = cfg.LAYOUTS[layout_name]
    cell_w = (cfg.CANVAS_W - (cols - 1) * cfg.GUTTER) // cols
    cell_h = (cfg.CANVAS_H - (rows - 1) * cfg.GUTTER) // rows
    rects = []
    for i in range(count):
        r, c = divmod(i, cols)
        rects.append((c * (cell_w + cfg.GUTTER), r * (cell_h + cfg.GUTTER), cell_w, cell_h))
    return rects


def orient_for_layout(frame, layout_name):
    """Rotate a frame for sideways layouts (see config.SIDEWAYS_LAYOUTS)."""
    if layout_name in cfg.SIDEWAYS_LAYOUTS:
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    return frame


def render_cell(frame_bgr, cell_w, cell_h):
    """Crop a frame to a cell's aspect, resize, and apply the film look."""
    cropped = center_crop_to_aspect(frame_bgr, cell_w, cell_h)
    photo = cv2.resize(cropped, (cell_w, cell_h), interpolation=cv2.INTER_AREA)
    return apply_film_look(photo)


def compose_print(frames, layout_name=cfg.DEFAULT_LAYOUT):
    """Lay graded frames into the chosen layout on a 600x800 canvas.

    `frames` must hold at least the layout's photo_count frames; extras are
    ignored. Returns a 600x800 BGR uint8 image ready to print.
    """
    if layout_name not in cfg.LAYOUTS:
        raise ValueError(f"unknown layout {layout_name!r}; choose from {list(cfg.LAYOUTS)}")
    count = cfg.LAYOUTS[layout_name][2]
    if len(frames) < count:
        raise ValueError(f"layout {layout_name!r} needs {count} frames, got {len(frames)}")

    canvas = np.full((cfg.CANVAS_H, cfg.CANVAS_W, 3), cfg.BORDER_COLOR, dtype=np.uint8)
    for i, (x, y, w, h) in enumerate(cell_rects(layout_name)):
        frame = orient_for_layout(frames[i], layout_name)
        canvas[y:y + h, x:x + w] = render_cell(frame, w, h)

    return canvas


def film_card_geometry(card_h):
    """(card_w, card_h, (x, y, w, h) of the picture area) for an on-screen
    Instax Mini card card_h pixels tall."""
    card_wmm, card_hmm = cfg.FILM_CARD_MM
    side, top, bottom = cfg.FILM_BORDER_MM
    px_per_mm = card_h / card_hmm
    card_w = round(card_wmm * px_per_mm)
    x, y = round(side * px_per_mm), round(top * px_per_mm)
    w = card_w - 2 * x
    h = card_h - y - round(bottom * px_per_mm)
    return card_w, card_h, (x, y, w, h)


def film_card(print_img, card_h=cfg.PREVIEW_CARD_H, empty_color=None):
    """The print as it will come out of the printer: on a white Instax Mini
    card with the thick chin, card_h pixels tall. With print_img None, the
    picture area is filled with empty_color instead."""
    card_w, card_h, (x, y, w, h) = film_card_geometry(card_h)
    card = np.full((card_h, card_w, 3), cfg.BORDER_COLOR, np.uint8)
    if print_img is not None:
        card[y:y + h, x:x + w] = cv2.resize(print_img, (w, h), interpolation=cv2.INTER_AREA)
    elif empty_color is not None:
        card[y:y + h, x:x + w] = empty_color
    return card
